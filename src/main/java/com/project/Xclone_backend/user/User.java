package com.project.Xclone_backend.user;

import java.time.Instant;

import org.hibernate.annotations.ColumnDefault;
import org.hibernate.annotations.CreationTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;


    @Column(nullable = false, unique = true, length = 15)
    private String username;


    @Column(nullable = false, unique = true, length = 254)
    private String email;

    @Column(nullable = false)
    private String passwordHash;


    @ColumnDefault("true")
    @Column(nullable = false)
    private boolean emailVerified = true;

    @Column(nullable = false, length = 50)
    private String displayName;

    @Column(length = 160)
    private String bio;

    private String avatarKey;

    private String bannerKey;

    @Enumerated(EnumType.STRING)
    @ColumnDefault("'ACTIVE'")
    @Column(nullable = false, length = 20)
    private AccountStatus status = AccountStatus.ACTIVE;


    @ColumnDefault("false")
    @Column(nullable = false)
    private boolean protectedAccount;

    /** Access tokens carry the value they were issued with; bumping it (password change or reset) invalidates all of them. */
    @ColumnDefault("0")
    @Column(nullable = false)
    private int tokenVersion;

    @Enumerated(EnumType.STRING)
    @ColumnDefault("'EVERYONE'")
    @Column(nullable = false, length = 20)
    private DmPolicy dmPolicy = DmPolicy.EVERYONE;

    @ColumnDefault("false")
    @Column(name = "is_admin", nullable = false)
    private boolean admin;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;
}
