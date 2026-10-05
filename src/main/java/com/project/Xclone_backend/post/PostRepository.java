package com.project.Xclone_backend.post;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface PostRepository extends JpaRepository<Post, Long> {

    /** Repost rows are excluded: clients always act on the original's id. */
    @Query("select p from Post p join fetch p.author where p.id = :id and p.deleted = false and p.repostOf is null")
    Optional<Post> findLive(Long id);

    /**
     * Live posts by id the viewer may see, authors fetched; used to render the quoted post of quote posts in one query.
     * A quoted post that became protected renders as missing for viewers who may not see it.
     */
    @Query("select p from Post p join fetch p.author where p.id in :ids and p.deleted = false and "
            + PostVisibility.POST_VISIBLE)
    List<Post> findLiveVisibleByIds(Collection<Long> ids, Long viewerId);

    /** Conversation roots by id, deleted or not: a deleted top post must keep governing who may reply. */
    @Query("select p from Post p join fetch p.author where p.id in :ids")
    List<Post> findRootsByIds(Collection<Long> ids);

    /** The author's live posts in one conversation, oldest first; the service keeps those that chain from the root. */
    @Query("""
            select p from Post p join fetch p.author
            where p.root.id = :rootId and p.author.id = :authorId and p.deleted = false
            order by p.id asc
            """)
    List<Post> findAuthorPostsInConversation(Long rootId, Long authorId);

    /** Top-level posts and reposts by one author, newest first. Reposts of deleted posts are skipped. */
    @Query("""
            select p from Post p join fetch p.author left join fetch p.repostOf o left join fetch o.author
            where p.author.id = :authorId and p.parent is null and p.deleted = false and p.id < :cursor
              and (o is null or o.deleted = false)
              and """ + PostVisibility.ORIGINAL_VISIBLE + """
            order by p.id desc
            """)
    List<Post> findUserPosts(Long authorId, Long viewerId, long cursor, Limit limit);

    /** Replies by one author, newest first. */
    @Query("""
            select p from Post p join fetch p.author
            where p.author.id = :authorId and p.parent is not null and p.deleted = false and p.id < :cursor
            order by p.id desc
            """)
    List<Post> findUserReplies(Long authorId, long cursor, Limit limit);

    /** Direct replies to a post, oldest first so a thread reads top to bottom. Skips viewer-blocked authors. */
    @Query("""
            select p from Post p join fetch p.author
            where p.parent.id = :parentId and p.deleted = false and p.id > :cursor
              and (:viewerId is null or not exists (select 1 from Block b
                   where (b.blocker.id = :viewerId and b.blocked.id = p.author.id)
                      or (b.blocker.id = p.author.id and b.blocked.id = :viewerId)))
              and """ + PostVisibility.POST_VISIBLE + """
            order by p.id asc
            """)
    List<Post> findReplies(Long parentId, Long viewerId, long cursor, Limit limit);

    /**
     * The repost rows of a post, newest first (each row's author is the person who reposted it). Skips reposters blocked either way with the
     * viewer, inactive ones, and protected reposters the viewer may not see (their reposts are not shown to the viewer anywhere else either).
     */
    @Query("""
            select p from Post p join fetch p.author
            where p.repostOf.id = :postId and p.deleted = false and p.id < :cursor
              and (:viewerId is null or not exists (select 1 from Block b
                   where (b.blocker.id = :viewerId and b.blocked.id = p.author.id)
                      or (b.blocker.id = p.author.id and b.blocked.id = :viewerId)))
              and """ + PostVisibility.POST_VISIBLE + """
            order by p.id desc
            """)
    List<Post> findReposts(Long postId, Long viewerId, long cursor, Limit limit);

    /** Posts and replies tagged with a normalized hashtag name, newest first. */
    @Query("""
            select p from Post p join fetch p.author join p.hashtags h
            where h.name = :name and p.deleted = false and p.id < :cursor
              and """ + PostVisibility.POST_VISIBLE + """
            order by p.id desc
            """)
    List<Post> findByHashtag(String name, Long viewerId, long cursor, Limit limit);

    /**
     * Posts and replies whose text contains the (already lower-cased, LIKE-escaped) pattern, newest first.
     * Skips authors who block or are blocked by the viewer.
     */
    @Query("""
            select p from Post p join fetch p.author
            where lower(p.content) like :pattern escape '\\' and p.deleted = false and p.repostOf is null
              and p.id < :cursor
              and (:viewerId is null or not exists (select 1 from Block b
                   where (b.blocker.id = :viewerId and b.blocked.id = p.author.id)
                      or (b.blocker.id = p.author.id and b.blocked.id = :viewerId)))
              and """ + PostVisibility.POST_VISIBLE + """
            order by p.id desc
            """)
    List<Post> searchByContent(String pattern, Long viewerId, long cursor, Limit limit);

    /**
     * Home timeline: top-level posts and reposts by the user and everyone they follow, newest first, minus muted accounts (their posts, their reposts, and reposts of their posts). Each row is
     * {@code [Post, likedByUser, repostedByUser, bookmarkedByUser]} (Booleans), the flags being about the post actually shown
     * (the original, for a repost row). Computing them here saves the extra round trips the mapper would make.
     */
    @Query("""
            select p,
                   case when exists (select 1 from PostLike l
                                     where l.user.id = :viewerId and l.post.id = coalesce(o.id, p.id))
                        then true else false end,
                   case when exists (select 1 from Post r
                                     where r.author.id = :viewerId and r.deleted = false
                                       and r.repostOf.id = coalesce(o.id, p.id))
                        then true else false end,
                   case when exists (select 1 from Bookmark bm
                                     where bm.user.id = :viewerId and bm.post.id = coalesce(o.id, p.id))
                        then true else false end
            from Post p join fetch p.author left join fetch p.repostOf o left join fetch o.author
            where (p.author.id = :viewerId
                   or p.author.id in (select f.followee.id from Follow f where f.follower.id = :viewerId))
              and p.parent is null and p.deleted = false and p.id < :cursor
              and p.author.status = com.project.Xclone_backend.user.AccountStatus.ACTIVE
              and (o is null or o.deleted = false)
              and not exists (select 1 from Mute m where m.muter.id = :viewerId
                              and (m.muted.id = p.author.id or m.muted.id = o.author.id))
              and """ + PostVisibility.ORIGINAL_VISIBLE + """
            order by p.id desc
            """)
    List<Object[]> findTimelineWithViewerFlags(Long viewerId, long cursor, Limit limit);

    /** Posts by id with their authors, in no particular order (the caller puts them in rank order). */
    @Query("select p from Post p join fetch p.author where p.id in :ids and p.deleted = false")
    List<Post> findAllWithAuthor(Collection<Long> ids);

    /**
     * The "For You" ranking: ids of posts in rank order. Candidates are the latest {@code candidates} top-level posts since {@code since}
     * that the viewer may see (author active; protected authors only if the viewer is or follows them; no blocks either way; no muted
     * authors; not deleted; no replies or repost rows; the viewer's own posts count). Score is engagement over age:
     * {@code (likes + 2*reposts + 3*replies + 1) / (age_hours + 2)^1.5}, times a boost: 2.0 for the viewer and the people they follow,
     * 1.3 for people followed by someone they follow, else 1.0. At most {@code perAuthor} posts per author, so one account cannot flood it.
     * Scored at the frozen instant {@code now} so every page of one feed uses the same clock.
     */
    @Query(value = """
            select ranked.id from (
              select c.id, c.score,
                     row_number() over (partition by c.author_id order by c.score desc, c.id desc) as author_rank
              from (
                select p.id, p.author_id,
                       (p.like_count + 2.0 * p.repost_count + 3.0 * p.reply_count + 1.0)
                         / power(extract(epoch from (cast(:now as timestamptz) - p.created_at)) / 3600.0 + 2.0, 1.5)
                         * case
                             when p.author_id = :viewerId
                               or exists (select 1 from follows f where f.follower_id = :viewerId and f.followee_id = p.author_id) then 2.0
                             when exists (select 1 from follows f1 join follows f2 on f2.follower_id = f1.followee_id
                                          where f1.follower_id = :viewerId and f2.followee_id = p.author_id) then 1.3
                             else 1.0
                           end as score
                from (
                  select p0.id, p0.author_id, p0.created_at, p0.like_count, p0.repost_count, p0.reply_count
                  from posts p0 join users a on a.id = p0.author_id
                  where p0.deleted = false and p0.parent_id is null and p0.repost_of_id is null
                    and p0.created_at > cast(:since as timestamptz) and p0.created_at <= cast(:now as timestamptz)
                    and a.status = 'ACTIVE'
                    and (a.protected_account = false or p0.author_id = :viewerId
                         or exists (select 1 from follows pf where pf.follower_id = :viewerId and pf.followee_id = p0.author_id))
                    and not exists (select 1 from blocks b
                                    where (b.blocker_id = :viewerId and b.blocked_id = p0.author_id)
                                       or (b.blocker_id = p0.author_id and b.blocked_id = :viewerId))
                    and not exists (select 1 from mutes m where m.muter_id = :viewerId and m.muted_id = p0.author_id)
                  order by p0.created_at desc
                  limit :candidates
                ) p
              ) c
            ) ranked
            where ranked.author_rank <= :perAuthor
            order by ranked.score desc, ranked.id desc
            offset :offset limit :limit
            """, nativeQuery = true)
    List<Long> findForYouIds(Long viewerId, java.time.Instant now, java.time.Instant since, int candidates, int perAuthor, int offset, int limit);

    @Modifying
    @Query("update Post p set p.likeCount = p.likeCount + :delta where p.id = :id")
    void addToLikeCount(Long id, int delta);

    @Modifying
    @Query("update Post p set p.replyCount = p.replyCount + :delta where p.id = :id")
    void addToReplyCount(Long id, int delta);

    /** Idempotent: returns 1 if a new repost row was created, 0 if the user had already reposted the post. */
    @Modifying
    @Query(value = """
            insert into posts (author_id, repost_of_id, content, like_count, reply_count, repost_count, deleted, created_at)
            values (:userId, :postId, '', 0, 0, 0, false, now())
            on conflict (author_id, repost_of_id) do nothing
            """, nativeQuery = true)
    int repost(Long userId, Long postId);

    @Modifying
    @Query("delete from Post p where p.author.id = :userId and p.repostOf.id = :postId")
    int unrepost(Long userId, Long postId);

    @Modifying
    @Query("update Post p set p.repostCount = p.repostCount + :delta where p.id = :id")
    void addToRepostCount(Long id, int delta);

    @Query("""
            select p.repostOf.id from Post p
            where p.author.id = :userId and p.deleted = false and p.repostOf.id in :postIds
            """)
    Set<Long> findRepostedPostIds(Long userId, Collection<Long> postIds);

    // --- Account deletion. Count fixes must run before the likes are deleted and the posts are soft-deleted.

    /** Takes the author's live replies out of their parents' reply counts. */
    @Modifying
    @Query(value = """
            update posts p set reply_count = p.reply_count - r.n
            from (select parent_id, count(*) as n from posts
                  where author_id = :authorId and deleted = false and parent_id is not null
                  group by parent_id) r
            where p.id = r.parent_id
            """, nativeQuery = true)
    void decrementReplyCountsForAuthor(Long authorId);

    /** Takes the user's live reposts out of the repost counts of the posts they reposted. */
    @Modifying
    @Query(value = """
            update posts p set repost_count = p.repost_count - 1
            from posts r where r.repost_of_id = p.id and r.author_id = :userId and r.deleted = false
            """, nativeQuery = true)
    void decrementRepostCountsForReposter(Long userId);

    /** Takes the user's likes out of the like counts of the posts they liked. */
    @Modifying
    @Query(value = """
            update posts p set like_count = p.like_count - 1
            from likes l where l.post_id = p.id and l.user_id = :userId
            """, nativeQuery = true)
    void decrementLikeCountsForLiker(Long userId);

    @Modifying
    @Query(value = "delete from post_hashtags where post_id in (select id from posts where author_id = :authorId)",
            nativeQuery = true)
    void deleteHashtagLinksForAuthor(Long authorId);

    /** Removes mentions made by the author's posts and mentions of the author in anyone's posts. */
    @Modifying
    @Query(value = """
            delete from post_mentions
            where user_id = :userId or post_id in (select id from posts where author_id = :userId)
            """, nativeQuery = true)
    void deleteMentionLinksInvolving(Long userId);

    @Modifying
    @Query("delete from PostMedia m where m.post.id in (select p.id from Post p where p.author.id = :authorId)")
    void deleteMediaForAuthor(Long authorId);

    /** Soft delete keeps other users' replies attached; the text is cleared because it is the author's data. */
    @Modifying
    @Query("update Post p set p.deleted = true, p.content = '' where p.author.id = :authorId")
    void softDeleteAndClearAllByAuthor(Long authorId);
}
