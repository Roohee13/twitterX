package com.project.Xclone_backend.websocket;

import static org.awaitility.Awaitility.await;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import java.time.Duration;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import tools.jackson.databind.JsonNode;

/**
 * Real Redis round trip with the relay on: a push (or a message published by another instance) must reach this
 * instance's broker through the Redis subscription. Skipped when Redis is unreachable.
 */
@SpringBootTest(properties = "app.websocket.redis-relay=true")
@ActiveProfiles("test")
class UserPushRelayRedisTest {

    @Autowired
    UserPushPublisher publisher;

    @Autowired
    StringRedisTemplate redis;

    @MockitoSpyBean
    SimpMessagingTemplate messagingTemplate;

    @MockitoBean
    S3Client s3Client;

    @MockitoBean
    S3Presigner s3Presigner;

    private void requireRedis() {
        try {
            redis.getConnectionFactory().getConnection().ping();
        } catch (RuntimeException e) {
            assumeTrue(false, "Redis not reachable; run `docker compose up -d redis`");
        }
        // The relay subscribes on a background thread; publish a harmless probe until someone is listening.
        await().atMost(Duration.ofSeconds(15)).pollInterval(Duration.ofMillis(200)).until(() -> {
            Long receivers = redis.convertAndSend(UserPushPublisher.CHANNEL,
                    "{\"userId\":0,\"destination\":\"/queue/probe\",\"payload\":{}}");
            return receivers != null && receivers >= 1;
        });
    }

    @Test
    void aPushGoesThroughRedisAndIsDeliveredByTheSubscription() {
        requireRedis();

        publisher.send(42, "/queue/notifications", Map.of("id", 9, "type", "FOLLOW"));

        verify(messagingTemplate, timeout(5000)).convertAndSendToUser(eq("42"), eq("/queue/notifications"),
                any(JsonNode.class));
    }

    @Test
    void aMessagePublishedByAnotherInstanceIsDeliveredHere() {
        requireRedis();

        redis.convertAndSend(UserPushPublisher.CHANNEL,
                "{\"userId\":43,\"destination\":\"/queue/messages\",\"payload\":{\"id\":1}}");

        verify(messagingTemplate, timeout(5000)).convertAndSendToUser(eq("43"), eq("/queue/messages"),
                any(JsonNode.class));
    }
}
