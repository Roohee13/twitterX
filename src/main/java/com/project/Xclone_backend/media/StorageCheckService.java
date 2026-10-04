package com.project.Xclone_backend.media;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import com.project.Xclone_backend.common.ApiException;
import com.project.Xclone_backend.config.R2Properties;
import com.project.Xclone_backend.media.StorageCheckDtos.StorageCheckResponse;
import com.project.Xclone_backend.media.StorageCheckDtos.StorageStep;

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.S3Exception;

/**
 * Walks through every step an image upload depends on, with a tiny test image, and says which one is wrong and how to fix it. The mistakes
 * it catches (a mistyped account id, a token without write permission, a wrong bucket name, no public access) all look the same to a user:
 * "the picture did not upload". It uploads exactly the way the app does (a presigned URL), so a pass means real uploads work, apart from the
 * browser's own CORS rule, which the admin's browser tests with a second call (see {@link #check}).
 */
@Service
public class StorageCheckService {

    /** A valid 1x1 PNG, 70 bytes. The frontend uploads the same image for the browser part of the check. */
    static final byte[] TEST_PNG = Base64.getDecoder()
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
    private static final long MAX_TEST_OBJECT_BYTES = 1024;
    private static final Pattern XML_CODE = Pattern.compile("<Code>([^<]*)</Code>");
    private static final Pattern XML_MESSAGE = Pattern.compile("<Message>([^<]*)</Message>");

    private final R2Properties props;
    private final MediaService media;
    private final ObjectProvider<S3Client> s3Client;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public StorageCheckService(R2Properties props, MediaService media, ObjectProvider<S3Client> s3Client) {
        this.props = props;
        this.media = media;
        this.s3Client = s3Client;
    }

    /**
     * @param browserTestKey null for the server's own check. Otherwise the key of a test image that the admin's browser uploaded: it is checked
     *                       (proving the browser, and so the bucket's CORS rule, can upload), read through the public address, and deleted.
     */
    public StorageCheckResponse check(Long adminId, String browserTestKey) {
        List<StorageStep> steps = new ArrayList<>();
        if (!configured(steps)) {
            return new StorageCheckResponse(false, steps);
        }
        if (browserTestKey == null || browserTestKey.isBlank()) {
            serverSteps(adminId, steps);
        } else {
            browserSteps(adminId, browserTestKey, steps);
        }
        return new StorageCheckResponse(steps.stream().allMatch(StorageStep::ok), steps);
    }

    // --- the server's own check ---

    private boolean configured(List<StorageStep> steps) {
        List<String> missing = new ArrayList<>();
        if (blank(props.accountId())) {
            missing.add("R2_ACCOUNT_ID");
        }
        if (blank(props.accessKey())) {
            missing.add("R2_ACCESS_KEY");
        }
        if (blank(props.secretKey())) {
            missing.add("R2_SECRET_KEY");
        }
        if (!missing.isEmpty() || s3Client.getIfAvailable() == null) {
            steps.add(new StorageStep("config", "Storage settings", false, "Not set: " + String.join(", ", missing),
                    "Set these in the backend's environment (README, Cloudflare R2 setup) and restart it. The Account ID is the 32-character id in your Cloudflare dashboard address."));
            return false;
        }
        steps.add(new StorageStep("config", "Storage settings", true, "Account " + props.accountId() + ", bucket " + props.bucket(), null));
        return true;
    }

    private void serverSteps(Long adminId, List<StorageStep> steps) {
        UploadUrlResponseHolder upload = presign(adminId, steps);
        if (upload == null) {
            return;
        }
        boolean uploaded = upload(upload, steps);
        if (uploaded) {
            stored(adminId, upload.key, steps);
            publicRead(upload.key, "public", "Public address", steps);
        }
        // Whatever happened above, remove the test object if it exists.
        if (uploaded) {
            cleanup(upload.key, "cleanup", steps);
        }
    }

    private UploadUrlResponseHolder presign(Long adminId, List<StorageStep> steps) {
        try {
            var url = media.createUploadUrl(adminId, "image/png", TEST_PNG.length);
            steps.add(new StorageStep("presign", "Upload address", true, "A signed upload address was created", null));
            return new UploadUrlResponseHolder(url.key(), url.uploadUrl());
        } catch (RuntimeException e) {
            steps.add(new StorageStep("presign", "Upload address", false, e.getMessage(), "Check the storage settings above."));
            return null;
        }
    }

