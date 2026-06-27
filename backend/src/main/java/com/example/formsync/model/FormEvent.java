package com.example.formsync.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * STOMP로 오가는 동기화 메시지 (명세 §5).
 * 모든 메시지는 발신자 식별을 위해 {@code clientId}(UUID)와 {@code role}('A'|'B')을 포함한다.
 * 무한 루프 방지 가드는 역할이 아니라 {@code clientId}로 한다(명세 §4.4).
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record FormEvent(
        EventType type,
        String clientId,
        String role,
        Payload payload
) {
    public static FormEvent userLeave(String clientId, String role) {
        return new FormEvent(EventType.USER_LEAVE, clientId, role, Payload.empty());
    }
}
