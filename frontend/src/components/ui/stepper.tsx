"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepperStep {
  /** 1-based 단계 번호 */
  value: number;
  label: string;
}

interface StepperProps {
  steps: StepperStep[];
  /** 현재 활성 단계(1-based) */
  current: number;
  /** 단계 클릭 시 이동 (생략 시 클릭 비활성) */
  onStepClick?: (value: number) => void;
  className?: string;
}

export function Stepper({ steps, current, onStepClick, className }: StepperProps) {
  return (
    <ol className={cn("flex w-full items-center", className)}>
      {steps.map((step, idx) => {
        const isCompleted = step.value < current;
        const isActive = step.value === current;
        const isLast = idx === steps.length - 1;
        const clickable = Boolean(onStepClick);

        return (
          <li
            key={step.value}
            className={cn("flex items-center", !isLast && "flex-1")}
          >
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onStepClick?.(step.value)}
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md p-1 text-left transition-colors",
                clickable && "hover:bg-accent",
                !clickable && "cursor-default",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors",
                  isActive &&
                    "border-primary bg-primary text-primary-foreground",
                  isCompleted &&
                    "border-primary bg-primary/10 text-primary",
                  !isActive &&
                    !isCompleted &&
                    "border-muted-foreground/30 text-muted-foreground",
                )}
              >
                {isCompleted ? <Check className="size-4" /> : step.value}
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-xs text-muted-foreground">
                  {step.value}단계
                </span>
                <span
                  className={cn(
                    "text-sm font-medium",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
              </span>
            </button>

            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  "mx-2 h-px flex-1 transition-colors",
                  isCompleted ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
