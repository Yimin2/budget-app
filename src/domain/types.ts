/**
 * 가계부 데이터 모델 — 모든 모듈이 공유하는 단일 출처.
 * 금액은 원 단위 정수(Won). 날짜는 로컬 기준 'YYYY-MM-DD', 월은 'YYYY-MM'.
 * 시트 구조와 1:1 대응 (PLAN.md 5장). 삭제는 행을 지우지 않고 deleted=true.
 */

export type Won = number;
export type ISODate = string; // 'YYYY-MM-DD'
export type YearMonth = string; // 'YYYY-MM'
export type Timestamp = string; // ISO 8601 date-time
export type Id = string;

export type LedgerKind = 'shared' | 'personal';

/** 통장 역할. personal 가계부의 기본 통장은 allowance(용돈). */
export type AccountRole =
  | 'income' // 수입통장
  | 'fixed' // 고정지출통장 (생활비 포함)
  | 'event' // 이벤트통장
  | 'reservoir' // 저수지통장
  | 'savings' // 저축투자통장
  | 'allowance' // 용돈 (개인 가계부)
  | 'other';

export interface Account {
  id: Id;
  name: string;
  role: AccountRole;
  openingBalance: Won;
  /** 시작 잔액 기준일. 이 날짜 이후(포함)의 기록만 잔액에 반영 */
  openingDate: ISODate;
  order: number;
  deleted: boolean;
}

/** 월배분: 매달 dayOfMonth 일에 from → to 로 amount 이체 */
export interface AllocationRule {
  id: Id;
  fromAccountId: Id;
  toAccountId: Id;
  amount: Won;
  dayOfMonth: number; // 1..31 (말일보다 크면 말일)
  startMonth: YearMonth;
  endMonth: YearMonth | null; // null = 계속
  deleted: boolean;
}

export type TransferKind = 'income' | 'transfer' | 'adjustment';
export type TransferStatus = 'done' | 'planned';

/**
 * 수입·이체·잔액 조정.
 * - income: fromAccountId=null, toAccountId=받는 통장
 * - transfer: 둘 다 채움
 * - adjustment: 늘리면 toAccountId 만, 줄이면 fromAccountId 만
 */
export interface Transfer {
  id: Id;
  date: ISODate;
  kind: TransferKind;
  fromAccountId: Id | null;
  toAccountId: Id | null;
  amount: Won; // 항상 양수
  status: TransferStatus;
  ruleId: Id | null; // 월배분 자동 이체면 규칙 id
  memo: string;
  author: string; // 이메일 (체험 모드는 'demo')
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deleted: boolean;
}

/** bill=일반 고정비, living=생활비(한 달 금액, 지출로 기록하지 않음), allowance=용돈 */
export type FixedKind = 'bill' | 'living' | 'allowance';

export interface FixedExpense {
  id: Id;
  name: string;
  amount: Won;
  accountId: Id; // 기본 고정지출통장
  categoryId: Id | null;
  dayOfMonth: number | null; // living 은 null
  kind: FixedKind;
  targetEmail: string | null; // allowance 의 받는 멤버
  startMonth: YearMonth;
  endMonth: YearMonth | null;
  deleted: boolean;
}

export type EventStatus = 'planned' | 'done' | 'canceled';
export type Repeat = 'none' | 'monthly' | 'yearly';

/** 이벤트 일정. 반복 일정은 완료 시 다음 회차 행을 새로 만든다. 예측은 planned 행의 반복을 기간 안에서 펼친다. */
export interface PlannedEvent {
  id: Id;
  date: ISODate;
  name: string;
  amount: Won; // 예상 금액
  accountId: Id; // 기본 이벤트통장
  categoryId: Id | null;
  status: EventStatus;
  repeat: Repeat;
  memo: string;
  author: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deleted: boolean;
}

export interface Expense {
  id: Id;
  date: ISODate;
  amount: Won;
  accountId: Id;
  categoryId: Id | null;
  memo: string;
  eventId: Id | null; // 이벤트 일정을 쓴 지출
  fixedExpenseId: Id | null; // 자동 기록된 고정 지출 (생활비 계산에서 제외)
  author: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deleted: boolean;
}

