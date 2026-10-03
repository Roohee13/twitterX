package com.project.Xclone_backend.websocket;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The single way to push to a user's WebSocket queue. With the relay on, the push is published to Redis and every
 * instance (including this one) delivers it to the sessions it holds, so it reaches the user whichever instance they
 * are connected to. With the relay off, or while Redis is unreachable, it is delivered to this instance's sessions
 * only. Redis is not retried for {@link #COOLDOWN} after a failure so an outage does not add a timeout to each push.
 */
@Component
public class UserPushPublisher {

    /** What travels over Redis. */
    public record Envelope(long userId, String destination, JsonNode payload) {
    }

    public static final String CHANNEL = "ws:user-push";
    static final Duration COOLDOWN = Duration.ofSeconds(30);

    private static final Logger log = LoggerFactory.getLogger(UserPushPublisher.class);

    private final StringRedisTemplate redis;
    private final SimpMessagingTemplate messagingTemplate;
    private final JsonMapper jsonMapper;
    private final boolean relayEnabled;
    private final AtomicLong skipRedisUntilNanos = new AtomicLong();

    public UserPushPublisher(StringRedisTemplate redis, SimpMessagingTemplate messagingTemplate,
            JsonMapper jsonMapper, @Value("${app.websocket.redis-relay:false}") boolean relayEnabled) {
        this.redis = redis;
        this.messagingTemplate = messagingTemplate;
        this.jsonMapper = jsonMapper;
        this.relayEnabled = relayEnabled;
    }

    public void send(long userId, String destination, Object payload) {
        if (relayEnabled && System.nanoTime() - skipRedisUntilNanos.get() >= 0) {
            try {
                String json = jsonMapper.writeValueAsString(
                        new Envelope(userId, destination, jsonMapper.valueToTree(payload)));
                redis.convertAndSend(CHANNEL, json);
                return;
            } catch (RuntimeException e) {
                skipRedisUntilNanos.set(System.nanoTime() + COOLDOWN.toNanos());
                log.warn("Redis push relay unavailable; delivering locally for {}s: {}", COOLDOWN.toSeconds(),
                        e.getMessage());
            }
        }
        deliverLocally(userId, destination, payload);
    }

    void deliverLocally(long userId, String destination, Object payload) {
        messagingTemplate.convertAndSendToUser(String.valueOf(userId), destination, payload);
    }
}
