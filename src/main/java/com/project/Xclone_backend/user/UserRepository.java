package com.project.Xclone_backend.user;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByUsername(String username);

    Optional<User> findByEmail(String email);

    List<User> findByUsernameInAndStatus(Collection<String> usernames, AccountStatus status);

    boolean existsByUsername(String username);

    boolean existsByEmail(String email);

    /** The admins who should hear about new reports. */
    List<User> findByAdminTrueAndStatus(AccountStatus status);

    boolean existsByIdAndStatus(Long id, AccountStatus status);

    boolean existsByIdAndEmailVerifiedFalse(Long id);

    /** The account's current token version, or empty when it is not ACTIVE. */
    @Query("select u.tokenVersion from User u where u.id = :id and u.status = com.project.Xclone_backend.user.AccountStatus.ACTIVE")
    java.util.Optional<Integer> findActiveTokenVersion(Long id);

    /** {@code prefix} must already be lowercased, LIKE-escaped and end with {@code %}. */
    @Query("""
            select u from User u
            where (u.username like :prefix escape '\\' or lower(u.displayName) like :prefix escape '\\')
              and u.status = com.project.Xclone_backend.user.AccountStatus.ACTIVE
            order by u.username
            """)
    List<User> search(String prefix, Limit limit);

    /** One suggested account. {@code mutuals} is how many of the viewer's follows follow it (0 for popular fallbacks). */
    interface SuggestionRow {
        Long getId();

        String getUsername();

        String getDisplayName();

        String getAvatarKey();

        Boolean getProtectedAccount();

        Long getMutuals();
    }

    /**
     * Friends of friends: accounts followed by the viewer's {@code firstHop} most recent follows, ranked by how many of
     * those follow them. Leaves out the viewer, accounts they already follow, block pairs, muted and inactive accounts.
     */
    @Query(value = """
            with my_follows as (
                select followee_id from follows where follower_id = :me order by id desc limit :firstHop
            )
            select u.id as "id", u.username as "username", u.display_name as "displayName",
                   u.avatar_key as "avatarKey", u.protected_account as "protectedAccount", count(*) as "mutuals"
            from my_follows m
            join follows f on f.follower_id = m.followee_id
            join users u on u.id = f.followee_id
            where u.id <> :me and u.status = 'ACTIVE'
              and not exists (select 1 from follows x where x.follower_id = :me and x.followee_id = u.id)
              and not exists (select 1 from blocks b
                              where (b.blocker_id = :me and b.blocked_id = u.id)
                                 or (b.blocker_id = u.id and b.blocked_id = :me))
              and not exists (select 1 from mutes mu where mu.muter_id = :me and mu.muted_id = u.id)
            group by u.id
            order by count(*) desc, u.id desc
            limit :limit
            """, nativeQuery = true)
    List<SuggestionRow> findFriendsOfFriends(long me, int firstHop, int limit);

    /** The same exclusions, applied to a given set of candidates (the cached most-followed accounts). */
    @Query(value = """
            select u.id as "id", u.username as "username", u.display_name as "displayName",
                   u.avatar_key as "avatarKey", u.protected_account as "protectedAccount", 0 as "mutuals"
            from users u
            where u.id in (:candidateIds) and u.id <> :me and u.status = 'ACTIVE'
              and not exists (select 1 from follows x where x.follower_id = :me and x.followee_id = u.id)
              and not exists (select 1 from blocks b
                              where (b.blocker_id = :me and b.blocked_id = u.id)
                                 or (b.blocker_id = u.id and b.blocked_id = :me))
              and not exists (select 1 from mutes mu where mu.muter_id = :me and mu.muted_id = u.id)
            """, nativeQuery = true)
    List<SuggestionRow> findAllowedAmong(long me, Collection<Long> candidateIds);
}
