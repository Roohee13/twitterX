package com.project.Xclone_backend.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.net.ServerSocket;
import java.time.Duration;
import java.util.Properties;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionSynchronizationUtils;

import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.GreenMailUtil;
import com.icegreen.greenmail.util.ServerSetupTest;
import com.project.Xclone_backend.config.MailProperties;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import jakarta.mail.internet.MimeMessage;

/** Email delivery against a real (embedded) SMTP server: what arrives, what a wrong login or a silent server looks like, and when sending happens. */
class EmailSenderTest {

    @RegisterExtension
    static GreenMailExtension smtp = new GreenMailExtension(ServerSetupTest.SMTP);

    private ThreadPoolTaskExecutor executor;

    @BeforeEach
    void setUp() {
        executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(100);
        executor.initialize();
        smtp.getManagers().getUserManager().setAuthRequired(true);
        smtp.setUser("login@example.com", "login@example.com", "app-password");
    }

    @AfterEach
    void tearDown() {
        executor.shutdown();
        TransactionSynchronizationManager.clear();
    }

    private JavaMailSenderImpl realSender(String host, int port, String user, String password, int timeoutMs) {
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost(host);
        sender.setPort(port);
        sender.setUsername(user);
        sender.setPassword(password);
        Properties p = sender.getJavaMailProperties();
        p.put("mail.smtp.auth", "true");
        p.put("mail.smtp.starttls.enable", "false"); // the embedded server has no TLS; production keeps it on (application.yaml)
        p.put("mail.smtp.connectiontimeout", String.valueOf(timeoutMs));
        p.put("mail.smtp.timeout", String.valueOf(timeoutMs));
        p.put("mail.smtp.writetimeout", String.valueOf(timeoutMs));
        return sender;
    }

    @SuppressWarnings("unchecked")
    private EmailSender emailSender(JavaMailSenderImpl sender) {
        ObjectProvider<org.springframework.mail.javamail.JavaMailSender> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(sender);
        return new EmailSender(provider, new MailProperties("login@example.com", "http://localhost:5173", Duration.ofHours(24), Duration.ofHours(1)), executor);
    }

    private EmailSender workingSender() {
        return emailSender(realSender("localhost", smtp.getSmtp().getPort(), "login@example.com", "app-password", 3000));
    }

    // --- what arrives ---

    @Test
    void aMessageReallyArrivesWithTheRightSenderRecipientSubjectAndText() throws Exception {
        workingSender().send("someone@example.com", "Verify your email", "Confirm your email address: http://localhost:5173/verify-email?token=abc");

        assertThat(smtp.waitForIncomingEmail(5000, 1)).isTrue();
        MimeMessage received = smtp.getReceivedMessages()[0];
        assertThat(received.getFrom()[0].toString()).isEqualTo("login@example.com");
        assertThat(received.getAllRecipients()[0].toString()).isEqualTo("someone@example.com");
        assertThat(received.getSubject()).isEqualTo("Verify your email");
        assertThat(GreenMailUtil.getBody(received)).contains("/verify-email?token=abc");
    }

    @Test
    void sendNowDeliversOnTheCallingThread() {
        workingSender().sendNow("me@example.com", "Test", "body");
        assertThat(smtp.getReceivedMessages()).hasSize(1); // already there, no waiting
    }

    // --- what goes wrong, and who hears about it ---

    @Test
    void aWrongPasswordIsReportedWithTheServersOwnWordsByTheDiagnosticsPathAndNeverBreaksNormalSending() {
        EmailSender wrongLogin = emailSender(realSender("localhost", smtp.getSmtp().getPort(), "login@example.com", "the-real-account-password", 3000));

        assertThatThrownBy(() -> wrongLogin.sendNow("me@example.com", "Test", "body"))
                .isInstanceOf(MailDeliveryException.class).hasMessageContaining("535").hasMessageNotContaining("the-real-account-password");
        wrongLogin.send("me@example.com", "Normal path", "body"); // logs, does not throw
        assertThat(smtp.getReceivedMessages()).isEmpty();
    }

