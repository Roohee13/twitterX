package com.project.Xclone_backend.report;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.project.Xclone_backend.common.CursorPage;
import com.project.Xclone_backend.report.ReportDtos.AdminPostReportResponse;
import com.project.Xclone_backend.report.ReportDtos.AdminUserReportResponse;
import com.project.Xclone_backend.report.ReportDtos.NoteRequest;
import com.project.Xclone_backend.report.ReportDtos.ReportFilter;
import com.project.Xclone_backend.report.ReportDtos.UpdateReportStatusRequest;
import com.project.Xclone_backend.security.AuthUser;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

/** Report review for admins; every endpoint answers 403 to everyone else. */
@RestController
@RequestMapping("/api/admin")
@RequiredArgsConstructor
public class AdminReportController {

    private final AdminReportService service;

    @GetMapping("/reports/users")
    public CursorPage<AdminUserReportResponse> userReports(@AuthenticationPrincipal AuthUser me,
            @RequestParam(defaultValue = "OPEN") ReportFilter status, @RequestParam(required = false) Long cursor,
            @RequestParam(required = false) Integer limit) {
        return service.userReports(me.id(), status, cursor, limit);
    }

    @GetMapping("/reports/posts")
    public CursorPage<AdminPostReportResponse> postReports(@AuthenticationPrincipal AuthUser me,
            @RequestParam(defaultValue = "OPEN") ReportFilter status, @RequestParam(required = false) Long cursor,
            @RequestParam(required = false) Integer limit) {
        return service.postReports(me.id(), status, cursor, limit);
    }

    @PatchMapping("/reports/users/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void setUserReportStatus(@PathVariable Long id, @AuthenticationPrincipal AuthUser me,
            @Valid @RequestBody UpdateReportStatusRequest req) {
        service.setUserReportStatus(me.id(), id, req.status(), req.note());
    }

    @PatchMapping("/reports/posts/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void setPostReportStatus(@PathVariable Long id, @AuthenticationPrincipal AuthUser me,
            @Valid @RequestBody UpdateReportStatusRequest req) {
        service.setPostReportStatus(me.id(), id, req.status(), req.note());
    }

    @PostMapping("/posts/{postId}/remove")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removePost(@PathVariable Long postId, @AuthenticationPrincipal AuthUser me,
            @Valid @RequestBody(required = false) NoteRequest req) {
        service.removePost(me.id(), postId, note(req));
    }

    @PostMapping("/users/{userId}/suspend")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void suspendUser(@PathVariable Long userId, @AuthenticationPrincipal AuthUser me,
            @Valid @RequestBody(required = false) NoteRequest req) {
        service.suspendUser(me.id(), userId, note(req));
    }

    @PostMapping("/users/{userId}/unsuspend")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unsuspendUser(@PathVariable Long userId, @AuthenticationPrincipal AuthUser me) {
        service.unsuspendUser(me.id(), userId);
    }

    @PostMapping("/users/{userId}/remove")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeUser(@PathVariable Long userId, @AuthenticationPrincipal AuthUser me,
            @Valid @RequestBody(required = false) NoteRequest req) {
        service.removeUser(me.id(), userId, note(req));
    }

    private static String note(NoteRequest req) {
        return req == null ? null : req.note();
    }
}
