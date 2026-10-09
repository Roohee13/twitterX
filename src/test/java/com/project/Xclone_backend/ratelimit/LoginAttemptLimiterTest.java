package com.project.Xclone_backend.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;

class LoginAttemptLimiterTest {

    @Test
    void doesNothingWhenRateLimitingIsOff() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        LoginAttemptLimiter limiter = new LoginAttemptLimiter(redis, new RateLimitProperties(false));

        limiter.requireNotLocked("alice");
        limiter.recordFailure("alice");
        limiter.reset("alice");

        verifyNoInteractions(redis);
    }

    @Test
    @SuppressWarnings("unchecked")
    void failsOpenWhenRedisIsDown() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.opsForValue()).thenThrow(new RedisConnectionFailureException("down"));
        when(redis.execute(any(RedisScript.class), anyList(), any(Object[].class)))
                .thenThrow(new RedisConnectionFailureException("down"));
        LoginAttemptLimiter limiter = new LoginAttemptLimiter(redis, new RateLimitProperties(true));

        limiter.requireNotLocked("alice"); // no exception
        limiter.recordFailure("alice");
    }

    @Test
    void theKeyHidesTheTypedNameAndIsStable() {
        assertThat(LoginAttemptLimiter.key("alice@example.com")).startsWith("login-fail:").doesNotContain("alice")
                .isEqualTo(LoginAttemptLimiter.key("alice@example.com"));
    }

    /** Against a real Redis; skipped when none is reachable (docker compose up -d redis). */
    @Test
    void locksAfterTooManyFailuresAndASuccessClearsTheCount() {
        LettuceConnectionFactory factory = new LettuceConnectionFactory("localhost", 6379);
        factory.afterPropertiesSet();
        StringRedisTemplate redis = new StringRedisTemplate(factory);
        try {
            redis.getConnectionFactory().getConnection().ping();
        } catch (RuntimeException e) {
            factory.destroy();
            assumeTrue(false, "Redis not reachable");
        }
        String name = "lock-test-" + UUID.randomUUID();
        try {
            LoginAttemptLimiter limiter = new LoginAttemptLimiter(redis, new RateLimitProperties(true));
            for (int i = 0; i < LoginAttemptLimiter.MAX_FAILURES; i++) {
                limiter.requireNotLocked(name);
                limiter.recordFailure(name);
            }
            assertThatThrownBy(() -> limiter.requireNotLocked(name)).isInstanceOfSatisfying(RateLimitedException.class,
                    e -> assertThat(e.getRetryAfterSeconds()).isBetween(1L, LoginAttemptLimiter.WINDOW.toSeconds()));

            limiter.reset(name);
            limiter.requireNotLocked(name);
        } finally {
            redis.delete(LoginAttemptLimiter.key(name));
            factory.destroy();
        }
    }
}
