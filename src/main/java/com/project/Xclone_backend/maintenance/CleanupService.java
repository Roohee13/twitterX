package com.project.Xclone_backend.maintenance;

import java.time.Clock;
import java.time.Instant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.project.Xclone_backend.auth.EmailTokenRepository;
import com.project.Xclone_backend.auth.RefreshTokenRepository;

import lombok.RequiredArgsConstructor;

/** The housekeeping itself, so it can be tested without the scheduler. Every step is idempotent. */
@Service
@RequiredArgsConstructor
public class CleanupService {

    private static final Logger log = LoggerFactory.getLogger(CleanupService.class);

    public record Result(int refreshTokens, int emailTokens) {
    }

    private final RefreshTokenRepository refreshTokens;
    private final EmailTokenRepository emailTokens;

    @Transactional
    public Result purgeExpired() {
        return purgeExpired(Instant.now());
    }

    @Transactional
    Result purgeExpired(Instant now) {
        Result result = new Result(refreshTokens.deleteExpired(now), emailTokens.deleteExpired(now));
        log.info("Cleanup removed {} expired refresh tokens and {} expired email tokens", result.refreshTokens(), result.emailTokens());
        return result;
    }
}
