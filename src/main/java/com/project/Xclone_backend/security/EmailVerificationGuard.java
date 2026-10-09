package com.project.Xclone_backend.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.project.Xclone_backend.common.ApiException;
import com.project.Xclone_backend.user.UserRepository;

/**
 * Keeps accounts whose email address is not confirmed from posting, replying, reposting, liking, following, messaging and uploading
 * (reading, settings, blocking and reporting stay open). Accounts created before verification existed count as verified. Switch off with
 * {@code REQUIRE_VERIFIED_EMAIL=false}, e.g. on a deployment that has no SMTP server, where nobody could ever verify.
 */
@Component
public class EmailVerificationGuard {

    public static final String MESSAGE = "Verify your email address to do this. Check your inbox for the link, or resend it from the banner.";

    private final UserRepository userRepository;
    private final boolean enabled;

    public EmailVerificationGuard(UserRepository userRepository,
            @Value("${app.security.require-verified-email:true}") boolean enabled) {
        this.userRepository = userRepository;
        this.enabled = enabled;
    }

    public boolean enabled() {
        return enabled;
    }

    /** Throws a 403 for an account whose email is not confirmed. */
    public void requireVerified(Long userId) {
        if (enabled && userRepository.existsByIdAndEmailVerifiedFalse(userId)) {
            throw ApiException.forbidden(MESSAGE);
        }
    }
}
