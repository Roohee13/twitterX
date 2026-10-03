package com.project.Xclone_backend.ratelimit;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/**
 * Fixed-window counter in Redis: one atomic script call (INCR + expiry + TTL) per check, so a limited request costs a
 * single round trip. Fails open: if Redis is unreachable, requests are allowed and Redis is not retried for
 * {@link #COOLDOWN}, so an outage neither blocks the API nor adds a connect timeout to every request.
 */
@Component
public class RateLimiter {

    public record Decision(boolean allowed, long retryAfterSeconds) {
        static final Decision ALLOWED = new Decision(true, 0);
    }

    static final Duration COOLDOWN = Duration.ofSeconds(30);

    private static final Logger log = LoggerFactory.getLogger(RateLimiter.class);

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static final DefaultRedisScript<List> SCRIPT = new DefaultRedisScript<>("""
            local c = redis.call('INCR', KEYS[1])
            local t = redis.call('PTTL', KEYS[1])
            if c == 1 or t < 0 then
                redis.call('PEXPIRE', KEYS[1], ARGV[1])
                t = tonumber(ARGV[1])
            end
            return {c, t}
            """, List.class);

    private final StringRedisTemplate redis;
    private final AtomicLong skipRedisUntilNanos = new AtomicLong();

    public RateLimiter(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public Decision check(String key, int limit, Duration window) {
        if (System.nanoTime() - skipRedisUntilNanos.get() < 0) {
            return Decision.ALLOWED;
        }
        try {
            List<?> result = redis.execute(SCRIPT, List.of(key), String.valueOf(window.toMillis()));
            long count = ((Number) result.get(0)).longValue();
            long ttlMillis = ((Number) result.get(1)).longValue();
            if (count <= limit) {
                return Decision.ALLOWED;
            }
            return new Decision(false, Math.max(1, (ttlMillis + 999) / 1000));
        } catch (RuntimeException e) {
            skipRedisUntilNanos.set(System.nanoTime() + COOLDOWN.toNanos());
            log.warn("Rate limiter cannot reach Redis; allowing requests for {}s: {}", COOLDOWN.toSeconds(),
                    e.getMessage());
            return Decision.ALLOWED;
        }
    }
}
