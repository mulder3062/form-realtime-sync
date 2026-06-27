package com.example.formsync.model;

/**
 * WebSocket 세션 → (formId, clientId, role) 역추적용 (명세 §8.3).
 * disconnect 시 어떤 폼의 어떤 클라이언트가 빠졌는지 알아내 락 해제 + presence 브로드캐스트에 사용.
 */
public record SessionInfo(String formId, String clientId, String role) {
}
