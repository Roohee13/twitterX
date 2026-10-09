package com.project.Xclone_backend.ratelimit;

import org.springframework.http.HttpStatus;

import com.project.Xclone_backend.common.ApiException;

import lombok.Getter;

/** A 429 raised from service code (the filter writes its own 429 for plain requests). Carries the wait for the Retry-After header. */
@Getter
public class RateLimitedException extends ApiException {

    private final long retryAfterSeconds;

    public RateLimitedException(String message, long retryAfterSeconds) {
        super(HttpStatus.TOO_MANY_REQUESTS, message);
        this.retryAfterSeconds = retryAfterSeconds;
    }
}
