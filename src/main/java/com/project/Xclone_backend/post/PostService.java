package com.project.Xclone_backend.post;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.BiFunction;
import java.util.function.BiPredicate;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.project.Xclone_backend.bookmark.Bookmark;
import com.project.Xclone_backend.bookmark.BookmarkRepository;
import com.project.Xclone_backend.common.ApiException;
import com.project.Xclone_backend.common.CursorPage;
import com.project.Xclone_backend.follow.FollowRepository;
import com.project.Xclone_backend.hashtag.Hashtag;
import com.project.Xclone_backend.hashtag.HashtagService;
import com.project.Xclone_backend.like.LikeRepository;
import com.project.Xclone_backend.like.PostLike;
import com.project.Xclone_backend.media.MediaService;
import com.project.Xclone_backend.mention.MentionService;
import com.project.Xclone_backend.mutedword.MutedWordFilter;
import com.project.Xclone_backend.mutedword.MutedWordService;
import com.project.Xclone_backend.notification.NotificationService;
import com.project.Xclone_backend.poll.PollDtos.PollResponse;
import com.project.Xclone_backend.poll.PollService;
import com.project.Xclone_backend.notification.NotificationType;
import com.project.Xclone_backend.post.PostDtos.CreatePostRequest;
import com.project.Xclone_backend.post.PostDtos.CreateThreadRequest;
import com.project.Xclone_backend.post.PostDtos.PostResponse;
import com.project.Xclone_backend.post.PostDtos.UpdatePostRequest;
import com.project.Xclone_backend.report.ModerationNotifier;
import com.project.Xclone_backend.report.PostReportRepository;
import com.project.Xclone_backend.report.ReportStatus;
import com.project.Xclone_backend.report.ReportReason;
import com.project.Xclone_backend.user.User;
import com.project.Xclone_backend.user.UserDtos.UserSummary;
import com.project.Xclone_backend.user.UserMapper;
import com.project.Xclone_backend.user.UserService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class PostService {

    private static final int SEARCH_MIN_LENGTH = 2;
    private static final int SEARCH_MAX_LENGTH = 100;

    private final PostRepository postRepository;
    private final LikeRepository likeRepository;
    private final UserService userService;
    private final PostMapper postMapper;
    private final UserMapper userMapper;
    private final MediaService mediaService;
    private final HashtagService hashtagService;
    private final PostReportRepository postReportRepository;
    private final ModerationNotifier moderationNotifier;
    private final BookmarkRepository bookmarkRepository;
    private final MentionService mentionService;
    private final NotificationService notificationService;
    private final FollowRepository followRepository;
    private final MutedWordService mutedWordService;
    private final PollService pollService;

    @Transactional
    public PostResponse create(Long authorId, CreatePostRequest req) {
        String content = req.content() == null ? "" : req.content().strip();
        List<String> mediaKeys = req.mediaKeys() == null ? List.of() : List.copyOf(new LinkedHashSet<>(req.mediaKeys()));
        if (content.isEmpty() && mediaKeys.isEmpty() && req.poll() == null) {
            throw ApiException.badRequest("A post needs text, an image or a poll");
        }
        if (req.poll() != null && (!mediaKeys.isEmpty() || req.replyToId() != null || req.quotedPostId() != null)) {
            throw ApiException.badRequest("A poll can only be added to a new post, without images and not as a reply or a quote");
        }
        mediaService.verifyOwnedAttachments(authorId, mediaKeys);

        Post post = new Post();
        User author = userService.requireById(authorId);
        post.setAuthor(author);
        post.setContent(content);
        mediaKeys.forEach(post::addMedia);
        syncHashtags(post);
        syncMentions(post);

        if (req.replyPolicy() != null && (req.replyToId() != null || req.quotedPostId() != null)) {
            throw ApiException.badRequest("Only a top-level post can set who can reply");
        }
        if (req.replyPolicy() != null) {
            post.setReplyPolicy(req.replyPolicy());
        }
        if (req.quotedPostId() != null) {
            if (req.replyToId() != null) {
                throw ApiException.badRequest("A post cannot be both a reply and a quote");
            }
            Post quoted = requireLiveVisible(req.quotedPostId(), authorId);
            if (quoted.getAuthor().isProtectedAccount() && !quoted.getAuthor().getId().equals(authorId)) {
                throw ApiException.forbidden("Posts from protected accounts cannot be quoted");
            }
            post.setQuoteOf(quoted);
        }
        Post parent = null;
        if (req.replyToId() != null) {
            parent = requireLiveVisible(req.replyToId(), authorId);
            userService.requireNotBlocked(authorId, parent.getAuthor().getId());
            Post root = parent.getRoot() != null ? parent.getRoot() : parent;
            requireCanReply(root, authorId);
            post.setParent(parent);
            post.setRoot(root);
            postRepository.addToReplyCount(parent.getId(), 1);
        }
        postRepository.save(post);
        if (req.poll() != null) {
            pollService.create(post.getId(), req.poll());
        }
        if (parent != null) {
            notificationService.notify(parent.getAuthor(), author, NotificationType.REPLY, post);
        }
        for (User mentioned : post.getMentions()) {
            if (parent == null || !mentioned.getId().equals(parent.getAuthor().getId())) {
                notificationService.notify(mentioned, author, NotificationType.MENTION, post);
            }
        }
        return postMapper.toCreatedResponse(post);
    }

    /** Creates the posts in order in one transaction: the first starts the thread, each later one replies to the previous. */
    @Transactional
    public List<PostResponse> createThread(Long authorId, CreateThreadRequest req) {
        List<PostResponse> created = new ArrayList<>();
        Long previousId = null;
        for (CreatePostRequest item : req.posts()) {
            if (item.replyToId() != null || item.quotedPostId() != null || item.replyPolicy() != null || item.poll() != null) {
                throw ApiException.badRequest("Thread posts cannot set replyToId, quotedPostId, replyPolicy or poll");
            }
            CreatePostRequest linked = new CreatePostRequest(item.content(), item.mediaKeys(), previousId, null,
                    previousId == null ? req.replyPolicy() : null, null);
            PostResponse response = create(authorId, linked);
            created.add(response);
            previousId = response.id();
        }
        return created;
    }

    /**
     * The thread containing the post: the conversation's top-level post plus the author's own posts that chain from
     * it through the author's own replies, oldest first. Replies by other people are not part of the thread.
     */
    @Transactional(readOnly = true)
    public List<PostResponse> thread(Long postId, Long viewerId) {
        Post post = requireLive(postId);
        requireVisible(viewerId, post.getAuthor());
        Post root = post.getRoot() != null ? post.getRoot() : post;
        if (root.isDeleted()) {
            throw ApiException.notFound("Post not found");
        }
        Long authorId = root.getAuthor().getId();
        requireVisible(viewerId, root.getAuthor());
        Set<Long> inThread = new HashSet<>(Set.of(root.getId()));
        List<Post> chain = new ArrayList<>(List.of(root));
        for (Post p : postRepository.findAuthorPostsInConversation(root.getId(), authorId)) {
            if (inThread.contains(p.getParent().getId())) {
                inThread.add(p.getId());
                chain.add(p);
            }
        }
        return postMapper.toResponses(chain, viewerId);
    }

    @Transactional
    public PostResponse updateReplyPolicy(Long postId, Long userId, ReplyPolicy policy) {
        Post post = requireLive(postId);
        if (!post.getAuthor().getId().equals(userId)) {
            throw ApiException.forbidden("You can only change who can reply to your own posts");
        }
        if (post.getParent() != null) {
            throw ApiException.badRequest("Only a top-level post can set who can reply");
        }
        post.setReplyPolicy(policy);
        return postMapper.toResponse(post, userId);
    }

    @Transactional(readOnly = true)
    public PostResponse get(Long postId, Long viewerId) {
        Post post = requireLive(postId);
        requireVisible(viewerId, post.getAuthor());
        return postMapper.toResponse(post, viewerId);
    }

    @Transactional
    public PostResponse update(Long postId, Long userId, UpdatePostRequest req) {
        Post post = requireLive(postId);
        if (!post.getAuthor().getId().equals(userId)) {
            throw ApiException.forbidden("You can only edit your own posts");
        }
        Set<Long> previouslyMentioned = post.getMentions().stream().map(User::getId).collect(Collectors.toSet());
        post.setContent(req.content().strip());
        syncHashtags(post);
        syncMentions(post);
        for (User mentioned : post.getMentions()) {
            if (!previouslyMentioned.contains(mentioned.getId())) {
                notificationService.notify(mentioned, post.getAuthor(), NotificationType.MENTION, post);
            }
        }
        return postMapper.toResponse(post, userId);
    }

    @Transactional
    public void delete(Long postId, Long userId) {
        Post post = requireLive(postId);
        if (!post.getAuthor().getId().equals(userId)) {
            throw ApiException.forbidden("You can only delete your own posts");
        }
        softDelete(post);
    }

    /**
     * Takes a post out of circulation: marked deleted, mentions cleared, its notifications removed, and the parent's reply count
     * lowered. Shared by an author deleting their own post and an admin removing a reported one, so they always do the same things.
     */
    public void softDelete(Post post) {
        post.setDeleted(true);
        post.getMentions().clear();
        notificationService.removeForPost(post.getId());
        if (post.getParent() != null) {
            postRepository.addToReplyCount(post.getParent().getId(), -1);
        }
    }

    /** Records the report and, if the post had no open report, alerts the admins. The reported post is not changed in any way. */
    @Transactional
    public void report(Long postId, Long reporterId, ReportReason reason) {
        Post post = requireLiveVisible(postId, reporterId);
        if (post.getAuthor().getId().equals(reporterId)) {
            throw ApiException.badRequest("You cannot report your own post");
        }
        boolean alreadyUnderReview = postReportRepository.existsByPostIdAndStatus(postId, ReportStatus.OPEN);
        if (postReportRepository.report(reporterId, postId, reason.name()) == 0) {
            throw ApiException.conflict("You have already reported this post");
        }
        if (!alreadyUnderReview) {
            moderationNotifier.reportReceived("a post by @" + post.getAuthor().getUsername(), reason, post);
        }
    }

    @Transactional
    public void repost(Long postId, Long userId) {
        Post post = requireLiveVisible(postId, userId);
        if (post.getAuthor().getId().equals(userId)) {
            throw ApiException.badRequest("You cannot repost your own post");
        }
        if (post.getAuthor().isProtectedAccount()) {
            throw ApiException.forbidden("Posts from protected accounts cannot be reposted");
        }
        if (postRepository.repost(userId, postId) > 0) {
            postRepository.addToRepostCount(postId, 1);
            notificationService.notify(post.getAuthor(), userService.requireById(userId), NotificationType.REPOST, post);
        }
    }

    @Transactional
    public void unrepost(Long postId, Long userId) {
        requireLive(postId);
        if (postRepository.unrepost(userId, postId) > 0) {
            postRepository.addToRepostCount(postId, -1);
            notificationService.removeRepost(userId, postId);
        }
    }

    @Transactional
    public void like(Long postId, Long userId) {
        Post post = requireLiveVisible(postId, userId);
        userService.requireNotBlocked(userId, post.getAuthor().getId());
        if (likeRepository.like(userId, postId) > 0) {
            postRepository.addToLikeCount(postId, 1);
            notificationService.notify(post.getAuthor(), userService.requireById(userId), NotificationType.LIKE, post);
        }
    }

    @Transactional
    public void unlike(Long postId, Long userId) {
        requireLive(postId);
        if (likeRepository.unlike(userId, postId) > 0) {
            postRepository.addToLikeCount(postId, -1);
            notificationService.removeLike(userId, postId);
        }
    }

    /** Votes in the post's poll. Needs the same access as reading the post, and no block between voter and author. */
    @Transactional
    public PollResponse votePoll(Long postId, Long userId, Long optionId) {
        Post post = requireLiveVisible(postId, userId);
        userService.requireNotBlocked(userId, post.getAuthor().getId());
        return pollService.vote(postId, userId, optionId);
    }

    @Transactional
    public void bookmark(Long postId, Long userId) {
        requireLiveVisible(postId, userId);
        if (bookmarkRepository.bookmark(userId, postId) == 0) {
            throw ApiException.conflict("You have already bookmarked this post");
        }
    }

    @Transactional
    public void unbookmark(Long postId, Long userId) {
        requireLive(postId);
        bookmarkRepository.unbookmark(userId, postId);
    }

    /** Cursor here is the bookmark id, so paging follows "most recently bookmarked" order. */
    @Transactional(readOnly = true)
    public CursorPage<PostResponse> bookmarks(Long userId, Long cursor, Integer limit) {
        int n = CursorPage.clampLimit(limit);
        List<Bookmark> rows = bookmarkRepository.findUserBookmarks(userId, CursorPage.cursorOrMax(cursor), Limit.of(n + 1));
        return CursorPage.of(rows, n, Bookmark::getId,
                page -> postMapper.toResponses(page.stream().map(Bookmark::getPost).toList(), userId));
    }

    @Transactional(readOnly = true)
    public CursorPage<PostResponse> replies(Long postId, Long viewerId, Long cursor, Integer limit) {
        requireLiveVisible(postId, viewerId);
        int n = CursorPage.clampLimit(limit);
        List<Post> rows = postRepository.findReplies(postId, viewerId, cursor == null ? 0L : cursor,
                Limit.of(n + 1));
        return CursorPage.of(rows, n, Post::getId, page -> postMapper.toResponses(page, viewerId));
    }

    /** The people who reposted a post (plain reposts, the ones counted in {@code repostCount}), newest first. */
    @Transactional(readOnly = true)
    public CursorPage<UserSummary> reposters(Long postId, Long viewerId, Long cursor, Integer limit) {
        requireLiveVisible(postId, viewerId);
        int n = CursorPage.clampLimit(limit);
        List<Post> rows = postRepository.findReposts(postId, viewerId, CursorPage.cursorOrMax(cursor), Limit.of(n + 1));
        return CursorPage.of(rows, n, Post::getId, page -> page.stream().map(p -> userMapper.toSummary(p.getAuthor())).toList());
    }

    @Transactional(readOnly = true)
    public CursorPage<UserSummary> likers(Long postId, Long viewerId, Long cursor, Integer limit) {
        requireLiveVisible(postId, viewerId);
        int n = CursorPage.clampLimit(limit);
        List<PostLike> rows = likeRepository.findLikers(postId, CursorPage.cursorOrMax(cursor), Limit.of(n + 1));
        return CursorPage.of(rows, n, PostLike::getId,
                page -> page.stream().map(l -> userMapper.toSummary(l.getUser())).toList());
    }

    @Transactional(readOnly = true)
    public CursorPage<PostResponse> userPosts(String username, Long viewerId, Long cursor, Integer limit) {
        User user = userService.requireByUsername(username);
        requireVisible(viewerId, user);
        int n = CursorPage.clampLimit(limit);
        List<Post> rows = postRepository.findUserPosts(user.getId(), viewerId, CursorPage.cursorOrMax(cursor),
                Limit.of(n + 1));
        return CursorPage.of(rows, n, Post::getId, page -> postMapper.toResponses(page, viewerId));
    }

    @Transactional(readOnly = true)
    public CursorPage<PostResponse> userReplies(String username, Long viewerId, Long cursor, Integer limit) {
        User user = userService.requireByUsername(username);
        requireVisible(viewerId, user);
        int n = CursorPage.clampLimit(limit);
        List<Post> rows = postRepository.findUserReplies(user.getId(), CursorPage.cursorOrMax(cursor), Limit.of(n + 1));
        return CursorPage.of(rows, n, Post::getId, page -> postMapper.toResponses(page, viewerId));
    }

    /** Cursor here is the like id, so paging follows "most recently liked" order. */
    @Transactional(readOnly = true)
    public CursorPage<PostResponse> userLikes(String username, Long viewerId, Long cursor, Integer limit) {
        User user = userService.requireByUsername(username);
        requireVisible(viewerId, user);
        int n = CursorPage.clampLimit(limit);
        List<PostLike> rows = likeRepository.findUserLikes(user.getId(), viewerId, CursorPage.cursorOrMax(cursor),
                Limit.of(n + 1));
        return CursorPage.of(rows, n, PostLike::getId,
                page -> postMapper.toResponses(page.stream().map(PostLike::getPost).toList(), viewerId));
    }

    @Transactional(readOnly = true)
    public CursorPage<PostResponse> hashtagPosts(String name, Long viewerId, Long cursor, Integer limit) {
        int n = CursorPage.clampLimit(limit);
        String tag = HashtagService.normalize(name);
        return pageHidingMutedWords(viewerId, n, cursor,
                (from, size) -> postRepository.findByHashtag(tag, viewerId, from, Limit.of(size)),
                Post::getId, (p, muted) -> hides(muted, p, viewerId), page -> postMapper.toResponses(page, viewerId));
    }

    @Transactional(readOnly = true)
    public CursorPage<PostResponse> search(String q, Long viewerId, Long cursor, Integer limit) {
        String term = q == null ? "" : q.strip().toLowerCase(Locale.ROOT);
        if (term.length() < SEARCH_MIN_LENGTH) {
            throw ApiException.badRequest("Search query must be at least " + SEARCH_MIN_LENGTH + " characters");
        }
        if (term.length() > SEARCH_MAX_LENGTH) {
            throw ApiException.badRequest("Search query must be at most " + SEARCH_MAX_LENGTH + " characters");
        }
        String escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        int n = CursorPage.clampLimit(limit);
        return pageHidingMutedWords(viewerId, n, cursor,
                (from, size) -> postRepository.searchByContent("%" + escaped + "%", viewerId, from, Limit.of(size)),
                Post::getId, (p, muted) -> hides(muted, p, viewerId), page -> postMapper.toResponses(page, viewerId));
    }

    @Transactional(readOnly = true)
    public CursorPage<PostResponse> timeline(Long userId, Long cursor, Integer limit) {
        int n = CursorPage.clampLimit(limit);
        return pageHidingMutedWords(userId, n, cursor,
                (from, size) -> postRepository.findTimelineWithViewerFlags(userId, from, Limit.of(size)),
                row -> ((Post) row[0]).getId(), (row, muted) -> hides(muted, (Post) row[0], userId),
                page -> {
                    List<Post> posts = new ArrayList<>(page.size());
                    Set<Long> liked = new HashSet<>();
                    Set<Long> reposted = new HashSet<>();
                    Set<Long> bookmarked = new HashSet<>();
                    for (Object[] row : page) {
                        Post post = (Post) row[0];
                        Long shownId = post.getRepostOf() != null ? post.getRepostOf().getId() : post.getId();
                        if (Boolean.TRUE.equals(row[1])) {
                            liked.add(shownId);
                        }
                        if (Boolean.TRUE.equals(row[2])) {
                            reposted.add(shownId);
                        }
                        if (Boolean.TRUE.equals(row[3])) {
                            bookmarked.add(shownId);
                        }
                        posts.add(post);
                    }
                    return postMapper.toResponses(posts, userId, new PostMapper.ViewerFlags(liked, reposted, bookmarked));
                });
    }

    /** How many fetches a single request may spend looking for posts that are not hidden by the viewer's muted words. */
    private static final int MUTED_WORD_SCAN_ROUNDS = 5;

    /**
     * A page of an id-ordered (newest first) feed without the posts the viewer's muted words hide. A page must not come back short just because
     * its rows were hidden, so more rows are fetched until it is full. If the scan budget runs out first the page is returned as it is, with a
     * cursor that continues from where the scan stopped. Without muted words this is exactly one fetch.
     */
    private <T> CursorPage<PostResponse> pageHidingMutedWords(Long viewerId, int n, Long cursor,
            BiFunction<Long, Integer, List<T>> fetch, Function<T, Long> idOf, BiPredicate<T, MutedWordFilter> hidden,
            Function<List<T>, List<PostResponse>> mapper) {
        long position = CursorPage.cursorOrMax(cursor);
        MutedWordFilter muted = mutedWordService.filterFor(viewerId);
        if (muted.isEmpty()) {
            return CursorPage.of(fetch.apply(position, n + 1), n, idOf, mapper);
        }
        List<T> kept = new ArrayList<>();
        boolean exhausted = false;
        for (int round = 0; round < MUTED_WORD_SCAN_ROUNDS && kept.size() <= n && !exhausted; round++) {
            List<T> rows = fetch.apply(position, n + 1);
            exhausted = rows.size() < n + 1;
            if (!rows.isEmpty()) {
                position = idOf.apply(rows.get(rows.size() - 1));
            }
            for (T row : rows) {
                if (!hidden.test(row, muted)) {
                    kept.add(row);
                }
            }
        }
        if (kept.size() > n) {
            return CursorPage.of(kept, n, idOf, mapper);
        }
        return new CursorPage<>(mapper.apply(kept), exhausted ? null : position);
    }

    /** Whether the viewer's muted words hide the post (its text, a repost's original, a quoted post). People's own posts are never hidden from them. */
    private static boolean hides(MutedWordFilter muted, Post post, Long viewerId) {
        Post shown = post.getRepostOf() != null ? post.getRepostOf() : post;
        if (shown.getAuthor().getId().equals(viewerId)) {
            return false;
        }
        return muted.hides(shown.getContent()) || (shown.getQuoteOf() != null && muted.hides(shown.getQuoteOf().getContent()));
    }

    // --- For You ---
    // How the "For You" feed is ranked (see PostRepository.findForYouIds for the formula). Tune these in one place.

    /** Only posts newer than this are candidates; older ones would need to be very popular to matter anyway. */
    static final Duration FOR_YOU_WINDOW = Duration.ofDays(7);
    /** The latest this many eligible posts in the window are scored. Bounds the cost of one request. */
    static final int FOR_YOU_CANDIDATES = 2000;
    /** At most this many posts by one author, so a single account cannot take over the feed. */
    static final int FOR_YOU_PER_AUTHOR = 3;
    /** The feed ends after this many posts (then nextCursor is null), like the end of a "top posts" list. */
    static final int FOR_YOU_MAX_DEPTH = 200;
    /** A feed is scored at one frozen minute; a cursor older than this starts a fresh feed instead. */
    private static final long FOR_YOU_SNAPSHOT_MAX_AGE_MINUTES = 60;

    /**
     * The ranked "For You" feed. Ranking depends on the clock, so an id cursor cannot page it: the cursor packs the minute the feed was
     * scored at and how many posts were already served ({@code snapshotMinute * 1000 + offset}), and every page is scored at that same minute.
     * A garbage, future or stale cursor just starts a new feed.
     */
    @Transactional(readOnly = true)
    public CursorPage<PostResponse> forYou(Long userId, Long cursor, Integer limit) {
        int n = CursorPage.clampLimit(limit);
        long nowMinute = Instant.now().getEpochSecond() / 60;
        long snapshot = nowMinute;
        int offset = 0;
        if (cursor != null && cursor > 0) {
            long cursorSnapshot = cursor / 1000;
            long cursorOffset = cursor % 1000;
            if (cursorSnapshot <= nowMinute && nowMinute - cursorSnapshot <= FOR_YOU_SNAPSHOT_MAX_AGE_MINUTES) {
                snapshot = cursorSnapshot;
                offset = (int) cursorOffset;
            }
        }
        int pageSize = Math.min(n, FOR_YOU_MAX_DEPTH - offset);
        if (pageSize <= 0) {
            return new CursorPage<>(List.of(), null);
        }
        Instant scoredAt = Instant.ofEpochSecond((snapshot + 1) * 60); // the end of that minute, so posts made this minute are in
        MutedWordFilter muted = mutedWordService.filterFor(userId);
        if (!muted.isEmpty()) {
            return forYouHidingMutedWords(userId, muted, snapshot, offset, pageSize, scoredAt);
        }
        List<Long> ids = postRepository.findForYouIds(userId, scoredAt, scoredAt.minus(FOR_YOU_WINDOW), FOR_YOU_CANDIDATES,
                FOR_YOU_PER_AUTHOR, offset, pageSize + 1);
        boolean more = ids.size() > pageSize && offset + pageSize < FOR_YOU_MAX_DEPTH;
        List<Long> pageIds = ids.size() > pageSize ? ids.subList(0, pageSize) : ids;
        Map<Long, Post> byId = new HashMap<>();
        postRepository.findAllWithAuthor(pageIds).forEach(p -> byId.put(p.getId(), p));
        List<Post> posts = pageIds.stream().map(byId::get).filter(Objects::nonNull).toList();
        Long next = more ? snapshot * 1000 + offset + pageSize : null;
        return new CursorPage<>(postMapper.toResponses(posts, userId), next);
    }

    /**
     * "For you" when the viewer has muted words: walks the ranked list in order, skipping hidden posts, until the page is full. The cursor then
     * points just past the last ranked post that was looked at, so skipped posts never come back on a later page.
     */
    private CursorPage<PostResponse> forYouHidingMutedWords(Long userId, MutedWordFilter muted, long snapshot, int offset, int pageSize,
            Instant scoredAt) {
        List<Post> kept = new ArrayList<>();
        int position = offset;
        boolean more = false;
        for (int round = 0; round < MUTED_WORD_SCAN_ROUNDS && !more && position < FOR_YOU_MAX_DEPTH; round++) {
            int window = Math.min(pageSize + 1, FOR_YOU_MAX_DEPTH - position);
            List<Long> ids = postRepository.findForYouIds(userId, scoredAt, scoredAt.minus(FOR_YOU_WINDOW), FOR_YOU_CANDIDATES,
                    FOR_YOU_PER_AUTHOR, position, window);
            Map<Long, Post> byId = new HashMap<>();
            postRepository.findAllWithAuthor(ids).forEach(p -> byId.put(p.getId(), p));
            for (Long id : ids) {
                if (kept.size() == pageSize) {
                    more = true; // this one is for the next page
                    break;
                }
                position++;
                Post post = byId.get(id);
                if (post != null && !hides(muted, post, userId)) {
                    kept.add(post);
                }
            }
            if (ids.size() < window) {
                break; // the ranked list is exhausted
            }
            more = more || (kept.size() == pageSize && position < FOR_YOU_MAX_DEPTH);
        }
        boolean exhaustedBudget = !more && position < FOR_YOU_MAX_DEPTH && kept.size() < pageSize;
        // Scan budget spent without filling the page: hand back what there is and let the client continue from here.
        Long next = (more || exhaustedBudget) && position < FOR_YOU_MAX_DEPTH ? snapshot * 1000 + position : null;
        return new CursorPage<>(postMapper.toResponses(kept, userId), next);
    }

    /** The author of the conversation can always reply; everyone else must satisfy the root post's policy. */
    private void requireCanReply(Post root, Long replierId) {
        Long rootAuthorId = root.getAuthor().getId();
        if (rootAuthorId.equals(replierId)) {
            return;
        }
        boolean allowed = switch (root.getReplyPolicy()) {
            case EVERYONE -> true;
            case FOLLOWING -> followRepository.existsByFollowerIdAndFolloweeId(rootAuthorId, replierId);
            case MENTIONED -> root.getMentions().stream().anyMatch(u -> u.getId().equals(replierId));
        };
        if (!allowed) {
            throw ApiException.forbidden("The author limits who can reply to this conversation");
        }
    }

    private void requireVisible(Long viewerId, User user) {
        if (viewerId != null) {
            userService.requireNotBlocked(viewerId, user.getId());
        }
        userService.requireCanViewPosts(viewerId, user);
    }

    /** A live post the viewer is allowed to see: posts of protected accounts are visible to the owner and approved followers only. */
    private Post requireLiveVisible(Long postId, Long viewerId) {
        Post post = requireLive(postId);
        userService.requireCanViewPosts(viewerId, post.getAuthor());
        return post;
    }
  
    /** Retain-then-add so Hibernate only writes the link rows that actually changed. */
    private void syncHashtags(Post post) {
        Set<Hashtag> tags = hashtagService.resolve(post.getContent());
        post.getHashtags().retainAll(tags);
        post.getHashtags().addAll(tags);
    }

    private void syncMentions(Post post) {
        Set<User> users = mentionService.resolve(post.getContent());
        post.getMentions().retainAll(users);
        post.getMentions().addAll(users);
    }

    private Post requireLive(Long postId) {
        return postRepository.findLive(postId).orElseThrow(() -> ApiException.notFound("Post not found"));
    }
}
