package com.project.Xclone_backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.junit.jupiter.api.Assertions.assertEquals;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.jayway.jsonpath.JsonPath;
import com.project.Xclone_backend.auth.EmailSender;

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** Report review for admins: who may use it, what it lists, how reports are handled, and removing a reported post. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AdminReportsTest {

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

    private Account admin() throws Exception {
        Account a = register();
        jdbc.update("update users set is_admin = true where id = ?", a.id());
        return a;
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder b, Account a) {
        return b.header("Authorization", "Bearer " + a.token());
    }

    private MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder b, String body) {
        return b.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private long createPost(Account author, String content) throws Exception {
        String res = mvc.perform(json(auth(post("/api/posts"), author), "{\"content\":\"" + content + "\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(res, "$.id")).longValue();
    }

    private void reportPost(Account reporter, long postId, String reason) throws Exception {
        mvc.perform(json(auth(post("/api/posts/" + postId + "/report"), reporter), "{\"reason\":\"" + reason + "\"}"))
                .andExpect(status().isNoContent());
    }

    private void reportUser(Account reporter, Account target, String reason) throws Exception {
        mvc.perform(json(auth(post("/api/users/" + target.username() + "/report"), reporter), "{\"reason\":\"" + reason + "\"}"))
                .andExpect(status().isNoContent());
    }

    private long reportIdForPost(long postId, Account reporter) {
        return jdbc.queryForObject("select id from post_reports where post_id = ? and reporter_id = ?", Long.class, postId, reporter.id());
    }

    private long reportIdForUser(Account target, Account reporter) {
        return jdbc.queryForObject("select id from user_reports where reported_user_id = ? and reporter_id = ?", Long.class, target.id(), reporter.id());
    }

    // --- who may use it ---

    @Test
    void onlyAdminsCanUseTheAdminEndpoints() throws Exception {
        Account normal = register();
        for (MockHttpServletRequestBuilder request : List.<MockHttpServletRequestBuilder>of(get("/api/admin/reports/users"),
                get("/api/admin/reports/posts"), json(patch("/api/admin/reports/users/1"), "{\"status\":\"DISMISSED\"}"),
                json(patch("/api/admin/reports/posts/1"), "{\"status\":\"DISMISSED\"}"), post("/api/admin/posts/1/remove"))) {
            mvc.perform(request).andExpect(status().isUnauthorized());
        }
        mvc.perform(auth(get("/api/admin/reports/users"), normal)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail").value("Admins only"));
        mvc.perform(auth(get("/api/admin/reports/posts"), normal)).andExpect(status().isForbidden());
        mvc.perform(json(auth(patch("/api/admin/reports/users/1"), normal), "{\"status\":\"DISMISSED\"}")).andExpect(status().isForbidden());
        mvc.perform(auth(post("/api/admin/posts/1/remove"), normal)).andExpect(status().isForbidden());
    }

    @Test
    void accessFollowsTheFlagInTheDatabaseSoARevokedAdminLosesItAtOnce() throws Exception {
        Account a = admin();
        mvc.perform(auth(get("/api/admin/reports/users"), a)).andExpect(status().isOk());

        jdbc.update("update users set is_admin = false where id = ?", a.id());

        mvc.perform(auth(get("/api/admin/reports/users"), a)).andExpect(status().isForbidden());
    }

    @Test
    void meReportsWhetherYouAreAnAdmin() throws Exception {
        mvc.perform(auth(get("/api/users/me"), admin())).andExpect(jsonPath("$.admin").value(true));
        mvc.perform(auth(get("/api/users/me"), register())).andExpect(jsonPath("$.admin").value(false));
    }

    // --- listing ---

    @Test
    void listsAccountReportsWithTheReporterTheReasonAndHowManyReportsTheAccountHas() throws Exception {
        Account admin = admin();
        Account target = register();
        Account first = register();
        Account second = register();
        reportUser(first, target, "SPAM");
        reportUser(second, target, "HARASSMENT");

        String body = mvc.perform(auth(get("/api/admin/reports/users?limit=50"), admin)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        List<String> reporters = JsonPath.read(body, "$.items[?(@.reportedUser.username=='" + target.username() + "')].reporter.username");
        assertEquals(List.of(second.username(), first.username()), reporters); // newest first
        List<String> reasons = JsonPath.read(body, "$.items[?(@.reportedUser.username=='" + target.username() + "')].reason");
        assertEquals(List.of("HARASSMENT", "SPAM"), reasons);
        List<Integer> totals = JsonPath.read(body, "$.items[?(@.reportedUser.username=='" + target.username() + "')].totalReports");
        assertEquals(List.of(2, 2), totals);
        List<String> status = JsonPath.read(body, "$.items[?(@.reportedUser.username=='" + target.username() + "')].status");
        assertEquals(List.of("OPEN", "OPEN"), status);
    }

    @Test
    void listsPostReportsWithTheContentTheAuthorAndHowManyReportsThePostHas() throws Exception {
        Account admin = admin();
        Account author = register();
        Account r1 = register();
        Account r2 = register();
        long postId = createPost(author, "a reported post");
        reportPost(r1, postId, "SPAM");
        reportPost(r2, postId, "VIOLENCE");

        String body = mvc.perform(auth(get("/api/admin/reports/posts?limit=50"), admin)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        List<String> contents = JsonPath.read(body, "$.items[?(@.post.id==" + postId + ")].post.content");
        assertEquals(List.of("a reported post", "a reported post"), contents);
        List<String> authors = JsonPath.read(body, "$.items[?(@.post.id==" + postId + ")].post.author.username");
        assertEquals(List.of(author.username(), author.username()), authors);
        List<Integer> totals = JsonPath.read(body, "$.items[?(@.post.id==" + postId + ")].totalReports");
        assertEquals(List.of(2, 2), totals);
        List<Boolean> removed = JsonPath.read(body, "$.items[?(@.post.id==" + postId + ")].post.removed");
        assertEquals(List.of(false, false), removed);
    }

    @Test
    void pagesThroughReportsByCursor() throws Exception {
        Account admin = admin();
        Account target = register();
        for (int i = 0; i < 3; i++) {
            reportUser(register(), target, "SPAM");
        }
        // Only this page's own reports matter, so walk the pages and count the ones about this account.
        int seen = 0;
        Long cursor = null;
        do {
            String body = mvc.perform(auth(get("/api/admin/reports/users?limit=2" + (cursor == null ? "" : "&cursor=" + cursor)), admin))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            List<?> mine = JsonPath.read(body, "$.items[?(@.reportedUser.username=='" + target.username() + "')]");
            seen += mine.size();
            Number next = JsonPath.read(body, "$.nextCursor");
            cursor = next == null ? null : next.longValue();
        } while (cursor != null && seen < 3);
        assertEquals(3, seen);
    }

    @Test
    void filtersByOpenHandledOrAll() throws Exception {
        Account admin = admin();
        Account target = register();
        Account r1 = register();
        Account r2 = register();
        reportUser(r1, target, "SPAM");
        reportUser(r2, target, "OTHER");
        mvc.perform(json(auth(patch("/api/admin/reports/users/" + reportIdForUser(target, r1)), admin), "{\"status\":\"DISMISSED\"}"))
                .andExpect(status().isNoContent());

        String open = mvc.perform(auth(get("/api/admin/reports/users?status=OPEN&limit=50"), admin)).andReturn().getResponse().getContentAsString();
        String handled = mvc.perform(auth(get("/api/admin/reports/users?status=HANDLED&limit=50"), admin)).andReturn().getResponse().getContentAsString();
        String all = mvc.perform(auth(get("/api/admin/reports/users?status=ALL&limit=50"), admin)).andReturn().getResponse().getContentAsString();

        String filter = "$.items[?(@.reportedUser.username=='" + target.username() + "')].reporter.username";
        assertEquals(List.of(r2.username()), JsonPath.read(open, filter));
        assertEquals(List.of(r1.username()), JsonPath.read(handled, filter));
        assertEquals(2, ((List<?>) JsonPath.read(all, filter)).size());
        mvc.perform(auth(get("/api/admin/reports/users?status=NONSENSE"), admin)).andExpect(status().isBadRequest());
    }

    // --- handling ---

    @Test
    void dismissingResolvingAndReopeningRecordWhoDidItAndWhen() throws Exception {
        Account admin = admin();
        Account target = register();
        Account reporter = register();
        reportUser(reporter, target, "SPAM");
        long id = reportIdForUser(target, reporter);
        String path = "/api/admin/reports/users/" + id;

        mvc.perform(json(auth(patch(path), admin), "{\"status\":\"RESOLVED\"}")).andExpect(status().isNoContent());
        assertEquals("RESOLVED", jdbc.queryForObject("select status from user_reports where id = ?", String.class, id));
        assertEquals(admin.id(), jdbc.queryForObject("select handled_by from user_reports where id = ?", Long.class, id));
        assertEquals(Boolean.TRUE, jdbc.queryForObject("select handled_at is not null from user_reports where id = ?", Boolean.class, id));
        String handled = mvc.perform(auth(get("/api/admin/reports/users?status=HANDLED&limit=50"), admin)).andReturn().getResponse().getContentAsString();
        assertEquals(List.of(admin.username()), JsonPath.read(handled, "$.items[?(@.id==" + id + ")].handledBy.username"));

        mvc.perform(json(auth(patch(path), admin), "{\"status\":\"DISMISSED\"}")).andExpect(status().isNoContent());
        assertEquals("DISMISSED", jdbc.queryForObject("select status from user_reports where id = ?", String.class, id));

        mvc.perform(json(auth(patch(path), admin), "{\"status\":\"OPEN\"}")).andExpect(status().isNoContent());
        assertEquals("OPEN", jdbc.queryForObject("select status from user_reports where id = ?", String.class, id));
        assertEquals(Boolean.TRUE, jdbc.queryForObject("select handled_by is null and handled_at is null from user_reports where id = ?", Boolean.class, id));
    }

    @Test
    void postReportsCanBeHandledToo() throws Exception {
        Account admin = admin();
        Account author = register();
        Account reporter = register();
        long postId = createPost(author, "needs a look");
        reportPost(reporter, postId, "MISINFORMATION");
        long id = reportIdForPost(postId, reporter);

        mvc.perform(json(auth(patch("/api/admin/reports/posts/" + id), admin), "{\"status\":\"DISMISSED\"}")).andExpect(status().isNoContent());

        assertEquals("DISMISSED", jdbc.queryForObject("select status from post_reports where id = ?", String.class, id));
        // Dismissing a report does not touch the post itself.
        mvc.perform(get("/api/posts/" + postId)).andExpect(status().isOk());
    }

    @Test
    void unknownReportsAndBadStatusesAreRejected() throws Exception {
        Account admin = admin();
        mvc.perform(json(auth(patch("/api/admin/reports/users/999999999"), admin), "{\"status\":\"DISMISSED\"}")).andExpect(status().isNotFound());
        mvc.perform(json(auth(patch("/api/admin/reports/posts/999999999"), admin), "{\"status\":\"OPEN\"}")).andExpect(status().isNotFound());
        mvc.perform(json(auth(patch("/api/admin/reports/users/1"), admin), "{\"status\":\"BANNED\"}")).andExpect(status().isBadRequest());
        mvc.perform(json(auth(patch("/api/admin/reports/users/1"), admin), "{}")).andExpect(status().isBadRequest());
    }

    // --- removing a post ---

    @Test
    void removingAReportedPostHidesItFromEveryoneAndResolvesAllItsOpenReports() throws Exception {
        Account admin = admin();
        Account author = register();
        Account r1 = register();
        Account r2 = register();
        Account follower = register();
        mvc.perform(auth(post("/api/users/" + author.username() + "/follow"), follower)).andExpect(status().isNoContent());
        long postId = createPost(author, "this will be removed");
        reportPost(r1, postId, "SPAM");
        reportPost(r2, postId, "HARASSMENT");
        mvc.perform(json(auth(patch("/api/admin/reports/posts/" + reportIdForPost(postId, r1)), admin), "{\"status\":\"DISMISSED\"}"))
                .andExpect(status().isNoContent()); // a report handled earlier stays as it was
        mvc.perform(auth(get("/api/timeline"), follower)).andExpect(jsonPath("$.items", hasSize(1)));

        mvc.perform(auth(post("/api/admin/posts/" + postId + "/remove"), admin)).andExpect(status().isNoContent());

        mvc.perform(get("/api/posts/" + postId)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/timeline"), follower)).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(auth(get("/api/users/" + author.username() + "/posts"), follower)).andExpect(jsonPath("$.items", hasSize(0)));
        assertEquals("DISMISSED", jdbc.queryForObject("select status from post_reports where id = ?", String.class, reportIdForPost(postId, r1)));
        assertEquals("RESOLVED", jdbc.queryForObject("select status from post_reports where id = ?", String.class, reportIdForPost(postId, r2)));
        assertEquals(admin.id(), jdbc.queryForObject("select handled_by from post_reports where id = ?", Long.class, reportIdForPost(postId, r2)));

        // The admin still sees what was removed, flagged as removed.
        String body = mvc.perform(auth(get("/api/admin/reports/posts?status=ALL&limit=50"), admin)).andReturn().getResponse().getContentAsString();
        assertEquals(List.of(true, true), JsonPath.read(body, "$.items[?(@.post.id==" + postId + ")].post.removed"));
        assertEquals(List.of("this will be removed", "this will be removed"), JsonPath.read(body, "$.items[?(@.post.id==" + postId + ")].post.content"));
    }

    @Test
    void removingTwiceIsHarmlessAndAReplyKeepsItsParentsCountRight() throws Exception {
        Account admin = admin();
        Account author = register();
        Account replier = register();
        long parent = createPost(author, "parent post");
        mvc.perform(json(auth(post("/api/posts"), replier), "{\"content\":\"a reply\",\"replyToId\":" + parent + "}")).andExpect(status().isCreated());
        long replyId = jdbc.queryForObject("select id from posts where parent_id = ?", Long.class, parent);
        reportPost(author, replyId, "SPAM");
        mvc.perform(get("/api/posts/" + parent)).andExpect(jsonPath("$.replyCount").value(1));

        mvc.perform(auth(post("/api/admin/posts/" + replyId + "/remove"), admin)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/admin/posts/" + replyId + "/remove"), admin)).andExpect(status().isNoContent());

        mvc.perform(get("/api/posts/" + parent)).andExpect(jsonPath("$.replyCount").value(0)); // lowered once, not twice
    }

    @Test
    void removingAnUnknownPostIs404AndOnlyAdminsMayDoIt() throws Exception {
        mvc.perform(auth(post("/api/admin/posts/999999999/remove"), admin())).andExpect(status().isNotFound());
        Account author = register();
        long postId = createPost(author, "safe from non-admins");
        mvc.perform(auth(post("/api/admin/posts/" + postId + "/remove"), register())).andExpect(status().isForbidden());
        mvc.perform(get("/api/posts/" + postId)).andExpect(status().isOk());
    }

    @Test
    void removalTakesTheLikeNotificationsAwayAndLeavesOnlyTheRemovalNotice() throws Exception {
        Account admin = admin();
        Account author = register();
        Account fan = register();
        long postId = createPost(author, "popular post");
        mvc.perform(auth(post("/api/posts/" + postId + "/like"), fan)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/notifications/unread-count"), author)).andExpect(jsonPath("$.count").value(1));

        mvc.perform(auth(post("/api/admin/posts/" + postId + "/remove"), admin)).andExpect(status().isNoContent());

        mvc.perform(auth(get("/api/notifications"), author)).andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1)).andExpect(jsonPath("$.items[0].type").value("POST_REMOVED"));
    }

    // --- moderation notifications ---

    private String notificationsOf(Account a) throws Exception {
        return mvc.perform(auth(get("/api/notifications"), a)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    private int countOfType(Account a, String type) throws Exception {
        return ((List<?>) JsonPath.read(notificationsOf(a), "$.items[?(@.type=='" + type + "')]")).size();
    }

    private String emailAddress(Account a) {
        return a.username() + "@example.com";
    }

    @Test
    void aNewReportAlertsEveryAdminOnceNotNormalUsersAndNotForEachFurtherReport() throws Exception {
        Account admin1 = admin();
        Account admin2 = admin();
        Account bystander = register();
        Account author = register();
        Account r1 = register();
        Account r2 = register();
        long postId = createPost(author, "reported twice");

        reportPost(r1, postId, "SPAM");
        reportPost(r2, postId, "HARASSMENT");

        for (Account a : List.of(admin1, admin2)) {
            assertThat(countOfType(a, "REPORT_RECEIVED")).isEqualTo(1);
            mvc.perform(auth(get("/api/notifications"), a)).andExpect(jsonPath("$.items[0].actor").doesNotExist())
                    .andExpect(jsonPath("$.items[0].detail").value(org.hamcrest.Matchers.containsString("@" + author.username())));
            verify(emailSender).send(eq(emailAddress(a)), eq("New report to review"), anyString());
        }
        assertThat(countOfType(bystander, "REPORT_RECEIVED")).isZero();
        verify(emailSender, never()).send(eq(emailAddress(bystander)), eq("New report to review"), anyString());
    }

    @Test
    void aNewAccountReportAlertsAdminsToo() throws Exception {
        Account admin = admin();
        Account target = register();
        reportUser(register(), target, "SPAM");
        assertThat(countOfType(admin, "REPORT_RECEIVED")).isEqualTo(1);
        mvc.perform(auth(get("/api/notifications"), admin))
                .andExpect(jsonPath("$.items[0].detail").value(org.hamcrest.Matchers.containsString("account @" + target.username())));
    }

    @Test
    void removingAPostTellsTheAuthorWithTheNoteAndTheReportersTheOutcome() throws Exception {
        Account admin = admin();
        Account author = register();
        Account reporter = register();
        long postId = createPost(author, "bad post");
        reportPost(reporter, postId, "HARASSMENT");

        mvc.perform(json(auth(post("/api/admin/posts/" + postId + "/remove"), admin), "{\"note\":\"Targeted harassment\"}"))
                .andExpect(status().isNoContent());

        mvc.perform(auth(get("/api/notifications"), author)).andExpect(jsonPath("$.items[0].type").value("POST_REMOVED"))
                .andExpect(jsonPath("$.items[0].actor").doesNotExist())
                .andExpect(jsonPath("$.items[0].detail").value(org.hamcrest.Matchers.containsString("Targeted harassment")));
        verify(emailSender).send(eq(emailAddress(author)), eq("Your post was removed"),
                org.mockito.ArgumentMatchers.contains("Targeted harassment"));
        mvc.perform(auth(get("/api/notifications"), reporter)).andExpect(jsonPath("$.items[0].type").value("REPORT_OUTCOME"))
                .andExpect(jsonPath("$.items[0].detail").value(org.hamcrest.Matchers.containsString("we took action")));
        // The reporter is never given the admin's note about someone else's post.
        mvc.perform(auth(get("/api/notifications"), reporter))
                .andExpect(jsonPath("$.items[0].detail").value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("harassment"))));
    }

    @Test
    void removingTheSamePostAgainTellsNobodyAgain() throws Exception {
        Account admin = admin();
        Account author = register();
        long postId = createPost(author, "once only");
        mvc.perform(auth(post("/api/admin/posts/" + postId + "/remove"), admin)).andExpect(status().isNoContent());
        mvc.perform(auth(post("/api/admin/posts/" + postId + "/remove"), admin)).andExpect(status().isNoContent());
        assertThat(countOfType(author, "POST_REMOVED")).isEqualTo(1);
    }

    @Test
    void dismissingAndResolvingTellTheReporterTheOutcomeOnce() throws Exception {
        Account admin = admin();
        Account target = register();
        Account r1 = register();
        Account r2 = register();
        reportUser(r1, target, "SPAM");
        reportUser(r2, target, "HARASSMENT");

        mvc.perform(json(auth(patch("/api/admin/reports/users/" + reportIdForUser(target, r1)), admin), "{\"status\":\"DISMISSED\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(json(auth(patch("/api/admin/reports/users/" + reportIdForUser(target, r2)), admin), "{\"status\":\"RESOLVED\",\"note\":\"warned\"}"))
                .andExpect(status().isNoContent());
        // Setting the same status again is not news.
        mvc.perform(json(auth(patch("/api/admin/reports/users/" + reportIdForUser(target, r1)), admin), "{\"status\":\"DISMISSED\"}"))
                .andExpect(status().isNoContent());

        mvc.perform(auth(get("/api/notifications"), r1)).andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].detail").value(org.hamcrest.Matchers.containsString("took no action")));
        mvc.perform(auth(get("/api/notifications"), r2)).andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].detail").value(org.hamcrest.Matchers.containsString("we took action")));
        verify(emailSender).send(eq(emailAddress(r1)), eq("Update on your report"), anyString());
        assertThat(jdbc.queryForObject("select admin_note from user_reports where id = ?", String.class, reportIdForUser(target, r2)))
                .isEqualTo("warned");
    }

    @Test
    void aPostReportOutcomeReachesTheReporter() throws Exception {
        Account admin = admin();
        Account author = register();
        Account reporter = register();
        long postId = createPost(author, "fine post");
        reportPost(reporter, postId, "SPAM");
        mvc.perform(json(auth(patch("/api/admin/reports/posts/" + reportIdForPost(postId, reporter)), admin), "{\"status\":\"DISMISSED\"}"))
                .andExpect(status().isNoContent());
        assertThat(countOfType(reporter, "REPORT_OUTCOME")).isEqualTo(1);
        assertThat(countOfType(author, "POST_REMOVED")).isZero();
    }

    // --- suspending and removing accounts ---

    @Test
    void suspendingBlocksSignInEndsTheSessionHidesTheAccountAndResolvesItsReports() throws Exception {
        Account admin = admin();
        Account target = register();
        Account reporter = register();
        long postId = createPost(target, "visible until suspended");
        reportUser(reporter, target, "HARASSMENT");
        mvc.perform(auth(get("/api/posts/" + postId), reporter)).andExpect(status().isOk());

        mvc.perform(json(auth(post("/api/admin/users/" + target.id() + "/suspend"), admin), "{\"note\":\"Repeated abuse\"}"))
                .andExpect(status().isNoContent());

        mvc.perform(json(post("/api/auth/login"), "{\"usernameOrEmail\":\"" + target.username() + "\",\"password\":\"password123\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.detail").value("Account suspended"));
        mvc.perform(json(post("/api/auth/login"), "{\"usernameOrEmail\":\"" + target.username() + "\",\"password\":\"wrong-password\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(auth(get("/api/users/me"), target)).andExpect(status().isUnauthorized());
        mvc.perform(auth(get("/api/users/" + target.username()), reporter)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/posts/" + postId), reporter)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/api/posts/search").param("q", "visible until suspended"), reporter))
                .andExpect(jsonPath("$.items.length()").value(0));
        assertThat(jdbc.queryForObject("select status from user_reports where reported_user_id = ?", String.class, target.id()))
                .isEqualTo("RESOLVED");
        assertThat(countOfType(reporter, "REPORT_OUTCOME")).isEqualTo(1);
        verify(emailSender).send(eq(emailAddress(target)), eq("Your account was suspended"),
                org.mockito.ArgumentMatchers.contains("Repeated abuse"));
    }

    @Test
    void unsuspendingRestoresSignInAndVisibility() throws Exception {
        Account admin = admin();
        Account target = register();
        long postId = createPost(target, "back again");
        mvc.perform(auth(post("/api/admin/users/" + target.id() + "/suspend"), admin)).andExpect(status().isNoContent());

        mvc.perform(auth(post("/api/admin/users/" + target.id() + "/unsuspend"), admin)).andExpect(status().isNoContent());

        mvc.perform(json(post("/api/auth/login"), "{\"usernameOrEmail\":\"" + target.username() + "\",\"password\":\"password123\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/users/" + target.username())).andExpect(status().isOk());
        mvc.perform(get("/api/posts/" + postId)).andExpect(status().isOk());
        verify(emailSender).send(eq(emailAddress(target)), eq("Your account is active again"), anyString());
    }

    @Test
    void removingAnAccountAnonymizesItEmailsTheUserFirstAndCannotBeUndone() throws Exception {
        Account admin = admin();
        Account target = register();
        Account reporter = register();
        long postId = createPost(target, "gone with the account");
        reportUser(reporter, target, "MISINFORMATION");

        mvc.perform(json(auth(post("/api/admin/users/" + target.id() + "/remove"), admin), "{\"note\":\"Fake account\"}"))
                .andExpect(status().isNoContent());

        assertThat(jdbc.queryForObject("select status from users where id = ?", String.class, target.id())).isEqualTo("DELETED");
        assertThat(jdbc.queryForObject("select username from users where id = ?", String.class, target.id())).isEqualTo("~" + target.id());
        mvc.perform(auth(get("/api/posts/" + postId), reporter)).andExpect(status().isNotFound());
        mvc.perform(json(post("/api/auth/login"), "{\"usernameOrEmail\":\"" + target.username() + "\",\"password\":\"password123\"}"))
                .andExpect(status().isUnauthorized());
        verify(emailSender).send(eq(emailAddress(target)), eq("Your account was removed"), org.mockito.ArgumentMatchers.contains("Fake account"));
        assertThat(countOfType(reporter, "REPORT_OUTCOME")).isEqualTo(1);
        // Removing it again, or lifting a suspension that never was, finds nothing.
        mvc.perform(auth(post("/api/admin/users/" + target.id() + "/remove"), admin)).andExpect(status().isNotFound());
    }

    @Test
    void onlyAdminsMaySuspendOrRemoveAndNeverAdminsOrThemselves() throws Exception {
        Account admin = admin();
        Account otherAdmin = admin();
        Account normal = register();
        Account target = register();
        for (String action : List.of("suspend", "unsuspend", "remove")) {
            mvc.perform(post("/api/admin/users/" + target.id() + "/" + action)).andExpect(status().isUnauthorized());
            mvc.perform(auth(post("/api/admin/users/" + target.id() + "/" + action), normal)).andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.detail").value("Admins only"));
            mvc.perform(auth(post("/api/admin/users/" + otherAdmin.id() + "/" + action), admin)).andExpect(status().isForbidden());
            mvc.perform(auth(post("/api/admin/users/" + admin.id() + "/" + action), admin)).andExpect(status().isForbidden());
            mvc.perform(auth(post("/api/admin/users/999999999/" + action), admin)).andExpect(status().isNotFound());
        }
        assertThat(jdbc.queryForObject("select status from users where id = ?", String.class, target.id())).isEqualTo("ACTIVE");
    }

    @Test
    void listedAccountReportsShowWhetherTheAccountIsSuspended() throws Exception {
        Account admin = admin();
        Account target = register();
        reportUser(register(), target, "SPAM");
        mvc.perform(auth(get("/api/admin/reports/users"), admin)).andExpect(jsonPath("$.items[0].reportedUserStatus").value("ACTIVE"));
        mvc.perform(auth(post("/api/admin/users/" + target.id() + "/suspend"), admin)).andExpect(status().isNoContent());
        mvc.perform(auth(get("/api/admin/reports/users").param("status", "ALL"), admin))
                .andExpect(jsonPath("$.items[0].reportedUserStatus").value("SUSPENDED"));
    }

    // --- visibility and edge cases ---

    @Test
    void anAdminSeesAProtectedAccountsReportedPostThatAStrangerCannot() throws Exception {
        Account admin = admin();
        Account priv = register();
        Account reporter = register();
        Account stranger = register();
        mvc.perform(json(auth(patch("/api/users/me"), priv), "{\"protectedAccount\":true}")).andExpect(status().isOk());
        long postId = createPost(priv, "for approved followers only");
        mvc.perform(auth(post("/api/users/" + priv.username() + "/follow"), reporter)).andExpect(status().isAccepted());
        jdbc.update("insert into follows (follower_id, followee_id, created_at) values (?, ?, now())", reporter.id(), priv.id());
        reportPost(reporter, postId, "SPAM");

        mvc.perform(auth(get("/api/posts/" + postId), stranger)).andExpect(status().isForbidden());
        String body = mvc.perform(auth(get("/api/admin/reports/posts?limit=50"), admin)).andReturn().getResponse().getContentAsString();

        assertEquals(List.of("for approved followers only"), JsonPath.read(body, "$.items[?(@.post.id==" + postId + ")].post.content"));
    }

    @Test
    void reportsStillListWhenTheReporterOrTheReportedAccountDeletedTheirAccount() throws Exception {
        Account admin = admin();
        Account target = register();
        Account reporter = register();
        reportUser(reporter, target, "SPAM");
        mvc.perform(json(auth(delete("/api/users/me"), reporter), "{\"password\":\"password123\"}")).andExpect(status().isNoContent());

        String body = mvc.perform(auth(get("/api/admin/reports/users?limit=50"), admin)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();

        List<String> reporters = JsonPath.read(body, "$.items[?(@.reportedUser.username=='" + target.username() + "')].reporter.displayName");
        assertEquals(List.of("Deleted user"), reporters);
    }

    @Test
    void newReportsStartOpenAndNothingChangesForTheReportedAccount() throws Exception {
        Account target = register();
        Account reporter = register();
        reportUser(reporter, target, "SPAM");

        assertEquals("OPEN", jdbc.queryForObject("select status from user_reports where reported_user_id = ?", String.class, target.id()));
        assertEquals(Boolean.TRUE, jdbc.queryForObject("select handled_by is null from user_reports where reported_user_id = ?", Boolean.class, target.id()));
        mvc.perform(get("/api/users/" + target.username())).andExpect(status().isOk()).andExpect(jsonPath("$.protectedAccount").value(false));
        mvc.perform(auth(get("/api/users/me"), target)).andExpect(jsonPath("$.admin").value(false)); // being reported grants and removes nothing
    }
}
