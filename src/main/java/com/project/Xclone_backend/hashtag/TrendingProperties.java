package com.project.Xclone_backend.hashtag;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** {@code minAuthors}: how many different accounts must have used a tag in the recent window before it can trend at all. */
@ConfigurationProperties(prefix = "app.trending")
public record TrendingProperties(int minAuthors) {

    public TrendingProperties {
        if (minAuthors < 1) {
            minAuthors = 2;
        }
    }
}
