package com.project.Xclone_backend.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;

import org.junit.jupiter.api.Test;

import com.project.Xclone_backend.message.MessageDtos.SendMessageRequest;
import com.project.Xclone_backend.message.MessageService;
import com.project.Xclone_backend.ratelimit.RateLimitProperties;
import com.project.Xclone_backend.ratelimit.RateLimitRules;
import com.project.Xclone_backend.ratelimit.RateLimitedException;
import com.project.Xclone_backend.ratelimit.RateLimiter;
import com.project.Xclone_backend.ratelimit.RateLimiter.Decision;
import com.project.Xclone_backend.security.AuthUser;
import com.project.Xclone_backend.security.EmailVerificationGuard;

class MessageSocketControllerTest {

    private final MessageService messages = mock(MessageService.class);
    private final RateLimiter limiter = mock(RateLimiter.class);
    private final EmailVerificationGuard guard = mock(EmailVerificationGuard.class);
    private final StompPrincipal alice = new StompPrincipal(new AuthUser(7L, "alice"));
    private final SendMessageRequest req = new SendMessageRequest("hi", null);

    @Test
    void sendsOverTheSocketShareTheRestAllowanceAndAreRefusedOverIt() {
        MessageSocketController controller = new MessageSocketController(messages, limiter, new RateLimitProperties(true), guard);
        when(limiter.check("rl:message-send:u:7", 60, Duration.ofMinutes(1))).thenReturn(new Decision(false, 42));

        assertThatThrownBy(() -> controller.send(1L, req, alice)).isInstanceOfSatisfying(RateLimitedException.class,
                e -> assertThat(e.getRetryAfterSeconds()).isEqualTo(42));

        verify(messages, never()).send(any(), any(), any(), any());
    }

    @Test
    void anAllowedSendGoesThrough() {
        MessageSocketController controller = new MessageSocketController(messages, limiter, new RateLimitProperties(true), guard);
        when(limiter.check("rl:message-send:u:7", RateLimitRules.MESSAGE_SEND.limit(), RateLimitRules.MESSAGE_SEND.window()))
                .thenReturn(new Decision(true, 0));

        controller.send(1L, req, alice);

        verify(messages).send(7L, 1L, "hi", null);
    }

    @Test
    void whenRateLimitingIsOffTheLimiterIsNotConsulted() {
        MessageSocketController controller = new MessageSocketController(messages, limiter, new RateLimitProperties(false), guard);

        controller.send(1L, req, alice);

        verifyNoInteractions(limiter);
        verify(messages).send(7L, 1L, "hi", null);
    }

    @Test
    void anUnverifiedAccountCannotSend() {
        MessageSocketController controller = new MessageSocketController(messages, limiter, new RateLimitProperties(true), guard);
        org.mockito.Mockito.doThrow(com.project.Xclone_backend.common.ApiException.forbidden("verify")).when(guard).requireVerified(7L);

        assertThatThrownBy(() -> controller.send(1L, req, alice)).isInstanceOf(com.project.Xclone_backend.common.ApiException.class);

        verifyNoInteractions(limiter);
        verify(messages, never()).send(any(), any(), any(), any());
    }
}
