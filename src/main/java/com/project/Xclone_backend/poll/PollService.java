package com.project.Xclone_backend.poll;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.project.Xclone_backend.common.ApiException;
import com.project.Xclone_backend.poll.PollDtos.CreatePollRequest;
import com.project.Xclone_backend.poll.PollDtos.PollOptionResponse;
import com.project.Xclone_backend.poll.PollDtos.PollResponse;

import lombok.RequiredArgsConstructor;

/** Creating polls, voting, and rendering them. Who may see or vote on the post is decided by the caller (PostService). */
@Service
@RequiredArgsConstructor
public class PollService {

    public static final int MIN_MINUTES = 5;
    public static final int MAX_MINUTES = 7 * 24 * 60;
    static final int DEFAULT_MINUTES = 24 * 60;

    private final PollRepository repository;
    private final PollOptionRepository optionRepository;

    /** Called inside the transaction that creates the post. */
    @Transactional
    public void create(Long postId, CreatePollRequest req) {
        List<String> texts = new ArrayList<>();
        for (String raw : req.options()) {
            String text = raw.strip().replaceAll("\\s+", " ");
            if (text.isEmpty()) {
                throw ApiException.badRequest("Poll options cannot be empty");
            }
            if (text.length() > PollOption.MAX_LENGTH) {
                throw ApiException.badRequest("Poll options can be at most " + PollOption.MAX_LENGTH + " characters");
            }
            texts.add(text);
        }
        if (texts.stream().map(t -> t.toLowerCase(Locale.ROOT)).distinct().count() != texts.size()) {
            throw ApiException.badRequest("Poll options must be different from each other");
        }
        int minutes = req.durationMinutes() == null ? DEFAULT_MINUTES : req.durationMinutes();
        if (minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
            throw ApiException.badRequest("A poll runs from " + MIN_MINUTES + " minutes to 7 days");
        }
        Poll poll = new Poll();
        poll.setPostId(postId);
        poll.setExpiresAt(Instant.now().plus(Duration.ofMinutes(minutes)));
        repository.save(poll);
        List<PollOption> options = new ArrayList<>();
        for (int i = 0; i < texts.size(); i++) {
            PollOption option = new PollOption();
            option.setPollId(poll.getId());
            option.setPosition(i);
            option.setText(texts.get(i));
            options.add(option);
        }
        optionRepository.saveAll(options);
    }

    /** Records the viewer's vote and returns the updated poll. One vote per person, only while the poll is open. */
    @Transactional
    public PollResponse vote(Long postId, Long userId, Long optionId) {
        Poll poll = repository.findByPostId(postId).orElseThrow(() -> ApiException.notFound("This post has no poll"));
        if (poll.hasEnded(Instant.now())) {
            throw ApiException.conflict("This poll has ended");
        }
        List<PollOption> options = repository.findOptions(List.of(poll.getId()));
        if (options.stream().noneMatch(o -> o.getId().equals(optionId))) {
            throw ApiException.badRequest("That option is not part of this poll");
        }
        if (repository.vote(poll.getId(), optionId, userId) == 0) {
            throw ApiException.conflict("You have already voted in this poll");
        }
        repository.addToVoteCount(optionId, 1);
        return responses(List.of(postId), userId).get(postId);
    }

    /** The polls of the given posts (posts without one are absent from the map), with the viewer's votes. Three queries at most. */
    @Transactional(readOnly = true)
    public Map<Long, PollResponse> responses(Collection<Long> postIds, Long viewerId) {
        if (postIds.isEmpty()) {
            return Map.of();
        }
        List<Poll> polls = repository.findByPostIdIn(postIds);
        if (polls.isEmpty()) {
            return Map.of();
        }
        List<Long> pollIds = polls.stream().map(Poll::getId).toList();
        Map<Long, List<PollOption>> options = repository.findOptions(pollIds).stream()
                .collect(Collectors.groupingBy(PollOption::getPollId));
        Map<Long, Long> myVotes = new HashMap<>();
        if (viewerId != null) {
            repository.findVotes(viewerId, pollIds).forEach(v -> myVotes.put(v.getPollId(), v.getOptionId()));
        }
        Instant now = Instant.now();
        Map<Long, PollResponse> out = new HashMap<>();
        for (Poll poll : polls) {
            List<PollOption> list = options.getOrDefault(poll.getId(), List.of());
            out.put(poll.getPostId(), new PollResponse(poll.getId(),
                    list.stream().map(o -> new PollOptionResponse(o.getId(), o.getText(), o.getVoteCount())).toList(),
                    list.stream().mapToInt(PollOption::getVoteCount).sum(), poll.getExpiresAt(), poll.hasEnded(now),
                    myVotes.get(poll.getId())));
        }
        return out;
    }
}
