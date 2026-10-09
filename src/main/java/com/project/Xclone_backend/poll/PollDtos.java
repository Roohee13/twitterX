package com.project.Xclone_backend.poll;

import java.time.Instant;
import java.util.List;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public final class PollDtos {

    private PollDtos() {
    }

    /** {@code durationMinutes}: 5 minutes to 7 days; one day when left out. */
    public record CreatePollRequest(
            @NotNull @Size(min = 2, max = 4) List<@NotNull @Size(max = PollOption.MAX_LENGTH) String> options,
            @Min(PollService.MIN_MINUTES) @Max(PollService.MAX_MINUTES) Integer durationMinutes) {
    }

    public record VoteRequest(@NotNull Long optionId) {
    }

    public record PollOptionResponse(Long id, String text, int voteCount) {
    }

    /** {@code myVoteOptionId} is null until the viewer votes (and for anonymous viewers). Results are visible to everyone. */
    public record PollResponse(Long id, List<PollOptionResponse> options, int totalVotes, Instant expiresAt, boolean ended,
            Long myVoteOptionId) {
    }
}
