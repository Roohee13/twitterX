package com.project.Xclone_backend.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;

import com.project.Xclone_backend.ratelimit.RateLimiter.Decision;

class RateLimiterTest {

    @Test
    @SuppressWarnings("unchecked")
    void failsOpenAndStopsCallingRedisDuringTheCooldown() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.execute(any(RedisScript.class), anyList(), any(Object[].class)))
                .thenThrow(new RedisConnectionFailureException("down"));
        RateLimiter limiter = new RateLimiter(redis);

        Decision first = limiter.check("rl:x", 1, Duration.ofMinutes(1));
        Decision second = limiter.check("rl:x", 1, Duration.ofMinutes(1));

        assertThat(first.allowed()).isTrue();
        assertThat(second.allowed()).isTrue();
        verify(redis, times(1)).execute(any(RedisScript.class), anyList(), any(Object[].class));
    }

    /** Against a real Redis; skipped when none is reachable (docker compose up -d redis). */
    @Test
    void countsWithinAWindowAgainstRealRedis() {
        LettuceConnectionFactory factory = new LettuceConnectionFactory("localhost", 6379);
        factory.afterPropertiesSet();
        StringRedisTemplate redis = new StringRedisTemplate(factory);
        try {
            redis.getConnectionFactory().getConnection().ping();
        } catch (RuntimeException e) {
            factory.destroy();
            assumeTrue(false, "Redis not reachable");
        }
        String key = "rl:test:" + UUID.randomUUID();
        try {
            RateLimiter limiter = new RateLimiter(redis);
            assertThat(limiter.check(key, 2, Duration.ofSeconds(30)).allowed()).isTrue();
            assertThat(limiter.check(key, 2, Duration.ofSeconds(30)).allowed()).isTrue();

            Decision blocked = limiter.check(key, 2, Duration.ofSeconds(30));
            assertThat(blocked.allowed()).isFalse();
            assertThat(blocked.retryAfterSeconds()).isBetween(1L, 30L);
            assertThat(redis.getExpire(key)).isPositive();
        } finally {
            redis.delete(key);
            factory.destroy();
        }
    }
}
