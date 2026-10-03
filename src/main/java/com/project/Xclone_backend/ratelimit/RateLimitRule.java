package com.project.Xclone_backend.ratelimit;

import java.time.Duration;
import java.util.Set;

/** One limit: which requests it covers, who is counted (client IP or signed-in user), and how many per window. */
public record RateLimitRule(String name, Set<String> methods, String pattern, Scope scope, int limit,
        Duration window) {

    public enum Scope { IP, USER }
}
