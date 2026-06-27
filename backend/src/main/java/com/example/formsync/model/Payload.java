package com.example.formsync.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 모든 이벤트가 공유하는 payload. 이벤트 타입별로 사용하는 필드만 채워지고 나머지는 null이다.
 * - PAGE_CHANGE: page
 * - FOCUS_QUESTION / FIELD_LOCK / FIELD_UNLOCK: questionId
 * - FIELD_UPDATE: questionId, type, value (value는 문자열 또는 문자열 배열(멀티선택))
 * - FORM_SUBMITTED: submittedAt
 * - SUBMIT_REQUEST / USER_*: 비어 있음
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public record Payload(
        Integer page,
        String questionId,
        String type,
        Object value,
        String submittedAt
) {
    public static Payload empty() {
        return new Payload(null, null, null, null, null);
    }
}
