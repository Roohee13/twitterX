package com.project.Xclone_backend.media;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.project.Xclone_backend.common.ApiException;
import com.project.Xclone_backend.config.R2Properties;
import com.project.Xclone_backend.media.MediaDtos.UploadUrlResponse;

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.Delete;
import software.amazon.awssdk.services.s3.model.DeleteObjectsRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.ObjectIdentifier;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

@Service
public class MediaService {

    private static final Logger log = LoggerFactory.getLogger(MediaService.class);

    static final Map<String, String> ALLOWED_TYPES = Map.of(
            "image/jpeg", "jpg",
            "image/png", "png",
            "image/webp", "webp",
            "image/gif", "gif");

    /** Videos are only accepted on posts, one per post (see {@link #verifyOwnedAttachments}). */
    static final Map<String, String> VIDEO_TYPES = Map.of(
            "video/mp4", "mp4",
            "video/webm", "webm");

    private final R2Properties props;
    private final ObjectProvider<S3Client> s3Client;
    private final ObjectProvider<S3Presigner> s3Presigner;

    public MediaService(R2Properties props, ObjectProvider<S3Client> s3Client, ObjectProvider<S3Presigner> s3Presigner) {
        this.props = props;
        this.s3Client = s3Client;
        this.s3Presigner = s3Presigner;
    }

    public UploadUrlResponse createUploadUrl(Long userId, String contentType, long contentLength) {
        String type = contentType.strip().toLowerCase(Locale.ROOT);
        String ext = ALLOWED_TYPES.containsKey(type) ? ALLOWED_TYPES.get(type) : VIDEO_TYPES.get(type);
        if (ext == null) {
            throw ApiException.badRequest("Unsupported type; allowed: " + ALLOWED_TYPES.keySet() + " and " + VIDEO_TYPES.keySet());
        }
        long limit = limitFor(type);
        if (contentLength > limit) {
            throw ApiException.badRequest((VIDEO_TYPES.containsKey(type) ? "Video" : "Image") + " exceeds the " + limit + " byte limit");
        }

        String key = userPrefix(userId) + UUID.randomUUID() + "." + ext;
        PutObjectRequest put = PutObjectRequest.builder()
                .bucket(props.bucket())
                .key(key)
                .contentType(type)
                .contentLength(contentLength)
                .build();
        PresignedPutObjectRequest presigned = presigner().presignPutObject(PutObjectPresignRequest.builder()
                .signatureDuration(props.presignTtl())
                .putObjectRequest(put)
                .build());

        return new UploadUrlResponse(key, presigned.url().toString(), presigned.signedHeaders(),
                props.publicUrl(key), presigned.expiration());
    }

    /**
     * Ensures {@code key} lives under this user's prefix and that the upload actually reached the bucket. Prevents
     * attaching someone else's media or a key that was presigned but never uploaded.
     */
    public void verifyOwnedUpload(Long userId, String key) {
        verifyOwnedUpload(userId, key, false);
    }

    /**
     * What a post may attach: images (as many as the post allows) or exactly one video on its own. Each file must be the caller's own upload.
     * Direct messages and profile pictures use {@link #verifyOwnedUpload(Long, String)}, which accepts images only.
     */
    public void verifyOwnedAttachments(Long userId, List<String> keys) {
        boolean hasVideo = keys.stream().anyMatch(MediaService::isVideoKey);
        if (hasVideo && keys.size() > 1) {
            throw ApiException.badRequest("A post can carry one video, or up to four images, not both");
        }
        keys.forEach(key -> verifyOwnedUpload(userId, key, true));
    }

    static boolean isVideoKey(String key) {
        String lower = key == null ? "" : key.toLowerCase(Locale.ROOT);
        return lower.endsWith(".mp4") || lower.endsWith(".webm");
    }

