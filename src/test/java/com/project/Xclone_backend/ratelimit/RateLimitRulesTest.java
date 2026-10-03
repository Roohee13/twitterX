package com.project.Xclone_backend.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class RateLimitRulesTest {

    private static String rule(String method, String path) {
        return RateLimitRules.match(method, path).map(RateLimitRule::name).orElse(null);
    }

    @Test
    void specificRulesWinOverTheGenericWriteLimit() {
        assertThat(rule("POST", "/api/auth/login")).isEqualTo("auth-login");
        assertThat(rule("POST", "/api/auth/logout")).isEqualTo("auth-other");
        assertThat(rule("POST", "/api/posts")).isEqualTo("post-create");
        assertThat(rule("POST", "/api/posts/thread")).isEqualTo("thread-create");
        assertThat(rule("POST", "/api/conversations/7/messages")).isEqualTo("message-send");
        assertThat(rule("POST", "/api/users/alice/follow")).isEqualTo("follow");
        assertThat(rule("POST", "/api/posts/9/report")).isEqualTo("report-post");
    }

    @Test
    void otherWritesFallBackToTheGenericLimit() {
        assertThat(rule("POST", "/api/posts/9/like")).isEqualTo("write");
        assertThat(rule("DELETE", "/api/posts/9")).isEqualTo("write");
        assertThat(rule("PATCH", "/api/users/me")).isEqualTo("write");
    }

    @Test
    void readsAreNotLimited() {
        assertThat(rule("GET", "/api/timeline")).isNull();
        assertThat(rule("GET", "/api/posts/9")).isNull();
        assertThat(rule("GET", "/api/auth/login")).isNull();
    }
}
