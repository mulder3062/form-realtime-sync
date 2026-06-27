# 실시간 동기화 폼 서비스 프로토타입 구현 명세서

> Google Forms 형태의 폼 서비스 + 작성자(A)·상담사(B) 간 실시간 화면 미러링/데이터 동기화
> **프로토타입 단계** (DB 미사용, 인메모리 상태 관리)

---

## 1. 프로젝트 개요

작성자(A)가 폼 작성 중 상담사(B)에게 도움을 요청하면, B가 폼 ID로 접속하여 **동일한 폼 화면을 공유**하고 양방향으로 컨트롤·편집을 동기화하는 서비스.

### 핵심 시나리오

1. A가 폼 작성 중 궁금한 사항이 생겨 상담사 B에게 전화
2. B가 폼 ID 입력 후 접속 → A가 작성 중이던 **현재 상태 그대로**(값 + 현재 페이지 + 포커스) 화면에 표시
3. B의 폼 컨트롤이 A에게 동기화
   - 페이지 이동 → A 화면도 같은 페이지로 이동
   - N번 문항 선택/포커스 → A 화면도 해당 문항으로 스크롤
4. B의 문항 편집 → A 화면에 반영
5. **폼 제출은 작성 주체인 A만 수행** → B는 A에게 제출 요청만 전송, A 화면에 확인 모달이 떠 A가 직접 확정 (자세히는 §5.1)
6. **위 모든 동기화는 A가 조작한 경우에도 B에게 동일하게 적용** (양방향, 단 제출 확정 권한은 A 단방향)

### 통신 단절/재연결 시나리오 (추가 커버)

7. A 또는 B의 연결이 끊겼다 다시 붙으면, 재접속자는 **신규 접속과 동일하게 서버의 현재 전체 스냅샷을 다시 수신**하여 자동으로 정합성을 회복 (자세히는 §4.6)

---

## 형상관리
git mono repo

Frontend는 'frontend', Backend는 'backend'으로 경로 생성

## 2. 기술 스택
세부 버전은 2026년 6월 시점의 최신 안정화 버전을 사용한다.

- Node.js 22
- java 21

| 영역 | 기술 |
|---|---|
| Frontend | Next.js |
| UI | Shadcn/ui |
| 실시간 통신 | WebSocket (STOMP over SockJS) |
| Backend | Spring Boot REST API |
| 메시지 브로커 | Spring 내장 SimpleBroker (Redis 불필요) |
| 상태 저장 | 인메모리 (`ConcurrentHashMap`) — 프로토타입 한정 |
| 서버 OS | Linux |

### 환경 제약

- Frontend / Backend 모두 **단일 서버**, 수평 확장 없음
- 미들웨어 없음
- DB 없음 (실서비스 전환 시 외부 서비스 API로 CRUD 처리)

---

## 3. 통신 기술 선택: WebSocket (SSE 아님)

### 선택 이유

폼 동시편집은 **양방향 통신**이 필요. SSE는 서버→클라이언트 단방향이라 클라이언트→서버 전송에 별도 REST API가 필요하므로 부적합.

### 연결 제한 비교 (참고)

**SSE**
- 브라우저: HTTP/1.1은 도메인당 6개 연결 제한 / HTTP/2는 기본 100개
- 서버: Tomcat 기본 스레드 200개 (SSE는 연결당 스레드 점유)

**WebSocket** ← 채택
- 브라우저: 도메인당 사실상 제한 없음 (탭별 독립 연결)
- 서버: Tomcat WebSocket은 NIO 사용 → 스레드 효율적
- 실질적 한계는 메모리 + 파일 디스크립터(`ulimit -n`)

> 본 시나리오는 폼당 2명(A, B) 연결이므로 연결 수는 전혀 문제되지 않음.

---

## 4. 핵심 설계 원칙

### 4.1 서버 인메모리가 Source of Truth

DB가 없으므로 **서버 메모리가 곧 진실의 원천**. 폼 상태는 서버의 `Map<formId, FormState>`에 보관.
모든 데이터/네비게이션 이벤트는 브로드캐스트 시 **반드시 `FormState`를 갱신**한다(§4.2 스냅샷·§4.6 재연결의 정합성이 여기에 의존).

