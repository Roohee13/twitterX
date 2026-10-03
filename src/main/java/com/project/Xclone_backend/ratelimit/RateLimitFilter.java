package com.project.Xclone_backend.ratelimit;

import java.io.IOException;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import com.project.Xclone_backend.ratelimit.RateLimiter.Decision;
import com.project.Xclone_backend.security.AuthUser;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Applies {@link RateLimitRules}. Runs inside the security chain after the JWT filter so user-scoped rules can see the
 * caller. It is created in {@code SecurityConfig} rather than as a component so the servlet container does not also
 * register it ahead of Spring Security.
 */
public class RateLimitFilter extends OncePerRequestFilter {

    private final RateLimiter limiter;
    private final boolean enabled;

    public RateLimitFilter(RateLimiter limiter, boolean enabled) {
        this.limiter = limiter;
        this.enabled = enabled;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !enabled;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var rule = RateLimitRules.match(request.getMethod(), request.getRequestURI()).orElse(null);
        String subject = rule == null ? null : subject(rule, request);
        if (subject != null) {
            Decision decision = limiter.check("rl:" + rule.name() + ":" + subject, rule.limit(), rule.window());
            if (!decision.allowed()) {
                reject(response, decision.retryAfterSeconds());
                return;
            }
        }
        chain.doFilter(request, response);
    }

    /** Null means "not limited here": an anonymous call to a user-scoped endpoint is left for security to reject. */
    private static String subject(RateLimitRule rule, HttpServletRequest request) {
        if (rule.scope() == RateLimitRule.Scope.IP) {
            return "ip:" + request.getRemoteAddr();
        }
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.getPrincipal() instanceof AuthUser user ? "u:" + user.id() : null;
    }

    private static void reject(HttpServletResponse response, long retryAfterSeconds) throws IOException {
        response.setStatus(429);
        response.setHeader(HttpHeaders.RETRY_AFTER, String.valueOf(retryAfterSeconds));
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.getWriter().write("{\"type\":\"about:blank\",\"title\":\"Too Many Requests\",\"status\":429,"
                + "\"detail\":\"Rate limit exceeded. Try again in " + retryAfterSeconds + " seconds.\"}");
    }
}
