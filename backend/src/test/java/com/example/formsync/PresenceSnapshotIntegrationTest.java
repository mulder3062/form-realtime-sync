package com.example.formsync;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.messaging.converter.MappingJackson2MessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import org.springframework.web.socket.sockjs.client.SockJsClient;
import org.springframework.web.socket.sockjs.client.Transport;
import org.springframework.web.socket.sockjs.client.WebSocketTransport;

import java.lang.reflect.Type;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 접속 스냅샷에 "이미 들어와 있는 참가자"가 담겨 내려오는지 검증 (명세 §4.2).
 * 작성자 → 상담사1 → 상담사2 순서로 접속할 때, 나중에 들어온 클라이언트의 스냅샷에
 * 기존 접속자가 모두 포함돼야 한다(presence가 clientId 단위로 N명 표시되기 위한 전제).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PresenceSnapshotIntegrationTest {

    @LocalServerPort
    int port;

    private WebSocketStompClient newClient() {
        List<Transport> transports = List.of(new WebSocketTransport(new StandardWebSocketClient()));
        WebSocketStompClient client = new WebSocketStompClient(new SockJsClient(transports));
        client.setMessageConverter(new MappingJackson2MessageConverter());
        return client;
    }

    /** 한 클라이언트의 접속 결과: 받은 스냅샷의 participants */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> connectAndCapture(String formId, String clientId, String role)
            throws Exception {
        WebSocketStompClient client = newClient();
        BlockingQueue<Map<String, Object>> snapshots = new LinkedBlockingQueue<>();
        WebSocketHttpHeaders handshake = new WebSocketHttpHeaders();

        StompSession session = client
                .connectAsync("http://localhost:" + port + "/ws", handshake,
                        new StompSessionHandlerAdapter() {})
                .get(5, TimeUnit.SECONDS);

        // (1) 토픽 먼저 구독 → (2) 스냅샷 구독(@SubscribeMapping 응답 수신)
        session.subscribe("/topic/form/" + formId, new StompFrameHandler() {
            @Override public Type getPayloadType(StompHeaders headers) { return Map.class; }
            @Override public void handleFrame(StompHeaders headers, Object payload) { /* 이벤트 무시 */ }
        });
        session.subscribe("/app/form/" + formId + "/snapshot", new StompFrameHandler() {
            @Override public Type getPayloadType(StompHeaders headers) { return Map.class; }
            @Override public void handleFrame(StompHeaders headers, Object payload) {
                snapshots.add((Map<String, Object>) payload);
            }
        });

        Map<String, Object> snap = snapshots.poll(5, TimeUnit.SECONDS);
        assertThat(snap).as("스냅샷이 수신돼야 한다").isNotNull();

        // USER_JOIN 전송 → 서버가 세션 등록(이후 접속자의 스냅샷에 포함되도록)
        session.send("/app/form/" + formId + "/event", Map.of(
                "type", "USER_JOIN",
                "clientId", clientId,
                "role", role,
                "payload", Map.of()));
        // 등록이 반영될 시간을 잠깐 준다(다음 클라이언트 접속 전).
        Thread.sleep(300);

        Object participants = snap.get("participants");
        return participants == null ? List.of() : (List<Map<String, Object>>) participants;
    }

    @Test
    void snapshot_includes_existing_participants() throws Exception {
        String formId = "test-" + System.nanoTime();

        // 작성자 접속 → 첫 접속이라 기존 참가자 없음
        List<Map<String, Object>> authorSnap = connectAndCapture(formId, "client-author", "AUTHOR");
        assertThat(authorSnap).isEmpty();

        // 상담사1 접속 → 스냅샷에 작성자 1명이 보여야 한다
        List<Map<String, Object>> c1Snap = connectAndCapture(formId, "client-c1", "COUNSELOR");
        assertThat(c1Snap).extracting(p -> p.get("clientId")).containsExactly("client-author");

        // 상담사2 접속 → 스냅샷에 작성자 + 상담사1 = 2명이 보여야 한다
        List<Map<String, Object>> c2Snap = connectAndCapture(formId, "client-c2", "COUNSELOR");
        assertThat(c2Snap).extracting(p -> p.get("clientId"))
                .containsExactlyInAnyOrder("client-author", "client-c1");
    }
}
