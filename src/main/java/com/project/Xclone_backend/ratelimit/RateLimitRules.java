package com.project.Xclone_backend.ratelimit;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import org.springframework.util.AntPathMatcher;

import com.project.Xclone_backend.ratelimit.RateLimitRule.Scope;

/**
 * The limits, in priority order: the first rule that matches a request is the only one applied, so specific rules
 * come before the generic write limit at the end. Reads are not limited, which keeps Redis traffic proportional to
 * writes.
 */
public final class RateLimitRules {

    private static final Set<String> POST = Set.of("POST");
    private static final Set<String> WRITES = Set.of("POST", "PUT", "PATCH", "DELETE");

    private static final List<RateLimitRule> RULES = List.of(
            // Unauthenticated endpoints: counted per client IP to slow brute force and signup/email spam.
            new RateLimitRule("auth-login", POST, "/api/auth/login", Scope.IP, 10, Duration.ofMinutes(1)),
            new RateLimitRule("auth-register", POST, "/api/auth/register", Scope.IP, 10, Duration.ofHours(1)),
            new RateLimitRule("auth-forgot", POST, "/api/auth/forgot-password", Scope.IP, 5, Duration.ofHours(1)),
            new RateLimitRule("auth-reset", POST, "/api/auth/reset-password", Scope.IP, 10, Duration.ofHours(1)),
            new RateLimitRule("auth-other", POST, "/api/auth/**", Scope.IP, 60, Duration.ofMinutes(1)),
            // Signed-in users: counted per account.
            new RateLimitRule("post-create", POST, "/api/posts", Scope.USER, 100, Duration.ofHours(1)),
            new RateLimitRule("thread-create", POST, "/api/posts/thread", Scope.USER, 20, Duration.ofHours(1)),
            new RateLimitRule("message-send", POST, "/api/conversations/*/messages", Scope.USER, 60, Duration.ofMinutes(1)),
            new RateLimitRule("media-upload", POST, "/api/media/upload-url", Scope.USER, 30, Duration.ofMinutes(1)),
            new RateLimitRule("follow", POST, "/api/users/*/follow", Scope.USER, 100, Duration.ofHours(1)),
            new RateLimitRule("report-user", POST, "/api/users/*/report", Scope.USER, 20, Duration.ofHours(1)),
            new RateLimitRule("report-post", POST, "/api/posts/*/report", Scope.USER, 20, Duration.ofHours(1)),
            new RateLimitRule("write", WRITES, "/api/**", Scope.USER, 120, Duration.ofMinutes(1)));

    private static final AntPathMatcher MATCHER = new AntPathMatcher();

    private RateLimitRules() {
    }

    public static Optional<RateLimitRule> match(String method, String path) {
        return RULES.stream()
                .filter(r -> r.methods().contains(method) && MATCHER.match(r.pattern(), path))
                .findFirst();
    }
}
