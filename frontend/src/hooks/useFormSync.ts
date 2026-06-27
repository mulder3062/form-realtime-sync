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
  type FormState,
  type Payload,
  type Role,
  roleLabel,
} from "@/lib/types";
import { questionById } from "@/lib/questions";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:8080/ws";

export interface Presence {
  A: boolean;
  B: boolean;
}

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
  const myClientId = useRef<string>(
    typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36),
  ).current;

  const [connected, setConnected] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [locks, setLocks] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [submitRequestFrom, setSubmitRequestFrom] = useState<Role | null>(null);
  const [presence, setPresence] = useState<Presence>({
    A: role === "A",
    B: role === "B",
  });

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
    (s: FormState) => {
      Object.entries(s.answers ?? {}).forEach(([qId, value]) => {
        form.setValue(qId, value, { shouldValidate: false, shouldDirty: false });
      });
      setCurrentPage(s.currentPage || 1);
      if (s.focusedQuestionId) setPendingFocus(s.focusedQuestionId);
      setLocks(s.locks ?? {});
      setSubmitted(Boolean(s.submitted));
    },
    [form],
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
          // 제출 확정 권한은 A만 → A 화면에서만 확인 모달 (명세 §5.1)
          if (role === "A") setSubmitRequestFrom(event.role);
          break;
        case "FORM_SUBMITTED":
          setSubmitted(true);
          setSubmittedAt(p.submittedAt ?? new Date().toISOString());
          setSubmitRequestFrom(null);
          break;
        case "USER_JOIN":
          setPresence((prev) => ({ ...prev, [event.role]: true }));
          if (event.role !== role) toast.success(`${roleLabel(event.role)}가 접속했습니다`);
          break;
        case "USER_LEAVE":
          setPresence((prev) => ({ ...prev, [event.role]: false }));
          if (event.role !== role) toast.warning(`${roleLabel(event.role)}의 연결이 끊겼습니다`);
          break;
      }
    },
    [form, myClientId, role],
  );

  // --- 연결/재연결 ---
  useEffect(() => {
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
          if (msg.body) applySnapshot(JSON.parse(msg.body) as FormState);
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
  }, [formId, handleIncoming, applySnapshot, sendEvent]);

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

  return {
    myClientId,
    connected,
    currentPage,
    pendingFocus,
    clearPendingFocus,
    locks,
    isLockedByOther,
    submitted,
    submittedAt,
    submitRequestFrom,
    presence,
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
