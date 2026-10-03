package com.project.Xclone_backend.notification;

public enum NotificationType {
    FOLLOW, LIKE, REPLY, MENTION, REPOST,
    /** Someone asked to follow a protected account; the recipient is the account owner. */
    FOLLOW_REQUEST
}
