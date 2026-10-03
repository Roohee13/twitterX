package com.project.Xclone_backend.user;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.LongSupplier;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.project.Xclone_backend.follow.FollowRepository;
import com.project.Xclone_backend.user.UserDtos.SuggestionResponse;
import com.project.Xclone_backend.user.UserRepository.SuggestionRow;

/**
 * "Who to follow": friends of friends first, ranked by mutual connections. A viewer who follows nobody (or too few) is
 * filled up with the most-followed accounts, whose ranking is computed at most once per cache period because it scans
 * the follows table.
 */
@Service
public class SuggestionService {

    static final int DEFAULT_LIMIT = 10;
    static final int MAX_LIMIT = 20;
    /** How many of the viewer's most recent follows are expanded; bounds the cost for accounts that follow thousands. */
    static final int FIRST_HOP = 200;
    private static final int POPULAR_POOL = 100;

    private final UserRepository userRepository;
    private final FollowRepository followRepository;
    private final UserMapper userMapper;
    private final long cacheNanos;
    private final LongSupplier nanoClock;

    private volatile List<Long> popularIds = List.of();
    private volatile long popularLoadedAt;
    private volatile boolean popularLoaded;

    @Autowired
    public SuggestionService(UserRepository userRepository, FollowRepository followRepository, UserMapper userMapper,
            @Value("${app.suggestions.popular-cache-ttl:10m}") Duration cacheTtl) {
        this(userRepository, followRepository, userMapper, cacheTtl, System::nanoTime);
    }

    SuggestionService(UserRepository userRepository, FollowRepository followRepository, UserMapper userMapper,
            Duration cacheTtl, LongSupplier nanoClock) {
        this.userRepository = userRepository;
        this.followRepository = followRepository;
        this.userMapper = userMapper;
        this.cacheNanos = cacheTtl.toNanos();
        this.nanoClock = nanoClock;
    }

    @Transactional(readOnly = true)
    public List<SuggestionResponse> suggestions(Long viewerId, Integer limit) {
        int n = limit == null || limit <= 0 ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT);
        List<SuggestionRow> rows = new ArrayList<>(userRepository.findFriendsOfFriends(viewerId, FIRST_HOP, n));
        if (rows.size() < n) {
            Set<Long> taken = new HashSet<>();
            rows.forEach(r -> taken.add(r.getId()));
            List<Long> candidates = popularIds().stream().filter(id -> !taken.contains(id)).toList();
            if (!candidates.isEmpty()) {
                // The pool is already ordered by popularity; keep that order after filtering.
                List<SuggestionRow> allowed = userRepository.findAllowedAmong(viewerId, candidates);
                for (Long id : candidates) {
                    if (rows.size() >= n) {
                        break;
                    }
                    allowed.stream().filter(r -> r.getId().equals(id)).findFirst().ifPresent(rows::add);
                }
            }
        }
        return rows.stream().map(r -> new SuggestionResponse(
                userMapper.toSummary(r.getId(), r.getUsername(), r.getDisplayName(), r.getAvatarKey()),
                r.getMutuals())).toList();
    }

    private List<Long> popularIds() {
        long now = nanoClock.getAsLong();
        if (!popularLoaded || cacheNanos <= 0 || now - popularLoadedAt >= cacheNanos) {
            popularIds = followRepository.findMostFollowedIds(POPULAR_POOL);
            popularLoadedAt = now;
            popularLoaded = true;
        }
        return popularIds;
    }
}
