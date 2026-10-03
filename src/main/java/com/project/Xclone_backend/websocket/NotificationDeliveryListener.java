package com.project.Xclone_backend.websocket;

import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import com.project.Xclone_backend.notification.NotificationCreatedEvent;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * Pushes a new notification to the recipient's /user/queue/notifications once it is committed (so a rolled-back action
 * never notifies anyone). A recipient with no open session simply misses the push; the notification stays available
 * over REST, and clients should read the unread count from REST when they connect.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class NotificationDeliveryListener {

    private final SimpMessagingTemplate messagingTemplate;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onNotificationCreated(NotificationCreatedEvent event) {
        try {
            messagingTemplate.convertAndSendToUser(String.valueOf(event.recipientId()), "/queue/notifications",
                    event.notification());
        } catch (RuntimeException e) {
            log.warn("Could not push notification {} to user {}", event.notification().id(), event.recipientId(), e);
        }
    }
}
