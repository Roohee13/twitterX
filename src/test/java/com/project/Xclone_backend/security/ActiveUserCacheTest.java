package com.project.Xclone_backend.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.Test;

import com.project.Xclone_backend.user.UserRepository;

class ActiveUserCacheTest {

    private final UserRepository repo = mock(UserRepository.class);
    private final AtomicLong clock = new AtomicLong();

    private ActiveUserCache cache(Duration ttl) {
        return new ActiveUserCache(repo, ttl, clock::get);
    }

    @Test
    void activeIsRememberedUntilTheTtlExpires() {
        when(repo.findActiveTokenVersion(1L)).thenReturn(Optional.of(0));
        ActiveUserCache cache = cache(Duration.ofSeconds(10));

        assertThat(cache.isCurrent(1L, 0)).isTrue();
        clock.addAndGet(Duration.ofSeconds(9).toNanos());
        assertThat(cache.isCurrent(1L, 0)).isTrue();
        verify(repo, times(1)).findActiveTokenVersion(1L);

        clock.addAndGet(Duration.ofSeconds(2).toNanos());
        assertThat(cache.isCurrent(1L, 0)).isTrue();
        verify(repo, times(2)).findActiveTokenVersion(1L);
    }

    @Test
    void inactiveIsNeverCachedSoReactivationWorksImmediately() {
        when(repo.findActiveTokenVersion(2L)).thenReturn(Optional.empty(), Optional.of(0));
        ActiveUserCache cache = cache(Duration.ofSeconds(10));

        assertThat(cache.isCurrent(2L, 0)).isFalse();
        assertThat(cache.isCurrent(2L, 0)).isTrue();
    }

    @Test
    void evictForcesTheNextCheckToHitTheDatabase() {
        when(repo.findActiveTokenVersion(3L)).thenReturn(Optional.of(0), Optional.empty());
        ActiveUserCache cache = cache(Duration.ofSeconds(10));

        assertThat(cache.isCurrent(3L, 0)).isTrue();
        cache.evict(3L);
        assertThat(cache.isCurrent(3L, 0)).isFalse();
    }

    @Test
    void zeroTtlChecksTheDatabaseEveryTime() {
        when(repo.findActiveTokenVersion(4L)).thenReturn(Optional.of(0));
        ActiveUserCache cache = cache(Duration.ZERO);

        cache.isCurrent(4L, 0);
        cache.isCurrent(4L, 0);

        verify(repo, times(2)).findActiveTokenVersion(4L);
    }

    @Test
    void aTokenFromBeforeAVersionBumpIsRefusedAsSoonAsTheEntryIsEvicted() {
        when(repo.findActiveTokenVersion(5L)).thenReturn(Optional.of(0), Optional.of(1));
        ActiveUserCache cache = cache(Duration.ofSeconds(10));

        assertThat(cache.isCurrent(5L, 0)).isTrue();
        cache.evict(5L); // what a password change does after it commits
        assertThat(cache.isCurrent(5L, 0)).isFalse();
        assertThat(cache.isCurrent(5L, 1)).isTrue();
    }
}
