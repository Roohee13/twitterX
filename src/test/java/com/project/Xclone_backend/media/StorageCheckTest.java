package com.project.Xclone_backend.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;

import com.project.Xclone_backend.common.ApiException;
import com.project.Xclone_backend.config.R2Config;
import com.project.Xclone_backend.config.R2Properties;
import com.project.Xclone_backend.media.StorageCheckDtos.StorageCheckResponse;
import com.project.Xclone_backend.media.StorageCheckDtos.StorageStep;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** The storage check against a small fake S3-compatible server, so every way setup can go wrong is exercised without Cloudflare. */
class StorageCheckTest {

    private static final long ADMIN = 7L;

    /** What the fake bucket does with an upload. */
    enum Upload { ACCEPT, ACCESS_DENIED, NO_SUCH_BUCKET, BAD_ACCESS_KEY, BAD_SIGNATURE }

    private HttpServer server;
    private final Map<String, byte[]> bucket = new ConcurrentHashMap<>();
    private final Map<String, String> types = new ConcurrentHashMap<>();
    private volatile Upload upload = Upload.ACCEPT;
    private volatile int publicStatus = 200;

    @BeforeEach
    void startFakeStorage() throws IOException {
        server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/", this::handle);
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private void handle(HttpExchange ex) throws IOException {
        String path = ex.getRequestURI().getPath();
        String method = ex.getRequestMethod();
        if (path.startsWith("/public/")) { // the bucket's public address
            String key = path.substring("/public/".length());
            reply(ex, publicStatus == 200 && bucket.containsKey(key) ? 200 : publicStatus == 200 ? 404 : publicStatus, bucket.getOrDefault(key, new byte[0]));
            return;
        }
        String key = path.substring(path.indexOf('/', 1) + 1); // path-style: /bucket/key
        switch (method) {
            case "PUT" -> {
                byte[] body = ex.getRequestBody().readAllBytes();
                switch (upload) {
                    case ACCEPT -> {
                        bucket.put(key, body);
                        types.put(key, ex.getRequestHeaders().getFirst("Content-Type"));
                        reply(ex, 200, new byte[0]);
                    }
                    case ACCESS_DENIED -> error(ex, 403, "AccessDenied", "Access Denied");
                    case NO_SUCH_BUCKET -> error(ex, 404, "NoSuchBucket", "The specified bucket does not exist");
                    case BAD_ACCESS_KEY -> error(ex, 403, "InvalidAccessKeyId", "The AWS Access Key Id you provided does not exist");
                    case BAD_SIGNATURE -> error(ex, 403, "SignatureDoesNotMatch", "The request signature we calculated does not match");
                }
            }
            case "HEAD" -> {
                if (bucket.containsKey(key)) {
                    ex.getResponseHeaders().add("Content-Type", types.getOrDefault(key, "image/png"));
                    ex.getResponseHeaders().add("ETag", "\"x\"");
                    ex.getResponseHeaders().set("Content-Length", String.valueOf(bucket.get(key).length)); // a HEAD answer has no body but states the size
                    ex.sendResponseHeaders(200, -1);
                    ex.close();
                } else {
                    ex.sendResponseHeaders(404, -1);
                    ex.close();
                }
            }
            case "DELETE" -> {
                bucket.remove(key);
                reply(ex, 204, new byte[0]);
            }
            default -> reply(ex, 405, new byte[0]);
        }
    }

    private void error(HttpExchange ex, int status, String code, String message) throws IOException {
        reply(ex, status, ("<?xml version=\"1.0\"?><Error><Code>" + code + "</Code><Message>" + message + "</Message></Error>").getBytes(StandardCharsets.UTF_8));
    }

    private void reply(HttpExchange ex, int status, byte[] body) throws IOException {
        if (body.length == 0 || status == 204) {
            ex.sendResponseHeaders(status, -1);
        } else {
            ex.sendResponseHeaders(status, body.length);
            ex.getResponseBody().write(body);
        }
        ex.close();
    }

    private R2Properties props(String endpoint, String accountId, String accessKey, String publicBase) {
        return new R2Properties(accountId, accessKey, "secret-secret-secret-secret", "xclone-media", publicBase, Duration.ofMinutes(10), 5_242_880, endpoint);
    }

    private StorageCheckService service(R2Properties props) throws Exception {
        if (props.accountId().isBlank() || props.accessKey().isBlank()) {
            var none = new StaticListableBeanFactory();
            return new StorageCheckService(props, new MediaService(props, none.getBeanProvider(S3Client.class), none.getBeanProvider(S3Presigner.class)),
                    none.getBeanProvider(S3Client.class));
        }
        var config = new R2Config();
        var client = R2Config.class.getDeclaredMethod("r2Client", R2Properties.class);
        var presigner = R2Config.class.getDeclaredMethod("r2Presigner", R2Properties.class);
        client.setAccessible(true);
        presigner.setAccessible(true);
        var beans = new StaticListableBeanFactory();
        beans.addBean("c", client.invoke(config, props));
        beans.addBean("p", presigner.invoke(config, props));
        return new StorageCheckService(props, new MediaService(props, beans.getBeanProvider(S3Client.class), beans.getBeanProvider(S3Presigner.class)),
                beans.getBeanProvider(S3Client.class));
    }

    private StorageCheckService working() throws Exception {
        String base = "http://localhost:" + server.getAddress().getPort();
        return service(props(base, "acct", "AKIAEXAMPLE", base + "/public"));
    }

    private static List<String> ids(StorageCheckResponse r) {
        return r.steps().stream().map(StorageStep::id).toList();
    }

    private static StorageStep step(StorageCheckResponse r, String id) {
        return r.steps().stream().filter(s -> s.id().equals(id)).findFirst().orElseThrow();
    }

    // --- the server's own check ---

    @Test
    void everythingWorkingGivesAllGreenAndLeavesNothingBehind() throws Exception {
        StorageCheckResponse result = working().check(ADMIN, null);

        assertThat(result.ok()).isTrue();
        assertThat(ids(result)).containsExactly("config", "presign", "upload", "stored", "public", "cleanup");
        assertThat(result.steps()).allMatch(StorageStep::ok).allMatch(s -> s.hint() == null);
        assertThat(bucket).isEmpty(); // the test image was removed again
    }

    @Test
    void theTestImageIsUploadedAsAPngUnderTheAdminsOwnFolder() throws Exception {
        server.removeContext("/");
        server.createContext("/", ex -> {
            if ("PUT".equals(ex.getRequestMethod())) {
                bucket.put("seen:" + ex.getRequestURI().getPath(), ex.getRequestBody().readAllBytes());
                types.put("type", ex.getRequestHeaders().getFirst("Content-Type"));
            }
            handle(ex);
        });
        working().check(ADMIN, null);
        assertThat(types.get("type")).isEqualTo("image/png");
        assertThat(bucket.keySet()).anyMatch(k -> k.startsWith("seen:/xclone-media/users/7/") && k.endsWith(".png"));
    }

    @Test
    void aTokenWithoutWritePermissionIsExplained() throws Exception {
        upload = Upload.ACCESS_DENIED;

        StorageCheckResponse result = working().check(ADMIN, null);

        assertThat(result.ok()).isFalse();
        assertThat(step(result, "upload").ok()).isFalse();
        assertThat(step(result, "upload").detail()).contains("403").contains("AccessDenied");
        assertThat(step(result, "upload").hint()).contains("Object Read & Write");
        assertThat(ids(result)).doesNotContain("stored", "public"); // nothing after the failure is attempted
    }

    @Test
    void aWrongBucketNameNamesTheBucket() throws Exception {
        upload = Upload.NO_SUCH_BUCKET;
        assertThat(step(working().check(ADMIN, null), "upload").hint()).contains("'xclone-media'").contains("R2_BUCKET");
    }

    @Test
    void aWrongAccessKeyAndAWrongSecretAreToldApart() throws Exception {
        upload = Upload.BAD_ACCESS_KEY;
        assertThat(step(working().check(ADMIN, null), "upload").hint()).contains("R2_ACCESS_KEY");
        upload = Upload.BAD_SIGNATURE;
        assertThat(step(working().check(ADMIN, null), "upload").hint()).contains("R2_SECRET_KEY");
    }

    @Test
    void anUnreachableAccountAddressPointsAtTheAccountId() throws Exception {
        StorageCheckResponse result = service(props("http://localhost:1", "acct", "AKIAEXAMPLE", "http://localhost:1/public")).check(ADMIN, null);

        assertThat(step(result, "upload").ok()).isFalse();
        assertThat(step(result, "upload").detail()).startsWith("Could not reach localhost");
        assertThat(step(result, "upload").hint()).contains("R2_ACCOUNT_ID");
    }

    @Test
    void aBucketWithoutPublicAccessIsCaughtEvenThoughUploadsWork() throws Exception {
        publicStatus = 403;

        StorageCheckResponse result = working().check(ADMIN, null);

        assertThat(result.ok()).isFalse();
        assertThat(step(result, "upload").ok()).isTrue();
        assertThat(step(result, "public").detail()).contains("HTTP 403");
        assertThat(step(result, "public").hint()).contains("public access");
        assertThat(step(result, "cleanup").ok()).isTrue();
        assertThat(bucket).isEmpty();
    }

    @Test
    void aMissingPublicAddressSettingIsCaught() throws Exception {
        String base = "http://localhost:" + server.getAddress().getPort();

        StorageCheckResponse result = service(props(base, "acct", "AKIAEXAMPLE", "")).check(ADMIN, null);

        assertThat(step(result, "public").ok()).isFalse();
        assertThat(step(result, "public").detail()).contains("R2_PUBLIC_BASE_URL is not set");
    }

    @Test
    void missingCredentialsListWhatIsMissingAndGoNoFurther() throws Exception {
        StorageCheckResponse result = service(new R2Properties("", "", "", "xclone-media", "", Duration.ofMinutes(10), 5_242_880, "")).check(ADMIN, null);

        assertThat(result.ok()).isFalse();
        assertThat(ids(result)).containsExactly("config");
        assertThat(step(result, "config").detail()).contains("R2_ACCOUNT_ID").contains("R2_ACCESS_KEY").contains("R2_SECRET_KEY");
    }

    // --- the browser's part ---

    @Test
    void anImageTheBrowserUploadedProvesTheBrowserCanUploadAndIsThenRemoved() throws Exception {
        String key = "users/7/browser-test.png";
        bucket.put(key, StorageCheckService.TEST_PNG); // what the browser's PUT leaves in the bucket
        types.put(key, "image/png");

        StorageCheckResponse result = working().check(ADMIN, key);

        assertThat(result.ok()).isTrue();
        assertThat(ids(result)).containsExactly("config", "browser-upload", "browser-public", "browser-cleanup");
        assertThat(bucket).isEmpty();
    }

    @Test
    void ifTheBrowsersImageNeverArrivedTheBucketSettingsAreBlamed() throws Exception {
        StorageCheckResponse result = working().check(ADMIN, "users/7/never-uploaded.png");

        assertThat(result.ok()).isFalse();
        assertThat(step(result, "browser-upload").hint()).contains("CORS");
    }

    @Test
    void onlyTinyTestImagesInTheAdminsOwnFolderMayBeChecked() throws Exception {
        bucket.put("users/7/big.png", new byte[5000]);
        types.put("users/7/big.png", "image/png");
        bucket.put("users/8/other.png", StorageCheckService.TEST_PNG);
        StorageCheckService service = working();

        assertThatThrownBy(() -> service.check(ADMIN, "users/8/other.png")).isInstanceOf(ApiException.class);   // someone else's folder
        assertThatThrownBy(() -> service.check(ADMIN, "users/7/notes.txt")).isInstanceOf(ApiException.class);    // not a png
        assertThatThrownBy(() -> service.check(ADMIN, "users/7/../8/other.png")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.check(ADMIN, "users/7/big.png")).isInstanceOf(ApiException.class);      // too big to be a test image
        assertThat(bucket).containsKeys("users/7/big.png", "users/8/other.png"); // none of them was deleted
    }

    @Test
    void theBuiltInTestImageIsReallyAPng() {
        byte[] png = StorageCheckService.TEST_PNG;
        assertThat(png[0] & 0xFF).isEqualTo(0x89);
        assertThat(new String(png, 1, 3, StandardCharsets.US_ASCII)).isEqualTo("PNG");
        assertThat(png.length).isLessThan(1024);
    }
}
