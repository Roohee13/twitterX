package com.project.Xclone_backend.maintenance;

import java.time.Duration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;

/**
 * Runs {@link CleanupService} once a day (03:30 server time; {@code CLEANUP_CRON} changes it, {@code CLEANUP_ENABLED=false} turns it off).
 * With several instances a short Redis lock lets only one of them do the work; if Redis is unreachable every instance runs it, which is
 * harmless because the deletes are idempotent.
 */
@Component
@EnableScheduling
@ConditionalOnProperty(name = "app.cleanup.enabled", havingValue = "true", matchIfMissing = true)
@RequiredArgsConstructor
public class CleanupJob {

    private static final Logger log = LoggerFactory.getLogger(CleanupJob.class);
    private static final String LOCK_KEY = "job:cleanup";
    private static final Duration LOCK_TTL = Duration.ofMinutes(30);

    private final CleanupService cleanup;
    private final StringRedisTemplate redis;

    @Scheduled(cron = "${app.cleanup.cron:0 30 3 * * *}")
    public void run() {
        if (!acquireLock()) {
            log.debug("Cleanup skipped: another instance is running it");
            return;
        }
        try {
            cleanup.purgeExpired();
        } catch (RuntimeException e) {
            log.error("Scheduled cleanup failed", e);
        }
    }

    boolean acquireLock() {
        try {
            return Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(LOCK_KEY, "1", LOCK_TTL));
        } catch (RuntimeException e) {
            log.warn("Cleanup lock unavailable ({}); running anyway", e.getMessage());
            return true;
        }
    }
}