### 4.2 접속 시 스냅샷 핸드셰이크 (가장 중요)

B가 접속하면 A가 작성 중이던 현재 상태가 그대로 떠야 함. WebSocket 연결 직후 **현재 폼 스냅샷을 1회 내려주는 과정**이 필수.

```
연결 → (1) /topic/form/{formId} 먼저 구독   ← 순서 중요 (레이스 컨디션 방지)
     → (2) 서버에 스냅샷 요청
     → 서버: formStore.getOrCreate(formId) 조회 → 현재 전체 상태 1회 전송 (SNAPSHOT)
     → 이후부터는 델타(변경분)만 브로드캐스트
```

**구독을 먼저, 스냅샷 요청을 나중에** 하는 이유: 스냅샷을 받는 사이에 상대가 보낸 이벤트가 토픽으로 흐르는데, 구독이 늦으면 그 이벤트가 유실되어 해당 필드가 영구히 어긋난다. 구독을 먼저 걸면 스냅샷 + 이후 델타가 빠짐없이 합쳐진다.

#### 스냅샷에 담기는 것 (FormState)

스냅샷은 단순 필드 값만이 아니라 **현재 페이지와 포커스 문항까지** 포함해야 "A가 보던 화면 그대로"가 성립한다.

```typescript
interface FormState {
  formId: string;
  answers: Record<string, FieldValue>;  // questionId → value
  currentPage: number;                  // 현재 페이지 (필수)
  focusedQuestionId: string | null;     // 마지막 포커스 문항 (선택)
  submitted: boolean;                   // 제출 완료 여부
  locks: Record<string, string>;        // questionId → 점유 중인 clientId (텍스트 필드 락, §5.2)
}
```

### 4.3 충돌 정책: Last-Write-Wins (LWW) + 텍스트 필드 소프트 락

폼 작성 지원 시나리오상 마지막 입력이 반영되는 **LWW**가 현실적이며, 객관식(라디오/체크박스)·페이지·포커스에는 LWW가 오히려 정답(서로 다른 선택을 "병합"한다는 개념 자체가 없으므로 마지막 선택이 이기는 것이 옳다).

LWW가 유일하게 취약한 곳은 **같은 주관식 텍스트 필드를 두 사람이 동시에 타이핑**하는 경우(글자 덮어쓰기·커서 튐)뿐이다. 이를 OT/CRDT 같은 병합 알고리즘으로 푸는 대신, **소프트 락**으로 동시 편집 자체를 회피한다(§5.2). 한 사람이 텍스트 필드에 포커스하면 상대 화면에서 해당 칸을 비활성화 + "OOO 입력 중" 표시.

#### 실서비스 확장 경로 (문서형 동시편집이 요구될 때)

실서비스에서 같은 텍스트를 진짜로 동시에 편집하는 기능이 필요해지면, **OT가 아니라 CRDT(Yjs)** 로 확장하는 것이 본 아키텍처와 맞는다.

- **OT는 부적합**: 서버가 연산을 중앙에서 정렬·재변환해야 하므로 "서버는 단순 릴레이"인 현재 SimpleBroker 구조가 깨지고, 검증 까다로운 변환 함수(TP1/TP2)를 직접 구현해야 한다. JVM용 성숙한 OT 라이브러리도 부족.
- **CRDT(Yjs)는 적합**: Yjs 업데이트는 바이너리 델타이고 클라이언트끼리 병합되므로, **서버는 이 바이너리를 STOMP로 그대로 중계만** 하면 된다(별도 Node 서버 불필요 — 공식 `y-websocket` 서버 대신 기존 STOMP에 `YJS_UPDATE` 메시지로 얹는 커스텀 프로바이더 방식). 늦게 들어온 접속자에게는 서버가 append-only로 쌓아둔 업데이트 로그를 재생(replay)하면 CRDT 수렴성에 의해 정합성이 맞는다.
- **단, 압축(compaction) 한계**: JVM에는 성숙한 Yjs 런타임이 사실상 없어 서버가 로그를 병합·압축하지 못하고 계속 쌓기만 한다. 프로토타입·시연 규모(2명·짧은 세션)에서는 무방하나, 실서비스 규모에서는 그때 Node 사이드카(또는 `yrs` 기반 런타임)를 붙여 주기적 snapshot을 생성한다.
- presence(커서·"입력 중")용 awareness 메시지는 **휘발성**이므로 append-only 로그에 쌓지 말고 릴레이 후 폐기.

