package com.project.Xclone_backend.user;

/** Who may message an account. Someone the account has already written to can always answer. */
public enum DmPolicy {
    EVERYONE,
    /** Only accounts the user follows. */
    FOLLOWED,
    NOBODY
}
