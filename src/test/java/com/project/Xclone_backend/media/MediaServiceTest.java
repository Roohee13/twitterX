package com.project.Xclone_backend.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;

import com.project.Xclone_backend.common.ApiException;
import com.project.Xclone_backend.config.R2Properties;
import com.project.Xclone_backend.media.MediaDtos.UploadUrlResponse;

import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

class MediaServiceTest {

    private final R2Properties props = new R2Properties("acct", "ak", "sk", "bucket", "https://cdn.example/",
            Duration.ofMinutes(10), 5_000_000, 50_000_000, "");

    private S3Client s3;
    private S3Presigner presigner;
    private MediaService service;

    @BeforeEach
    void setUp() {
        s3 = mock(S3Client.class);
        presigner = mock(S3Presigner.class);
        service = new MediaService(props, provider(s3), provider(presigner));
    }

    @Test
    void createUploadUrlPresignsUserScopedKey() throws Exception {
        PresignedPutObjectRequest presigned = mock(PresignedPutObjectRequest.class);
        when(presigned.url()).thenReturn(URI.create("https://signed.example/put").toURL());
        when(presigned.signedHeaders()).thenReturn(Map.of("content-type", List.of("image/png")));
        when(presigned.expiration()).thenReturn(Instant.parse("2030-01-01T00:00:00Z"));
        when(presigner.presignPutObject(any(PutObjectPresignRequest.class))).thenReturn(presigned);

        UploadUrlResponse res = service.createUploadUrl(42L, "IMAGE/PNG", 1234);

        assertThat(res.key()).startsWith("users/42/").endsWith(".png");
        assertThat(res.uploadUrl()).isEqualTo("https://signed.example/put");
        assertThat(res.publicUrl()).isEqualTo("https://cdn.example/" + res.key());

        ArgumentCaptor<PutObjectPresignRequest> captor = ArgumentCaptor.forClass(PutObjectPresignRequest.class);
        verify(presigner).presignPutObject(captor.capture());
        assertThat(captor.getValue().signatureDuration()).isEqualTo(Duration.ofMinutes(10));
        assertThat(captor.getValue().putObjectRequest().bucket()).isEqualTo("bucket");
        assertThat(captor.getValue().putObjectRequest().contentType()).isEqualTo("image/png");
        assertThat(captor.getValue().putObjectRequest().contentLength()).isEqualTo(1234L);
    }

