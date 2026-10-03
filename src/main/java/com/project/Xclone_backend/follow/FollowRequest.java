package com.project.Xclone_backend.follow;

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

/** A pending request to follow a protected account. Inserted via a native ON CONFLICT query in {@link FollowRequestRepository}. */
@Entity
@Table(name = "follow_requests",
        uniqueConstraints = @UniqueConstraint(name = "uk_follow_requests_pair", columnNames = {"requester_id", "target_id"}),
        indexes = @Index(name = "idx_follow_requests_target", columnList = "target_id"))
@Getter
@NoArgsConstructor
public class FollowRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "requester_id", nullable = false)
    private User requester;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "target_id", nullable = false)
    private User target;

    @Column(nullable = false)
    private Instant createdAt;
}
