"use client";

import { Controller, type UseFormReturn } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { LocateFixed } from "lucide-react";
import type { FieldValue } from "@/lib/types";
import { roleLabel } from "@/lib/types";
import type { Question } from "@/lib/questions";
import type { FormSyncApi } from "@/hooks/useFormSync";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  question: Question;
  form: UseFormReturn<Record<string, FieldValue>>;
  sync: FormSyncApi;
  readOnly: boolean;
}

export function QuestionField({ question, form, sync, readOnly }: Props) {
  const lockedByOther = sync.isLockedByOther(question.id);
  const lockOwnerRole = sync.lockOwnerRole(question.id);
  const disabled = readOnly || lockedByOther;
  const isText = question.type === "TEXT" || question.type === "TEXTAREA";

  // 텍스트는 타이핑마다 전송하면 과부하 → 300ms 디바운스 (명세 §9.3)
  const debouncedSend = useDebouncedCallback((value: string) => {
    sync.updateField(question.id, question.type, value);
  }, 300);

  // 포커스/블러 → 텍스트 필드 소프트 락 (명세 §5.2). 객관식은 락 불필요.
  const handleFocus = () => {
    sync.focusQuestion(question.id);
    if (isText) sync.lockField(question.id);
  };
  const handleBlur = () => {
    if (isText) {
      debouncedSend.flush(); // 보류 입력 flush 후 락 해제
      sync.unlockField(question.id);
    }
  };

  // 답을 작성하지 않고도 "이 문항을 같이 보자"고 상대 화면을 이동시키는 길잡이.
  // 문항 제목 클릭 → FOCUS_QUESTION 발신 → 상대가 해당 페이지·문항으로 스크롤(명세 §5).
  // 카드 전체가 아니라 제목만 트리거로 둬서 읽다가 누른 오발신/입력요소 클릭과 충돌을 피한다.
  const shareFocus = () => {
    if (readOnly) return;
    sync.focusQuestion(question.id);
    const el = document.getElementById(question.id); // 보낸 쪽에도 짧게 하이라이트로 피드백
    if (el) {
      el.classList.add("ring-2", "ring-primary");
      window.setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 800);
    }
  };

  return (
    <Card id={question.id} className="scroll-mt-24">
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={shareFocus}
            disabled={readOnly}
            title="클릭하면 상대 화면을 이 문항으로 이동시킵니다"
            className="group/share flex flex-1 items-start gap-1.5 text-left disabled:cursor-default"
          >
            <span className="text-base font-medium leading-relaxed">{question.label}</span>
            <LocateFixed className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition group-hover/share:opacity-100" />
          </button>
          {lockedByOther && (
            <Badge variant="secondary" className="shrink-0 animate-pulse">
              {lockOwnerRole ? roleLabel(lockOwnerRole) : "상대방"} 입력 중
            </Badge>
          )}
        </div>

        <Controller
          control={form.control}
          name={question.id}
          defaultValue={question.type === "MULTI_CHOICE" ? [] : ""}
          render={({ field }) => {
            switch (question.type) {
              case "TEXT":
                return (
                  <Input
                    {...field}
                    value={(field.value as string) ?? ""}
                    placeholder={question.placeholder}
                    disabled={disabled}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    onChange={(e) => {
                      field.onChange(e.target.value);
                      debouncedSend(e.target.value);
                    }}
                  />
                );
              case "TEXTAREA":
                return (
                  <Textarea
                    {...field}
                    value={(field.value as string) ?? ""}
                    placeholder={question.placeholder}
                    rows={4}
                    disabled={disabled}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    onChange={(e) => {
                      field.onChange(e.target.value);
                      debouncedSend(e.target.value);
                    }}
                  />
                );
              case "SINGLE_CHOICE":
                return (
                  <RadioGroup
                    value={(field.value as string) ?? ""}
                    disabled={disabled}
                    onValueChange={(v) => {
                      field.onChange(v);
                      sync.focusQuestion(question.id);
                      sync.updateField(question.id, question.type, v); // 클릭 즉시 전송
                    }}
                    className="gap-2"
                  >
                    {question.options?.map((opt) => (
                      <div key={opt.value} className="flex items-center gap-2">
                        <RadioGroupItem value={opt.value} id={`${question.id}_${opt.value}`} />
                        <Label htmlFor={`${question.id}_${opt.value}`} className="font-normal">
                          {opt.label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                );
              case "MULTI_CHOICE": {
                const selected: string[] = Array.isArray(field.value)
                  ? (field.value as string[])
                  : [];
                const toggle = (value: string, checked: boolean) => {
                  const next = checked
                    ? [...selected, value]
                    : selected.filter((v) => v !== value);
                  field.onChange(next);
                  sync.focusQuestion(question.id);
                  sync.updateField(question.id, question.type, next); // 클릭 즉시 전송
                };
                return (
                  <div className="space-y-2">
                    {question.options?.map((opt) => (
                      <div key={opt.value} className="flex items-center gap-2">
                        <Checkbox
                          id={`${question.id}_${opt.value}`}
                          checked={selected.includes(opt.value)}
                          disabled={disabled}
                          onCheckedChange={(c) => toggle(opt.value, Boolean(c))}
                        />
                        <Label htmlFor={`${question.id}_${opt.value}`} className="font-normal">
                          {opt.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                );
              }
              default:
                return <span />;
            }
          }}
        />
      </CardContent>
    </Card>
  );
}
