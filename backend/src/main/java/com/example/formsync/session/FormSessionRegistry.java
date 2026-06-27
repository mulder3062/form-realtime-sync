package com.example.formsync.session;

import com.example.formsync.model.SessionInfo;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 어떤 사용자가 어떤 폼에 연결됐는지 추적 (명세 §8.3).
 * disconnect 시 sessionId만으로 formId/clientId/role을 역추적해 락 해제 + presence 처리에 사용.
 */
@Component
public class FormSessionRegistry {

    /** formId → 연결된 sessionId 집합 */
    private final Map<String, Set<String>> formSessions = new ConcurrentHashMap<>();

    /** sessionId → SessionInfo (disconnect 역추적용) */
    private final Map<String, SessionInfo> sessionIndex = new ConcurrentHashMap<>();

    public void register(String sessionId, String formId, String clientId, String role) {
        if (sessionId == null || formId == null) return;
        sessionIndex.put(sessionId, new SessionInfo(formId, clientId, role));
        formSessions.computeIfAbsent(formId, k -> ConcurrentHashMap.newKeySet()).add(sessionId);
    }

    /** 세션 제거 후 해당 세션의 정보를 반환(없으면 null) */
    public SessionInfo remove(String sessionId) {
        SessionInfo info = sessionIndex.remove(sessionId);
        if (info != null) {
            Set<String> sessions = formSessions.get(info.formId());
            if (sessions != null) {
                sessions.remove(sessionId);
                if (sessions.isEmpty()) {
                    formSessions.remove(info.formId());
                }
            }
        }
        return info;
    }
}
