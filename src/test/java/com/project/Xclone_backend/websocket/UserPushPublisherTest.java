package com.project.Xclone_backend.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import java.time.Instant;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import tools.jackson.databind.json.JsonMapper;

class UserPushPublisherTest {

    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final SimpMessagingTemplate template = mock(SimpMessagingTemplate.class);
    private final JsonMapper mapper = JsonMapper.builder().build();

    private UserPushPublisher publisher(boolean relay) {
        return new UserPushPublisher(redis, template, mapper, relay);
    }

    @Test
    void relayOffDeliversLocallyWithoutTouchingRedis() {
        Map<String, Object> payload = Map.of("id", 1);

        publisher(false).send(7, "/queue/notifications", payload);

        verify(template).convertAndSendToUser("7", "/queue/notifications", payload);
        verifyNoInteractions(redis);
    }

    @Test
    void relayOnPublishesAnEnvelopeToRedisAndDoesNotDeliverLocally() throws Exception {
        record Payload(long id, Instant createdAt) {
        }

        publisher(true).send(7, "/queue/notifications", new Payload(3, Instant.parse("2026-01-02T03:04:05Z")));

        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(redis).convertAndSend(eq(UserPushPublisher.CHANNEL), json.capture());
        var envelope = mapper.readValue(json.getValue(), UserPushPublisher.Envelope.class);
        assertThat(envelope.userId()).isEqualTo(7);
        assertThat(envelope.destination()).isEqualTo("/queue/notifications");
        assertThat(envelope.payload().get("id").asLong()).isEqualTo(3);
        assertThat(envelope.payload().get("createdAt").asString()).isEqualTo("2026-01-02T03:04:05Z");
        verify(template, never()).convertAndSendToUser(anyString(), anyString(), any(Object.class));
    }

    @Test
    void redisFailureFallsBackToLocalDeliveryAndPausesRedis() {
        doThrow(new RedisConnectionFailureException("down")).when(redis).convertAndSend(anyString(), anyString());
        UserPushPublisher publisher = publisher(true);

        publisher.send(7, "/queue/messages", Map.of("n", 1));
        publisher.send(7, "/queue/messages", Map.of("n", 2));

        verify(template, times(2)).convertAndSendToUser(eq("7"), eq("/queue/messages"), any(Object.class));
        verify(redis, times(1)).convertAndSend(anyString(), anyString()); // second push skipped Redis
    }
}
