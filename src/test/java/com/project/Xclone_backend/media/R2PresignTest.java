package com.project.Xclone_backend.media;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;

import org.junit.jupiter.api.Test;

import com.project.Xclone_backend.config.R2Properties;

/**
 * Cloudflare R2 is S3-compatible but not every S3 extra is accepted. Recent AWS SDK versions add checksum parameters to presigned uploads
 * by default; a browser then uploads bytes whose checksum differs from the one signed into the URL, and R2 refuses it. These tests build the
 * real presigned URL (with made-up credentials, offline) and check that nothing like that is in it.
 */
class R2PresignTest {

    private final R2Properties props = new R2Properties("0123456789abcdef0123456789abcdef", "AKIAEXAMPLEEXAMPLE", "secretsecretsecretsecretsecretsecret",
            "xclone-media", "https://pub-example.r2.dev", Duration.ofMinutes(10), 5_242_880, "");

    private MediaService service() throws Exception {
        var config = new com.project.Xclone_backend.config.R2Config();
        var presigner = config.getClass().getDeclaredMethod("r2Presigner", R2Properties.class);
        presigner.setAccessible(true);
        var client = config.getClass().getDeclaredMethod("r2Client", R2Properties.class);
        client.setAccessible(true);
        var presignerBean = (software.amazon.awssdk.services.s3.presigner.S3Presigner) presigner.invoke(config, props);
        var clientBean = (software.amazon.awssdk.services.s3.S3Client) client.invoke(config, props);
        var presignerProvider = new org.springframework.beans.factory.support.StaticListableBeanFactory();
        presignerProvider.addBean("p", presignerBean);
        presignerProvider.addBean("c", clientBean);
        return new MediaService(props, presignerProvider.getBeanProvider(software.amazon.awssdk.services.s3.S3Client.class),
                presignerProvider.getBeanProvider(software.amazon.awssdk.services.s3.presigner.S3Presigner.class));
    }

    @Test
    void thePresignedUploadUrlPointsAtTheAccountsR2EndpointAndTheUsersOwnFolder() throws Exception {
        var url = service().createUploadUrl(42L, "image/png", 12345);

        assertThat(url.uploadUrl()).startsWith("https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/xclone-media/users/42/");
        assertThat(url.key()).startsWith("users/42/").endsWith(".png");
        assertThat(url.publicUrl()).isEqualTo("https://pub-example.r2.dev/" + url.key());
    }

    @Test
    void theUrlCarriesNoChecksumParametersAndNoHeaderTheBrowserCouldNotSend() throws Exception {
        var url = service().createUploadUrl(42L, "image/jpeg", 2048);

        assertThat(url.uploadUrl().toLowerCase()).doesNotContain("checksum");
        assertThat(url.headers().keySet().stream().map(String::toLowerCase)).allMatch(h -> h.equals("host") || h.equals("content-type") || h.equals("content-length"));
    }
}
