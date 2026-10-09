package com.project.Xclone_backend.auth;

import java.util.Optional;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, Long> {

    @EntityGraph(attributePaths = "user")
    Optional<RefreshToken> findByTokenHash(String tokenHash);

    @Modifying
    @Query("update RefreshToken t set t.revoked = true where t.user.id = :userId and t.revoked = false")
    int revokeAllForUser(Long userId);

    /** Expired tokens can no longer be used, and a replay of one is rejected as expired anyway, so theft detection loses nothing. */
    @Modifying
    @Query("delete from RefreshToken t where t.expiresAt < :now")
    int deleteExpired(java.time.Instant now);

    @Modifying
    @Query("delete from RefreshToken t where t.user.id = :userId")
    void deleteAllForUser(Long userId);
}
