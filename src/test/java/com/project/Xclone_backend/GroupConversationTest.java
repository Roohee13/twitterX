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
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.jayway.jsonpath.JsonPath;
import com.project.Xclone_backend.auth.EmailSender;
import com.project.Xclone_backend.conversation.ConversationUpdatedEvent;
import com.project.Xclone_backend.message.MessageChangedEvent;
import com.project.Xclone_backend.message.MessageSentEvent;

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * Group chats: creating one, who can do what, how messages reach every member, and each member's own unread count and history.
 * Uses the same mocked beans as ConversationDeleteTest so both share one Spring context.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@RecordApplicationEvents
class GroupConversationTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    ApplicationEvents events;

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

    private static String names(Account... accounts) {
        return String.join(",", java.util.Arrays.stream(accounts).map(a -> "\"" + a.username() + "\"").toList());
    }

    private long createGroup(Account owner, String title, Account... others) throws Exception {
        String res = mvc.perform(auth(post("/api/conversations/groups"), owner).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"" + title + "\",\"usernames\":[" + names(others) + "]}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
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

    private void addMembers(Account by, long conv, Account... added) throws Exception {
        mvc.perform(auth(post("/api/conversations/" + conv + "/members"), by).contentType(MediaType.APPLICATION_JSON)
                .content("{\"usernames\":[" + names(added) + "]}")).andExpect(status().isOk());
    }

    @Test
    void creatingAGroupReturnsItAndTellsTheOtherMembers() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();

        mvc.perform(auth(post("/api/conversations/groups"), alice).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"  Weekend plans \",\"usernames\":[" + names(bob, carol, bob) + "]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.type").value("GROUP"))
                .andExpect(jsonPath("$.title").value("Weekend plans"))
                .andExpect(jsonPath("$.memberCount").value(3))
                .andExpect(jsonPath("$.participant").value(nullValue()))
                .andExpect(jsonPath("$.lastMessage").value(nullValue()));

        List<Long> told = events.stream(ConversationUpdatedEvent.class).map(ConversationUpdatedEvent::recipientId).toList();
        assertThat(told).contains(bob.id(), carol.id()).doesNotContain(alice.id());
    }

    @Test
    void aGroupNeedsAnameAndSomeoneElse() throws Exception {
        Account alice = register();
        Account bob = register();
        mvc.perform(auth(post("/api/conversations/groups"), alice).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"   \",\"usernames\":[" + names(bob) + "]}")).andExpect(status().isBadRequest());
        mvc.perform(auth(post("/api/conversations/groups"), alice).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Solo\",\"usernames\":[]}")).andExpect(status().isBadRequest());
        mvc.perform(auth(post("/api/conversations/groups"), alice).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Just me\",\"usernames\":[" + names(alice) + "]}")).andExpect(status().isBadRequest());
        mvc.perform(auth(post("/api/conversations/groups"), alice).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Ghosts\",\"usernames\":[\"nobody_here_x\"]}")).andExpect(status().isNotFound());
    }

    @Test
    void youCannotStartAGroupWithSomeoneWhoBlockedYouOrYouBlocked() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        mvc.perform(auth(post("/api/users/" + bob.username() + "/block"), alice)).andExpect(status().is2xxSuccessful());

        mvc.perform(auth(post("/api/conversations/groups"), alice).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Nope\",\"usernames\":[" + names(carol, bob) + "]}")).andExpect(status().isForbidden());
        mvc.perform(auth(post("/api/conversations/groups"), bob).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Nope\",\"usernames\":[" + names(alice) + "]}")).andExpect(status().isForbidden());
    }

    @Test
    void aMessageReachesEveryOtherMemberAndOnlyMembersCanSeeOrWrite() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        Account outsider = register();
        long conv = createGroup(alice, "Team", bob, carol);

        long id = send(alice, conv, "hello team");

        List<Long> recipients = events.stream(MessageSentEvent.class)
                .filter(e -> e.message().id() == id).map(MessageSentEvent::recipientId).toList();
        assertThat(recipients).containsExactlyInAnyOrder(bob.id(), carol.id());
        assertThat(texts(bob, conv)).containsExactly("hello team");
        assertThat(texts(carol, conv)).containsExactly("hello team");

        mvc.perform(auth(get("/api/conversations/" + conv), outsider)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/conversations/" + conv + "/messages"), outsider)).andExpect(status().isNotFound());
        mvc.perform(auth(post("/api/conversations/" + conv + "/messages"), outsider).contentType(MediaType.APPLICATION_JSON).content("{\"content\":\"let me in\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/conversations/" + conv + "/members"), outsider)).andExpect(status().isNotFound());
    }

    @Test
    void theGroupAppearsInEachMembersInboxWithTheSendersNameAndTheirOwnUnreadCount() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long conv = createGroup(alice, "Inbox group", bob, carol);
        send(alice, conv, "one");
        send(bob, conv, "two");

        mvc.perform(auth(get("/api/conversations"), carol)).andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].id").value(conv)).andExpect(jsonPath("$.items[0].type").value("GROUP"))
                .andExpect(jsonPath("$.items[0].title").value("Inbox group")).andExpect(jsonPath("$.items[0].memberCount").value(3))
                .andExpect(jsonPath("$.items[0].lastMessage.content").value("two"))
                .andExpect(jsonPath("$.items[0].lastMessage.senderName").value("Test User"))
                .andExpect(jsonPath("$.items[0].unreadCount").value(2));
        // Their own messages never count as unread for the sender.
        mvc.perform(auth(get("/api/conversations/" + conv + "/unread-count"), alice)).andExpect(jsonPath("$.count").value(1));
        mvc.perform(auth(get("/api/conversations/" + conv + "/unread-count"), bob)).andExpect(jsonPath("$.count").value(1));
    }

    @Test
    void readingIsPerMemberAndTheTotalBadgeIncludesGroups() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long conv = createGroup(alice, "Reads", bob, carol);
        send(alice, conv, "first");
        send(alice, conv, "second");
        mvc.perform(auth(get("/api/conversations/unread-count"), bob)).andExpect(jsonPath("$.count").value(2));

        mvc.perform(auth(post("/api/conversations/" + conv + "/read"), bob)).andExpect(status().isNoContent());

        mvc.perform(auth(get("/api/conversations/" + conv + "/unread-count"), bob)).andExpect(jsonPath("$.count").value(0));
        mvc.perform(auth(get("/api/conversations/unread-count"), bob)).andExpect(jsonPath("$.count").value(0));
        // Carol has not read anything: Bob reading does not change what she sees.
        mvc.perform(auth(get("/api/conversations/" + conv + "/unread-count"), carol)).andExpect(jsonPath("$.count").value(2));
        mvc.perform(auth(get("/api/conversations/unread-count"), carol)).andExpect(jsonPath("$.count").value(2));

        send(alice, conv, "third");
        mvc.perform(auth(get("/api/conversations/" + conv + "/unread-count"), bob)).andExpect(jsonPath("$.count").value(1));
        mvc.perform(auth(get("/api/conversations/" + conv), bob)).andExpect(jsonPath("$.unreadCount").value(1));
    }

    @Test
    void aNewMemberOnlySeesWhatIsSaidAfterTheyJoin() throws Exception {
        Account alice = register();
        Account bob = register();
        Account dave = register();
        long conv = createGroup(alice, "History", bob);
        send(alice, conv, "before dave");
        send(bob, conv, "also before dave");

        addMembers(bob, conv, dave); // any member can add people
        mvc.perform(auth(get("/api/conversations/" + conv + "/unread-count"), dave)).andExpect(jsonPath("$.count").value(0));
        assertThat(texts(dave, conv)).isEmpty();
        mvc.perform(auth(get("/api/conversations"), dave)).andExpect(jsonPath("$.items", hasSize(0)));

        send(alice, conv, "after dave");
        assertThat(texts(dave, conv)).containsExactly("after dave");
        assertThat(texts(alice, conv)).containsExactly("before dave", "also before dave", "after dave");
        mvc.perform(auth(get("/api/conversations/" + conv + "/members"), dave)).andExpect(jsonPath("$", hasSize(3)));
    }

    @Test
    void addingSomeoneAlreadyInTheGroupChangesNothingAndBlockedPeopleCannotBeAdded() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long conv = createGroup(alice, "Adds", bob);
        mvc.perform(auth(post("/api/conversations/" + conv + "/members"), alice).contentType(MediaType.APPLICATION_JSON)
                .content("{\"usernames\":[" + names(bob) + "]}")).andExpect(status().isOk()).andExpect(jsonPath("$", hasSize(2)));

        mvc.perform(auth(post("/api/users/" + carol.username() + "/block"), alice)).andExpect(status().is2xxSuccessful());
        mvc.perform(auth(post("/api/conversations/" + conv + "/members"), alice).contentType(MediaType.APPLICATION_JSON)
                .content("{\"usernames\":[" + names(carol) + "]}")).andExpect(status().isForbidden());
    }

    @Test
    void aGroupHasAtMostFiftyMembers() throws Exception {
        Account alice = register();
        Account[] others = new Account[49];
        for (int i = 0; i < others.length; i++) {
            others[i] = register();
        }
        long conv = createGroup(alice, "Full house", others); // 50 with the owner
        mvc.perform(auth(post("/api/conversations/" + conv + "/members"), alice).contentType(MediaType.APPLICATION_JSON)
                .content("{\"usernames\":[" + names(register()) + "]}")).andExpect(status().isBadRequest());
    }

    @Test
    void onlyTheOwnerRenamesOrRemovesPeople() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long conv = createGroup(alice, "Old name", bob, carol);

        mvc.perform(auth(patch("/api/conversations/" + conv), bob).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"Bob's name\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(auth(delete("/api/conversations/" + conv + "/members/" + carol.id()), bob)).andExpect(status().isForbidden());

        mvc.perform(auth(patch("/api/conversations/" + conv), alice).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"New name\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.title").value("New name"));
        mvc.perform(auth(get("/api/conversations/" + conv), carol)).andExpect(jsonPath("$.title").value("New name"));

        mvc.perform(auth(delete("/api/conversations/" + conv + "/members/" + alice.id()), alice)).andExpect(status().isBadRequest());
        mvc.perform(auth(delete("/api/conversations/" + conv + "/members/" + carol.id()), alice)).andExpect(status().isNoContent());
        mvc.perform(auth(delete("/api/conversations/" + conv + "/members/" + carol.id()), alice)).andExpect(status().isNotFound());

        // Carol is out: no access, and she was told so.
        mvc.perform(auth(get("/api/conversations/" + conv), carol)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/conversations/" + conv + "/messages"), carol)).andExpect(status().isNotFound());
        assertThat(events.stream(ConversationUpdatedEvent.class)
                .filter(e -> e.recipientId().equals(carol.id()) && e.update().removed()).count()).isEqualTo(1);
        mvc.perform(auth(get("/api/conversations/" + conv + "/members"), alice)).andExpect(jsonPath("$", hasSize(2)));
    }

    @Test
    void leavingPassesOwnershipToTheLongestStandingMember() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long conv = createGroup(alice, "Handover", bob, carol);

        mvc.perform(auth(post("/api/conversations/" + conv + "/leave"), alice)).andExpect(status().isNoContent());

        mvc.perform(auth(get("/api/conversations/" + conv), alice)).andExpect(status().isNotFound());
        mvc.perform(auth(patch("/api/conversations/" + conv), carol).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"Carol's\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(auth(patch("/api/conversations/" + conv), bob).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"Bob's now\"}"))
                .andExpect(status().isOk());
        mvc.perform(auth(get("/api/conversations/" + conv + "/members"), carol)).andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].role").value("OWNER"));
        // What Alice wrote stays for those who remain, and she gets nothing new.
        send(bob, conv, "still here");
        assertThat(texts(carol, conv)).containsExactly("still here");
        mvc.perform(auth(post("/api/conversations/" + conv + "/leave"), alice)).andExpect(status().isNotFound());
    }

    @Test
    void editingAndDeletingAGroupMessageTellsEveryoneElse() throws Exception {
        Account alice = register();
        Account bob = register();
        Account carol = register();
        long conv = createGroup(alice, "Changes", bob, carol);
        long id = send(alice, conv, "typo");

        mvc.perform(auth(patch("/api/conversations/" + conv + "/messages/" + id), alice).contentType(MediaType.APPLICATION_JSON).content("{\"content\":\"fixed\"}"))
                .andExpect(status().isOk());
        mvc.perform(auth(patch("/api/conversations/" + conv + "/messages/" + id), bob).contentType(MediaType.APPLICATION_JSON).content("{\"content\":\"hijack\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(auth(delete("/api/conversations/" + conv + "/messages/" + id), alice)).andExpect(status().isNoContent());

        List<Long> told = events.stream(MessageChangedEvent.class).filter(e -> e.message().id() == id).map(MessageChangedEvent::recipientId).toList();
        assertThat(told).containsExactlyInAnyOrder(bob.id(), carol.id(), bob.id(), carol.id()); // once for the edit, once for the delete
        assertThat(texts(bob, conv)).containsExactly("");
    }

    @Test
    void deletingAGroupConversationClearsOnlyMyViewAndTheGroupComesBackWithNewMessages() throws Exception {
        Account alice = register();
        Account bob = register();
        long conv = createGroup(alice, "Clearing", bob);
        send(alice, conv, "old");
        mvc.perform(auth(get("/api/conversations/unread-count"), bob)).andExpect(jsonPath("$.count").value(1));

        mvc.perform(auth(delete("/api/conversations/" + conv), bob)).andExpect(status().isNoContent());

        mvc.perform(auth(get("/api/conversations"), bob)).andExpect(jsonPath("$.items", hasSize(0)));
        assertThat(texts(bob, conv)).isEmpty();
        mvc.perform(auth(get("/api/conversations/unread-count"), bob)).andExpect(jsonPath("$.count").value(0));
        assertThat(texts(alice, conv)).containsExactly("old");

        send(alice, conv, "new");
        assertThat(texts(bob, conv)).containsExactly("new");
        mvc.perform(auth(get("/api/conversations"), bob)).andExpect(jsonPath("$.items", hasSize(1))).andExpect(jsonPath("$.items[0].unreadCount").value(1));
    }

    @Test
    void groupActionsDoNotApplyToADirectConversation() throws Exception {
        Account alice = register();
        Account bob = register();
        String res = mvc.perform(auth(post("/api/conversations"), alice).contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"" + bob.username() + "\"}"))
                .andReturn().getResponse().getContentAsString();
        long direct = ((Number) JsonPath.read(res, "$.id")).longValue();

        mvc.perform(auth(patch("/api/conversations/" + direct), alice).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"Renamed\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/conversations/" + direct + "/members"), alice)).andExpect(status().isNotFound());
        mvc.perform(auth(post("/api/conversations/" + direct + "/leave"), alice)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/conversations/" + direct), alice)).andExpect(jsonPath("$.type").value("DIRECT"))
                .andExpect(jsonPath("$.title").value(nullValue())).andExpect(jsonPath("$.participant.username").value(bob.username()));
    }
}
