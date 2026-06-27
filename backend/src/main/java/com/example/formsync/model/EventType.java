package com.example.formsync.model;

/**
 * 동기화 이벤트 타입 (명세 §5).
 * 상태 갱신 대상과 단순 릴레이 대상이 섞여 있다(분기는 {@code FormSyncController} 참조).
 */
public enum EventType {
    PAGE_CHANGE,
    FOCUS_QUESTION,
    FIELD_UPDATE,
    FIELD_LOCK,
    FIELD_UNLOCK,
    SUBMIT_REQUEST,
    FORM_SUBMITTED,
    USER_JOIN,
    USER_LEAVE
}
