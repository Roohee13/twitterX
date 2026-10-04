package com.project.Xclone_backend.auth;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;
import jakarta.annotation.PreDestroy;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.project.Xclone_backend.config.MailProperties;

/**
 * Sends plain-text email through SMTP when {@code spring.mail.host} is configured; otherwise logs the message, so the app still
 * works locally and in tests and the emailed links can be copied from the log.
 *
 * {@link #send} is for the app's own mail (verification, password reset, moderation): it waits until the surrounding transaction has
 * committed (no email about something that was rolled back), then delivers on a background thread, so it never slows down or fails
 * the request. Failures are logged. {@link #sendNow} is the opposite, for diagnostics: it sends on the calling thread and reports
 * exactly what went wrong.
 */
@Component
public class EmailSender {

    private static final Logger log = LoggerFactory.getLogger(EmailSender.class);

    private final ObjectProvider<JavaMailSender> mailSender;
    private final MailProperties props;
    private final Executor executor;

    @Autowired
    public EmailSender(ObjectProvider<JavaMailSender> mailSender, MailProperties props) {
        this(mailSender, props, backgroundSender());
    }

    /** For tests, which bring their own executor. */
    EmailSender(ObjectProvider<JavaMailSender> mailSender, MailProperties props, Executor executor) {
        this.mailSender = mailSender;
        this.props = props;
        this.executor = executor;
    }

    /**
     * Two background threads and a queue of 100: an SMTP handshake takes a second or two with a real provider, and a provider outage must not
     * hold up registration. If the queue ever fills up, new messages are dropped (and logged) rather than piling up. It is kept private to this
     * class on purpose: declaring an Executor bean would stop Spring Boot from creating its own default one.
     */
    private static ThreadPoolExecutor backgroundSender() {
        AtomicInteger count = new AtomicInteger();
        return new ThreadPoolExecutor(2, 2, 0L, TimeUnit.SECONDS, new ArrayBlockingQueue<>(100), runnable -> {
            Thread thread = new Thread(runnable, "mail-" + count.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        });
    }

    /** Lets messages already queued go out before the application stops, but not for long. */
    @PreDestroy
    void shutdown() {
        if (executor instanceof ThreadPoolExecutor pool) {
            pool.shutdown();
            try {
                pool.awaitTermination(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    public void send(String to, String subject, String body) {
        afterCommit(() -> {
            JavaMailSender sender = mailSender.getIfAvailable();
            if (sender == null) {
                log.info("Email not sent (no SMTP configured). To: {} | {} | {}", to, subject, body);
                return;
            }
            try {
                executor.execute(() -> deliver(sender, to, subject, body));
            } catch (RejectedExecutionException e) {
                log.error("Email to {} dropped: the mail queue is full", to);
            }
        });
    }

    /**
     * Sends now and tells the caller what went wrong.
     *
     * @throws MailNotConfiguredException when there is no SMTP server configured
     * @throws MailDeliveryException      when the server refuses the message or cannot be reached
     */
    public void sendNow(String to, String subject, String body) {
        JavaMailSender sender = mailSender.getIfAvailable();
        if (sender == null) {
            throw new MailNotConfiguredException();
        }
        try {
            sender.send(message(to, subject, body));
        } catch (MailException e) {
            throw new MailDeliveryException(reasonOf(e), e);
        }
    }

    private void deliver(JavaMailSender sender, String to, String subject, String body) {
        try {
            sender.send(message(to, subject, body));
        } catch (RuntimeException e) {
            log.error("Could not send email to {}: {}", to, reasonOf(e));
        }
    }

    private SimpleMailMessage message(String to, String subject, String body) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(props.from());
        message.setTo(to);
        message.setSubject(subject);
        message.setText(body);
        return message;
    }

    /** The innermost cause usually holds the server's own words (for example "535 5.7.8 Username and Password not accepted"). */
    static String reasonOf(Throwable error) {
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        String text = root.getMessage() != null ? root.getMessage() : error.getMessage();
        return text == null || text.isBlank() ? root.getClass().getSimpleName() : text.replaceAll("\\s+", " ").strip();
    }

    private static void afterCommit(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
        } else {
            action.run();
        }
    }
}
