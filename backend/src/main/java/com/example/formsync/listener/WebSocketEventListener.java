package com.example.formsync.listener;

import com.example.formsync.model.FormEvent;
import com.example.formsync.model.FormState;
import com.example.formsync.model.SessionInfo;
import com.example.formsync.session.FormSessionRegistry;
import com.example.formsync.store.FormStore;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

/**
 * disconnect 처리: presence(USER_LEAVE) + 락 자동 해제 (명세 §4.6, §8.6).
 * 락 보유 클라이언트가 끊기면 해당 락을 해제해 데드락을 방지한다.
 */
@Component
public class WebSocketEventListener {

    private final FormStore formStore;
    private final FormSessionRegistry sessionRegistry;
    private final SimpMessagingTemplate messagingTemplate;

    public WebSocketEventListener(FormStore formStore,
                                  FormSessionRegistry sessionRegistry,
                                  SimpMessagingTemplate messagingTemplate) {
        this.formStore = formStore;
        this.sessionRegistry = sessionRegistry;
        this.messagingTemplate = messagingTemplate;
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        String sessionId = StompHeaderAccessor.wrap(event.getMessage()).getSessionId();
        SessionInfo info = sessionRegistry.remove(sessionId);
        if (info == null) {
            return;
        }
        FormState state = formStore.getOrCreate(info.formId());
        state.releaseLocksOf(info.clientId());
        messagingTemplate.convertAndSend(
                "/topic/form/" + info.formId(),
                FormEvent.userLeave(info.clientId(), info.role()));
    }
}
