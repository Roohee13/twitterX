package com.project.Xclone_backend.hashtag;

public final class HashtagDtos {

    private HashtagDtos() {
    }

    /** {@code name} is lowercase without the leading '#'. */
    public record TrendingHashtag(String name, long postCount, long userCount) {
    }

    /**
     * One tag's activity for trending, before it is scored: posts and distinct authors in the recent window, distinct authors in the
     * newest half of that window, and posts over the baseline (the days before the window), which show what is normal for the tag.
     */
    public record TrendCandidate(String name, long recentPosts, long recentAuthors, long newerHalfAuthors, long baselinePosts) {
    }
}
