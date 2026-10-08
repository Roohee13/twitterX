package com.project.Xclone_backend.hashtag;

import java.util.Collection;
import java.time.Instant;
import java.util.List;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import com.project.Xclone_backend.hashtag.HashtagDtos.TrendCandidate;

public interface HashtagRepository extends JpaRepository<Hashtag, Long> {

    /** Idempotent and safe under concurrent posts introducing the same tag. */
    @Modifying
    @Query(value = "insert into hashtags (name) values (:name) on conflict (name) do nothing", nativeQuery = true)
    void insertIfAbsent(String name);

    List<Hashtag> findByNameIn(Collection<String> names);

    /**
     * Activity per tag for trending, from live posts of active public accounts created since {@code since} (the start of the baseline):
     * posts and distinct authors since {@code recentSince}, distinct authors since {@code halfSince} (the newest part of that window) and
     * posts before {@code recentSince}. Tags with fewer than {@code minAuthors} recent authors are left out; the busiest
     * candidates come first and {@link TrendScorer} ranks them.
     */
    @Query("""
            select new com.project.Xclone_backend.hashtag.HashtagDtos$TrendCandidate(
                   h.name,
                   count(distinct case when p.createdAt >= :recentSince then p.id end),
                   count(distinct case when p.createdAt >= :recentSince then p.author.id end),
                   count(distinct case when p.createdAt >= :halfSince then p.author.id end),
                   count(distinct case when p.createdAt < :recentSince then p.id end))
            from Post p join p.hashtags h
            where p.deleted = false and p.author.status = com.project.Xclone_backend.user.AccountStatus.ACTIVE
              and p.author.protectedAccount = false and p.createdAt >= :since
            group by h.name
            having count(distinct case when p.createdAt >= :recentSince then p.author.id end) >= :minAuthors
            order by count(distinct case when p.createdAt >= :recentSince then p.author.id end) desc, h.name asc
            """)
    List<TrendCandidate> findTrendCandidates(Instant since, Instant recentSince, Instant halfSince, long minAuthors, Limit limit);
}
