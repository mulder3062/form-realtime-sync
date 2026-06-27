// 백엔드 com.example.formsync.model 과 1:1 대응 (명세 §4.2, §5)

export type Role = "A" | "B";

export type EventType =
  | "PAGE_CHANGE"
  | "FOCUS_QUESTION"
  | "FIELD_UPDATE"
  | "FIELD_LOCK"
  | "FIELD_UNLOCK"
  | "SUBMIT_REQUEST"
  | "FORM_SUBMITTED"
  | "USER_JOIN"
  | "USER_LEAVE";

export type FieldValue = string | string[];

export interface Payload {
  page?: number;
  questionId?: string;
  type?: string;
  value?: FieldValue;
  submittedAt?: string;
}

export interface FormEvent {
  type: EventType;
  clientId: string;
  role: Role;
  payload: Payload;
}

/** 서버 인메모리 스냅샷 (명세 §4.2) */
export interface FormState {
  formId: string;
  answers: Record<string, FieldValue>;
  currentPage: number;
  focusedQuestionId: string | null;
  submitted: boolean;
  locks: Record<string, string>; // questionId → clientId
}

export const roleLabel = (role: Role): string =>
  role === "A" ? "작성자 A" : "상담사 B";
