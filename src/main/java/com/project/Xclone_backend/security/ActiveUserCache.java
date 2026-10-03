package com.project.Xclone_backend.security;

import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.project.Xclone_backend.user.AccountStatus;
import com.project.Xclone_backend.user.UserRepository;

/**
 * Remembers for a few seconds that an account is ACTIVE, so authenticating a request does not cost a database round
 * trip every time (on Neon each one is a network hop that also holds a pooled connection).
 *
 * <p>Only "active" is cached, so a reactivated account works immediately. Deactivating or deleting evicts the entry on
 * this instance right after the change commits; other instances notice within the TTL. Set the TTL to 0 to check the
 * database on every request.
 */
@Component
public class ActiveUserCache {

    private static final int MAX_ENTRIES = 100_000;

    private final UserRepository userRepository;
    private final long ttlNanos;
    private final LongSupplier nanoClock;
    private final ConcurrentHashMap<Long, Long> activeUntil = new ConcurrentHashMap<>();

    @Autowired
    public ActiveUserCache(UserRepository userRepository,
            @Value("${app.security.active-user-cache-ttl:10s}") Duration ttl) {
        this(userRepository, ttl, System::nanoTime);
    }

    ActiveUserCache(UserRepository userRepository, Duration ttl, LongSupplier nanoClock) {
        this.userRepository = userRepository;
        this.ttlNanos = ttl.toNanos();
        this.nanoClock = nanoClock;
    }

    public boolean isActive(Long userId) {
        if (ttlNanos <= 0) {
            return queryActive(userId);
        }
        Long until = activeUntil.get(userId);
        long now = nanoClock.getAsLong();
        if (until != null && until - now > 0) {
            return true;
        }
        boolean active = queryActive(userId);
        if (active) {
            if (activeUntil.size() >= MAX_ENTRIES) {
                activeUntil.clear();
            }
            activeUntil.put(userId, now + ttlNanos);
        } else {
            activeUntil.remove(userId);
        }
        return active;
    }

    public void evict(Long userId) {
        activeUntil.remove(userId);
    }

    /** Evicts once the surrounding transaction commits (immediately when there is none), so a concurrent request cannot re-cache the old status. */
    public void evictAfterCommit(Long userId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    evict(userId);
                }
            });
        } else {
            evict(userId);
        }
    }

    private boolean queryActive(Long userId) {
        return userRepository.existsByIdAndStatus(userId, AccountStatus.ACTIVE);
    }
}
