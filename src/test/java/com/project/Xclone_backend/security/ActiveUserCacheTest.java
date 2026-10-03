package com.project.Xclone_backend.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.Test;

import com.project.Xclone_backend.user.AccountStatus;
import com.project.Xclone_backend.user.UserRepository;

class ActiveUserCacheTest {

    private final UserRepository repo = mock(UserRepository.class);
    private final AtomicLong clock = new AtomicLong();

    private ActiveUserCache cache(Duration ttl) {
        return new ActiveUserCache(repo, ttl, clock::get);
    }

    @Test
    void activeIsRememberedUntilTheTtlExpires() {
        when(repo.existsByIdAndStatus(1L, AccountStatus.ACTIVE)).thenReturn(true);
        ActiveUserCache cache = cache(Duration.ofSeconds(10));

        assertThat(cache.isActive(1L)).isTrue();
        clock.addAndGet(Duration.ofSeconds(9).toNanos());
        assertThat(cache.isActive(1L)).isTrue();
        verify(repo, times(1)).existsByIdAndStatus(1L, AccountStatus.ACTIVE);

        clock.addAndGet(Duration.ofSeconds(2).toNanos());
        assertThat(cache.isActive(1L)).isTrue();
        verify(repo, times(2)).existsByIdAndStatus(1L, AccountStatus.ACTIVE);
    }

    @Test
    void inactiveIsNeverCachedSoReactivationWorksImmediately() {
        when(repo.existsByIdAndStatus(2L, AccountStatus.ACTIVE)).thenReturn(false, true);
        ActiveUserCache cache = cache(Duration.ofSeconds(10));

        assertThat(cache.isActive(2L)).isFalse();
        assertThat(cache.isActive(2L)).isTrue();
    }

    @Test
    void evictForcesTheNextCheckToHitTheDatabase() {
        when(repo.existsByIdAndStatus(3L, AccountStatus.ACTIVE)).thenReturn(true, false);
        ActiveUserCache cache = cache(Duration.ofSeconds(10));

        assertThat(cache.isActive(3L)).isTrue();
        cache.evict(3L);
        assertThat(cache.isActive(3L)).isFalse();
    }

    @Test
    void zeroTtlChecksTheDatabaseEveryTime() {
        when(repo.existsByIdAndStatus(4L, AccountStatus.ACTIVE)).thenReturn(true);
        ActiveUserCache cache = cache(Duration.ZERO);

        cache.isActive(4L);
        cache.isActive(4L);

        verify(repo, times(2)).existsByIdAndStatus(4L, AccountStatus.ACTIVE);
    }
}
