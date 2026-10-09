package com.project.Xclone_backend.auth;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.Optional;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.project.Xclone_backend.auth.AuthDtos.LoginRequest;
import com.project.Xclone_backend.common.ApiException;
import com.project.Xclone_backend.config.JwtProperties;
import com.project.Xclone_backend.ratelimit.LoginAttemptLimiter;
import com.project.Xclone_backend.ratelimit.RateLimitedException;
import com.project.Xclone_backend.security.ActiveUserCache;
import com.project.Xclone_backend.security.JwtService;
import com.project.Xclone_backend.user.User;
import com.project.Xclone_backend.user.UserMapper;
import com.project.Xclone_backend.user.UserRepository;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AuthServiceLoginTest {

    @Mock UserRepository userRepository;
    @Mock RefreshTokenRepository refreshTokenRepository;
    @Mock PasswordEncoder passwordEncoder;
    @Mock JwtService jwtService;
    @Mock JwtProperties jwtProperties;
    @Mock UserMapper userMapper;
    @Mock EmailTokenService emailTokenService;
    @Mock ActiveUserCache activeUserCache;
    @Mock LoginAttemptLimiter loginAttempts;
    @InjectMocks AuthService service;

    private static User user() {
        User u = new User();
        u.setUsername("alice");
        u.setPasswordHash("hash");
        return u;
    }

    @Test
    void aLockedAccountIsRefusedBeforeThePasswordIsEvenChecked() {
        org.mockito.Mockito.doThrow(new RateLimitedException("locked", 60)).when(loginAttempts).requireNotLocked("alice");

        assertThatThrownBy(() -> service.login(new LoginRequest("Alice", "right-password"))).isInstanceOf(RateLimitedException.class);

        verifyNoInteractions(passwordEncoder);
        verify(userRepository, never()).findByUsername(anyString());
    }

    @Test
    void aWrongPasswordIsCountedAsAFailure() {
        when(userRepository.findByUsername("alice")).thenReturn(Optional.of(user()));
        when(passwordEncoder.matches("nope", "hash")).thenReturn(false);

        assertThatThrownBy(() -> service.login(new LoginRequest("alice", "nope"))).isInstanceOf(ApiException.class);

        verify(loginAttempts).recordFailure("alice");
        verify(loginAttempts, never()).reset(any());
    }

    @Test
    void anUnknownNameIsCountedToo_andStillPaysForAPasswordCheck() {
        when(userRepository.findByUsername("ghost")).thenReturn(Optional.empty());
        when(passwordEncoder.encode(anyString())).thenReturn("dummy-hash");

        assertThatThrownBy(() -> service.login(new LoginRequest("ghost", "whatever"))).isInstanceOf(ApiException.class);

        verify(passwordEncoder).matches(eq("whatever"), eq("dummy-hash"));
        verify(loginAttempts).recordFailure("ghost");
    }

    @Test
    void aCorrectPasswordClearsTheFailureCount() {
        when(userRepository.findByUsername("alice")).thenReturn(Optional.of(user()));
        when(passwordEncoder.matches("good-password", "hash")).thenReturn(true);
        when(jwtProperties.refreshTtl()).thenReturn(Duration.ofDays(1));

        service.login(new LoginRequest("alice", "good-password"));

        verify(loginAttempts).reset("alice");
        verify(loginAttempts, never()).recordFailure(any());
    }
}
