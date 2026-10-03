package com.project.Xclone_backend.mute;

import java.time.Instant;

import com.project.Xclone_backend.user.User;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
 * One-directional and silent: the muter stops seeing the muted user's posts on their timeline and notifications from
 * them, while follows, replies, likes and messages keep working and the muted user is not told. Inserted via a native
 * ON CONFLICT query in {@link MuteRepository}.
 */
@Entity
@Table(name = "mutes",
        uniqueConstraints = @UniqueConstraint(name = "uk_mutes_pair", columnNames = {"muter_id", "muted_id"}),
        indexes = @Index(name = "idx_mutes_muted", columnList = "muted_id"))
@Getter
@NoArgsConstructor
public class Mute {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "muter_id", nullable = false)
    private User muter;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "muted_id", nullable = false)
    private User muted;

    @Column(nullable = false)
    private Instant createdAt;
}