export type MonthEndChoice = 'pending' | 'reservoir' | 'carryover';

/** 월말 처리. 월(month)이 키. */
export interface MonthEnd {
  month: YearMonth;
  leftover: Won;
  choice: MonthEndChoice;
  decidedBy: string | null;
  decidedAt: Timestamp | null;
}

export interface Category {
  id: Id;
  name: string;
  /** 아이콘 이름 (ui/icons 의 이름). 이모지는 쓰지 않는다 */
  icon: string;
  /** 이 카테고리를 고르면 자동 선택되는 통장 역할 */
  defaultAccountRole: AccountRole;
  order: number;
  deleted: boolean;
}

export interface Favorite {
  id: Id;
  name: string;
  amount: Won;
  categoryId: Id | null;
  accountId: Id | null;
  order: number;
  deleted: boolean;
}

export interface Member {
  email: string;
  displayName: string;
}

export interface LedgerSettings {
  name: string;
  kind: LedgerKind;
  /** 개인 가계부일 때 용돈을 받는 공용 가계부 id */
  sharedLedgerId: Id | null;
  schemaVersion: number;
  createdAt: Timestamp;
}

export interface LedgerData {
  settings: LedgerSettings;
  accounts: Account[];
  rules: AllocationRule[];
  transfers: Transfer[];
  fixedExpenses: FixedExpense[];
  events: PlannedEvent[];
  expenses: Expense[];
  monthEnds: MonthEnd[];
  categories: Category[];
  favorites: Favorite[];
  members: Member[];
}

/* ---------- 계산 결과 타입 ---------- */

export interface LivingStatus {
  month: YearMonth;
  /** 이번 달 생활비 = living 고정지출 합 + 지난달 이월 */
  monthBudget: Won;
  carryIn: Won;
  spent: Won; // 이번 달 생활비 지출 합 (오늘 포함)
  spentToday: Won;
  remaining: Won; // monthBudget - spent (음수 가능)
  daysLeft: number; // 오늘 포함 말일까지
  dailyBudget: Won; // 오늘 하루 고정 값
  todayAvailable: Won; // dailyBudget - spentToday (음수 가능)
  /** 생활비 지출이 나가는 통장 id (없으면 null) */
  livingAccountId: Id | null;
}

export interface ProjectionMonth {
  month: YearMonth;
  startBalance: Won;
  contributions: Won; // 아직 반영 안 된 월배분 적립
  transfersIn: Won; // 예정 이체(planned) + 오늘 뒤 날짜로 기록한 이체 들어옴
  transfersOut: Won; // 예정 이체(planned) + 오늘 뒤 날짜로 기록한 이체 나감
  planned: Won; // 그달 예정 일정 합 (반복 펼침 포함)
  extra: Won; // 가정 지출 (사도 돼? 판단용)
  /** 오늘 뒤 날짜로 이미 기록한 지출 (0 이면 생략) */
  scheduledSpending?: Won;
  endBalance: Won;
  events: { id: Id; name: string; date: ISODate; amount: Won }[];
}

export interface Shortage {
  month: YearMonth;
  amount: Won; // 모자라는 금액 (양수)
}

export interface EventProjection {
  accountId: Id | null;
  currentBalance: Won;
  monthlyContribution: Won;
  months: ProjectionMonth[];
  shortages: Shortage[];
}

export interface ShortageFix {
  /** ① 지금부터 매달 적립액 늘리기 */
  increaseMonthly: { amount: Won; fromMonth: YearMonth; toMonth: YearMonth; times: number } | null;
  /** ② 그달에 저수지에서 옮기기 */
  fromReservoir: { month: YearMonth; amount: Won; reservoirAccountId: Id; reservoirProjected: Won } | null;
}

export type Signal = 'ok' | 'warn' | 'bad';

export interface Verdict {
  signal: Signal;
  title: string; // '괜찮아요' | '가능하지만' | '비추천'
  message: string;
  details: { label: string; value: string }[];
  when: string | null; // "언제 살 수 있어?" 안내
  /** 이벤트통장 기준일 때 산 뒤 예측 */
  projectionAfter: EventProjection | null;
}

export interface AutoRecords {
  transfers: Transfer[];
  expenses: Expense[];
}