### 4.4 무한 루프 방지 가드 (clientId 기반)

외부에서 들어온 값을 폼에 주입할 때, 내가 보낸 이벤트는 무시해야 함.
**식별자는 역할("A"/"B")이 아니라 클라이언트가 생성한 UUID(`clientId`)를 사용**한다. 모든 메시지 payload에 `clientId`를 실어 보내고, 수신 시 이것으로 자기 자신을 판별한다.

```typescript
const myClientId = crypto.randomUUID(); // 접속 시 1회 생성

// 수신 가드
if (event.clientId === myClientId) return;
```

> Spring Security 없이 익명 STOMP 연결이면 `Principal`이 null이라 `principal.getName()`에서 NPE가 날 수 있고, 역할 기반 식별은 신원과 의미가 섞인다. 클라이언트 생성 `clientId`를 쓰면 Principal 핸드셰이크 설정을 통째로 생략할 수 있어 프로토타입에 가장 단순·확실하다.

### 4.5 추상화로 실서비스 전환 대비

`FormRepository` 인터페이스로 추상화 → 프로토타입은 인메모리 구현, 실서비스는 외부 API 구현으로 교체만 하면 됨.

### 4.6 연결 단절·재연결 처리

WebSocket은 끊긴다(특히 시연장 와이파이의 "조용한 단절"). 끊긴 동안 상대가 바꾼 변경은 재연결만으로 자동 전달되지 않으므로(STOMP에는 SSE의 `Last-Event-ID` 같은 재전송이 없음), **재연결을 "신규 접속"과 동일하게 취급**하여 스냅샷을 다시 받는 것으로 해결한다.

- **감지**: STOMP heartbeat(10초)로 조용한 단절을 빠르게 감지.
- **자동 재연결**: `reconnectDelay`로 재접속.
- **정합성 회복**: `@stomp/stompjs`의 `onConnect`는 최초 연결과 모든 재연결마다 호출되므로, 여기서 항상 **(1) 토픽 구독 → (2) 스냅샷 재요청** 을 수행하면 첫 접속·재접속이 같은 코드로 처리된다. 서버 `FormStore`가 최신 상태를 갖고 있으므로 전체 상태를 다시 받아 덮어쓰면 끊긴 동안의 변경까지 한 번에 맞춰진다.
- **세션 정리**: 서버는 `SessionDisconnectEvent`로 끊김을 잡아 `FormSessionRegistry`에서 세션 제거 + presence(`USER_LEAVE`) 브로드캐스트, 재연결 시 `USER_JOIN`.

> 주의: A가 텍스트 입력 중(디바운스 대기 중) 끊겼다 붙으면, 아직 서버로 안 보낸 로컬 입력이 스냅샷 덮어쓰기로 사라질 수 있다. 프로토타입에서는 큰 이슈가 아니며, 정석인 로컬 dirty 값 머지는 시연용으로는 과하므로 생략한다.

> 시연 팁: "끊겼다 다시 붙으니 알아서 동기화가 맞춰진다"는 통신 불안정 복구 능력을 의도적으로 한 번 보여주면 발주사 신뢰도에 효과적.

---

## 5. 동기화 이벤트 분류

| 분류 | 이벤트 | 특성 |
|---|---|---|
| 네비게이션 | `PAGE_CHANGE` 페이지 이동 | 즉각 반영, 단순, 서버 상태 갱신 |
| 포커스 | `FOCUS_QUESTION` 문항 스크롤 | 즉각 반영, 단순, 서버 상태 갱신 |
| 데이터 | `FIELD_UPDATE` 문항 입력/선택 | 충돌 가능성 (LWW), 서버 상태 갱신 |
| 락 | `FIELD_LOCK` / `FIELD_UNLOCK` | 텍스트 필드 점유/해제 (§5.2) |
| 상태 | `SUBMIT_REQUEST` / `FORM_SUBMITTED` | 제출 2단계 (§5.1) |
| 접속 | `USER_JOIN` / `USER_LEAVE` | presence 표시 (§5.3) |

### 메시지 포맷 (STOMP)