    @Test
    void createUploadUrlRejectsBadTypeAndSize() {
        assertThatThrownBy(() -> service.createUploadUrl(1L, "application/pdf", 10))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.createUploadUrl(1L, "image/jpeg", 5_000_001))
                .isInstanceOf(ApiException.class);
        verify(presigner, never()).presignPutObject(any(PutObjectPresignRequest.class));
    }

    @Test
    void verifyRejectsKeysOutsideUserPrefixWithoutCallingR2() {
        assertThatThrownBy(() -> service.verifyOwnedUpload(1L, "users/2/x.png")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.verifyOwnedUpload(1L, "users/1/../2/x.png")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.verifyOwnedUpload(1L, "users/11x.png")).isInstanceOf(ApiException.class);
        verify(s3, never()).headObject(any(HeadObjectRequest.class));
    }

    @Test
    void verifyRequiresObjectToExistAsAllowedImage() {
        when(s3.headObject(any(HeadObjectRequest.class))).thenThrow(NoSuchKeyException.builder().build());
        assertThatThrownBy(() -> service.verifyOwnedUpload(1L, "users/1/missing.png")).isInstanceOf(ApiException.class);
    }

    @Test
    void verifyAcceptsExistingImage() {
        when(s3.headObject(any(HeadObjectRequest.class)))
                .thenReturn(HeadObjectResponse.builder().contentType("image/webp").contentLength(10L).build());
        service.verifyOwnedUpload(1L, "users/1/ok.webp");
    }

    @Test
    void videoUploadsHaveTheirOwnTypesAndLimit() throws Exception {
        PresignedPutObjectRequest presigned = mock(PresignedPutObjectRequest.class);
        when(presigned.url()).thenReturn(URI.create("https://signed.example/put").toURL());
        when(presigned.signedHeaders()).thenReturn(Map.of());
        when(presigned.expiration()).thenReturn(Instant.parse("2030-01-01T00:00:00Z"));
        when(presigner.presignPutObject(any(PutObjectPresignRequest.class))).thenReturn(presigned);

        assertThat(service.createUploadUrl(7L, "video/mp4", 40_000_000).key()).startsWith("users/7/").endsWith(".mp4");
        assertThat(service.createUploadUrl(7L, "video/webm", 1000).key()).endsWith(".webm");
        // Larger than an image may be, but not larger than the video limit; other formats are refused.
        assertThatThrownBy(() -> service.createUploadUrl(7L, "video/mp4", 50_000_001)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.createUploadUrl(7L, "video/quicktime", 1000)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.createUploadUrl(7L, "image/png", 5_000_001)).isInstanceOf(ApiException.class);
    }

    private void stubObject(String type, long length, byte[] firstBytes) {
        when(s3.headObject(any(HeadObjectRequest.class))).thenReturn(HeadObjectResponse.builder().contentType(type).contentLength(length).build());
        when(s3.getObjectAsBytes(any(GetObjectRequest.class)))
                .thenReturn(ResponseBytes.fromByteArray(GetObjectResponse.builder().build(), firstBytes));
    }

    private static final byte[] MP4 = {0, 0, 0, 0x18, 'f', 't', 'y', 'p', 'm', 'p', '4', '2', 0, 0, 0, 0};
    private static final byte[] WEBM = {0x1A, 0x45, (byte) 0xDF, (byte) 0xA3, 1, 0, 0, 0, 0, 0, 0, 0x1F, 0x42, (byte) 0x86, (byte) 0x81, 1};

    @Test
    void aPostAcceptsOneRealVideoAndChecksItsBytes() {
        stubObject("video/mp4", 10_000_000, MP4);
        service.verifyOwnedAttachments(1L, List.of("users/1/clip.mp4"));
        stubObject("video/webm", 10_000_000, WEBM);
        service.verifyOwnedAttachments(1L, List.of("users/1/clip.webm"));
    }

    @Test
    void aVideoFileThatIsNotAVideoIsRefused() {
        stubObject("video/mp4", 100, "<html>not a video</html>".getBytes());
        assertThatThrownBy(() -> service.verifyOwnedAttachments(1L, List.of("users/1/fake.mp4"))).isInstanceOf(ApiException.class);
        stubObject("video/webm", 100, MP4); // right bytes for the wrong container
        assertThatThrownBy(() -> service.verifyOwnedAttachments(1L, List.of("users/1/fake.webm"))).isInstanceOf(ApiException.class);
    }

    @Test
    void aVideoMustBeTheOnlyAttachmentAndOversizedOnesAreRefused() {
        stubObject("video/mp4", 10_000_000, MP4);
        assertThatThrownBy(() -> service.verifyOwnedAttachments(1L, List.of("users/1/clip.mp4", "users/1/a.png"))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.verifyOwnedAttachments(1L, List.of("users/1/a.png", "users/1/clip.mp4"))).isInstanceOf(ApiException.class);
        stubObject("video/mp4", 50_000_001, MP4);
        assertThatThrownBy(() -> service.verifyOwnedAttachments(1L, List.of("users/1/big.mp4"))).isInstanceOf(ApiException.class);
    }

    @Test
    void videosAreNotAcceptedWhereOnlyImagesBelong() {
        stubObject("video/mp4", 10_000_000, MP4);
        // Avatars, banners and direct messages go through verifyOwnedUpload.
        assertThatThrownBy(() -> service.verifyOwnedUpload(1L, "users/1/clip.mp4")).isInstanceOf(ApiException.class);
    }

    @Test
    void unconfiguredStorageReturns503() {
        MediaService unconfigured = new MediaService(props, provider(null), provider(null));
        assertThatThrownBy(() -> unconfigured.createUploadUrl(1L, "image/png", 10))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE));
    }

    @SuppressWarnings("unchecked")
    private static <T> ObjectProvider<T> provider(T value) {
        ObjectProvider<T> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(value);
        return provider;
    }
}
