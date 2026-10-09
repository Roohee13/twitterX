package com.project.Xclone_backend.security;

/** Authenticated principal extracted from the access token. {@code tokenVersion} is the user's version when the token was issued. */
public record AuthUser(Long id, String username, int tokenVersion) {

    public AuthUser(Long id, String username) {
        this(id, username, 0);
    }
}
