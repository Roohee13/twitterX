package com.project.Xclone_backend.report;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.project.Xclone_backend.auth.EmailSender;
import com.project.Xclone_backend.notification.NotificationService;
import com.project.Xclone_backend.notification.NotificationType;
import com.project.Xclone_backend.post.Post;
import com.project.Xclone_backend.user.AccountStatus;
import com.project.Xclone_backend.user.User;
import com.project.Xclone_backend.user.UserRepository;

import lombok.RequiredArgsConstructor;

/**
 * Tells people about moderation: admins when a report arrives, a post's author when it is removed, reporters what became
 * of their report, and a user when their account is suspended or removed. Each message is an in-app notification (no actor,
 * so the admin's identity is never shown) plus an email, because a suspended or removed user cannot read the app.
 * Emails go out only after the surrounding transaction commits; they never fail the moderation action.
 */
@Component
@RequiredArgsConstructor
public class ModerationNotifier {

    private static final Logger log = LoggerFactory.getLogger(ModerationNotifier.class);

    private final NotificationService notificationService;
    private final UserRepository userRepository;
    private final EmailSender emailSender;

    /** To every active admin. Callers send it for the first open report about a target only, so a pile-on is one alert. */
    public void reportReceived(String what, ReportReason reason, Post post) {
        String text = "New report: " + what + " (" + reason.name().toLowerCase().replace('_', ' ') + ")";
        for (User admin : userRepository.findByAdminTrueAndStatus(AccountStatus.ACTIVE)) {
            notificationService.notifySystem(admin, NotificationType.REPORT_RECEIVED, post, text);
            email(admin, "New report to review", text + ". Open the Reports page to review it.");
        }
    }

    public void postRemoved(Post post, String note) {
        String text = "An admin removed your post for breaking the rules." + noteText(note);
        notificationService.notifySystem(post.getAuthor(), NotificationType.POST_REMOVED, null, text);
        email(post.getAuthor(), "Your post was removed", text);
    }

    /** {@code subject}: what was reported, e.g. "@alice" or "a post". Reporters are told the result, never who decided it. */
    public void reportOutcome(User reporter, ReportStatus status, String subject) {
        if (reporter.getStatus() != AccountStatus.ACTIVE) {
            return;
        }
        String text = status == ReportStatus.RESOLVED
                ? "Thanks for your report about " + subject + ": we took action."
                : "Thanks for your report about " + subject + ": we reviewed it and took no action.";
        notificationService.notifySystem(reporter, NotificationType.REPORT_OUTCOME, null, text);
        email(reporter, "Update on your report", text);
    }

    /** Email only: a suspended user cannot sign in to see notifications. */
    public void accountSuspended(User user, String note) {
        email(user, "Your account was suspended",
                "An admin suspended your account for breaking the rules, so you cannot sign in for now." + noteText(note));
    }

    public void accountRestored(User user) {
        email(user, "Your account is active again", "The suspension on your account was lifted. You can sign in again.");
    }

    /** Takes the address as a string because the account is anonymized in the same transaction. */
    public void accountRemoved(String email, String note) {
        afterCommit(() -> emailSender.send(email, "Your account was removed",
                "An admin removed your account for breaking the rules. This cannot be undone." + noteText(note)));
    }

    private void email(User user, String subject, String body) {
        String address = user.getEmail();
        afterCommit(() -> emailSender.send(address, subject, body));
    }

    private static String noteText(String note) {
        return note == null || note.isBlank() ? "" : " Reason: " + note.strip();
    }

    private void afterCommit(Runnable action) {
        Runnable safe = () -> {
            try {
                action.run();
            } catch (RuntimeException e) {
                log.error("Moderation email failed: {}", e.getMessage());
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    safe.run();
                }
            });
        } else {
            safe.run();
        }
    }
}
