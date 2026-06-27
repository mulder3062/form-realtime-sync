package com.example.formsync.controller;

import com.example.formsync.model.FormEvent;
import com.example.formsync.model.FormSnapshot;
import com.example.formsync.model.FormState;
import com.example.formsync.session.FormSessionRegistry;
import com.example.formsync.store.FormStore;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.annotation.SubscribeMapping;
import org.springframework.stereotype.Controller;

/**
 * 스냅샷 핸드셰이크 + 이벤트 브로드캐스트 (명세 §8.4, §8.5).
 *
 * clientId는 클라이언트 payload에서 그대로 사용한다(Principal 미사용 → NPE 회피, 명세 §4.4).
 */
@Controller
public class FormSyncController {

    private final FormStore formStore;
    private final FormSessionRegistry sessionRegistry;

    public FormSyncController(FormStore formStore, FormSessionRegistry sessionRegistry) {
        this.formStore = formStore;
        this.sessionRegistry = sessionRegistry;
    }

    /**
     * 구독 시 현재 전체 상태(값+페이지+포커스+락+제출)와 현재 접속자 목록을 1회 직접 응답한다(명세 §4.2).
     * 클라이언트는 /topic 구독을 먼저 건 뒤 이 목적지를 구독해 스냅샷을 받는다(레이스 컨디션 방지).
     * 이 시점엔 신규 접속자의 USER_JOIN 등록 전이라 participants에는 "기존 접속자"만 담긴다.
     */
    @SubscribeMapping("/form/{formId}/snapshot")
    public FormSnapshot onSubscribe(@DestinationVariable String formId) {
        return new FormSnapshot(formStore.getOrCreate(formId), sessionRegistry.participants(formId));
    }

    /**
     * 모든 데이터/네비게이션 이벤트는 서버 상태에 반영한 뒤 구독자 전원에게 브로드캐스트한다.
     * 상태 갱신을 빠뜨리면 신규/재연결 스냅샷이 옛 값을 내려보내 화면이 영구히 어긋난다(명세 §4.1).
     */
    @MessageMapping("/form/{formId}/event")
    @SendTo("/topic/form/{formId}")
    public FormEvent handleEvent(@DestinationVariable String formId,
                                 @Payload FormEvent event,
                                 SimpMessageHeaderAccessor accessor) {
        FormState state = formStore.getOrCreate(formId);
        var p = event.payload();

        switch (event.type()) {
            case PAGE_CHANGE    -> state.setCurrentPage(p.page() == null ? state.getCurrentPage() : p.page());
            case FOCUS_QUESTION -> state.setFocusedQuestionId(p.questionId());
            case FIELD_UPDATE   -> state.putAnswer(p.questionId(), p.value());
            case FIELD_LOCK     -> state.lock(p.questionId(), event.clientId());
            case FIELD_UNLOCK   -> state.unlock(p.questionId());
            case FORM_SUBMITTED -> state.setSubmitted(true);
            case USER_JOIN      -> sessionRegistry.register(
                    accessor.getSessionId(), formId, event.clientId(), event.role());
            // SUBMIT_REQUEST / USER_LEAVE 는 상태 갱신 없이 릴레이만
            default -> { }
        }
        return event; // 구독자 전원에게 브로드캐스트 (수신 측은 clientId로 자기 자신 무시)
    }
}