    private void verifyOwnedUpload(Long userId, String key, boolean allowVideo) {
        if (key == null || !key.startsWith(userPrefix(userId)) || key.contains("..")) {
            throw ApiException.badRequest("Invalid media key: " + key);
        }
        HeadObjectResponse head;
        try {
            head = client().headObject(HeadObjectRequest.builder().bucket(props.bucket()).key(key).build());
        } catch (NoSuchKeyException e) {
            throw ApiException.badRequest("Media not found, upload it first: " + key);
        } catch (S3Exception e) {
            if (e.statusCode() == 404) {
                throw ApiException.badRequest("Media not found, upload it first: " + key);
            }
            throw new ApiException(HttpStatus.BAD_GATEWAY, "Media storage error");
        }
        String type = head.contentType() == null ? "" : head.contentType().toLowerCase(Locale.ROOT);
        boolean image = ALLOWED_TYPES.containsKey(type);
        boolean video = allowVideo && VIDEO_TYPES.containsKey(type);
        if (!image && !video) {
            throw ApiException.badRequest("Uploaded media is not an allowed " + (allowVideo ? "image or video" : "image") + ": " + key);
        }
        if (head.contentLength() > limitFor(type)) {
            throw ApiException.badRequest("Uploaded media is too large: " + key);
        }
        if (video && !(isVideoKey(key) && looksLikeVideo(key, type))) {
            throw ApiException.badRequest("Uploaded file is not a valid video: " + key);
        }
    }

    private long limitFor(String type) {
        return VIDEO_TYPES.containsKey(type) ? props.maxVideoBytes() : props.maxImageBytes();
    }

    /**
     * The declared type comes from the uploader, so for videos the first bytes are checked too: an MP4 has "ftyp" at offset 4, a WebM starts
     * with the EBML magic number 1A 45 DF A3.
     */
    private boolean looksLikeVideo(String key, String type) {
        byte[] head;
        try {
            head = client().getObjectAsBytes(GetObjectRequest.builder().bucket(props.bucket()).key(key).range("bytes=0-15").build())
                    .asByteArray();
        } catch (S3Exception e) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "Media storage error");
        }
        if ("video/webm".equals(type)) {
            return head.length >= 4 && (head[0] & 0xFF) == 0x1A && (head[1] & 0xFF) == 0x45 && (head[2] & 0xFF) == 0xDF
                    && (head[3] & 0xFF) == 0xA3;
        }
        return head.length >= 8 && head[4] == 'f' && head[5] == 't' && head[6] == 'y' && head[7] == 'p';
    }

    /**
     * Removes every file the user uploaded (post images, avatar, banner, message photos: all live under {@code users/<id>/}) once the
     * surrounding transaction commits. Best effort: a storage failure is logged and never fails the account deletion.
     */
    public void deleteAllForUserAfterCommit(Long userId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    deleteAllForUser(userId);
                }
            });
        } else {
            deleteAllForUser(userId);
        }
    }

    void deleteAllForUser(Long userId) {
        S3Client client = s3Client.getIfAvailable();
        if (client == null) {
            return;
        }
        try {
            String continuation = null;
            do {
                ListObjectsV2Response page = client.listObjectsV2(ListObjectsV2Request.builder()
                        .bucket(props.bucket()).prefix(userPrefix(userId)).continuationToken(continuation).build());
                List<ObjectIdentifier> keys = page.contents().stream()
                        .map(o -> ObjectIdentifier.builder().key(o.key()).build()).toList();
                if (!keys.isEmpty()) {
                    client.deleteObjects(DeleteObjectsRequest.builder().bucket(props.bucket())
                            .delete(Delete.builder().objects(keys).quiet(true).build()).build());
                }
                continuation = Boolean.TRUE.equals(page.isTruncated()) ? page.nextContinuationToken() : null;
            } while (continuation != null);
        } catch (RuntimeException e) {
            log.warn("Could not delete the stored files of removed user {}: {}", userId, e.getMessage());
        }
    }

    static String userPrefix(Long userId) {
        return "users/" + userId + "/";
    }


    private S3Client client() {
        S3Client client = s3Client.getIfAvailable();
        if (client == null) {
            throw notConfigured();
        }
        return client;
    }

    private S3Presigner presigner() {
        S3Presigner presigner = s3Presigner.getIfAvailable();
        if (presigner == null) {
            throw notConfigured();
        }
        return presigner;
    }

    private static ApiException notConfigured() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "Media storage is not configured");
    }
}
