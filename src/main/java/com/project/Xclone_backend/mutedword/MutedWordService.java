package com.project.Xclone_backend.mutedword;

import java.time.Instant;
import java.util.List;
import java.util.Locale;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.project.Xclone_backend.common.ApiException;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class MutedWordService {

    public static final int MAX_WORDS = 200;
    public static final int MAX_LENGTH = 50;

    public record MutedWordResponse(Long id, String word, Instant createdAt) {
        static MutedWordResponse of(MutedWord w) {
            return new MutedWordResponse(w.getId(), w.getWord(), w.getCreatedAt());
        }
    }

    private final MutedWordRepository repository;

    @Transactional(readOnly = true)
    public List<MutedWordResponse> list(Long userId) {
        return repository.findByUserIdOrderByIdDesc(userId).stream().map(MutedWordResponse::of).toList();
    }

    /** Idempotent: adding a word the user already has returns it unchanged. */
    @Transactional
    public MutedWordResponse add(Long userId, String raw) {
        String word = normalize(raw);
        if (word.isEmpty()) {
            throw ApiException.badRequest("Enter a word or phrase to mute");
        }
        if (word.length() > MAX_LENGTH) {
            throw ApiException.badRequest("A muted word can be at most " + MAX_LENGTH + " characters");
        }
        if (repository.findByUserIdAndWord(userId, word).isEmpty() && repository.countByUserId(userId) >= MAX_WORDS) {
            throw ApiException.badRequest("You can mute at most " + MAX_WORDS + " words");
        }
        repository.add(userId, word);
        return MutedWordResponse.of(repository.findByUserIdAndWord(userId, word)
                .orElseThrow(() -> ApiException.conflict("Could not save that word, please try again")));
    }

    /** Safe to repeat. */
    @Transactional
    public void remove(Long userId, Long id) {
        repository.remove(id, userId);
    }

    /** The filter for a viewer's feeds; {@link MutedWordFilter#NONE} for anonymous viewers and people with no muted words. */
    @Transactional(readOnly = true)
    public MutedWordFilter filterFor(Long userId) {
        if (userId == null) {
            return MutedWordFilter.NONE;
        }
        return MutedWordFilter.of(repository.findByUserIdOrderByIdDesc(userId).stream().map(MutedWord::getWord).toList());
    }

    static String normalize(String raw) {
        return raw == null ? "" : raw.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }
}
