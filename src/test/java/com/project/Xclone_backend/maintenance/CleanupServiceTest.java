package com.project.Xclone_backend.maintenance;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import com.project.Xclone_backend.auth.EmailSender;

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

@SpringBootTest
@ActiveProfiles("test")
class CleanupServiceTest {

    @Autowired
    CleanupService cleanup;

    @Autowired
    JdbcTemplate jdbc;

    @MockitoBean
    EmailSender emailSender;

    @MockitoBean
    S3Client s3Client;

    @MockitoBean
    S3Presigner s3Presigner;

    private long user() {
        String n = "c" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        return jdbc.queryForObject("insert into users (username, email, password_hash, display_name, email_verified, status, protected_account, is_admin, token_version, created_at) "
                + "values (?, ?, 'x', 'C', true, 'ACTIVE', false, false, 0, now()) returning id", Long.class, n, n + "@example.com");
    }

    @Test
    void onlyExpiredTokensAreRemoved() {
        long u = user();
        Instant now = Instant.now();
        String live = UUID.randomUUID().toString();
        String dead = UUID.randomUUID().toString();
        for (String[] t : new String[][] {{live, "true"}, {dead, "false"}}) {
            Instant exp = "true".equals(t[1]) ? now.plus(1, ChronoUnit.DAYS) : now.minus(1, ChronoUnit.HOURS);
            jdbc.update("insert into refresh_tokens (user_id, token_hash, expires_at, revoked, created_at) values (?, ?, ?, false, now())",
                    u, t[0], java.sql.Timestamp.from(exp));
            jdbc.update("insert into email_tokens (user_id, token_hash, type, expires_at, created_at) values (?, ?, 'VERIFY_EMAIL', ?, now())",
                    u, t[0], java.sql.Timestamp.from(exp));
        }

        CleanupService.Result result = cleanup.purgeExpired();

        assertThat(result.refreshTokens()).isGreaterThanOrEqualTo(1);
        assertThat(result.emailTokens()).isGreaterThanOrEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from refresh_tokens where token_hash = ?", Integer.class, dead)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from refresh_tokens where token_hash = ?", Integer.class, live)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from email_tokens where token_hash = ?", Integer.class, dead)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from email_tokens where token_hash = ?", Integer.class, live)).isEqualTo(1);
    }
}
