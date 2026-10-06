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

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** Photos in direct messages. Same mocked beans as AdminReportsTest so both share one Spring context. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MessagePhotosTest {

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

    @BeforeEach
    void storageHasEveryUpload() {
        when(s3Client.headObject(any(HeadObjectRequest.class)))
                .thenAnswer(inv -> {
                    String key = inv.<HeadObjectRequest>getArgument(0).key();
                    if (key.endsWith("missing.png")) {
                        throw NoSuchKeyException.builder().build();
                    }
                    return HeadObjectResponse.builder().contentType("image/png").contentLength(1000L).build();
                });
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

    private long conversation(Account me, Account other) throws Exception {
        String res = mvc.perform(auth(post("/api/conversations"), me).contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"" + other.username() + "\"}"))
                .andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private String key(Account owner, String name) {
        return "users/" + owner.id() + "/" + name;
    }

    private String send(Account from, long conversationId, String json, int expected) throws Exception {
        return mvc.perform(auth(post("/api/conversations/" + conversationId + "/messages"), from).contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().is(expected)).andReturn().getResponse().getContentAsString();
    }

    @Test
    void aPhotoOnlyMessageIsSavedDeliveredAndListedInOrder() throws Exception {
        Account ann = register();
        Account ben = register();
        long c = conversation(ann, ben);
        String json = "{\"mediaKeys\":[\"" + key(ann, "a.png") + "\",\"" + key(ann, "b.png") + "\"]}";

        String res = send(ann, c, json, 201);

        assertThat(JsonPath.<String>read(res, "$.content")).isEmpty();
        List<String> urls = JsonPath.read(res, "$.mediaUrls");
        assertThat(urls).hasSize(2);
        assertThat(urls.get(0)).endsWith(key(ann, "a.png"));
        assertThat(urls.get(1)).endsWith(key(ann, "b.png"));
        // The other person sees the same photos, and the inbox preview knows there is a photo.
        mvc.perform(auth(get("/api/conversations/" + c + "/messages"), ben)).andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].mediaUrls", hasSize(2)));
        mvc.perform(auth(get("/api/conversations"), ben)).andExpect(jsonPath("$.items[0].lastMessage.hasMedia").value(true))
                .andExpect(jsonPath("$.items[0].lastMessage.content").value(""));
    }

    @Test
    void textAndPhotosTogetherAndTextOnlyStillWork() throws Exception {
        Account ann = register();
        Account ben = register();
        long c = conversation(ann, ben);

        send(ann, c, "{\"content\":\"look\",\"mediaKeys\":[\"" + key(ann, "a.png") + "\"]}", 201);
        String plain = send(ann, c, "{\"content\":\"just words\"}", 201);

        assertThat(JsonPath.<List<String>>read(plain, "$.mediaUrls")).isEmpty();
        mvc.perform(auth(get("/api/conversations/" + c + "/messages"), ben)).andExpect(jsonPath("$.items[0].content").value("look"))
                .andExpect(jsonPath("$.items[0].mediaUrls", hasSize(1))).andExpect(jsonPath("$.items[1].mediaUrls", hasSize(0)));
        mvc.perform(auth(get("/api/conversations"), ben)).andExpect(jsonPath("$.items[0].lastMessage.hasMedia").value(false));
    }

    @Test
    void invalidAttachmentsAreRejected() throws Exception {
        Account ann = register();
        Account ben = register();
        long c = conversation(ann, ben);

        send(ann, c, "{}", 400); // nothing at all
        send(ann, c, "{\"content\":\"  \",\"mediaKeys\":[]}", 400);
        send(ann, c, "{\"mediaKeys\":[\"" + key(ann, "1.png") + "\",\"" + key(ann, "2.png") + "\",\"" + key(ann, "3.png") + "\",\"" + key(ann, "4.png") + "\",\"" + key(ann, "5.png") + "\"]}", 400);
        send(ann, c, "{\"mediaKeys\":[\"" + key(ben, "theirs.png") + "\"]}", 400); // someone else's upload
        send(ann, c, "{\"mediaKeys\":[\"" + key(ann, "missing.png") + "\"]}", 400); // never uploaded
        send(ann, c, "{\"mediaKeys\":[\"users/" + ann.id() + "/../" + ben.id() + "/x.png\"]}", 400);
        mvc.perform(auth(get("/api/conversations/" + c + "/messages"), ben)).andExpect(jsonPath("$.items", hasSize(0)));
    }

    @Test
    void anOutsiderCannotSendPhotosIntoAConversation() throws Exception {
        Account ann = register();
        Account ben = register();
        Account eve = register();
        long c = conversation(ann, ben);

        send(eve, c, "{\"mediaKeys\":[\"" + key(eve, "a.png") + "\"]}", 404);
    }

    @Test
    void deletingTheMessageRemovesItsPhotos() throws Exception {
        Account ann = register();
        Account ben = register();
        long c = conversation(ann, ben);
        String res = send(ann, c, "{\"content\":\"cap\",\"mediaKeys\":[\"" + key(ann, "a.png") + "\"]}", 201);
        long id = ((Number) JsonPath.read(res, "$.id")).longValue();

        mvc.perform(auth(delete("/api/conversations/" + c + "/messages/" + id), ann)).andExpect(status().isNoContent());

        mvc.perform(auth(get("/api/conversations/" + c + "/messages"), ben)).andExpect(jsonPath("$.items[0].deleted").value(true))
                .andExpect(jsonPath("$.items[0].mediaUrls", hasSize(0))).andExpect(jsonPath("$.items[0].content").value(""));
        mvc.perform(auth(get("/api/conversations"), ben)).andExpect(jsonPath("$.items[0].lastMessage.hasMedia").value(false));
    }

    @Test
    void editingChangesTheCaptionButNotThePhotosAndAPhotoMessageMayLoseItsText() throws Exception {
        Account ann = register();
        Account ben = register();
        long c = conversation(ann, ben);
        String res = send(ann, c, "{\"content\":\"cap\",\"mediaKeys\":[\"" + key(ann, "a.png") + "\"]}", 201);
        long id = ((Number) JsonPath.read(res, "$.id")).longValue();
        String url = "/api/conversations/" + c + "/messages/" + id;

        mvc.perform(auth(patch(url), ann).contentType(MediaType.APPLICATION_JSON).content("{\"content\":\"better\"}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("better")).andExpect(jsonPath("$.mediaUrls", hasSize(1)));
        mvc.perform(auth(patch(url), ann).contentType(MediaType.APPLICATION_JSON).content("{\"content\":\"\"}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("")).andExpect(jsonPath("$.mediaUrls", hasSize(1)));

        // A text-only message still cannot be emptied.
        String plain = send(ann, c, "{\"content\":\"words\"}", 201);
        long plainId = ((Number) JsonPath.read(plain, "$.id")).longValue();
        mvc.perform(auth(patch("/api/conversations/" + c + "/messages/" + plainId), ann).contentType(MediaType.APPLICATION_JSON).content("{\"content\":\"  \"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void photosCannotBeSentToSomeoneWhoLeftOrBlockedYou() throws Exception {
        Account ann = register();
        Account ben = register();
        long c = conversation(ann, ben);
        mvc.perform(auth(post("/api/users/" + ann.username() + "/block"), ben)).andExpect(status().isNoContent());

        send(ann, c, "{\"mediaKeys\":[\"" + key(ann, "a.png") + "\"]}", 403);
    }
}
