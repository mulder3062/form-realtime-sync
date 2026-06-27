# form-realtime-sync

Google Forms 형태의 폼 서비스에 **작성자와 상담사 간 실시간 화면 미러링·양방향 동기화**를 더한 프로토타입입니다. 작성자가 폼을 작성하다 도움을 요청하면, 상담사가 같은 폼 ID로 접속해 작성자의 현재 상태(입력값 + 현재 페이지 + 포커스)를 그대로 공유하고, 페이지 이동·문항 포커스·필드 편집을 양방향으로 동기화합니다. 접속 구분은 작성자/상담사 두 가지뿐이며, **같은 역할이 여러 명 동시에 접속**할 수 있습니다.

> **DB 없이 서버 인메모리만 사용하는 프로토타입**입니다. 단일 서버를 가정하며 수평 확장·Redis·미들웨어는 다루지 않습니다.

## 주요 기능

- **실시간 양방향 동기화** — 페이지 이동, 문항 포커스, 필드 입력을 STOMP over WebSocket으로 두 사용자 간 즉시 반영
- **스냅샷 핸드셰이크** — 신규 접속·재연결 시 서버의 전체 상태(`FormState`)를 1회 받아 화면을 "A가 보던 그대로" 복원
- **자동 재연결 복구** — heartbeat 10초 + 재연결 지연으로 조용한 단절을 감지하고, 재연결을 신규 접속과 동일하게 처리
- **소프트 락** — 텍스트 필드를 한 명이 편집 중이면 상대 화면에서 해당 칸을 잠금 표시(disconnect 시 서버가 자동 해제)
- **권한 분리 제출** — 제출 확정 권한은 작성자만 보유. 상담사는 제출 요청만 보내고, 작성자 화면의 확인 모달에서 직접 확정
- **다인원 Presence 표시** — 접속 중인 작성자·상담사를 각각 N명까지 `clientId` 단위로 실시간 표시(한 명이 끊겨도 같은 역할의 나머지는 유지)
- **단계 표시 Stepper** — 폼 진행 단계를 상단 Stepper로 표시하고, 단계 클릭으로 양방향 동기화 이동

## 기술 스택

| 영역 | 스택 |
|------|------|
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, react-hook-form, `@stomp/stompjs` + `sockjs-client`, sonner |
| **Backend** | Spring Boot 3.5, Java 21, Spring WebSocket(STOMP over SockJS), 내장 SimpleBroker, Lombok |
| **런타임** | Node 22 (`mise.toml`), Java 21 |

## 프로젝트 구조

```
form-realtime-sync/
├── frontend/                         # Next.js (포트 3000)
│   └── src/
│       ├── app/
│       │   ├── page.tsx              # 랜딩: 폼 ID 입력 + A/B 역할 선택
│       │   └── form/[formId]/page.tsx# 폼 페이지 (FormView 렌더링)
│       ├── components/
│       │   ├── FormView.tsx          # 폼 본문 · Stepper · 제출 모달
│       │   ├── QuestionField.tsx     # 문항 렌더링 · 락 · 디바운스 전송
│       │   └── ui/                   # shadcn/ui 컴포넌트
│       ├── hooks/
│       │   └── useFormSync.ts        # 실시간 동기화 핵심 훅
│       └── lib/
│           ├── types.ts              # 이벤트·상태 타입
│           └── questions.ts          # 샘플 여행 설문 15문항 / 3페이지
└── backend/                          # Spring Boot (포트 8080)
    └── src/main/java/com/example/formsync/
        ├── controller/FormSyncController.java   # @MessageMapping 핸들러 + 스냅샷 응답
        ├── model/                                # FormEvent, FormState, EventType, Payload, SessionInfo
        ├── store/FormStore.java                  # 상태 접근 진입점
        ├── repository/                            # FormRepository(인터페이스) + InMemoryFormRepository
        ├── session/FormSessionRegistry.java      # 세션 ↔ clientId/role 추적
        ├── listener/WebSocketEventListener.java  # disconnect 시 락 해제 + USER_LEAVE
        └── config/WebSocketConfig.java           # STOMP·SockJS·CORS 설정
```

## 시작하기

### 사전 요구사항

- Node 22 (`mise` 사용 시 자동 적용)
- Java 21

### Backend 실행

```bash
cd backend
./gradlew bootRun
```

기본 8080 포트로 기동합니다. 포트가 점유된 경우 다른 포트를 지정하세요.

```bash
./gradlew bootRun --args='--server.port=18080'
```

### Frontend 실행

```bash
cd frontend
npm install
npm run dev
```

`http://localhost:3000`에서 동작합니다. 백엔드 포트를 바꿨다면 `frontend/.env.local`에 백엔드 주소를 지정합니다.

```bash
# frontend/.env.local
NEXT_PUBLIC_WS_URL=http://localhost:18080/ws
```

기본값은 `http://localhost:8080/ws`이며, 예시는 `frontend/.env.example`을 참고하세요.

### 동작 확인 (E2E)

브라우저 탭 두 개 이상에서 같은 폼 ID로 접속하되, 랜딩 페이지에서 각각 **작성자** 또는 **상담사**를 선택합니다(같은 역할로 여러 명 입장해도 됩니다). 한쪽에서 페이지를 이동하거나 값을 입력하면 다른 쪽 화면에 실시간으로 반영됩니다.

