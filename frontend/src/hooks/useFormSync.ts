"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import {
  type EventType,
  type FieldValue,
  type FormEvent,
  type FormSnapshot,
  type Participant,
  type Payload,
  type Role,
  roleLabel,
} from "@/lib/types";
import { questionById } from "@/lib/questions";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:8080/ws";

/**
 * 실시간 동기화 훅 (명세 §9.1).
 *
 * 핵심 불변식:
 *  - onConnect는 최초 + 모든 재연결마다 호출 → 항상 "구독 먼저 → 스냅샷" (명세 §4.2/§4.6)
 *  - 수신 가드는 역할이 아니라 clientId (명세 §4.4)
 *  - 폼 값은 react-hook-form 에 주입(setValue), 그 외 상태는 훅이 보관
 */
export function useFormSync(
  formId: string,
  role: Role,
  form: UseFormReturn<Record<string, FieldValue>>,
) {
  const clientRef = useRef<Client | null>(null);
  // clientId는 클라이언트에서만 1회 생성한다. SSR 단계에서 만들면 서버/클라이언트 값이 달라
  // hydration mismatch가 난다(렌더에 쓰이는 title 속성 등). 마운트 후 effect에서 생성한다.
  const [myClientId, setMyClientId] = useState<string>("");

  const [connected, setConnected] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [locks, setLocks] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [submitRequestFrom, setSubmitRequestFrom] = useState<Role | null>(null);
  // presence는 clientId 단위 참가자 목록. clientId 생성(아래 effect) 시 나 자신을 시드한다.
  const [participants, setParticipants] = useState<Participant[]>([]);

  // 마운트(클라이언트) 시 clientId 1회 생성 + 참가자 목록에 나 자신 추가.
  // 초기 렌더(SSR=빈 목록)와 클라이언트 첫 렌더가 일치하므로 hydration mismatch가 없다.
  // 클라이언트 전용 1회 초기화라 effect 내 setState가 의도된 패턴(lazy init은 SSR/CSR 값이 갈려 불가).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    setMyClientId(id);
    setParticipants([{ clientId: id, role }]);
  }, [role]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // --- 송신 ---
  const sendEvent = useCallback(
    (type: EventType, payload: Payload) => {
      clientRef.current?.publish({
        destination: `/app/form/${formId}/event`,
        body: JSON.stringify({ type, clientId: myClientId, role, payload }),
      });
    },
    [formId, role, myClientId],
  );

  // --- 스냅샷 적용 (신규 + 재연결 공통, 명세 §4.6) ---
  const applySnapshot = useCallback(
    (snap: FormSnapshot) => {
      const s = snap.state;
      Object.entries(s.answers ?? {}).forEach(([qId, value]) => {
        form.setValue(qId, value, { shouldValidate: false, shouldDirty: false });
      });
      setCurrentPage(s.currentPage || 1);
      if (s.focusedQuestionId) setPendingFocus(s.focusedQuestionId);
      setLocks(s.locks ?? {});
      setSubmitted(Boolean(s.submitted));
      // 서버가 준 기존 접속자 + 나 자신을 합쳐 참가자 목록을 재구성(clientId 중복 제거)
      setParticipants(() => {
        const merged = new Map<string, Participant>();
        merged.set(myClientId, { clientId: myClientId, role });
        (snap.participants ?? []).forEach((p) => merged.set(p.clientId, p));
        return Array.from(merged.values());
      });
    },
    [form, myClientId, role],
  );

  // --- 수신 → 내 화면에 반영 ---
  const handleIncoming = useCallback(
    (event: FormEvent) => {
      if (event.clientId === myClientId) return; // 루프 방지 가드 (명세 §4.4)
      const p = event.payload ?? {};

      switch (event.type) {
        case "PAGE_CHANGE":
          if (typeof p.page === "number") {
            setCurrentPage(p.page);
            toast.info(`${roleLabel(event.role)}가 ${p.page}페이지로 이동했습니다`);
          }
          break;
        case "FOCUS_QUESTION": {
          const q = p.questionId ? questionById(p.questionId) : undefined;
          if (q) {
            setCurrentPage(q.page); // 페이지 이동(비동기 커밋) 후 useEffect 에서 스크롤
            setPendingFocus(q.id);
          }
          break;
        }
        case "FIELD_UPDATE":
          if (p.questionId !== undefined) {
            form.setValue(p.questionId, p.value as FieldValue, {
              shouldValidate: false,
              shouldDirty: false,
            });
          }
          break;
        case "FIELD_LOCK":
          if (p.questionId) {
            setLocks((prev) => ({ ...prev, [p.questionId as string]: event.clientId }));
          }
          break;
        case "FIELD_UNLOCK":
          if (p.questionId) {
            setLocks((prev) => {
              const next = { ...prev };
              delete next[p.questionId as string];
              return next;
            });
          }
          break;
        case "SUBMIT_REQUEST":
          // 제출 확정 권한은 작성자만 → 작성자 화면에서만 확인 모달 (명세 §5.1)
          if (role === "AUTHOR") setSubmitRequestFrom(event.role);
          break;
        case "FORM_SUBMITTED":
          setSubmitted(true);
          setSubmittedAt(p.submittedAt ?? new Date().toISOString());
          setSubmitRequestFrom(null);
          break;
        case "USER_JOIN":
          // clientId 단위로 추가(같은 역할 N명 구분). 자기 자신은 위 가드에서 이미 걸러짐.
          setParticipants((prev) =>
            prev.some((x) => x.clientId === event.clientId)
              ? prev
              : [...prev, { clientId: event.clientId, role: event.role }],
          );
          toast.success(`${roleLabel(event.role)}가 접속했습니다`);
          break;
        case "USER_LEAVE":
          // 끊긴 clientId만 제거 → 같은 역할의 다른 사용자는 그대로 유지
          setParticipants((prev) => prev.filter((x) => x.clientId !== event.clientId));
          toast.warning(`${roleLabel(event.role)}의 연결이 끊겼습니다`);
          break;
      }
    },
    [form, myClientId, role],
  );

  // --- 연결/재연결 ---
  useEffect(() => {
    if (!myClientId) return; // clientId 생성 후에만 연결(메시지에 발신자 식별자 필수)
    const client = new Client({
      webSocketFactory: () => new SockJS(WS_URL),
      reconnectDelay: 3000, // 자동 재연결
      heartbeatIncoming: 10000, // 조용한 단절 감지
      heartbeatOutgoing: 10000,
      onConnect: () => {
        // (1) 토픽 먼저 구독 → (2) 스냅샷 요청  순서 중요 (레이스 컨디션 방지, 명세 §4.2)
        client.subscribe(`/topic/form/${formId}`, (msg) =>
          handleIncoming(JSON.parse(msg.body) as FormEvent),
        );
        // @SubscribeMapping 은 구독 즉시 현재 스냅샷을 같은 목적지로 1회 직접 응답한다
        client.subscribe(`/app/form/${formId}/snapshot`, (msg) => {
          if (msg.body) applySnapshot(JSON.parse(msg.body) as FormSnapshot);
        });
        setConnected(true);
        sendEvent("USER_JOIN", {});
      },
      onWebSocketClose: () => setConnected(false),
    });

    clientRef.current = client;
    client.activate();
    return () => {
      void client.deactivate();
      clientRef.current = null;
    };
  }, [formId, myClientId, handleIncoming, applySnapshot, sendEvent]);

  // --- 공개 액션 ---
  const goToPage = useCallback(
    (page: number) => {
      setCurrentPage(page);
      sendEvent("PAGE_CHANGE", { page });
    },
    [sendEvent],
  );

  const focusQuestion = useCallback(
    (questionId: string) => sendEvent("FOCUS_QUESTION", { questionId }),
    [sendEvent],
  );

  const updateField = useCallback(
    (questionId: string, type: string, value: FieldValue) =>
      sendEvent("FIELD_UPDATE", { questionId, type, value }),
    [sendEvent],
  );

  const lockField = useCallback(
    (questionId: string) => sendEvent("FIELD_LOCK", { questionId }),
    [sendEvent],
  );

  const unlockField = useCallback(
    (questionId: string) => sendEvent("FIELD_UNLOCK", { questionId }),
    [sendEvent],
  );

  const requestSubmit = useCallback(() => sendEvent("SUBMIT_REQUEST", {}), [sendEvent]);

  const confirmSubmit = useCallback(() => {
    const at = new Date().toISOString();
    setSubmitted(true);
    setSubmittedAt(at);
    setSubmitRequestFrom(null);
    sendEvent("FORM_SUBMITTED", { submittedAt: at });
  }, [sendEvent]);

  const dismissSubmitRequest = useCallback(() => setSubmitRequestFrom(null), []);
  const clearPendingFocus = useCallback(() => setPendingFocus(null), []);

  const isLockedByOther = useCallback(
    (questionId: string) => {
      const owner = locks[questionId];
      return Boolean(owner) && owner !== myClientId;
    },
    [locks, myClientId],
  );

  // 해당 문항을 잠근 사용자의 역할(배지 표시용). 참가자 목록에서 clientId로 역추적.
  const lockOwnerRole = useCallback(
    (questionId: string): Role | null => {
      const owner = locks[questionId];
      if (!owner || owner === myClientId) return null;
      return participants.find((p) => p.clientId === owner)?.role ?? null;
    },
    [locks, myClientId, participants],
  );

  return {
    myClientId,
    connected,
    currentPage,
    pendingFocus,
    clearPendingFocus,
    locks,
    isLockedByOther,
    lockOwnerRole,
    submitted,
    submittedAt,
    submitRequestFrom,
    participants,
    // actions
    goToPage,
    focusQuestion,
    updateField,
    lockField,
    unlockField,
    requestSubmit,
    confirmSubmit,
    dismissSubmitRequest,
  };
}

export type FormSyncApi = ReturnType<typeof useFormSync>;