    private boolean upload(UploadUrlResponseHolder target, List<StorageStep> steps) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(target.url)).timeout(Duration.ofSeconds(10))
                .header("Content-Type", "image/png").PUT(HttpRequest.BodyPublishers.ofByteArray(TEST_PNG)).build();
        try {
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 == 2) {
                steps.add(new StorageStep("upload", "Upload a test image", true, "The storage server accepted it", null));
                return true;
            }
            steps.add(new StorageStep("upload", "Upload a test image", false, describe(response), uploadHint(response)));
        } catch (IOException e) {
            steps.add(new StorageStep("upload", "Upload a test image", false, "Could not reach " + URI.create(target.url).getHost() + ": " + rootMessage(e),
                    "The Account ID (R2_ACCOUNT_ID) is probably wrong, or this computer has no internet access. It is the 32-character id in your Cloudflare dashboard address."));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            steps.add(new StorageStep("upload", "Upload a test image", false, "Interrupted", null));
        }
        return false;
    }

    private void stored(Long adminId, String key, List<StorageStep> steps) {
        try {
            media.verifyOwnedUpload(adminId, key);
            steps.add(new StorageStep("stored", "Find it in the bucket", true, "The image is in the bucket and is recognised as a PNG", null));
        } catch (RuntimeException e) {
            steps.add(new StorageStep("stored", "Find it in the bucket", false, e.getMessage(), "The upload was accepted but the app cannot read it back: check that the token also has read permission."));
        }
    }

    // --- the browser's part ---

    private void browserSteps(Long adminId, String key, List<StorageStep> steps) {
        if (!key.startsWith("users/" + adminId + "/") || !key.endsWith(".png") || key.contains("..")) {
            throw ApiException.badRequest("Not a test image of yours");
        }
        HeadObjectResponse head;
        try {
            head = s3Client.getObject().headObject(HeadObjectRequest.builder().bucket(props.bucket()).key(key).build());
        } catch (S3Exception e) {
            steps.add(new StorageStep("browser-upload", "Image uploaded from your browser", false, "The test image is not in the bucket (HTTP " + e.statusCode() + ")",
                    "The browser's upload did not arrive. See the CORS rule in the README (Cloudflare R2 setup)."));
            return;
        }
        if (head.contentLength() != null && head.contentLength() > MAX_TEST_OBJECT_BYTES) {
            throw ApiException.badRequest("Not a test image");
        }
        steps.add(new StorageStep("browser-upload", "Image uploaded from your browser", true, "It arrived in the bucket, so the browser is allowed to upload", null));
        publicRead(key, "browser-public", "Public address (from the browser's upload)", steps);
        cleanup(key, "browser-cleanup", steps);
    }

    // --- shared ---

    private void publicRead(String key, String id, String label, List<StorageStep> steps) {
        if (blank(props.publicBaseUrl())) {
            steps.add(new StorageStep(id, label, false, "R2_PUBLIC_BASE_URL is not set",
                    "Turn on public access for the bucket (Cloudflare > R2 > your bucket > Settings > Public access) and set R2_PUBLIC_BASE_URL to the address it shows, such as https://pub-xxxx.r2.dev"));
            return;
        }
        String url = props.publicUrl(key);
        try {
            HttpResponse<byte[]> response = http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(10)).GET().build(),
                    HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() == 200) {
                steps.add(new StorageStep(id, label, true, "The image can be read at " + props.publicBaseUrl(), null));
            } else {
                steps.add(new StorageStep(id, label, false, "Reading " + url + " gave HTTP " + response.statusCode(),
                        "Visitors would see broken pictures. Check that public access is enabled for the bucket and that R2_PUBLIC_BASE_URL is exactly the address Cloudflare shows (no folder at the end)."));
            }
        } catch (IOException | IllegalArgumentException e) {
            steps.add(new StorageStep(id, label, false, "Could not read " + url + ": " + rootMessage(e), "R2_PUBLIC_BASE_URL does not look right."));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            steps.add(new StorageStep(id, label, false, "Interrupted", null));
        }
    }

    private void cleanup(String key, String id, List<StorageStep> steps) {
        try {
            s3Client.getObject().deleteObject(DeleteObjectRequest.builder().bucket(props.bucket()).key(key).build());
            steps.add(new StorageStep(id, "Remove the test image", true, "Deleted", null));
        } catch (S3Exception e) {
            steps.add(new StorageStep(id, "Remove the test image", false, "Could not delete it (HTTP " + e.statusCode() + ")",
                    "Uploads work, but the token cannot delete. Harmless: the test image is 70 bytes. For cleanliness give the token 'Object Read & Write'."));
        }
    }

    private String describe(HttpResponse<String> response) {
        String code = first(XML_CODE, response.body());
        String message = first(XML_MESSAGE, response.body());
        return "HTTP " + response.statusCode() + (code != null ? " " + code : "") + (message != null ? ": " + message : "");
    }

    private String uploadHint(HttpResponse<String> response) {
        String code = first(XML_CODE, response.body());
        if (code == null) {
            code = "";
        }
        return switch (code) {
            case "InvalidAccessKeyId" -> "R2_ACCESS_KEY is not a valid Access Key ID. Copy it again from the API token page.";
            case "SignatureDoesNotMatch" -> "R2_SECRET_KEY (or R2_ACCOUNT_ID) is wrong. The Secret Access Key is shown only once when the token is created; if it is lost, create a new token.";
            case "AccessDenied" -> "The API token is not allowed to write to this bucket. Create a token with 'Object Read & Write' for this bucket (or all buckets).";
            case "NoSuchBucket" -> "There is no bucket named '" + props.bucket() + "'. Check R2_BUCKET: it must match the bucket's name exactly.";
            default -> response.statusCode() == 403 ? "The API token is not allowed to write to this bucket. Create a token with 'Object Read & Write' for this bucket."
                    : response.statusCode() == 404 ? "There is no bucket named '" + props.bucket() + "'. Check R2_BUCKET."
                    : "The storage server refused the upload.";
        };
    }

    private static String first(Pattern pattern, String text) {
        if (text == null) {
            return null;
        }
        Matcher m = pattern.matcher(text);
        return m.find() ? m.group(1) : null;
    }

    private static String rootMessage(Throwable e) {
        Throwable root = e;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        return root.getMessage() != null ? root.getMessage() : root.getClass().getSimpleName();
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private record UploadUrlResponseHolder(String key, String url) {
    }
}
