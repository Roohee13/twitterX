package com.project.Xclone_backend.conversation;

import java.time.Instant;

import org.hibernate.annotations.Check;
import org.hibernate.annotations.ColumnDefault;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import com.project.Xclone_backend.user.User;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * A conversation: DIRECT (one-to-one) or GROUP (see {@link ConversationMember}). For a direct one the pair is stored in canonical order ({@code userOne.id < userTwo.id}), so the unique
 * constraint prevents duplicates whichever user starts the conversation and the check constraint rules out
 * self-conversations. Inserted via a native ON CONFLICT query in {@link ConversationRepository}. A group has no pair (both columns are null).
 */
@Entity
@Table(name = "conversations",
        uniqueConstraints = @UniqueConstraint(name = "uk_conversations_pair",
                columnNames = {"user_one_id", "user_two_id"}),
        indexes = @Index(name = "idx_conversations_user_two", columnList = "user_two_id"))
@Check(name = "ck_conversations_order", constraints = "user_one_id < user_two_id")
@Getter
@NoArgsConstructor
public class Conversation {

    public static final int MAX_TITLE = 100;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Enumerated(EnumType.STRING)
    @ColumnDefault("'DIRECT'")
    @Column(nullable = false, length = 10)
    private ConversationType type = ConversationType.DIRECT;

    /** The group's name; null for a direct conversation. */
    @Column(length = MAX_TITLE)
    private String title;

    /** Who created the group; null for a direct conversation. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by_id")
    private User createdBy;

    /** Direct conversations only (null for a group). */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_one_id")
    private User userOne;

    /** Direct conversations only (null for a group). */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_two_id")
    private User userTwo;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @ColumnDefault("now()") // lets ddl-auto=update add the column to a table that already has rows
    @Column(nullable = false)
    private Instant updatedAt;

    /** Messages with an id up to this are hidden from user one: they deleted the conversation (for themselves) up to there. 0 = nothing deleted. */
    @ColumnDefault("0")
    @Column(nullable = false)
    private long userOneClearedBefore;

    @ColumnDefault("0")
    @Column(nullable = false)
    private long userTwoClearedBefore;

    public static Conversation newGroup(String title, User creator) {
        Conversation c = new Conversation();
        c.type = ConversationType.GROUP;
        c.title = title;
        c.createdBy = creator;
        return c;
    }

    public boolean isGroup() {
        return type == ConversationType.GROUP;
    }

    public void rename(String title) {
        this.title = title;
    }

    /** Direct conversations only: messages with an id up to this are hidden from this participant. A group keeps this per member, see {@link ConversationMember}. */
    public long clearedBeforeFor(Long userId) {
        return userOne.getId().equals(userId) ? userOneClearedBefore : userTwoClearedBefore;
    }
}