Topic 구조: `/topic/form/{formId}`
모든 메시지는 공통으로 `clientId`(발신자 UUID)와 `role`('A'|'B')을 포함한다.

```json
// 페이지 이동
{ "type": "PAGE_CHANGE", "clientId": "uuid-b", "role": "B", "payload": { "page": 2 } }

// 문항 포커스/스크롤
{ "type": "FOCUS_QUESTION", "clientId": "uuid-b", "role": "B", "payload": { "questionId": "q_005" } }

// 문항 데이터 입력
{ "type": "FIELD_UPDATE", "clientId": "uuid-b", "role": "B",
  "payload": { "questionId": "q_003", "type": "SINGLE_CHOICE", "value": "option_2" } }

// 텍스트 필드 락 / 해제
{ "type": "FIELD_LOCK",   "clientId": "uuid-b", "role": "B", "payload": { "questionId": "q_007" } }
{ "type": "FIELD_UNLOCK", "clientId": "uuid-b", "role": "B", "payload": { "questionId": "q_007" } }

// 제출 요청 (B 등 비작성자 → A에게 확인 모달 트리거)
{ "type": "SUBMIT_REQUEST", "clientId": "uuid-b", "role": "B", "payload": {} }

// 제출 확정 (A만 발신) → 전원 동기화
{ "type": "FORM_SUBMITTED", "clientId": "uuid-a", "role": "A",
  "payload": { "submittedAt": "2026-06-27T10:00:00Z" } }

// 접속/이탈
{ "type": "USER_JOIN",  "clientId": "uuid-b", "role": "B", "payload": {} }
{ "type": "USER_LEAVE", "clientId": "uuid-b", "role": "B", "payload": {} }
```

### 5.1 제출 흐름 (2단계 분리)

작성 주체는 A이므로 **제출 확정 권한은 A만 보유**한다. B가 임의로 A의 폼을 제출시키지 않는다.

```
B: [제출] 버튼 → SUBMIT_REQUEST 전송
A: SUBMIT_REQUEST 수신 → "상담사 B가 제출을 요청했습니다" 확인 모달 표시
A: 모달에서 [제출] 확정 → 실제 제출 수행 + FORM_SUBMITTED 브로드캐스트
전원: FORM_SUBMITTED 수신 → 제출 완료 화면/읽기전용 전환
```

- A가 직접 제출하는 경우는 모달 없이 바로 `FORM_SUBMITTED`.
- 이 분리로 §1의 "모든 동기화 양방향"과 "제출은 단방향 트리거" 간 모순이 해소된다(요청은 양방향, 확정은 A 단방향).

### 5.2 텍스트 필드 소프트 락

LWW가 취약한 "같은 텍스트 칸 동시 편집"을 회피하기 위한 경량 락.

```
포커스(focus) → FIELD_LOCK 전송, 서버 FormState.locks[qId] = myClientId
상대 화면     → 해당 칸 disabled + "OOO 입력 중" 배지 표시
블러(blur)    → FIELD_UNLOCK 전송, 서버 락 해제
```

- 객관식(라디오/체크박스)은 락 불필요(LWW로 충분).
- 안전장치: 락 보유 클라이언트가 disconnect되면 서버가 해당 락을 자동 해제(데드락 방지).

### 5.3 Presence (접속자 표시)

서버 `FormSessionRegistry`의 변화를 클라이언트로 내려주어야 §7의 Avatar/Badge가 채워진다.

```
연결/재연결 → USER_JOIN 브로드캐스트 → 상대 배지 활성(초록)
disconnect  → USER_LEAVE 브로드캐스트 → 상대 배지 비활성(회색)
```

---

## 6. 폼 구조 (60문항 / 6페이지)

문항 60여 개를 한 화면에 표시하기 어려우므로 **페이지당 10개씩, 총 6페이지** 구성.

프로토타입에서는 사용할 샘플: 10개 문항으로 페이지당 2문항. 문항은 여행 설문 조사와 관련된 것으로 준비

### 페이지 + 스크롤 동기화 순서 (타이밍 안전 처리)

