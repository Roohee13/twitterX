package com.project.Xclone_backend.security;

import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.project.Xclone_backend.user.UserRepository;

/**
 * Remembers for a few seconds that an account is ACTIVE, so authenticating a request does not cost a database round
 * trip every time (on Neon each one is a network hop that also holds a pooled connection).
 *
 * <p>Only an active account (with its token version) is cached, so a reactivated account works immediately. Deactivating or deleting evicts the entry on
 * this instance right after the change commits; other instances notice within the TTL. Set the TTL to 0 to check the
 * database on every request.
 */
@Component
public class ActiveUserCache {

    private static final int MAX_ENTRIES = 100_000;

    private final UserRepository userRepository;
    private final long ttlNanos;
    private final LongSupplier nanoClock;
    private record Entry(int tokenVersion, long until) {
    }

    private final ConcurrentHashMap<Long, Entry> cached = new ConcurrentHashMap<>();

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

    /**
     * True when the account is ACTIVE and {@code tokenVersion} (from the access token) is still its current one, so a token
     * issued before a password change is refused.
     */
    public boolean isCurrent(Long userId, int tokenVersion) {
        if (ttlNanos <= 0) {
            return queryVersion(userId) == tokenVersion;
        }
        long now = nanoClock.getAsLong();
        Entry entry = cached.get(userId);
        if (entry != null && entry.until() - now > 0) {
            return entry.tokenVersion() == tokenVersion;
        }
        int current = queryVersion(userId);
        if (current >= 0) {
            if (cached.size() >= MAX_ENTRIES) {
                cached.clear();
            }
            cached.put(userId, new Entry(current, now + ttlNanos));
        } else {
            cached.remove(userId);
        }
        return current == tokenVersion;
    }

    public void evict(Long userId) {
        cached.remove(userId);
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

    /** The account's token version, or -1 when it is not active (never equal to a real version). */
    private int queryVersion(Long userId) {
        return userRepository.findActiveTokenVersion(userId).orElse(-1);
    }
}
