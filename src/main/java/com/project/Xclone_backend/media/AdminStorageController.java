package com.project.Xclone_backend.media;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.project.Xclone_backend.media.StorageCheckDtos.StorageCheckRequest;
import com.project.Xclone_backend.media.StorageCheckDtos.StorageCheckResponse;
import com.project.Xclone_backend.report.AdminGuard;
import com.project.Xclone_backend.security.AuthUser;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

/** An admin's "is image storage set up correctly?" check. Always answers 200 with the list of steps; {@code ok} says whether all passed. */
@RestController
@RequestMapping("/api/admin/storage")
@RequiredArgsConstructor
public class AdminStorageController {

    private final AdminGuard adminGuard;
    private final StorageCheckService service;

    @PostMapping("/check")
    public StorageCheckResponse check(@AuthenticationPrincipal AuthUser me, @Valid @RequestBody(required = false) StorageCheckRequest req) {
        adminGuard.requireAdmin(me.id());
        return service.check(me.id(), req == null ? null : req.browserTestKey());
    }
}
