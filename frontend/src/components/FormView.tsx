"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import type { FieldValue, Participant, Role } from "@/lib/types";
import { roleLabel } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  QUESTIONS,
  PAGE_TITLES,
  questionsOnPage,
} from "@/lib/questions";
import { useFormSync } from "@/hooks/useFormSync";
import { QuestionField } from "@/components/QuestionField";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

/** 한 역할(작성자/상담사)의 접속자들을 칩으로 나열. 같은 역할 N명을 모두 표시한다. */
function PresenceGroup({
  role,
  list,
  myClientId,
}: {
  role: Role;
  list: Participant[];
  myClientId: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">{roleLabel(role)}</span>
      <Badge
        variant="outline"
        className={list.length ? "border-green-500 text-green-600" : "text-muted-foreground"}
      >
        {list.length}명
      </Badge>
      <div className="flex flex-wrap items-center gap-1">
        {list.map((p) => {
          const isMe = p.clientId === myClientId;
          return (
            <span
              key={p.clientId}
              title={p.clientId} // 디버깅용: 전체 clientId
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                isMe
                  ? "border-primary bg-primary/5 font-medium"
                  : "border-muted-foreground/30 text-muted-foreground",
              )}
            >
              <span className="size-1.5 rounded-full bg-green-500" />
              {roleLabel(role)}
              {isMe && " (나)"}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PresenceBar({
  participants,
  myClientId,
}: {
  participants: Participant[];
  myClientId: string;
}) {
  const authors = participants.filter((p) => p.role === "AUTHOR");
  const counselors = participants.filter((p) => p.role === "COUNSELOR");
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <PresenceGroup role="AUTHOR" list={authors} myClientId={myClientId} />
      <PresenceGroup role="COUNSELOR" list={counselors} myClientId={myClientId} />
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
  const totalPages = PAGE_TITLES.length;

  const handleSubmitClick = () => {
    if (role === "AUTHOR") {
      sync.confirmSubmit(); // 작성자 직접 제출은 모달 없이 바로 (명세 §5.1)
    } else {
      sync.requestSubmit();
      toast.info("작성자에게 제출 요청을 보냈습니다");
    }
  };

  if (sync.submitted) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-4 text-center">
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
    <main className="mx-auto w-full max-w-4xl px-4 pb-28 pt-4 sm:px-6 sm:pt-6 lg:px-8">
      {/* 헤더: 폼 정보 + presence */}
      <header className="mb-4 flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold">여행 설문 조사</h1>
          {/* 폼 ID는 상대에게 공유·식별하는 키라 작게 유지. "나의 역할"은 아래 presence의 (나) 배지와 중복이라 제거 */}
          <p className="text-xs text-muted-foreground">
            폼 ID <span className="font-mono">{formId}</span>
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 lg:items-end">
          <PresenceBar participants={sync.participants} myClientId={sync.myClientId} />
          {/* 정상 연결 표시는 presence가 대신하므로 생략. 비정상(재연결 중)일 때만 노출 */}
          {!sync.connected && (
            <span className="animate-pulse text-xs text-amber-600">○ 연결 시도 중…</span>
          )}
        </div>
      </header>

      {/* 단계 표시 (Stepper) — 스크롤해도 상단 고정, 클릭 시 양방향 동기화 이동.
          음수 마진으로 main 패딩을 덮어 sticky 배경을 가로 전체로 확장한다 */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 border-b bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Stepper
          current={sync.currentPage}
          steps={PAGE_TITLES.map((label, i) => ({ value: i + 1, label }))}
          onStepClick={(page) => sync.goToPage(page)}
        />
      </div>

      {/* 현재 페이지 문항 */}
      <div className="space-y-4">
        {pageQuestions.map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            form={form}
            sync={sync}
            readOnly={sync.submitted}
          />
        ))}
      </div>

      {/* 하단 고정 바: 이전/다음(가운데) + 제출(오른쪽). 3열 그리드로 이동 버튼을 정중앙에 고정 */}
      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 p-4 backdrop-blur">
        <div className="mx-auto grid w-full max-w-4xl grid-cols-3 items-center gap-2 px-0 sm:px-2 lg:px-4">
          <div />
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="secondary"
              className="font-semibold shadow-sm"
              disabled={sync.currentPage <= 1}
              onClick={() => sync.goToPage(sync.currentPage - 1)}
            >
              <ChevronLeft className="size-4" />
              이전
            </Button>
            <Button
              variant="secondary"
              className="font-semibold shadow-sm"
              disabled={sync.currentPage >= totalPages}
              onClick={() => sync.goToPage(sync.currentPage + 1)}
            >
              다음
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSubmitClick} disabled={!sync.connected}>
              {role === "AUTHOR" ? "제출하기" : "작성자에게 제출 요청"}
            </Button>
          </div>
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
