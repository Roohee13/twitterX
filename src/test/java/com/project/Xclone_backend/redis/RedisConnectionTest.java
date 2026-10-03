package com.project.Xclone_backend.redis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.ActiveProfiles;

/** Smoke test for the Redis wiring. Skipped when no Redis is reachable (start one with docker compose). */
@SpringBootTest
@ActiveProfiles("test")
class RedisConnectionTest {

    @Autowired
    private StringRedisTemplate redis;

    @Test
    void roundTripsAValueWithTtl() {
        String reachable;
        try {
            reachable = redis.getConnectionFactory().getConnection().ping();
        } catch (RuntimeException e) {
            reachable = null;
        }
        assumeTrue(reachable != null, "Redis not reachable; run `docker compose up -d redis`");

        redis.opsForValue().set("test:ping", "pong", Duration.ofSeconds(30));
        assertThat(redis.opsForValue().get("test:ping")).isEqualTo("pong");
        assertThat(redis.getExpire("test:ping")).isPositive();
        redis.delete("test:ping");
    }
}
