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

/** "Who can message me": EVERYONE, FOLLOWED or NOBODY. Same mocked beans as the other message tests so they share one Spring context. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DmPolicyTest {

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



    private void setPolicy(Account who, String policy) throws Exception {
        mvc.perform(auth(patch("/api/users/me"), who).contentType(MediaType.APPLICATION_JSON).content("{\"dmPolicy\":\"" + policy + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.dmPolicy").value(policy));
    }

    private int startChat(Account me, Account other) throws Exception {
        return mvc.perform(auth(post("/api/conversations"), me).contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"" + other.username() + "\"}")).andReturn().getResponse().getStatus();
    }

    private long chatId(Account me, Account other) throws Exception {
        String res = mvc.perform(auth(post("/api/conversations"), me).contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"" + other.username() + "\"}")).andExpect(status().is2xxSuccessful())
                .andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private void profileCanMessage(Account viewer, Account target, boolean expected) throws Exception {
        mvc.perform(auth(get("/api/users/" + target.username()), viewer)).andExpect(jsonPath("$.canMessage").value(expected));
    }

    private void send(Account from, long conversationId, String text, int expected) throws Exception {
        mvc.perform(auth(post("/api/conversations/" + conversationId + "/messages"), from).contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"" + text + "\"}")).andExpect(status().is(expected));
    }

    @Test
    void everyoneIsTheDefaultAndAnUnknownValueIsRejected() throws Exception {
        Account ann = register();
        Account ben = register();
        mvc.perform(auth(get("/api/users/me"), ben)).andExpect(jsonPath("$.dmPolicy").value("EVERYONE"));
        profileCanMessage(ann, ben, true);
        assertThat(startChat(ann, ben)).isIn(200, 201);
        mvc.perform(auth(patch("/api/users/me"), ben).contentType(MediaType.APPLICATION_JSON).content("{\"dmPolicy\":\"FRIENDS\"}"))
                .andExpect(status().isBadRequest());
        // Not signed in or looking at yourself: no message button.
        mvc.perform(get("/api/users/" + ben.username())).andExpect(jsonPath("$.canMessage").value(false));
        profileCanMessage(ben, ben, false);
    }

    @Test
    void followedOnlyLetsInTheAccountsTheOwnerFollows() throws Exception {
        Account ann = register();
        Account ben = register();
        setPolicy(ben, "FOLLOWED");

        profileCanMessage(ann, ben, false);
        assertThat(startChat(ann, ben)).isEqualTo(403);

        mvc.perform(auth(post("/api/users/" + ann.username() + "/follow"), ben)).andExpect(status().isNoContent());
        profileCanMessage(ann, ben, true);
        long c = chatId(ann, ben);
        send(ann, c, "hello", 201);
    }

    @Test
    void nobodyClosesTheInboxButTheOwnerCanStillWriteFirstAndGetAnswers() throws Exception {
        Account ann = register();
        Account ben = register();
        setPolicy(ben, "NOBODY");
        assertThat(startChat(ann, ben)).isEqualTo(403);

        // Ben starts it himself (his own setting does not stop him writing); Ann may then answer.
        long c = chatId(ben, ann);
        send(ben, c, "hi ann", 201);
        send(ann, c, "hi ben", 201);
        profileCanMessage(ann, ben, true);
    }

    @Test
    void closingTheInboxLaterStopsNewMessagesInAnOldChatUnlessTheOwnerWroteFirst() throws Exception {
        Account ann = register();
        Account ben = register();
        long c = chatId(ann, ben);
        send(ann, c, "first", 201);

        setPolicy(ben, "NOBODY");
        send(ann, c, "again", 403);
        // Opening the existing chat to read it still works, and editing what she already sent is not a new message.
        assertThat(startChat(ann, ben)).isIn(200, 201);

        send(ben, c, "ok, you may write", 201);
        send(ann, c, "thanks", 201);
    }
}
