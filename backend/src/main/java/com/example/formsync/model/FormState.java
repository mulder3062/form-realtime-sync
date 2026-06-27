package com.example.formsync.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Getter;
import lombok.Setter;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 서버 인메모리 Source of Truth (명세 §4.1, §4.2).
 *
 * 단순 답변값뿐 아니라 현재 페이지/포커스/제출여부/락까지 포함해야
 * 스냅샷(신규·재연결)이 "A가 보던 화면 그대로"를 복원할 수 있다.
 *
 * 주의: ConcurrentHashMap은 맵 구조만 보호한다(명세 §8.1). 2명 시나리오라 내부 필드
 * 동시 변경 충돌 확률은 낮으므로 필드 단위 락은 두지 않는다.
 */
@Getter
@JsonIgnoreProperties(ignoreUnknown = true)
public class FormState {

    private final String formId;

    /** questionId → value (문자열 또는 문자열 배열) */
    private final Map<String, Object> answers = new ConcurrentHashMap<>();

    /** questionId → 점유 중인 clientId (텍스트 필드 소프트 락, 명세 §5.2) */
    private final Map<String, String> locks = new ConcurrentHashMap<>();

    @Setter
    private volatile int currentPage = 1;

    @Setter
    private volatile String focusedQuestionId = null;

    @Setter
    private volatile boolean submitted = false;

    public FormState(String formId) {
        this.formId = formId;
    }

    public static FormState empty(String formId) {
        return new FormState(formId);
    }

    public void putAnswer(String questionId, Object value) {
        if (questionId == null) return;
        if (value == null) {
            answers.remove(questionId);
        } else {
            answers.put(questionId, value);
        }
    }

    public void lock(String questionId, String clientId) {
        if (questionId != null && clientId != null) {
            locks.put(questionId, clientId);
        }
    }

    public void unlock(String questionId) {
        if (questionId != null) {
            locks.remove(questionId);
        }
    }

    /** disconnect 시 해당 클라이언트가 보유한 모든 락 해제 (데드락 방지, 명세 §5.2/§8.6) */
    public void releaseLocksOf(String clientId) {
        if (clientId == null) return;
        locks.values().removeIf(clientId::equals);
    }
}
