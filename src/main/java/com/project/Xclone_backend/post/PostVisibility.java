package com.project.Xclone_backend.post;

/**
 * JPQL predicates (usable inside {@code @Query} text blocks, which is why they are constants) for protected and
 * suspended accounts: a post is visible if its author is not suspended and is public, is the viewer, or is followed by the viewer (follows only exist once
 * approved). They bind {@code :viewerId}, which may be null for anonymous viewers: those match only public authors.
 */
public final class PostVisibility {

    /** For a query whose post alias is {@code p}. */
    public static final String POST_VISIBLE = """
            (p.author.status <> com.project.Xclone_backend.user.AccountStatus.SUSPENDED
             and (p.author.protectedAccount = false or p.author.id = :viewerId
                  or exists (select 1 from Follow vf where vf.follower.id = :viewerId and vf.followee.id = p.author.id)))
            """;

    /** For the original post {@code o} of a repost row, which may be absent (then the row itself is not a repost). */
    public static final String ORIGINAL_VISIBLE = """
            (o is null or (o.author.status <> com.project.Xclone_backend.user.AccountStatus.SUSPENDED
             and (o.author.protectedAccount = false or o.author.id = :viewerId
                  or exists (select 1 from Follow vo where vo.follower.id = :viewerId and vo.followee.id = o.author.id))))
            """;

    private PostVisibility() {
    }
}