스크롤 동기화는 페이지 내 위치 이동이므로, 해당 문항이 속한 페이지로 먼저 이동한 후 scrollIntoView. 단, **페이지 이동(상태 변경)은 비동기로 커밋**되므로 `requestAnimationFrame` 한 번으로는 새 페이지 DOM이 그려지기 전에 `getElementById`가 `null`을 반환할 수 있다(같은 페이지면 동작, 다른 페이지로 점프할 때만 실패하는 까다로운 버그).

**권장: 페이지 상태를 의존성으로 하는 `useEffect`에서 스크롤 처리.**

```typescript
// 1) 수신 시: 목표 문항을 상태로 저장하고 페이지만 이동
const focusQuestion = (questionId: string, questionIndex: number) => {
  const page = Math.floor(questionIndex / 10) + 1;
  setPendingFocus(questionId); // 스크롤 대상 예약
  goToPage(page);              // 페이지 이동 (비동기 커밋)
};

// 2) 페이지가 실제로 렌더된 뒤 스크롤 실행
useEffect(() => {
  if (!pendingFocus) return;
  const el = document.getElementById(pendingFocus);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' });
    setPendingFocus(null);
  }
}, [currentPage, pendingFocus]);
```

> 대안: 요소가 나타날 때까지 짧게 재시도하거나 `MutationObserver` 사용. 핵심은 "DOM에 문항이 실제로 존재하는 시점"에 스크롤하는 것.

### UX 보조: 동기화 주체 표시

강제 페이지 이동 시 흐름이 끊기는 혼란을 줄이기 위해 토스트/배너 표시 권장.

```
[상담사 B가 2페이지로 이동했습니다]
```

---

## 7. Shadcn/ui 컴포넌트 매핑

| 문항/UI 요소 | Shadcn 컴포넌트 |
|---|---|
| 주관식 텍스트 | `Input` / `Textarea` |
| 객관식 단일선택 | `RadioGroup` + `RadioGroupItem` |
| 객관식 멀티선택 | `Checkbox` (그룹) |
| 페이지 이동 | `Pagination` |
| 동기화 알림 | `Sonner` (toast) |
| 접속자 표시 | `Avatar` + `Badge` |
| 제출 확인 모달 | `AlertDialog` |
| 텍스트 락 표시 | `Tooltip` / `Badge` (입력 중) |

---

## 8. Backend 구현 (Spring Boot)

### 8.1 인메모리 상태 저장소

```java
@Component
public class FormStore {
    private final Map<String, FormState> store = new ConcurrentHashMap<>();

    public FormState getOrCreate(String formId) {
        return store.computeIfAbsent(formId, k -> FormState.empty(formId));
    }
}
```

> 동시성 주의: `ConcurrentHashMap`은 맵 구조만 보호할 뿐 같은 `FormState` 객체 내부 필드의 동시 변경은 보호하지 못한다. 2명 시나리오라 실제 충돌 확률은 낮지만, `FormState`를 불변 객체로 통째 교체하거나 formId 단위로 동기화하면 깔끔하다.

### 8.2 실서비스 전환용 추상화

```java
public interface FormRepository {
    FormState load(String formId);
    void save(FormState state);
}
// 프로토타입: InMemoryFormRepository
// 실서비스: ExternalApiFormRepository  ← 이것만 교체
```

### 8.3 세션 레지스트리 (어떤 사용자가 어떤 폼에 연결됐는지 추적)

```java
@Component
public class FormSessionRegistry {
    // formId → Set<sessionId>
    private final Map<String, Set<String>> formSessions = new ConcurrentHashMap<>();
    // sessionId → (formId, clientId) — disconnect 시 역추적용
    private final Map<String, SessionInfo> sessionIndex = new ConcurrentHashMap<>();
}
```

### 8.4 구독 시 스냅샷 전송

```java
@SubscribeMapping("/form/{formId}/snapshot")
public FormState onSubscribe(@DestinationVariable String formId) {
    return formStore.getOrCreate(formId);  // 현재 메모리 상태(값+페이지+포커스+락) 반환
}
```

### 8.5 이벤트 브로드캐스트 컨트롤러 (서버 상태 갱신 필수)

