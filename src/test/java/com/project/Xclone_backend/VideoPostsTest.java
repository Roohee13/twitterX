package com.project.Xclone_backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.jayway.jsonpath.JsonPath;
import com.project.Xclone_backend.auth.EmailSender;

import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** A post can carry one video; other places that take media stay image-only. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class VideoPostsTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    EmailSender emailSender;

    @MockitoBean
    S3Client s3Client;

    @MockitoBean
    S3Presigner s3Presigner;

    record Account(long id, String username, String token) {
    }

    private Account register() throws Exception {
        String username = "u" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String body = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"" + username + "\",\"email\":\"" + username + "@example.com\",\"password\":\"password123\",\"displayName\":\"Test User\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return new Account(((Number) JsonPath.read(body, "$.user.id")).longValue(), username, JsonPath.read(body, "$.accessToken"));
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder b, Account a) {
        return b.header("Authorization", "Bearer " + a.token());
    }

    private String key(Account owner, String name) {
        return "users/" + owner.id() + "/" + name;
    }


    @BeforeEach
    void storageHasTheseFiles() {
        when(s3Client.headObject(any(HeadObjectRequest.class))).thenAnswer(inv -> {
            String key = inv.<HeadObjectRequest>getArgument(0).key();
            String type = key.endsWith(".mp4") ? "video/mp4" : key.endsWith(".webm") ? "video/webm" : "image/png";
            return HeadObjectResponse.builder().contentType(type).contentLength(1000L).build();
        });
        when(s3Client.getObjectAsBytes(any(GetObjectRequest.class))).thenAnswer(inv -> {
            String key = inv.<GetObjectRequest>getArgument(0).key();
            byte[] bytes = key.contains("fake") ? "hello, not a video".getBytes()
                    : key.endsWith(".webm") ? new byte[] {0x1A, 0x45, (byte) 0xDF, (byte) 0xA3, 1, 0, 0, 0}
                    : new byte[] {0, 0, 0, 0x18, 'f', 't', 'y', 'p', 'm', 'p', '4', '2', 0, 0, 0, 0};
            return ResponseBytes.fromByteArray(GetObjectResponse.builder().build(), bytes);
        });
    }

    private String create(Account who, String json, int expected) throws Exception {
        return mvc.perform(auth(post("/api/posts"), who).contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().is(expected)).andReturn().getResponse().getContentAsString();
    }

    @Test
    void aPostCanCarryOneVideoAndReturnsItsAddress() throws Exception {
        Account ann = register();
        String res = create(ann, "{\"content\":\"watch\",\"mediaKeys\":[\"" + key(ann, "clip.mp4") + "\"]}", 201);
        List<String> urls = JsonPath.read(res, "$.mediaUrls");
        assertThat(urls).hasSize(1);
        assertThat(urls.get(0)).endsWith(key(ann, "clip.mp4"));
        // A video alone is a post.
        create(ann, "{\"mediaKeys\":[\"" + key(ann, "clip2.webm") + "\"]}", 201);
    }

    @Test
    void aVideoCannotBeMixedWithImagesOrOtherVideos() throws Exception {
        Account ann = register();
        create(ann, "{\"mediaKeys\":[\"" + key(ann, "clip.mp4") + "\",\"" + key(ann, "a.png") + "\"]}", 400);
        create(ann, "{\"mediaKeys\":[\"" + key(ann, "a.png") + "\",\"" + key(ann, "clip.mp4") + "\"]}", 400);
        create(ann, "{\"mediaKeys\":[\"" + key(ann, "one.mp4") + "\",\"" + key(ann, "two.mp4") + "\"]}", 400);
    }

    @Test
    void aFileThatOnlyClaimsToBeAVideoIsRefused() throws Exception {
        Account ann = register();
        create(ann, "{\"mediaKeys\":[\"" + key(ann, "fake.mp4") + "\"]}", 400);
    }

    @Test
    void someoneElsesVideoCannotBeAttached() throws Exception {
        Account ann = register();
        Account ben = register();
        create(ben, "{\"mediaKeys\":[\"" + key(ann, "clip.mp4") + "\"]}", 400);
    }

    @Test
    void messagesAndAvatarsStayImageOnly() throws Exception {
        Account ann = register();
        Account ben = register();
        String conv = mvc.perform(auth(post("/api/conversations"), ann).contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"" + ben.username() + "\"}")).andReturn().getResponse().getContentAsString();
        long id = ((Number) JsonPath.read(conv, "$.id")).longValue();
        mvc.perform(auth(post("/api/conversations/" + id + "/messages"), ann).contentType(MediaType.APPLICATION_JSON)
                .content("{\"mediaKeys\":[\"" + key(ann, "clip.mp4") + "\"]}")).andExpect(status().isBadRequest());
        mvc.perform(auth(patch("/api/users/me"), ann).contentType(MediaType.APPLICATION_JSON)
                .content("{\"avatarKey\":\"" + key(ann, "clip.mp4") + "\"}")).andExpect(status().isBadRequest());
    }
}
