package com.project.Xclone_backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
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

/** "Reposted by": the people behind a post's repost count. Uses the same mocked beans as AdminReportsTest so both share one Spring context. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RepostersListTest {

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

    private long createPost(Account author, String json) throws Exception {
        String res = mvc.perform(auth(post("/api/posts"), author).contentType(MediaType.APPLICATION_JSON).content(json)).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private void repost(Account who, long postId) throws Exception {
        mvc.perform(auth(post("/api/posts/" + postId + "/repost"), who)).andExpect(status().isNoContent());
    }

    private List<String> usernames(Account viewer, long postId) throws Exception {
        String res = mvc.perform(viewer == null ? get("/api/posts/" + postId + "/reposts?limit=50") : auth(get("/api/posts/" + postId + "/reposts?limit=50"), viewer))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return JsonPath.read(res, "$.items[*].username");
    }

    @Test
    void listsTheRepostersNewestFirstAndMatchesTheCount() throws Exception {
        Account author = register();
        Account first = register();
        Account second = register();
        Account third = register();
        long postId = createPost(author, "{\"content\":\"repost me\"}");
        repost(first, postId);
        repost(second, postId);
        repost(third, postId);

        assertThat(usernames(author, postId)).containsExactly(third.username(), second.username(), first.username());
        mvc.perform(auth(get("/api/posts/" + postId), author)).andExpect(jsonPath("$.repostCount").value(3));
        mvc.perform(auth(get("/api/posts/" + postId + "/reposts"), author)).andExpect(jsonPath("$.items[0].displayName").value("Test User"))
                .andExpect(jsonPath("$.items[0].id").value(third.id())).andExpect(jsonPath("$.items[0].unavailable").value(false));
    }

    @Test
    void anAnonymousVisitorCanSeeThemToo() throws Exception {
        Account author = register();
        Account reposter = register();
        long postId = createPost(author, "{\"content\":\"public\"}");
        repost(reposter, postId);

        assertThat(usernames(null, postId)).containsExactly(reposter.username());
    }

    @Test
    void anUndoneRepostLeavesTheListAndARepostComesBackOnTop() throws Exception {
        Account author = register();
        Account a = register();
        Account b = register();
        long postId = createPost(author, "{\"content\":\"flip\"}");
        repost(a, postId);
        repost(b, postId);

        mvc.perform(auth(delete("/api/posts/" + postId + "/repost"), a)).andExpect(status().isNoContent());
        assertThat(usernames(author, postId)).containsExactly(b.username());

        repost(a, postId);
        assertThat(usernames(author, postId)).containsExactly(a.username(), b.username());
    }

    @Test
    void aQuotePostIsNotARepost() throws Exception {
        Account author = register();
        Account reposter = register();
        Account quoter = register();
        long postId = createPost(author, "{\"content\":\"quote or repost\"}");
        repost(reposter, postId);
        createPost(quoter, "{\"content\":\"my take\",\"quotedPostId\":" + postId + "}");

        assertThat(usernames(author, postId)).containsExactly(reposter.username());
    }

    @Test
    void blockedInactiveAndHiddenProtectedRepostersAreLeftOut() throws Exception {
        Account author = register();
        Account viewer = register();
        Account visible = register();
        Account blockedByViewer = register();
        Account blocksViewer = register();
        Account leaver = register();
        Account secret = register();
        long postId = createPost(author, "{\"content\":\"popular\"}");
        for (Account a : List.of(visible, blockedByViewer, blocksViewer, leaver, secret)) {
            repost(a, postId);
        }
        mvc.perform(auth(post("/api/users/" + blockedByViewer.username() + "/block"), viewer)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/" + viewer.username() + "/block"), blocksViewer)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/users/me/deactivate"), leaver)).andExpect(status().isNoContent());
        mvc.perform(auth(patch("/api/users/me"), secret).contentType(MediaType.APPLICATION_JSON).content("{\"protectedAccount\":true}")).andExpect(status().isOk());

        assertThat(usernames(viewer, postId)).containsExactly(visible.username());

        // The protected person appears once the viewer follows them (and is approved), and always to themselves.
        mvc.perform(auth(post("/api/users/" + secret.username() + "/follow"), viewer)).andExpect(status().isAccepted());
        mvc.perform(auth(post("/api/users/me/follow-requests/" + viewer.username() + "/approve"), secret)).andExpect(status().isNoContent());
        assertThat(usernames(viewer, postId)).containsExactly(secret.username(), visible.username());
        assertThat(usernames(secret, postId)).contains(secret.username());
    }

    @Test
    void aReposterWhoDeactivatesDisappearsAndReturnsWhenTheySignInAgain() throws Exception {
        Account author = register();
        Account reposter = register();
        long postId = createPost(author, "{\"content\":\"come and go\"}");
        repost(reposter, postId);
        mvc.perform(auth(post("/api/users/me/deactivate"), reposter)).andExpect(status().isNoContent());
        assertThat(usernames(author, postId)).isEmpty();

        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{\"usernameOrEmail\":\"" + reposter.username() + "\",\"password\":\"password123\"}"))
                .andExpect(status().isOk());

        assertThat(usernames(author, postId)).containsExactly(reposter.username());
    }

    @Test
    void pagingWalksTheWholeListWithoutRepeats() throws Exception {
        Account author = register();
        long postId = createPost(author, "{\"content\":\"many reposts\"}");
        List<String> expected = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            Account a = register();
            repost(a, postId);
            expected.add(0, a.username()); // newest first
        }

        List<String> seen = new ArrayList<>();
        Long cursor = null;
        do {
            String res = mvc.perform(auth(get("/api/posts/" + postId + "/reposts?limit=2" + (cursor == null ? "" : "&cursor=" + cursor)), author))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            seen.addAll(JsonPath.<List<String>>read(res, "$.items[*].username"));
            Number next = JsonPath.read(res, "$.nextCursor");
            cursor = next == null ? null : next.longValue();
        } while (cursor != null);

        assertThat(seen).containsExactlyElementsOf(expected);
    }

    @Test
    void anUnknownDeletedOrHiddenPostIs404() throws Exception {
        Account author = register();
        Account stranger = register();
        long deleted = createPost(author, "{\"content\":\"soon gone\"}");
        mvc.perform(auth(delete("/api/posts/" + deleted), author)).andExpect(status().isNoContent());
        mvc.perform(auth(patch("/api/users/me"), author).contentType(MediaType.APPLICATION_JSON).content("{\"protectedAccount\":true}")).andExpect(status().isOk());
        long hidden = createPost(author, "{\"content\":\"protected post\"}");

        mvc.perform(auth(get("/api/posts/" + deleted + "/reposts"), stranger)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/posts/999999999/reposts"), stranger)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/posts/" + hidden + "/reposts"), stranger)).andExpect(status().isForbidden());
        mvc.perform(auth(get("/api/posts/" + hidden + "/reposts"), author)).andExpect(status().isOk()).andExpect(jsonPath("$.items", hasSize(0)));
    }
}