```java
@MessageMapping("/form/{formId}/event")
@SendTo("/topic/form/{formId}")
public FormEvent handleEvent(@DestinationVariable String formId, FormEvent event) {
    // clientId는 클라이언트 payload에서 그대로 사용 (Principal 미사용 → NPE 회피)
    FormState state = formStore.getOrCreate(formId);

    // ★ 필수: 모든 데이터/네비게이션 이벤트는 서버 상태에 반영해야
    //   스냅샷(신규/재연결)이 최신을 보장한다.
    switch (event.getType()) {
        case PAGE_CHANGE    -> state.setCurrentPage(event.payload().page());
        case FOCUS_QUESTION -> state.setFocusedQuestionId(event.payload().questionId());
        case FIELD_UPDATE   -> state.putAnswer(event.payload().questionId(), event.payload().value());
        case FIELD_LOCK     -> state.lock(event.payload().questionId(), event.clientId());
        case FIELD_UNLOCK   -> state.unlock(event.payload().questionId());
        case FORM_SUBMITTED -> state.setSubmitted(true);
        // SUBMIT_REQUEST / USER_* 는 상태 갱신 없이 릴레이만
        default -> { }
    }
    return event;  // 구독자 전원에게 브로드캐스트
}
```

### 8.6 Disconnect 처리 (presence + 락 해제)

```java
@EventListener
public void onDisconnect(SessionDisconnectEvent ev) {
    String sessionId = StompHeaderAccessor.wrap(ev.getMessage()).getSessionId();
    SessionInfo info = sessionRegistry.remove(sessionId); // formId, clientId 회수
    if (info == null) return;
    FormState state = formStore.getOrCreate(info.formId());
    state.releaseLocksOf(info.clientId());                // 데드락 방지: 해당 클라이언트 락 해제
    broadcast(info.formId(), FormEvent.userLeave(info.clientId(), info.role()));
}
```

### 8.7 WebSocket 설정 (CORS/Origin 필수)

`spring-boot-starter-websocket` 사용, STOMP + SockJS 폴백. 단일 서버이므로 내장 SimpleBroker로 충분 (Redis pub/sub 불필요).

**Next.js(예: 3000)와 Spring(예: 8080) 포트가 다르므로 Origin 허용 설정이 없으면 연결 자체가 안 된다**(데모 직전 가장 흔한 사고). 엔드포인트에 명시:

```java
@Override
public void registerStompEndpoints(StompEndpointRegistry registry) {
    registry.addEndpoint("/ws")
            .setAllowedOriginPatterns("http://localhost:3000") // 실제 FE 오리진
            .withSockJS();
}

@Override
public void configureMessageBroker(MessageBrokerRegistry registry) {
    registry.enableSimpleBroker("/topic");
    registry.setApplicationDestinationPrefixes("/app");
}
```

---

## 9. Frontend 구현 (Next.js)

### 9.1 동기화 훅 (useFormSync)

```typescript
const useFormSync = (formId: string, role: 'A' | 'B') => {
  const stompClient = useRef<Client | null>(null);
  const myClientId = useRef(crypto.randomUUID()).current; // 접속 1회 생성

  // 이벤트 수신 → 내 화면에 반영
  const handleIncoming = (event: FormEvent) => {
    if (event.clientId === myClientId) return; // 내가 보낸 건 무시 (루프 방지)

    switch (event.type) {
      case 'PAGE_CHANGE':    goToPage(event.payload.page); break;
      case 'FOCUS_QUESTION': scrollToQuestion(event.payload.questionId); break;
      case 'FIELD_UPDATE':   updateField(event.payload); break;
      case 'FIELD_LOCK':     setFieldLock(event.payload.questionId, event.role); break;
      case 'FIELD_UNLOCK':   clearFieldLock(event.payload.questionId); break;
      case 'SUBMIT_REQUEST': openSubmitConfirmModal(event.role); break;   // A 화면에서만 의미
      case 'FORM_SUBMITTED': applySubmitted(event.payload); break;
      case 'USER_JOIN':      setPresence(event.role, true); break;
      case 'USER_LEAVE':     setPresence(event.role, false); break;
    }
  };

  // 스냅샷 적용 (신규 + 재연결 공통)
  const applySnapshot = (s: FormState) => {
    hydrateAnswers(s.answers);
    goToPage(s.currentPage);
    if (s.focusedQuestionId) scrollToQuestion(s.focusedQuestionId);
    hydrateLocks(s.locks);
    if (s.submitted) applySubmitted({ /* ... */ });
  };

  // 연결/재연결 시 항상 실행
  const onConnect = () => {
    // (1) 토픽 먼저 구독 → (2) 스냅샷 요청  (레이스 컨디션 방지)
    stompClient.current!.subscribe(`/topic/form/${formId}`,
      (msg) => handleIncoming(JSON.parse(msg.body)));
    stompClient.current!.subscribe(`/user/queue/snapshot`,
      (msg) => applySnapshot(JSON.parse(msg.body)));
    stompClient.current!.subscribe(`/app/form/${formId}/snapshot`, () => {}); // @SubscribeMapping 트리거
    sendEvent('USER_JOIN', {});
  };

  useEffect(() => {
    const client = new Client({
      webSocketFactory: () => new SockJS('http://localhost:8080/ws'),
      reconnectDelay: 3000,        // 자동 재연결
      heartbeatIncoming: 10000,    // 조용한 단절 감지
      heartbeatOutgoing: 10000,
      onConnect,                   // 최초 + 모든 재연결마다 호출 → 스냅샷 재수신
    });
    client.activate();
    stompClient.current = client;
    return () => { client.deactivate(); };
  }, [formId]);

  // 내 액션 → 서버로 전송 (clientId, role 부착)
  const sendEvent = (type: string, payload: object) => {
    stompClient.current?.publish({
      destination: `/app/form/${formId}/event`,
      body: JSON.stringify({ type, clientId: myClientId, role, payload }),
    });
  };

  return { sendEvent, myClientId };
};
```

