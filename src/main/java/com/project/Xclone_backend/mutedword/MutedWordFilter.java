package com.project.Xclone_backend.mutedword;

import java.util.Collection;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Decides whether a text contains any of a user's muted words. A word matches as a whole word or phrase, ignoring case, so muting "ass" does
 * not hide "class", while "#cats" and "cats" (inside a hashtag) both match "cats".
 */
public final class MutedWordFilter {

    public static final MutedWordFilter NONE = new MutedWordFilter(null);

    private static final String WORD_CHAR = "[\\p{L}\\p{N}_]";

    private final Pattern pattern;

    private MutedWordFilter(Pattern pattern) {
        this.pattern = pattern;
    }

    public static MutedWordFilter of(Collection<String> words) {
        if (words.isEmpty()) {
            return NONE;
        }
        String alternatives = words.stream().map(Pattern::quote).collect(Collectors.joining("|"));
        return new MutedWordFilter(Pattern.compile("(?<!" + WORD_CHAR + ")(?:" + alternatives + ")(?!" + WORD_CHAR + ")",
                Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE));
    }

    public boolean isEmpty() {
        return pattern == null;
    }

    public boolean hides(String text) {
        return pattern != null && text != null && pattern.matcher(text).find();
    }
}