## 핵심 아키텍처

시스템 정합성은 아래 규칙들의 상호 의존에 달려 있습니다.

1. **서버 인메모리가 Source of Truth** — 폼 상태는 백엔드 `FormStore`의 `Map<formId, FormState>`에 보관합니다. `FormState`는 답변값뿐 아니라 `currentPage`, `focusedQuestionId`, `submitted`, `locks`를 포함합니다.
2. **데이터/네비게이션 이벤트는 브로드캐스트 시 `FormState`를 갱신** — `PAGE_CHANGE` · `FOCUS_QUESTION` · `FIELD_UPDATE` · `FIELD_LOCK`/`UNLOCK` · `FORM_SUBMITTED`는 상태를 갱신하고, `SUBMIT_REQUEST` · `USER_*`는 릴레이만 합니다.
3. **접속 시 스냅샷 핸드셰이크** — 클라이언트는 `onConnect`에서 `(1) 구독 → (2) 스냅샷 요청` 순서를 지킵니다. 백엔드는 `@SubscribeMapping`으로 현재 전체 상태를 1회 내려줍니다.
4. **재연결 = 신규 접속** — `onConnect`(최초 + 모든 재연결)에서 항상 "구독 → 스냅샷 재요청 → 전체 상태 덮어쓰기"를 수행합니다.
5. **무한 루프 가드는 `clientId`(UUID)로** — 접속 시 생성한 `clientId`를 모든 메시지에 싣고, 수신 시 자신의 `clientId`면 무시합니다.

### 충돌 정책

- 기본은 **Last-Write-Wins(LWW)**. 객관식·페이지·포커스는 병합 개념이 없으므로 LWW가 정답입니다.
- **텍스트 필드만 소프트 락**으로 동시 편집을 회피합니다(OT/CRDT 미사용). focus 시 `FIELD_LOCK`, blur 시 `FIELD_UNLOCK`, disconnect 시 서버가 자동 해제합니다.

### 제출 흐름 (2단계, 권한 분리)

제출 확정 권한은 **작성자 A만** 보유합니다. B는 `SUBMIT_REQUEST`만 보낼 수 있고, A 화면에 확인 모달이 떠 A가 직접 확정하면 `FORM_SUBMITTED`를 브로드캐스트합니다. A가 직접 제출할 땐 모달 없이 바로 확정합니다.

## 동기화 이벤트

Topic: `/topic/form/{formId}`. 모든 메시지는 공통으로 `type`, `clientId`(발신자 UUID), `role`(`AUTHOR`|`COUNSELOR`), `payload`를 포함합니다.

| 이벤트 | 설명 | 상태 갱신 |
|--------|------|:--------:|
| `PAGE_CHANGE` | 페이지 이동 | O |
| `FOCUS_QUESTION` | 문항 포커스 | O |
| `FIELD_UPDATE` | 필드 값 변경 | O |
| `FIELD_LOCK` / `FIELD_UNLOCK` | 텍스트 필드 락/해제 | O |
| `FORM_SUBMITTED` | 제출 확정(작성자) | O |
| `SUBMIT_REQUEST` | 제출 요청(상담사) | X(릴레이) |
| `USER_JOIN` / `USER_LEAVE` | 접속/이탈 | X(릴레이) |

> 접속 시 스냅샷에는 폼 상태(`state`)와 함께 현재 접속자 목록(`participants`: `clientId`+`role`)이 담겨, 신규 접속자가 이미 들어와 있는 사람을 즉시 인지합니다. presence는 역할이 아니라 `clientId` 단위로 관리되어 같은 역할이 N명 접속해도 각각 표시되고, 한 명이 끊겨도 나머지는 유지됩니다.

## 빌드 · 테스트

**Backend**
```bash
cd backend
./gradlew compileJava   # 컴파일
./gradlew test          # 테스트
```

**Frontend**
```bash
cd frontend
npx tsc --noEmit   # 타입 체크
npm run lint       # 린트
npm run build      # 프로덕션 빌드
```

> 현재 테스트는 백엔드 컨텍스트 로드 스켈레톤만 존재합니다. STOMP 레벨 통합 검증은 `@stomp/stompjs` + `sockjs-client`로 두 클라이언트를 띄워 스냅샷·브로드캐스트·락 자동 해제를 assert하는 방식으로 확장할 수 있습니다.

## 실서비스 전환 대비

- 백엔드 저장소는 `FormRepository` 인터페이스(`load`/`save`)로 추상화되어 있습니다. 프로토타입은 `InMemoryFormRepository`를, 실서비스는 외부 API 구현체를 주입해 **저장소만 교체**하면 됩니다.
- 진짜 동시 텍스트 편집이 필요해지면 OT가 아니라 **CRDT(Yjs)**로 확장합니다(서버는 바이너리 델타를 STOMP로 릴레이만 하면 됩니다).

## 한계 (프로토타입)

- DB 미연동(서버 재기동 시 상태 소실), 단일 서버 가정, 인증·권한 체계 없음
- 샘플 폼은 여행 설문 15문항 / 3페이지(페이지당 5문항)로 고정
