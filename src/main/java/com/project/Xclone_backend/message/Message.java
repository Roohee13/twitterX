package com.project.Xclone_backend.message;

import java.time.Instant;

import java.util.ArrayList;
import java.util.List;

import org.hibernate.annotations.BatchSize;
import org.hibernate.annotations.CreationTimestamp;

import com.project.Xclone_backend.conversation.Conversation;
import com.project.Xclone_backend.user.User;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "messages", indexes = @Index(name = "idx_messages_conversation", columnList = "conversation_id, id"))
@Getter
@Setter
@NoArgsConstructor
public class Message {

    public static final int MAX_LENGTH = 2000;
    public static final int MAX_MEDIA = 4;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "conversation_id", nullable = false)
    private Conversation conversation;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "sender_id", nullable = false)
    private User sender;

    @Column(nullable = false, length = MAX_LENGTH)
    private String content;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    /** When the recipient read it; null means unread. */
    private Instant readAt;

    /** When the sender last changed the text; null if never edited. */
    private Instant editedAt;

    /** The sender deleted it for both people: {@code content} is then empty and stays so. */
    @Column(nullable = false)
    private boolean deleted;

    /** Photos in the order they were attached; empty for a text-only message and once the message is deleted. */
    @OneToMany(mappedBy = "message", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("position")
    @BatchSize(size = 50)
    private List<MessageMedia> media = new ArrayList<>();

    public void addMedia(String r2Key) {
        MessageMedia m = new MessageMedia();
        m.setMessage(this);
        m.setR2Key(r2Key);
        m.setPosition(media.size());
        media.add(m);
    }
}
