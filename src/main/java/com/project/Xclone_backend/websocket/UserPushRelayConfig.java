package com.project.Xclone_backend.websocket;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.SmartLifecycle;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import tools.jackson.databind.json.JsonMapper;

/**
 * Every instance subscribes to the push channel and hands each message to its own simple broker, which delivers it
 * only if the target user has a session on this instance.
 *
 * <p>The container throws if Redis is unreachable when it starts, which would stop the whole app from booting. So it
 * is started by {@link Starter} on a background thread that waits for Redis; once subscribed, the container
 * reconnects on its own if Redis later goes away. Until then pushes fall back to local delivery.
 */
@Configuration
@ConditionalOnProperty(name = "app.websocket.redis-relay", havingValue = "true")
public class UserPushRelayConfig {

    private static final Logger log = LoggerFactory.getLogger(UserPushRelayConfig.class);

    @Bean
    RedisMessageListenerContainer userPushListenerContainer(RedisConnectionFactory connectionFactory,
            SimpMessagingTemplate messagingTemplate, JsonMapper jsonMapper) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.setAutoStartup(false); // started by Starter
        container.addMessageListener((message, pattern) -> {
            try {
                var envelope = jsonMapper.readValue(message.getBody(), UserPushPublisher.Envelope.class);
                messagingTemplate.convertAndSendToUser(String.valueOf(envelope.userId()), envelope.destination(),
                        envelope.payload());
            } catch (RuntimeException e) {
                log.warn("Dropping malformed push relay message: {}", e.getMessage());
            }
        }, new ChannelTopic(UserPushPublisher.CHANNEL));
        return container;
    }

    @Bean
    Starter userPushRelayStarter(RedisMessageListenerContainer userPushListenerContainer,
            RedisConnectionFactory connectionFactory) {
        return new Starter(userPushListenerContainer, connectionFactory);
    }

    static class Starter implements SmartLifecycle {

        private static final long RETRY_MILLIS = 5_000;

        private final RedisMessageListenerContainer container;
        private final RedisConnectionFactory connectionFactory;
        private volatile Thread thread;
        private volatile boolean running;

        Starter(RedisMessageListenerContainer container, RedisConnectionFactory connectionFactory) {
            this.container = container;
            this.connectionFactory = connectionFactory;
        }

        @Override
        public void start() {
            running = true;
            Thread t = new Thread(this::subscribeWhenRedisIsUp, "push-relay-starter");
            t.setDaemon(true);
            thread = t;
            t.start();
        }

        private void subscribeWhenRedisIsUp() {
            boolean warned = false;
            while (running) {
                try (var connection = connectionFactory.getConnection()) {
                    connection.ping();
                    container.start();
                    log.info("Push relay subscribed to Redis channel {}", UserPushPublisher.CHANNEL);
                    return;
                } catch (RuntimeException e) {
                    if (!warned) {
                        log.warn("Push relay waiting for Redis (pushes are delivered locally meanwhile): {}",
                                e.getMessage());
                        warned = true;
                    }
                    container.stop();
                }
                try {
                    Thread.sleep(RETRY_MILLIS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }

        @Override
        public void stop() {
            running = false;
            Thread t = thread;
            if (t != null) {
                t.interrupt();
            }
            container.stop();
        }

        @Override
        public boolean isRunning() {
            return running;
        }
    }
}