> 재연결 핵심: `onConnect`가 최초 연결과 모든 재연결마다 호출되므로, 여기서 **구독 → 스냅샷 재요청**을 하면 끊긴 동안의 변경까지 한 번에 정합성이 맞는다(§4.6).

### 9.2 react-hook-form 외부 값 주입

Shadcn `Form`은 react-hook-form 기반. 외부(상대방)에서 들어온 값을 폼에 주입해야 하므로 `setValue` 사용.

```typescript
const form = useForm({ defaultValues });

// 수신 이벤트를 폼에 주입 (clientId 가드는 handleIncoming에서 이미 처리됨)
const updateField = ({ questionId, value }: FieldUpdate) => {
  form.setValue(questionId, value, {
    shouldValidate: false,   // 검증 스킵 (성능)
    shouldDirty: false       // 내 입력 아님 표시
  });
};
```

> 외부 주입과 내 입력이 섞이면 무한 루프가 생기기 쉬움. `clientId === myClientId` 가드 필수(§4.4).

### 9.3 텍스트 입력 디바운싱 + 락

주관식 텍스트는 타이핑마다 전송하면 과부하. 300ms 디바운스 후 전송. 객관식은 클릭 즉시 전송 무방.

```typescript
const handleTextFocus = (qId: string) => sendEvent('FIELD_LOCK', { questionId: qId });
const handleTextBlur  = (qId: string) => sendEvent('FIELD_UNLOCK', { questionId: qId });

const handleTextInput = useDebouncedCallback((questionId, value) => {
  sendEvent('FIELD_UPDATE', { questionId, type: 'TEXT', value });
}, 300);
```

> 주의: 디바운스 대기 중 제출하면 마지막 타이핑이 안 실려갈 수 있으므로, 제출(확정) 직전에 보류 중인 입력을 flush 권장.

### 9.4 클라이언트 라이브러리

`@stomp/stompjs` + `sockjs-client`

---

## 10. 전체 데이터 흐름

```
[ 인메모리 FormStore (Map<formId, FormState>) ]   ← Source of Truth (값+페이지+포커스+락+제출)
              │  (모든 이벤트가 여기 갱신)
   ┌──────────┴──────────┐
   │  Spring WebSocket    │
   │  + SimpleBroker      │
   │  + SessionRegistry   │
   └──────────┬──────────┘
              │ /topic/form/{formId}
       ┌──────┴──────┐
   A (작성자)      B (상담사)
   - 접속/재접속: SNAPSHOT 수신 (구독 먼저 → 스냅샷)
   - 입력: 델타 송신 + 수신 (clientId 가드)
   - 페이지/스크롤/필드 동기화 (양방향)
   - 제출: B는 요청만 / A가 확정 (2단계)
   - presence/락 표시
```

