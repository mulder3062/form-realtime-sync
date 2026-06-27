// 프로토타입 샘플: 여행 설문 조사 10문항 / 페이지당 2문항 → 총 5페이지 (명세 §6)

export type QuestionType = "TEXT" | "TEXTAREA" | "SINGLE_CHOICE" | "MULTI_CHOICE";

export interface Option {
  value: string;
  label: string;
}

export interface Question {
  id: string;
  page: number; // 1-based
  type: QuestionType;
  label: string;
  placeholder?: string;
  options?: Option[];
}

export const QUESTIONS_PER_PAGE = 2;

export const QUESTIONS: Question[] = [
  // 1페이지
  {
    id: "q_01",
    page: 1,
    type: "TEXT",
    label: "1. 성함을 입력해 주세요.",
    placeholder: "예) 홍길동",
  },
  {
    id: "q_02",
    page: 1,
    type: "SINGLE_CHOICE",
    label: "2. 선호하는 여행 스타일은 무엇인가요?",
    options: [
      { value: "relax", label: "휴양 (리조트/온천)" },
      { value: "activity", label: "액티비티 (트레킹/스포츠)" },
      { value: "culture", label: "문화/역사 탐방" },
      { value: "food", label: "미식 여행" },
    ],
  },
  // 2페이지
  {
    id: "q_03",
    page: 2,
    type: "MULTI_CHOICE",
    label: "3. 가보고 싶은 지역을 모두 선택해 주세요.",
    options: [
      { value: "domestic", label: "국내" },
      { value: "japan", label: "일본" },
      { value: "seasia", label: "동남아시아" },
      { value: "europe", label: "유럽" },
      { value: "americas", label: "미주" },
    ],
  },
  {
    id: "q_04",
    page: 2,
    type: "SINGLE_CHOICE",
    label: "4. 주로 누구와 여행하시나요?",
    options: [
      { value: "alone", label: "혼자" },
      { value: "partner", label: "연인/배우자" },
      { value: "family", label: "가족" },
      { value: "friends", label: "친구" },
    ],
  },
  // 3페이지
  {
    id: "q_05",
    page: 3,
    type: "SINGLE_CHOICE",
    label: "5. 1회 여행 예산은 어느 정도인가요?",
    options: [
      { value: "u50", label: "50만원 미만" },
      { value: "50_100", label: "50~100만원" },
      { value: "100_200", label: "100~200만원" },
      { value: "o200", label: "200만원 이상" },
    ],
  },
  {
    id: "q_06",
    page: 3,
    type: "MULTI_CHOICE",
    label: "6. 여행지에서 즐기고 싶은 활동을 선택해 주세요.",
    options: [
      { value: "sightseeing", label: "관광/명소" },
      { value: "shopping", label: "쇼핑" },
      { value: "nature", label: "자연/풍경" },
      { value: "nightlife", label: "야경/나이트라이프" },
      { value: "wellness", label: "웰니스/스파" },
    ],
  },
  // 4페이지
  {
    id: "q_07",
    page: 4,
    type: "SINGLE_CHOICE",
    label: "7. 선호하는 숙박 형태는 무엇인가요?",
    options: [
      { value: "hotel", label: "호텔" },
      { value: "resort", label: "리조트" },
      { value: "guesthouse", label: "게스트하우스" },
      { value: "airbnb", label: "민박/에어비앤비" },
    ],
  },
  {
    id: "q_08",
    page: 4,
    type: "TEXTAREA",
    label: "8. 가장 기억에 남는 여행 경험을 적어 주세요.",
    placeholder: "자유롭게 작성해 주세요.",
  },
  // 5페이지
  {
    id: "q_09",
    page: 5,
    type: "SINGLE_CHOICE",
    label: "9. 연간 여행 횟수는 어느 정도인가요?",
    options: [
      { value: "1", label: "연 1회" },
      { value: "2_3", label: "연 2~3회" },
      { value: "4_5", label: "연 4~5회" },
      { value: "6+", label: "연 6회 이상" },
    ],
  },
  {
    id: "q_10",
    page: 5,
    type: "TEXTAREA",
    label: "10. 여행 서비스에 바라는 점이나 자유 의견을 남겨 주세요.",
    placeholder: "자유롭게 작성해 주세요.",
  },
];

export const TOTAL_PAGES = Math.max(...QUESTIONS.map((q) => q.page));

export const questionById = (id: string): Question | undefined =>
  QUESTIONS.find((q) => q.id === id);

export const questionsOnPage = (page: number): Question[] =>
  QUESTIONS.filter((q) => q.page === page);
