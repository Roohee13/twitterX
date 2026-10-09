package com.project.Xclone_backend.ratelimit;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.concurrent.atomic.AtomicLong;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/**
 * Locks sign-in for one account name after repeated wrong passwords, whichever IP they come from (the per-IP limit alone does nothing against
 * a spread-out attack on one account). Counts the name that was typed, existing or not, so a lock reveals nothing about which accounts
 * exist. A correct sign-in clears the count. Fails open when Redis is down, like {@link RateLimiter}.
 */
@Component
public class LoginAttemptLimiter {

    static final int MAX_FAILURES = 10;
    static final Duration WINDOW = Duration.ofMinutes(15);
    private static final Duration COOLDOWN = Duration.ofSeconds(30);

    private static final Logger log = LoggerFactory.getLogger(LoginAttemptLimiter.class);

    private static final DefaultRedisScript<Long> INCREMENT = new DefaultRedisScript<>("""
            local c = redis.call('INCR', KEYS[1])
            if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
            return c
            """, Long.class);

    private final StringRedisTemplate redis;
    private final boolean enabled;
    private final AtomicLong skipRedisUntilNanos = new AtomicLong();

    public LoginAttemptLimiter(StringRedisTemplate redis, RateLimitProperties properties) {
        this.redis = redis;
        this.enabled = properties.enabled();
    }

    /** Throws a 429 while the account name is locked. Call before checking the password. */
    public void requireNotLocked(String identifier) {
        guarded(() -> {
            String key = key(identifier);
            String count = redis.opsForValue().get(key);
            if (count != null && Long.parseLong(count) >= MAX_FAILURES) {
                Long ttlMillis = redis.getExpire(key, java.util.concurrent.TimeUnit.MILLISECONDS);
                long seconds = Math.max(1, ((ttlMillis == null ? WINDOW.toMillis() : ttlMillis) + 999) / 1000);
                throw new RateLimitedException("Too many failed sign-in attempts. Try again in " + seconds + " seconds.", seconds);
            }
        });
    }

    public void recordFailure(String identifier) {
        guarded(() -> redis.execute(INCREMENT, java.util.List.of(key(identifier)), String.valueOf(WINDOW.toMillis())));
    }

    public void reset(String identifier) {
        guarded(() -> redis.delete(key(identifier)));
    }

    private void guarded(Runnable action) {
        if (!enabled || System.nanoTime() - skipRedisUntilNanos.get() < 0) {
            return;
        }
        try {
            action.run();
        } catch (RateLimitedException e) {
            throw e;
        } catch (RuntimeException e) {
            skipRedisUntilNanos.set(System.nanoTime() + COOLDOWN.toNanos());
            log.warn("Login limiter cannot reach Redis; not limiting sign-ins for {}s: {}", COOLDOWN.toSeconds(), e.getMessage());
        }
    }

    static String key(String identifier) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(identifier.getBytes(StandardCharsets.UTF_8));
            return "login-fail:" + HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
