package com.project.Xclone_backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.UUID;

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
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * "Delete conversation" removes the history for one person only. Uses the same mocked beans as AdminReportsTest so both share one Spring context.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ConversationDeleteTest {

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

    private long conversation(Account a, Account b) throws Exception {
        String res = mvc.perform(auth(post("/api/conversations"), a).contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"" + b.username() + "\"}"))
                .andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private long send(Account from, long conv, String text) throws Exception {
        String res = mvc.perform(auth(post("/api/conversations/" + conv + "/messages"), from).contentType(MediaType.APPLICATION_JSON).content("{\"content\":\"" + text + "\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private List<String> texts(Account who, long conv) throws Exception {
        String res = mvc.perform(auth(get("/api/conversations/" + conv + "/messages"), who)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return JsonPath.read(res, "$.items[*].content");
    }

    private void deleteConversation(Account who, long conv) throws Exception {
        mvc.perform(auth(delete("/api/conversations/" + conv), who)).andExpect(status().isNoContent());
    }

    @Test
    void deletingRemovesItFromMyInboxHistoryAndUnreadCountsButNotFromTheOtherPersons() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = conversation(alice, bob);
        send(alice, conv, "first from alice");
        send(bob, conv, "reply from bob");
        send(alice, conv, "second from alice");
        mvc.perform(auth(get("/api/conversations/unread-count"), bob)).andExpect(jsonPath("$.count").value(2));

        deleteConversation(bob, conv);

        // Gone for Bob...
        mvc.perform(auth(get("/api/conversations"), bob)).andExpect(jsonPath("$.items", hasSize(0)));
        assertThat(texts(bob, conv)).isEmpty();
        mvc.perform(auth(get("/api/conversations/unread-count"), bob)).andExpect(jsonPath("$.count").value(0));
        mvc.perform(auth(get("/api/conversations/" + conv + "/unread-count"), bob)).andExpect(jsonPath("$.count").value(0));
        mvc.perform(auth(get("/api/conversations/" + conv), bob)).andExpect(jsonPath("$.lastMessage").value(nullValue())).andExpect(jsonPath("$.unreadCount").value(0));
        // ...untouched for Alice, who is not told: same inbox row, same history, and Bob's reply still unread for her.
        mvc.perform(auth(get("/api/conversations"), alice)).andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].lastMessage.content").value("second from alice")).andExpect(jsonPath("$.items[0].unreadCount").value(1));
        assertThat(texts(alice, conv)).containsExactly("first from alice", "reply from bob", "second from alice");
    }

    @Test
    void aNewMessageBringsTheConversationBackWithOnlyTheNewMessages() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = conversation(alice, bob);
        send(alice, conv, "old one");
        send(bob, conv, "old two");
        deleteConversation(bob, conv);

        send(alice, conv, "brand new");

        mvc.perform(auth(get("/api/conversations"), bob)).andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].id").value(conv)).andExpect(jsonPath("$.items[0].lastMessage.content").value("brand new"))
                .andExpect(jsonPath("$.items[0].unreadCount").value(1));
        assertThat(texts(bob, conv)).containsExactly("brand new"); // the deleted history stays deleted
        mvc.perform(auth(get("/api/conversations/unread-count"), bob)).andExpect(jsonPath("$.count").value(1));
        assertThat(texts(alice, conv)).containsExactly("old one", "old two", "brand new");
    }

    @Test
    void myOwnNewMessageAfterDeletingAlsoStartsAFreshConversationView() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = conversation(alice, bob);
        send(alice, conv, "before");
        deleteConversation(bob, conv);

        send(bob, conv, "starting over");
        // Starting a chat again with the same person reuses the conversation, still without the old history.
        assertThat(conversation(bob, alice)).isEqualTo(conv);

        assertThat(texts(bob, conv)).containsExactly("starting over");
        mvc.perform(auth(get("/api/conversations"), bob)).andExpect(jsonPath("$.items", hasSize(1)));
    }

    @Test
    void startingAChatAgainAfterDeletingGivesAnEmptyChatInTheSameConversation() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = conversation(alice, bob);
        send(alice, conv, "gone for bob");
        deleteConversation(bob, conv);

        mvc.perform(auth(post("/api/conversations"), bob).contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"" + alice.username() + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(conv)).andExpect(jsonPath("$.lastMessage").value(nullValue()))
                .andExpect(jsonPath("$.unreadCount").value(0));
        assertThat(texts(bob, conv)).isEmpty();
    }

    @Test
    void bothPeopleCanDeleteAndEachDeletionIsTheirOwn() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = conversation(alice, bob);
        send(alice, conv, "one");
        send(bob, conv, "two");

        deleteConversation(alice, conv);
        assertThat(texts(alice, conv)).isEmpty();
        assertThat(texts(bob, conv)).containsExactly("one", "two");
        deleteConversation(bob, conv);

        mvc.perform(auth(get("/api/conversations"), alice)).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(auth(get("/api/conversations"), bob)).andExpect(jsonPath("$.items", hasSize(0)));
        send(alice, conv, "hello again");
        assertThat(texts(alice, conv)).containsExactly("hello again");
        assertThat(texts(bob, conv)).containsExactly("hello again");
    }

    @Test
    void deletingTwiceIsHarmlessAndNeverBringsBackOrHidesLaterMessages() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = conversation(alice, bob);
        send(alice, conv, "one");
        deleteConversation(bob, conv);
        send(alice, conv, "two");

        deleteConversation(bob, conv);
        assertThat(texts(bob, conv)).isEmpty(); // the second deletion also covers "two"
        send(alice, conv, "three");

        assertThat(texts(bob, conv)).containsExactly("three");
    }

    @Test
    void onlyParticipantsCanDeleteAndUnknownOrAnonymousCallsAreRefused() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long conv = conversation(alice, bob);
        send(alice, conv, "private");

        mvc.perform(auth(delete("/api/conversations/" + conv), carol)).andExpect(status().isNotFound());
        mvc.perform(auth(delete("/api/conversations/999999999"), alice)).andExpect(status().isNotFound());
        mvc.perform(delete("/api/conversations/" + conv)).andExpect(status().isUnauthorized());
        assertThat(texts(alice, conv)).containsExactly("private");
        assertThat(texts(bob, conv)).containsExactly("private");
    }

    @Test
    void myOldMessagesCanNoLongerBeEditedOrDeletedOnceTheyAreGoneForMe() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = conversation(alice, bob);
        long mine = send(bob, conv, "my old message");
        deleteConversation(bob, conv);

        mvc.perform(auth(patch("/api/conversations/" + conv + "/messages/" + mine), bob).contentType(MediaType.APPLICATION_JSON).content("{\"content\":\"edit\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(auth(delete("/api/conversations/" + conv + "/messages/" + mine), bob)).andExpect(status().isNotFound());
        assertThat(texts(alice, conv)).containsExactly("my old message"); // Alice's copy is unchanged
    }

    @Test
    void itCanBeDeletedEvenWhenTheOtherPersonIsDeactivatedOrBlocked() throws Exception {
        Account me = register();
        Account gone = register();
        Account blocked = register();
        long withGone = conversation(me, gone);
        long withBlocked = conversation(me, blocked);
        send(gone, withGone, "bye");
        send(blocked, withBlocked, "hello");
        mvc.perform(auth(post("/api/users/me/deactivate"), gone)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + blocked.username() + "/block"), me)).andExpect(status().isNoContent());

        deleteConversation(me, withGone);
        deleteConversation(me, withBlocked);

        mvc.perform(auth(get("/api/conversations/unread-count"), me)).andExpect(jsonPath("$.count").value(0));
        mvc.perform(auth(get("/api/conversations"), me)).andExpect(jsonPath("$.items", hasSize(0)));
    }
}
