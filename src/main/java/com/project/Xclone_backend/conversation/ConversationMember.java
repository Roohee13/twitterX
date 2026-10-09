package com.project.Xclone_backend.conversation;

import java.time.Instant;

import org.hibernate.annotations.ColumnDefault;
import org.hibernate.annotations.CreationTimestamp;

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
import lombok.Setter;

/** A person in a group conversation, with their own view of it (what they deleted, what they have read). */
@Entity
@Table(name = "conversation_members",
        uniqueConstraints = @UniqueConstraint(name = "uk_conversation_members", columnNames = {"conversation_id", "user_id"}),
        indexes = @Index(name = "idx_conversation_members_user", columnList = "user_id"))
@Getter
@NoArgsConstructor
public class ConversationMember {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "conversation_id", nullable = false)
    private Conversation conversation;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Setter
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private MemberRole role;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant joinedAt;

    /** Messages with an id up to this are hidden from this member (older than their joining, or deleted by them). 0 = nothing hidden. */
    @ColumnDefault("0")
    @Column(nullable = false)
    private long clearedBefore;

    /** Messages up to this id count as read by this member. */
    @ColumnDefault("0")
    @Column(nullable = false)
    private long lastReadMessageId;

    public ConversationMember(Conversation conversation, User user, MemberRole role, long clearedBefore) {
        this.conversation = conversation;
        this.user = user;
        this.role = role;
        this.clearedBefore = clearedBefore;
    }

    /** Messages with an id up to this are not for this member to see or count as unread. */
    public long unreadAfter() {
        return Math.max(clearedBefore, lastReadMessageId);
    }
}
