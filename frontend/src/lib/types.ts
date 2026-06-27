// 백엔드 com.example.formsync.model 과 1:1 대응 (명세 §4.2, §5)

// 접속 구분은 작성자/상담사 두 가지뿐. 같은 역할이 N명 접속할 수 있으며
// 개별 사용자 식별은 역할이 아니라 clientId(UUID)로 한다.
export type Role = "AUTHOR" | "COUNSELOR";

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

/** 서버 인메모리 상태 (명세 §4.2) */
export interface FormState {
  formId: string;
  answers: Record<string, FieldValue>;
  currentPage: number;
  focusedQuestionId: string | null;
  submitted: boolean;
  locks: Record<string, string>; // questionId → clientId
}

/** 현재 접속 중인 참가자 (clientId 단위) */
export interface Participant {
  clientId: string;
  role: Role;
}

/** 접속 시 1회 수신하는 스냅샷: 폼 상태 + 현재 접속자 목록 */
export interface FormSnapshot {
  state: FormState;
  participants: Participant[];
}

export const roleLabel = (role: Role): string =>
  role === "AUTHOR" ? "작성자" : "상담사";
