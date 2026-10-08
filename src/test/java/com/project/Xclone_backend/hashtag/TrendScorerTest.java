package com.project.Xclone_backend.hashtag;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.project.Xclone_backend.hashtag.HashtagDtos.TrendCandidate;
import com.project.Xclone_backend.hashtag.HashtagDtos.TrendingHashtag;

class TrendScorerTest {

    private static final double WINDOW = 6;
    private static final double BASELINE = 168;

    private static TrendCandidate tag(String name, long posts, long authors, long newerHalf, long baseline) {
        return new TrendCandidate(name, posts, authors, newerHalf, baseline);
    }

    private static List<String> order(TrendCandidate... candidates) {
        return TrendScorer.rank(List.of(candidates), WINDOW, BASELINE, 50).stream().map(TrendingHashtag::name).toList();
    }

    @Test
    void aSpikeBeatsAnEvergreenTagThatHasMoreAuthors() {
        // "always" has 40 authors now, but around 1000 a week (about 35 per window): nothing unusual. "breaking" has 10, from almost nothing.
        assertThat(order(tag("always", 80, 40, 20, 1000), tag("breaking", 15, 10, 8, 2))).containsExactly("breaking", "always");
    }

    @Test
    void aBrandNewTagCanTrendOnceEnoughDifferentPeopleUseIt() {
        assertThat(order(tag("fresh", 4, 4, 3, 0), tag("meh", 3, 3, 0, 300))).containsExactly("fresh", "meh");
    }

    @Test
    void newerPostsCountMoreThanOlderOnesWithTheSameNumbers() {
        assertThat(order(tag("older", 5, 5, 0, 0), tag("newer", 5, 5, 5, 0))).containsExactly("newer", "older");
    }

    @Test
    void aTagBackedByManyPostsFromFewAuthorsDoesNotOutrankOneBackedByMoreAuthors() {
        assertThat(order(tag("spammed", 200, 2, 2, 0), tag("shared", 6, 6, 3, 0))).containsExactly("shared", "spammed");
    }

    @Test
    void tiesBreakByAuthorsThenPostsThenName() {
        assertThat(order(tag("b", 4, 3, 3, 0), tag("a", 4, 3, 3, 0), tag("c", 9, 3, 3, 0))).containsExactly("c", "a", "b");
    }

    @Test
    void theResultIsLimitedAndCarriesTheRecentCounts() {
        List<TrendingHashtag> top = TrendScorer.rank(List.of(tag("x", 7, 3, 2, 0), tag("y", 5, 2, 1, 0)), WINDOW, BASELINE, 1);

        assertThat(top).containsExactly(new TrendingHashtag("x", 7, 3));
    }
}
