# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 현재 상태

프로토타입 구현 완료. 모든 구현 결정의 기준 문서는 `form-realtime-sync-spec.md`이며, 변경 전에 반드시 참조한다. 명세서는 한국어로 작성되어 있고, 산출물·주석·커뮤니케이션도 한국어를 사용한다.

> `frontend/AGENTS.md` 주의: 이 프로젝트의 Next.js는 16.x로 학습 데이터와 다른 breaking change가 있다. 코드 작성 전 `frontend/node_modules/next/dist/docs/`의 해당 가이드를 확인한다. 예: `params`/`searchParams`는 Promise라 `await` 필요.

## 빌드 · 실행 · 테스트

**Backend** (`backend/`, Gradle wrapper):
- 실행: `./gradlew bootRun` (기본 8080 포트, 점유 시 `--args='--server.port=18080'`)
- 컴파일: `./gradlew compileJava` / 테스트: `./gradlew test` (단일: `./gradlew test --tests '클래스명'`)

**Frontend** (`frontend/`, npm):
- 개발 서버: `npm run dev` (3000 포트)
- 타입 체크: `npx tsc --noEmit` / 빌드: `npm run build` / 린트: `npm run lint`
- 백엔드 주소는 `NEXT_PUBLIC_WS_URL`(기본 `http://localhost:8080/ws`)로 주입. 백엔드 포트를 바꿨다면 `frontend/.env.local`에 이 값을 지정한다.

**E2E 동작 확인**: 브라우저 탭 둘 이상에서 같은 폼 ID로 각각 `?role=author`, `?role=counselor` 입장(랜딩 페이지에서 선택). 같은 역할로 여러 명 입장해도 된다. STOMP 레벨 통합 검증은 `@stomp/stompjs` + `sockjs-client`로 두 클라이언트를 띄워 스냅샷·브로드캐스트·락 자동해제를 assert하는 방식으로 한다(`frontend/node_modules`에서 ESM 실행).

## 프로젝트 개요

Google Forms 형태의 폼 서비스에 **작성자와 상담사 간 실시간 화면 미러링/양방향 동기화**를 더한 프로토타입. 작성자가 폼 작성 중 도움을 요청하면 상담사가 폼 ID로 접속해 작성자의 현재 상태(값 + 현재 페이지 + 포커스)를 그대로 공유하고, 페이지 이동·문항 포커스·필드 편집을 양방향으로 동기화한다. 접속 구분은 작성자(`AUTHOR`)/상담사(`COUNSELOR`) 두 역할뿐이며, **같은 역할이 N명 동시 접속 가능**하다(개별 식별은 역할이 아니라 `clientId`). **DB 없이 서버 인메모리만 사용하는 프로토타입**이다.

## 기술 스택 & 모노레포 구조

git mono repo. 경로는 `frontend/`(Next.js + Shadcn/ui)와 `backend/`(Spring Boot)로 분리한다.

- **Frontend**: Next.js, Shadcn/ui, `@stomp/stompjs` + `sockjs-client`, react-hook-form (Node 22)
- **Backend**: Spring Boot REST + WebSocket(STOMP over SockJS), 내장 SimpleBroker (Java 21)
- 세부 라이브러리 버전은 2026년 6월 시점 최신 안정 버전 사용
- 단일 서버 가정, 수평 확장·미들웨어·Redis·DB 없음

빌드/테스트/실행 명령은 아직 스캐폴딩이 없으므로, 프로젝트를 생성할 때 표준 도구(`frontend`는 npm/Next.js, `backend`는 Gradle/Maven + Spring Boot)를 사용하고 이 파일에 명령을 추가한다.

## 핵심 아키텍처 (반드시 지켜야 하는 불변 규칙)

이 시스템의 정합성은 아래 규칙들의 **상호 의존**에 달려 있다. 하나라도 어기면 재연결·신규 접속 시 화면이 영구히 어긋난다.

