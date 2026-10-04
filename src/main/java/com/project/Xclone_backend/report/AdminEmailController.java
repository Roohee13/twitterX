package com.project.Xclone_backend.report;

import java.time.Instant;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.project.Xclone_backend.auth.EmailSender;
import com.project.Xclone_backend.auth.MailDeliveryException;
import com.project.Xclone_backend.auth.MailNotConfiguredException;
import com.project.Xclone_backend.common.ApiException;
import com.project.Xclone_backend.security.AuthUser;
import com.project.Xclone_backend.user.User;

import lombok.RequiredArgsConstructor;

/**
 * Lets an admin check that email delivery works: one message to their own address, sent right now, with the mail server's real
 * answer reported back (the normal path only logs failures). "Accepted" means the SMTP server took the message; whether it lands in the
 * inbox or the spam folder is for the admin to see.
 */
@RestController
@RequestMapping("/api/admin/email")
@RequiredArgsConstructor
public class AdminEmailController {

    private final AdminGuard adminGuard;
    private final EmailSender emailSender;

    @PostMapping("/test")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void test(@AuthenticationPrincipal AuthUser me) {
        User admin = adminGuard.requireAdmin(me.id());
        try {
            emailSender.sendNow(admin.getEmail(), "XClone test email",
                    "This is a test message from XClone, sent at " + Instant.now() + ".\nIf you can read it, email delivery works.");
        } catch (MailNotConfiguredException e) {
            throw ApiException.conflict(e.getMessage());
        } catch (MailDeliveryException e) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "The mail server did not accept the message: " + e.getMessage());
        }
    }
}
