package com.project.Xclone_backend.notification;

public enum NotificationType {
    FOLLOW, LIKE, REPLY, MENTION, REPOST,
    /** Someone asked to follow a protected account; the recipient is the account owner. */
    FOLLOW_REQUEST,
    /** To admins: someone reported an account or a post. System notification (no actor). */
    REPORT_RECEIVED,
    /** To a post's author: an admin removed it. System notification. */
    POST_REMOVED,
    /** To a reporter: what happened to their report. System notification. */
    REPORT_OUTCOME
}