1. **서버 인메모리가 Source of Truth.** 폼 상태는 백엔드 `Map<formId, FormState>`(`FormStore`)에 보관한다. `FormState`는 단순 답변값뿐 아니라 `currentPage`, `focusedQuestionId`, `submitted`, `locks`(questionId → clientId)를 포함해야 "작성자가 보던 화면 그대로"가 성립한다.

2. **모든 데이터/네비게이션 이벤트는 브로드캐스트 시 반드시 `FormState`를 갱신한다.** 이벤트 컨트롤러(`@MessageMapping`)에서 PAGE_CHANGE / FOCUS_QUESTION / FIELD_UPDATE / FIELD_LOCK / FIELD_UNLOCK / FORM_SUBMITTED는 상태를 갱신하고, SUBMIT_REQUEST / USER_* 는 갱신 없이 릴레이만 한다. 갱신을 빠뜨리면 스냅샷이 옛 값을 내려보낸다.

3. **접속 시 스냅샷 핸드셰이크 — 구독을 먼저, 스냅샷 요청을 나중에.** 클라이언트는 `onConnect`에서 `(1) /topic/form/{formId} 구독 → (2) 스냅샷 요청` 순서를 지킨다. 구독이 늦으면 스냅샷 수신 중 흐른 델타가 유실되어 해당 필드가 영구히 어긋난다. 백엔드는 `@SubscribeMapping`으로 `FormSnapshot`(현재 전체 상태 `state` + 접속자 목록 `participants`)을 1회 내려준다. 이 시점엔 신규 접속자의 `USER_JOIN` 등록 전이라 `participants`엔 기존 접속자만 담기고, 신규 접속자는 로컬에서 자기 자신을 합친다.

4. **재연결 = 신규 접속.** STOMP에는 재전송 메커니즘이 없으므로, `@stomp/stompjs`의 `onConnect`(최초 + 모든 재연결마다 호출됨)에서 항상 "구독 → 스냅샷 재요청 → 전체 상태 덮어쓰기"를 수행한다. 첫 접속과 재접속을 같은 코드로 처리하는 것이 핵심. heartbeat 10초 + `reconnectDelay`로 조용한 단절을 감지·복구한다.

5. **무한 루프 가드와 presence는 역할이 아니라 `clientId`(UUID)로 한다.** 접속 시 `crypto.randomUUID()`로 생성한 `clientId`를 모든 메시지 payload에 싣고, 수신 시 `event.clientId === myClientId`면 무시한다. 역할(`AUTHOR`/`COUNSELOR`)이 아니라 clientId를 쓰는 이유: 익명 STOMP 연결에서 `Principal`이 null이라 Principal 핸드셰이크를 통째로 생략할 수 있고(NPE 회피), **같은 역할이 N명 접속해도 각각을 구분**할 수 있기 때문이다. presence도 `clientId` 단위 참가자 목록으로 관리해 한 명이 끊겨도(`USER_LEAVE`는 해당 `clientId`만 제거) 같은 역할의 나머지는 유지된다.

## 충돌 정책

- **Last-Write-Wins (LWW)** 가 기본. 객관식·페이지·포커스는 "병합" 개념이 없으므로 LWW가 정답이다.
- **텍스트 필드만 소프트 락**으로 동시 편집을 회피한다(OT/CRDT 미사용). 텍스트 필드 focus → `FIELD_LOCK`, blur → `FIELD_UNLOCK`. 상대 화면은 해당 칸을 disabled + "OOO 입력 중" 배지로 표시. **disconnect 시 서버가 해당 clientId의 락을 자동 해제**(데드락 방지).
- 실서비스에서 진짜 동시 텍스트 편집이 필요해지면 OT가 아니라 **CRDT(Yjs)** 로 확장한다(서버는 바이너리 델타를 STOMP로 릴레이만, 별도 Node 서버 불필요). 지금 구현하지는 않는다.

