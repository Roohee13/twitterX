package com.project.Xclone_backend.notification;

import java.time.Instant;

import com.project.Xclone_backend.user.UserDtos.UserSummary;

public final class NotificationDtos {

    private NotificationDtos() {
    }

    /** {@code actor} is null for system notifications; {@code detail} is their text. {@code postId} and {@code postContent} are null for FOLLOW notifications. */
    public record NotificationResponse(Long id, NotificationType type, UserSummary actor, Long postId,
            String postContent, String detail, boolean read, Instant createdAt) {
    }

    public record UnreadCountResponse(long count) {
    }
}
