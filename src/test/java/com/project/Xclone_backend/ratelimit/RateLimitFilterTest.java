package com.project.Xclone_backend.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import com.project.Xclone_backend.ratelimit.RateLimiter.Decision;
import com.project.Xclone_backend.security.AuthUser;

class RateLimitFilterTest {

    private final RateLimiter limiter = mock(RateLimiter.class);
    private final RateLimitFilter filter = new RateLimitFilter(limiter, true);

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    private MockHttpServletResponse run(RateLimitFilter f, MockHttpServletRequest request, MockFilterChain chain)
            throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        f.doFilter(request, response, chain);
        return response;
    }

    private MockHttpServletRequest request(String method, String uri) {
        MockHttpServletRequest r = new MockHttpServletRequest(method, uri);
        r.setRemoteAddr("203.0.113.9");
        return r;
    }

    @Test
    void rejectsWith429AndRetryAfterWhenOverTheLimit() throws Exception {
        when(limiter.check(eq("rl:auth-login:ip:203.0.113.9"), eq(10), any(Duration.class)))
                .thenReturn(new Decision(false, 42));
        MockFilterChain chain = new MockFilterChain();

        MockHttpServletResponse response = run(filter, request("POST", "/api/auth/login"), chain);

        assertThat(response.getStatus()).isEqualTo(429);
        assertThat(response.getHeader("Retry-After")).isEqualTo("42");
        assertThat(response.getContentType()).startsWith("application/problem+json");
        assertThat(response.getContentAsString()).contains("\"status\":429");
        assertThat(chain.getRequest()).isNull(); // the request never reached the controller
    }

    @Test
    void passesThroughWhenUnderTheLimit() throws Exception {
        when(limiter.check(any(), anyInt(), any())).thenReturn(new Decision(true, 0));
        MockFilterChain chain = new MockFilterChain();

        MockHttpServletResponse response = run(filter, request("POST", "/api/auth/login"), chain);

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(chain.getRequest()).isNotNull();
    }

    @Test
    void userScopedRulesCountPerAccount() throws Exception {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(new AuthUser(5L, "alice"), null, List.of()));
        when(limiter.check(any(), anyInt(), any())).thenReturn(new Decision(true, 0));

        run(filter, request("POST", "/api/posts"), new MockFilterChain());

        verify(limiter).check(eq("rl:post-create:u:5"), eq(100), eq(Duration.ofHours(1)));
    }

    @Test
    void anonymousCallToUserScopedEndpointIsLeftForSecurityToReject() throws Exception {
        MockFilterChain chain = new MockFilterChain();

        run(filter, request("POST", "/api/posts"), chain);

        verify(limiter, never()).check(any(), anyInt(), any());
        assertThat(chain.getRequest()).isNotNull();
    }

    @Test
    void unlimitedRequestsAndDisabledFilterSkipTheLimiter() throws Exception {
        run(filter, request("GET", "/api/timeline"), new MockFilterChain());
        run(new RateLimitFilter(limiter, false), request("POST", "/api/auth/login"), new MockFilterChain());

        verify(limiter, never()).check(any(), anyInt(), any());
    }
}