조작 흐름:

```
A 또는 B 입력/조작
    │
    └─ WebSocket → /app/form/{formId}/event
                        │ (서버: FormState 갱신 + 브로드캐스트)
                        └─ /topic/form/{formId} → 상대방 화면 즉시 반영
```

재연결 흐름:

```
연결 끊김(heartbeat 감지) → 자동 재연결(reconnectDelay)
    → onConnect: 토픽 구독 → 스냅샷 재요청
    → 서버 최신 FormState 수신 → 전체 덮어쓰기로 정합성 회복
```

> 프로토타입은 DB 저장 없이 WebSocket 브로드캐스트 + 인메모리 갱신만 수행.
> 실서비스 전환 시 `FormRepository` 구현을 외부 API 호출로 교체.

---

## 11. Linux 서버 튜닝 (참고)

본 시나리오(폼당 2명)는 기본 설정으로 충분하나, 규모 확대 시 참고.

```bash
# /etc/security/limits.conf
* soft nofile 65535
* hard nofile 65535

# /etc/sysctl.conf
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
```

---

## 12. 구현 체크리스트

### 연결·인프라
- [ ] WebSocket 설정 (STOMP + SockJS, SimpleBroker)
- [ ] **CORS/Origin 허용 설정** (`setAllowedOriginPatterns`) — 데모 필수
- [ ] STOMP heartbeat(10s) + `reconnectDelay` 자동 재연결

### 상태·스냅샷
- [ ] `FormRepository` 인터페이스 + 인메모리 구현
- [ ] `FormState`에 **currentPage / focusedQuestionId / locks / submitted** 포함
- [ ] 구독 시 스냅샷 전송 (`@SubscribeMapping`)
- [ ] **구독 먼저 → 스냅샷 요청** 순서 (레이스 컨디션 방지)
- [ ] **재연결 시 `onConnect`에서 스냅샷 재요청** (신규=재접속 동일 코드)
- [ ] 이벤트 핸들러에서 **서버 `FormState` 갱신 필수**

### 이벤트
- [ ] 이벤트 브로드캐스트 컨트롤러 (`@MessageMapping`)
- [ ] **`clientId`(UUID) 기반 자기 자신 무시 가드** (Principal 미사용)
- [ ] 핸들러: PAGE_CHANGE / FOCUS_QUESTION / FIELD_UPDATE
- [ ] **제출 2단계**: SUBMIT_REQUEST → A 확인 모달(`AlertDialog`) → FORM_SUBMITTED
- [ ] **텍스트 필드 소프트 락**: FIELD_LOCK / FIELD_UNLOCK + disconnect 시 자동 해제
- [ ] **presence**: USER_JOIN / USER_LEAVE + `SessionDisconnectEvent` 리스너

### Frontend UX
- [ ] 페이지 이동 후 scrollIntoView **타이밍 안전 처리**(useEffect/재시도)
- [ ] 텍스트 입력 디바운싱 (300ms) + 제출 직전 flush
- [ ] react-hook-form `setValue` 외부 주입
- [ ] 동기화 주체 토스트 알림 / 락 "입력 중" 표시 / presence 배지
- [ ] 60문항 / 페이지당 10개 페이지네이션

---

## 13. 시연 성패 핵심 (요약)

라이브 데모에서 어긋남을 막는 최우선 3가지:

1. **스크롤 타이밍** — 페이지 점프 후 DOM 렌더 완료 시점에 스크롤 (§6)
2. **스냅샷에 현재 페이지 포함** — 접속 즉시 "A가 보던 화면 그대로" (§4.2)
3. **CORS/Origin 설정** — 연결 자체가 안 되는 사고 방지 (§8.7)

발주사 예상 질문 대비:
- "동시 편집은?" → LWW + 텍스트 필드 락으로 충돌 회피, 실서비스는 OT가 아닌 **CRDT(Yjs)·별도 서버 없이** STOMP에 얹어 확장 (§4.3)
- "통신 끊기면?" → 재연결 = 신규 접속으로 스냅샷 재수신해 자동 복구 (§4.6) — 의도적 시연 권장
- "B가 남의 폼을 제출?" → 제출 확정은 A만, B는 요청만 (§5.1)
