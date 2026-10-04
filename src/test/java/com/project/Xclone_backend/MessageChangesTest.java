package com.project.Xclone_backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.jayway.jsonpath.JsonPath;
import com.project.Xclone_backend.auth.EmailSender;

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** Editing and deleting your own messages: who may, what changes, and what the other person and the inbox see. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MessageChangesTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

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
                .content("{\"username\":\"" + username + "\",\"email\":\"" + username + "@example.com\","
                        + "\"password\":\"password123\",\"displayName\":\"Test User\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return new Account(((Number) JsonPath.read(body, "$.user.id")).longValue(), username, JsonPath.read(body, "$.accessToken"));
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder b, Account a) {
        return b.header("Authorization", "Bearer " + a.token());
    }

    private MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder b, String body) {
        return b.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private long conversation(Account a, Account b) throws Exception {
        String res = mvc.perform(json(auth(post("/api/conversations"), a), "{\"username\":\"" + b.username() + "\"}"))
                .andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private long send(Account from, long conv, String text) throws Exception {
        String res = mvc.perform(json(auth(post("/api/conversations/" + conv + "/messages"), from), "{\"content\":\"" + text + "\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private String url(long conv, long message) {
        return "/api/conversations/" + conv + "/messages/" + message;
    }

    private void edit(Account who, long conv, long message, String text, int expected) throws Exception {
        mvc.perform(json(auth(patch(url(conv, message)), who), "{\"content\":\"" + text + "\"}")).andExpect(status().is(expected));
    }

    // --- editing ---

    @Test
    void theSenderCanEditAndBothPeopleSeeTheNewTextWithAnEditedMark() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = conversation(alice, bob);
        long id = send(alice, conv, "helo wrld");

        mvc.perform(json(auth(patch(url(conv, id)), alice), "{\"content\":\"  hello world  \"}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("hello world")).andExpect(jsonPath("$.editedAt").isNotEmpty())
                .andExpect(jsonPath("$.deleted").value(false)).andExpect(jsonPath("$.id").value(id));

        for (Account who : new Account[] { alice, bob }) {
            mvc.perform(auth(get("/api/conversations/" + conv + "/messages"), who)).andExpect(jsonPath("$.items", hasSize(1)))
                    .andExpect(jsonPath("$.items[0].content").value("hello world")).andExpect(jsonPath("$.items[0].editedAt").isNotEmpty());
        }
    }

    @Test
    void aMessageNeverEditedHasNoEditedMark_AndSavingTheSameTextChangesNothing() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = conversation(alice, bob);
        long id = send(alice, conv, "as it is");
        mvc.perform(auth(get("/api/conversations/" + conv + "/messages"), bob)).andExpect(jsonPath("$.items[0].editedAt").doesNotExist());

        mvc.perform(json(auth(patch(url(conv, id)), alice), "{\"content\":\"as it is\"}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.editedAt").doesNotExist());
    }

    @Test
    void onlyTheSenderMayEditAndOnlyInTheirOwnConversation() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long conv = conversation(alice, bob);
        long other = conversation(alice, carol);
        long id = send(alice, conv, "mine");
        long elsewhere = send(alice, other, "in another chat");

        edit(bob, conv, id, "not yours", 403);   // the other participant
        edit(carol, conv, id, "not yours", 404); // not in the conversation at all
        edit(alice, conv, 999999999L, "x", 404); // no such message
        edit(alice, conv, elsewhere, "x", 404);  // a message of another conversation, even her own
        assertThat(jdbc.queryForObject("select content from messages where id = ?", String.class, id)).isEqualTo("mine");
        mvc.perform(json(patch(url(conv, id)), "{\"content\":\"anon\"}")).andExpect(status().isUnauthorized());
    }

    @Test
    void editsAreValidated() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = conversation(alice, bob);
        long id = send(alice, conv, "fine");

        edit(alice, conv, id, "", 400);
        edit(alice, conv, id, "   ", 400);
        edit(alice, conv, id, "x".repeat(2001), 400);
        mvc.perform(json(auth(patch(url(conv, id)), alice), "{}")).andExpect(status().isBadRequest());
        edit(alice, conv, id, "x".repeat(2000), 200);
    }

    @Test
    void aBlockedPairCannotEditOrDelete() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = conversation(alice, bob);
        long id = send(alice, conv, "before the block");
        mvc.perform(auth(post("/api/users/" + bob.username() + "/block"), alice)).andExpect(status().isNoContent());

        edit(alice, conv, id, "after the block", 403);
        mvc.perform(auth(delete(url(conv, id)), alice)).andExpect(status().isForbidden());
    }

    // --- deleting ---

    @Test
    void deletingErasesTheTextForBothPeopleAndKeepsAPlaceholder() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = conversation(alice, bob);
        send(alice, conv, "first");
        long id = send(alice, conv, "secret text");
        send(alice, conv, "third");

        mvc.perform(auth(delete(url(conv, id)), alice)).andExpect(status().isNoContent());

        for (Account who : new Account[] { alice, bob }) {
            mvc.perform(auth(get("/api/conversations/" + conv + "/messages"), who)).andExpect(jsonPath("$.items", hasSize(3)))
                    .andExpect(jsonPath("$.items[1].id").value(id)).andExpect(jsonPath("$.items[1].deleted").value(true))
                    .andExpect(jsonPath("$.items[1].content").value(""))
                    .andExpect(jsonPath("$.items[0].deleted").value(false)).andExpect(jsonPath("$.items[2].deleted").value(false));
        }
        // Really gone from the database, not just hidden.
        assertThat(jdbc.queryForObject("select content from messages where id = ?", String.class, id)).isEmpty();
    }

    @Test
    void deletingTwiceIsHarmlessAndADeletedMessageCannotBeEdited() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = conversation(alice, bob);
        long id = send(alice, conv, "oops");

        mvc.perform(auth(delete(url(conv, id)), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(delete(url(conv, id)), alice)).andExpect(status().isNoContent());
        edit(alice, conv, id, "bring it back", 409);
        assertThat(jdbc.queryForObject("select content from messages where id = ?", String.class, id)).isEmpty();
    }

    @Test
    void onlyTheSenderMayDelete() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long conv = conversation(alice, bob);
        long id = send(alice, conv, "mine");

        mvc.perform(auth(delete(url(conv, id)), bob)).andExpect(status().isForbidden());
        mvc.perform(auth(delete(url(conv, id)), carol)).andExpect(status().isNotFound());
        mvc.perform(auth(delete(url(conv, 999999999L)), alice)).andExpect(status().isNotFound());
        mvc.perform(delete(url(conv, id))).andExpect(status().isUnauthorized());
        assertThat(jdbc.queryForObject("select deleted from messages where id = ?", Boolean.class, id)).isFalse();
    }

    // --- unread counts and the inbox ---

    @Test
    void aDeletedMessageNoLongerCountsAsUnread() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = conversation(alice, bob);
        send(alice, conv, "one");
        long second = send(alice, conv, "two");
        mvc.perform(auth(get("/api/conversations/unread-count"), bob)).andExpect(jsonPath("$.count").value(2));

        mvc.perform(auth(delete(url(conv, second)), alice)).andExpect(status().isNoContent());

        mvc.perform(auth(get("/api/conversations/unread-count"), bob)).andExpect(jsonPath("$.count").value(1));
        mvc.perform(auth(get("/api/conversations/" + conv + "/unread-count"), bob)).andExpect(jsonPath("$.count").value(1));
        mvc.perform(auth(get("/api/conversations"), bob)).andExpect(jsonPath("$.items[0].unreadCount").value(1));
        mvc.perform(auth(get("/api/conversations/" + conv), bob)).andExpect(jsonPath("$.unreadCount").value(1));
    }

    @Test
    void theInboxShowsTheNewTextOrAPlaceholderForTheLastMessage() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = conversation(alice, bob);
        long id = send(alice, conv, "typo hrere");

        edit(alice, conv, id, "typo here", 200);
        mvc.perform(auth(get("/api/conversations"), bob)).andExpect(jsonPath("$.items[0].lastMessage.content").value("typo here"))
                .andExpect(jsonPath("$.items[0].lastMessage.deleted").value(false));

        mvc.perform(auth(delete(url(conv, id)), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/conversations"), bob)).andExpect(jsonPath("$.items[0].lastMessage.deleted").value(true))
                .andExpect(jsonPath("$.items[0].lastMessage.content").value(""));
        mvc.perform(auth(get("/api/conversations/" + conv), alice)).andExpect(jsonPath("$.lastMessage.deleted").value(true));
    }
}
