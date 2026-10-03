package com.project.Xclone_backend.notification;

import com.project.Xclone_backend.notification.NotificationDtos.NotificationResponse;

/** Published inside the transaction that saves a notification; consumers react after it commits. */
public record NotificationCreatedEvent(Long recipientId, NotificationResponse notification) {
}
