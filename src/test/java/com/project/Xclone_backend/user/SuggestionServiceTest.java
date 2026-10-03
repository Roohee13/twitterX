package com.project.Xclone_backend.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.Test;

import com.project.Xclone_backend.follow.FollowRepository;
import com.project.Xclone_backend.user.UserDtos.SuggestionResponse;
import com.project.Xclone_backend.user.UserDtos.UserSummary;
import com.project.Xclone_backend.user.UserRepository.SuggestionRow;

class SuggestionServiceTest {

    private final UserRepository users = mock(UserRepository.class);
    private final FollowRepository follows = mock(FollowRepository.class);
    private final UserMapper mapper = mock(UserMapper.class);
    private final AtomicLong clock = new AtomicLong();

    private SuggestionService service(Duration ttl) {
        when(mapper.toSummary(any(Long.class), any(), any(), any())).thenAnswer(i ->
                new UserSummary(i.getArgument(0), i.getArgument(1), i.getArgument(2), null));
        return new SuggestionService(users, follows, mapper, ttl, clock::get);
    }

    private static SuggestionRow row(long id, long mutuals) {
        return new SuggestionRow() {
            public Long getId() {
                return id;
            }

            public String getUsername() {
                return "u" + id;
            }

            public String getDisplayName() {
                return "User " + id;
            }

            public String getAvatarKey() {
                return null;
            }

            public Long getMutuals() {
                return mutuals;
            }
        };
    }

    @Test
    void friendsOfFriendsKeepTheirRankingAndSkipThePopularFallbackWhenFull() {
        when(users.findFriendsOfFriends(1L, SuggestionService.FIRST_HOP, 2)).thenReturn(List.of(row(5, 3), row(6, 1)));

        List<SuggestionResponse> result = service(Duration.ofMinutes(10)).suggestions(1L, 2);

        assertThat(result).extracting(r -> r.user().id()).containsExactly(5L, 6L);
        assertThat(result).extracting(SuggestionResponse::mutualFollowCount).containsExactly(3L, 1L);
        verify(follows, never()).findMostFollowedIds(anyInt());
    }

    @Test
    void shortListsAreFilledWithPopularAccountsInPopularityOrderWithoutDuplicates() {
        when(users.findFriendsOfFriends(anyLong(), anyInt(), anyInt())).thenReturn(List.of(row(5, 2)));
        when(follows.findMostFollowedIds(anyInt())).thenReturn(List.of(9L, 5L, 8L, 7L));
        // The repository returns the allowed candidates in arbitrary order; 8 is filtered out (blocked, say).
        when(users.findAllowedAmong(anyLong(), anyCollection())).thenReturn(List.of(row(7, 0), row(9, 0)));

        List<SuggestionResponse> result = service(Duration.ofMinutes(10)).suggestions(1L, 3);

        assertThat(result).extracting(r -> r.user().id()).containsExactly(5L, 9L, 7L);
        verify(users).findAllowedAmong(1L, List.of(9L, 8L, 7L)); // 5 was already suggested
    }

    @Test
    void popularRankingIsCachedUntilTheTtlExpires() {
        when(users.findFriendsOfFriends(anyLong(), anyInt(), anyInt())).thenReturn(List.of());
        when(follows.findMostFollowedIds(anyInt())).thenReturn(List.of(9L));
        when(users.findAllowedAmong(anyLong(), anyCollection())).thenReturn(List.of(row(9, 0)));
        SuggestionService service = service(Duration.ofMinutes(10));

        service.suggestions(1L, 5);
        service.suggestions(2L, 5);
        verify(follows, times(1)).findMostFollowedIds(anyInt());

        clock.addAndGet(Duration.ofMinutes(11).toNanos());
        service.suggestions(3L, 5);
        verify(follows, times(2)).findMostFollowedIds(anyInt());
    }

    @Test
    void limitIsClampedAndDefaulted() {
        when(users.findFriendsOfFriends(anyLong(), anyInt(), anyInt())).thenReturn(List.of());
        when(follows.findMostFollowedIds(anyInt())).thenReturn(List.of());
        SuggestionService service = service(Duration.ofMinutes(10));

        service.suggestions(1L, null);
        service.suggestions(1L, 500);
        service.suggestions(1L, 0);

        verify(users, times(2)).findFriendsOfFriends(1L, SuggestionService.FIRST_HOP, SuggestionService.DEFAULT_LIMIT);
        verify(users).findFriendsOfFriends(1L, SuggestionService.FIRST_HOP, SuggestionService.MAX_LIMIT);
    }
}
