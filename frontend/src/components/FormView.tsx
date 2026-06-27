"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { FieldValue, Role } from "@/lib/types";
import { roleLabel } from "@/lib/types";
import {
  QUESTIONS,
  PAGE_TITLES,
  questionsOnPage,
} from "@/lib/questions";
import { useFormSync } from "@/hooks/useFormSync";
import { QuestionField } from "@/components/QuestionField";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Stepper } from "@/components/ui/stepper";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function PresenceBadge({ role, online }: { role: Role; online: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Avatar className="size-8">
        <AvatarFallback className={online ? "bg-green-100 text-green-700" : "bg-muted"}>
          {role}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-medium">{roleLabel(role)}</span>
        <Badge
          variant="outline"
          className={online ? "border-green-500 text-green-600" : "text-muted-foreground"}
        >
          {online ? "접속 중" : "오프라인"}
        </Badge>
      </div>
    </div>
  );
}

export default function FormView({ formId, role }: { formId: string; role: Role }) {
  const form = useForm<Record<string, FieldValue>>({
    defaultValues: Object.fromEntries(
      QUESTIONS.map((q) => [q.id, q.type === "MULTI_CHOICE" ? [] : ""]),
    ),
  });
  const sync = useFormSync(formId, role, form);

  // 페이지 점프 후 DOM 렌더 완료 시점에 스크롤 (명세 §6 타이밍 안전 처리)
  useEffect(() => {
    if (!sync.pendingFocus) return;
    const el = document.getElementById(sync.pendingFocus);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary");
      window.setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 1500);
      sync.clearPendingFocus();
    }
    // currentPage 가 바뀌어 새 페이지가 렌더된 뒤 재실행되어야 한다
  }, [sync.currentPage, sync.pendingFocus, sync]);

  const pageQuestions = questionsOnPage(sync.currentPage);

  const handleSubmitClick = () => {
    if (role === "A") {
      sync.confirmSubmit(); // A 직접 제출은 모달 없이 바로 (명세 §5.1)
    } else {
      sync.requestSubmit();
      toast.info("작성자 A에게 제출 요청을 보냈습니다");
    }
  };

  if (sync.submitted) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="text-5xl">✅</div>
        <h1 className="text-2xl font-bold">제출이 완료되었습니다</h1>
        <p className="text-muted-foreground">
          폼 ID <span className="font-mono font-medium">{formId}</span> 의 응답이 제출되었습니다.
        </p>
        {sync.submittedAt && (
          <p className="text-sm text-muted-foreground">
            제출 시각: {new Date(sync.submittedAt).toLocaleString("ko-KR")}
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-4 pb-28 sm:p-6 sm:pb-28">
      {/* 헤더: 폼 정보 + presence */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-xl font-bold">여행 설문 조사</h1>
          <p className="text-sm text-muted-foreground">
            폼 ID <span className="font-mono">{formId}</span> · 나의 역할{" "}
            <span className="font-medium">{roleLabel(role)}</span>
          </p>
          <p className="mt-1 text-xs">
            <span
              className={
                sync.connected
                  ? "text-green-600"
                  : "animate-pulse text-amber-600"
              }
            >
              {sync.connected ? "● 실시간 연결됨" : "○ 연결 시도 중…"}
            </span>
          </p>
        </div>
        <div className="flex gap-4">
          <PresenceBadge role="A" online={sync.presence.A} />
          <PresenceBadge role="B" online={sync.presence.B} />
        </div>
      </header>

      {/* 단계 표시 (Stepper) — 클릭 시 양방향 동기화 이동 */}
      <Stepper
        className="mb-6"
        current={sync.currentPage}
        steps={PAGE_TITLES.map((label, i) => ({ value: i + 1, label }))}
        onStepClick={(page) => sync.goToPage(page)}
      />

      {/* 현재 페이지 문항 */}
      <div className="space-y-4">
        {pageQuestions.map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            form={form}
            sync={sync}
            role={role}
            readOnly={sync.submitted}
          />
        ))}
      </div>

      {/* 하단 고정 바: 제출 (단계 이동은 상단 Stepper에서 처리) */}
      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 p-4 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-end">
          <Button onClick={handleSubmitClick} disabled={!sync.connected}>
            {role === "A" ? "제출하기" : "작성자에게 제출 요청"}
          </Button>
        </div>
      </div>

      {/* A 화면 제출 확인 모달 (명세 §5.1) */}
      <AlertDialog open={sync.submitRequestFrom !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>제출 요청</AlertDialogTitle>
            <AlertDialogDescription>
              {sync.submitRequestFrom && roleLabel(sync.submitRequestFrom)}가 폼 제출을 요청했습니다.
              지금 제출하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={sync.dismissSubmitRequest}>취소</AlertDialogCancel>
            <AlertDialogAction onClick={sync.confirmSubmit}>제출 확정</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