    @Test
    void anUnreachableServerFailsFastAndIsReported() {
        EmailSender nobodyHome = emailSender(realSender("localhost", 1, "login@example.com", "app-password", 2000)); // nothing listens on port 1

        long start = System.nanoTime();
        assertThatThrownBy(() -> nobodyHome.sendNow("me@example.com", "Test", "body")).isInstanceOf(MailDeliveryException.class);
        assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(5));
    }

    @Test
    void aServerThatAcceptsTheConnectionButNeverAnswersIsGivenUpOnAfterTheTimeoutAndDoesNotHoldUpTheRequest() throws Exception {
        try (ServerSocket silent = new ServerSocket(0)) {
            Thread accept = new Thread(() -> {
                try {
                    silent.accept(); // takes the connection and says nothing
                    Thread.sleep(10_000);
                } catch (Exception ignored) {
                    // the test ended
                }
            });
            accept.setDaemon(true);
            accept.start();
            EmailSender stuck = emailSender(realSender("localhost", silent.getLocalPort(), "login@example.com", "app-password", 800));

            // The normal path hands the work to a background thread: the caller is not kept waiting at all.
            long start = System.nanoTime();
            stuck.send("me@example.com", "Test", "body");
            assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofMillis(500));

            // The diagnostics path waits, but only as long as the timeout.
            start = System.nanoTime();
            assertThatThrownBy(() -> stuck.sendNow("me@example.com", "Test", "body")).isInstanceOf(MailDeliveryException.class);
            assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(5));
        }
    }

    // --- when sending happens ---

    @Test
    void insideATransactionNothingIsSentUntilItCommits() throws Exception {
        EmailSender sender = workingSender();
        TransactionSynchronizationManager.initSynchronization();

        sender.send("me@example.com", "After commit", "body");
        Thread.sleep(300);
        assertThat(smtp.getReceivedMessages()).isEmpty(); // still inside the transaction

        TransactionSynchronizationUtils.triggerAfterCommit();
        assertThat(smtp.waitForIncomingEmail(5000, 1)).isTrue();
        assertThat(smtp.getReceivedMessages()).hasSize(1);
    }

    @Test
    void aRolledBackTransactionSendsNothing() throws Exception {
        EmailSender sender = workingSender();
        TransactionSynchronizationManager.initSynchronization();

        sender.send("me@example.com", "Never", "body");
        TransactionSynchronizationManager.clearSynchronization(); // rolled back: afterCommit is never called

        Thread.sleep(500);
        assertThat(smtp.getReceivedMessages()).isEmpty();
    }

    // --- no SMTP configured ---

    @Test
    @SuppressWarnings("unchecked")
    void withoutAnSmtpServerTheMessageIsLoggedAndTheDiagnosticsPathSaysSo() {
        ObjectProvider<org.springframework.mail.javamail.JavaMailSender> none = mock(ObjectProvider.class);
        when(none.getIfAvailable()).thenReturn(null);
        EmailSender logOnly = new EmailSender(none, new MailProperties("a@b.c", "http://x", Duration.ofHours(1), Duration.ofHours(1)), executor);
        Logger logger = (Logger) LoggerFactory.getLogger(EmailSender.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            logOnly.send("someone@example.com", "Reset your password", "Reset: /reset-password?token=zzz");
            assertThat(appender.list).anyMatch(e -> e.getFormattedMessage().contains("Email not sent (no SMTP configured)")
                    && e.getFormattedMessage().contains("To: someone@example.com") && e.getFormattedMessage().contains("/reset-password?token=zzz"));
        } finally {
            logger.detachAppender(appender);
        }
        assertThatThrownBy(() -> logOnly.sendNow("someone@example.com", "x", "y")).isInstanceOf(MailNotConfiguredException.class);
    }
}