## 제출 흐름 (2단계, 권한 분리)

제출 확정 권한은 **작성자만** 보유한다. 상담사는 `SUBMIT_REQUEST`만 보낼 수 있고, 작성자 화면에 `AlertDialog` 확인 모달이 떠 작성자가 직접 확정하면 `FORM_SUBMITTED`를 브로드캐스트한다. 작성자가 직접 제출할 땐 모달 없이 바로 `FORM_SUBMITTED`. "동기화는 양방향, 제출 확정은 작성자 단방향"이라는 핵심 제약이다.

## 동기화 이벤트 & 메시지 포맷

Topic: `/topic/form/{formId}`. 모든 메시지는 공통으로 `type`, `clientId`(발신자 UUID), `role`(`AUTHOR`|`COUNSELOR`), `payload`를 포함한다. 전체 이벤트 타입과 payload 예시는 명세서 §5에 있다: `PAGE_CHANGE`, `FOCUS_QUESTION`, `FIELD_UPDATE`, `FIELD_LOCK`/`FIELD_UNLOCK`, `SUBMIT_REQUEST`/`FORM_SUBMITTED`, `USER_JOIN`/`USER_LEAVE`. 스냅샷 응답은 `FormSnapshot { state, participants }` 형태다(참가자 = `{ clientId, role }`).

## 흔히 놓치는 함정 (시연 성패 직결)

- **CORS/Origin 설정 필수.** Next.js(3000)와 Spring(8080) 포트가 다르므로 `registry.addEndpoint("/ws").setAllowedOriginPatterns("http://localhost:3000").withSockJS()` 가 없으면 연결 자체가 안 된다. 데모 직전 가장 흔한 사고.
- **페이지 점프 후 스크롤 타이밍.** 다른 페이지로 이동 후 `scrollIntoView` 하려면, 페이지 상태(`currentPage`)를 의존성으로 하는 `useEffect`에서 스크롤한다. `requestAnimationFrame` 한 번으로는 새 페이지 DOM이 그려지기 전이라 `getElementById`가 null을 반환할 수 있다. 패턴: 목표 questionId를 `pendingFocus` 상태로 예약 → 페이지 이동 → `useEffect([currentPage, pendingFocus])`에서 실제 스크롤.
- **텍스트 입력은 300ms 디바운스 후 전송**(객관식은 클릭 즉시). 단, **제출 확정 직전에 보류 중인 디바운스 입력을 flush**해야 마지막 타이핑이 유실되지 않는다.
- **react-hook-form 외부 값 주입은 `setValue(qId, value, { shouldValidate: false, shouldDirty: false })`** 로 한다. clientId 가드(규칙 5)와 함께 쓰지 않으면 무한 루프가 생긴다.
- `ConcurrentHashMap`은 맵 구조만 보호한다. 같은 `FormState` 내부 필드 동시 변경은 보호하지 않으므로 불변 객체 통째 교체 또는 formId 단위 동기화를 고려한다(소수 인원 시나리오라 실제 충돌 확률은 낮음).

## 실서비스 전환 대비 추상화

백엔드는 `FormRepository` 인터페이스(`load`/`save`)로 저장소를 추상화한다. 프로토타입은 `InMemoryFormRepository`, 실서비스는 `ExternalApiFormRepository`로 **이것만 교체**하면 되도록 설계한다.

## 샘플 폼 데이터

명세상 최종 폼은 60문항 / 6페이지(페이지당 10개)지만, **프로토타입 샘플은 여행 설문 조사 주제의 15문항 / 페이지당 5문항(총 3페이지)**으로 준비한다. 페이지 이동 UI는 하단 페이지네이션 대신 상단 Stepper(`components/ui/stepper.tsx`)로 단계를 표시하며, 단계 클릭 시 `goToPage`로 양방향 동기화한다. 각 페이지 단계 라벨은 `questions.ts`의 `PAGE_TITLES`로 관리한다.
