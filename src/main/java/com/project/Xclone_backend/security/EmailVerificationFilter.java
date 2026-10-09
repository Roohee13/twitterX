package com.project.Xclone_backend.security;

import java.io.IOException;
import java.util.List;
import java.util.Set;

import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

import com.project.Xclone_backend.common.ApiException;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Applies {@link EmailVerificationGuard} to the endpoints that put content or activity in front of other people. Runs after the JWT filter.
 * Created in {@code SecurityConfig} (not a component) so the servlet container does not also register it ahead of Spring Security.
 */
public class EmailVerificationFilter extends OncePerRequestFilter {

    private record Gate(Set<String> methods, String pattern) {
    }

    private static final Set<String> POST = Set.of("POST");
    private static final List<Gate> GATES = List.of(
            new Gate(POST, "/api/posts"),
            new Gate(POST, "/api/posts/thread"),
            new Gate(Set.of("PATCH"), "/api/posts/*"),
            new Gate(POST, "/api/posts/*/like"),
            new Gate(POST, "/api/posts/*/repost"),
            new Gate(POST, "/api/posts/*/poll/vote"),
            new Gate(POST, "/api/users/*/follow"),
            new Gate(POST, "/api/conversations"),
            new Gate(POST, "/api/conversations/*/messages"),
            new Gate(Set.of("PATCH"), "/api/conversations/*/messages/*"),
            new Gate(POST, "/api/media/upload-url"));

    private static final AntPathMatcher MATCHER = new AntPathMatcher();

    private final EmailVerificationGuard guard;

    public EmailVerificationFilter(EmailVerificationGuard guard) {
        this.guard = guard;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !guard.enabled() || GATES.stream()
                .noneMatch(g -> g.methods().contains(request.getMethod()) && MATCHER.match(g.pattern(), request.getRequestURI()));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof AuthUser user) {
            try {
                guard.requireVerified(user.id());
            } catch (ApiException e) {
                response.setStatus(e.getStatus().value());
                response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
                response.getWriter().write("{\"type\":\"about:blank\",\"title\":\"Forbidden\",\"status\":403,\"detail\":\""
                        + e.getMessage() + "\"}");
                return;
            }
        }
        chain.doFilter(request, response);
    }
}
