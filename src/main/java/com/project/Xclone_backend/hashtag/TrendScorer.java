package com.project.Xclone_backend.hashtag;

import java.util.Comparator;
import java.util.List;

import com.project.Xclone_backend.hashtag.HashtagDtos.TrendCandidate;
import com.project.Xclone_backend.hashtag.HashtagDtos.TrendingHashtag;

/**
 * Ranks tags by how far recent activity rises above their normal level, not by raw volume. Distinct authors are counted, so one account
 * posting a tag again and again cannot trend it, and authors in the newest half of the window count twice, so fresh activity wins.
 */
final class TrendScorer {

    private TrendScorer() {
    }

    /**
     * {@code (recentAuthors + newerHalfAuthors) / (1 + expected)}, where {@code expected} is how many posts the tag normally gets in a window
     * this long (its baseline rate); a tag that is busy all week therefore needs far more than its usual crowd to count as rising. A tag with no history is compared with zero, so a brand-new tag can trend.
     */
    static double score(TrendCandidate c, double windowHours, double baselineHours) {
        double expected = c.baselinePosts() * windowHours / baselineHours;
        return (c.recentAuthors() + c.newerHalfAuthors()) / (1 + expected);
    }

    static List<TrendingHashtag> rank(List<TrendCandidate> candidates, double windowHours, double baselineHours, int limit) {
        Comparator<TrendCandidate> byScore = Comparator.comparingDouble((TrendCandidate c) -> score(c, windowHours, baselineHours)).reversed();
        return candidates.stream()
                .sorted(byScore.thenComparing(Comparator.comparingLong(TrendCandidate::recentAuthors).reversed())
                        .thenComparing(Comparator.comparingLong(TrendCandidate::recentPosts).reversed())
                        .thenComparing(TrendCandidate::name))
                .limit(limit)
                .map(c -> new TrendingHashtag(c.name(), c.recentPosts(), c.recentAuthors()))
                .toList();
    }
}
