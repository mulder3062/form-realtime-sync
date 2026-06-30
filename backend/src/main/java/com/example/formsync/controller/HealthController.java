package com.example.formsync.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Render 등 PaaS의 Health Check용 엔드포인트.
 *
 * Render는 설정된 Health Check Path(예: /healthz)가 200을 반환해야
 * 서비스를 live로 간주한다. 200이 아니면 배포가 unhealthy로 실패한다.
 */
@RestController
public class HealthController {

    @GetMapping("/healthz")
    public Map<String, String> healthz() {
        return Map.of("status", "ok");
    }
}
