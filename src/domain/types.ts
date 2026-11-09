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
  /**
   * 통장 주인 (사람별 수입통장). 표시 이름 — 아직 가계부에 들어오지 않은 사람도 이름만으로 둘 수 있다.
   * 빈 셀은 null (주인 없는 공용 통장)
   */
  ownerName: string | null;
  /** 주인 이메일 (선택). 빈 셀은 null */
  ownerEmail: string | null;
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

/** bill=일반 고정비, living=생활비 항목 예산(한 달 금액, 지출로 기록하지 않음), allowance=용돈 */
export type FixedKind = 'bill' | 'living' | 'allowance';

/**
 * 생활비 항목을 쓰는 방식.
 * daily=하루에 나눠 쓰기 (하루 예산 = (남은 돈 + 오늘 쓴 돈) ÷ 남은 일수)
 * monthly=한 달 한도만 (이번 달 남은 돈만 본다)
 */
export type LivingSpread = 'daily' | 'monthly';

export interface FixedExpense {
  id: Id;
  name: string;
  amount: Won;
  accountId: Id; // 기본 고정지출통장
  /**
   * living 은 예산 항목을 정하는 카테고리. null 이면 예전 방식의 '생활비' 한 줄
   * (예산 없는 카테고리 지출과 카테고리 없는 지출이 모두 이 항목으로 들어간다)
   */
  categoryId: Id | null;
  dayOfMonth: number | null; // living 은 null
  kind: FixedKind;
  targetEmail: string | null; // allowance 의 받는 멤버
  /**
   * living 항목을 쓰는 방식. living 이 아니면 쓰지 않는다 (값은 'daily').
   * 시트 빈 셀은 'daily' (예전 시트의 생활비 한 줄도 지금처럼 하루에 나눠 쓴다)
   */
  spread: LivingSpread;
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
  /**
   * 청구(돌려받기, PLAN 4-9): 개인 돈으로 낸 사람 이름. 비어 있으면(null · 없음) 통장에서 바로 나간 보통 지출.
   * 청구 지출은 accountId(함께 쓰는 통장)의 예산·일정에는 바로 잡히지만, 그 통장 잔액에서는 돌려줄 때
   * (이체 claim:<지출id>) 빠진다. 시트 빈 셀은 null
   */
  paidBy?: string | null;
  /** 청구: 낸 사람의 통장 (돌려받을 통장, 보통 그 사람 수입통장). 없으면 null — 잔액은 어느 통장에서도 빠지지 않는다 */
  claimAccountId?: Id | null;
  /** 청구: 돌려줄 날 (정산일). 빈 셀이면 지출 날짜 기준 다음 정산일로 본다 */
  claimDue?: ISODate | null;
  author: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deleted: boolean;
}

export type MonthEndChoice = 'pending' | 'reservoir' | 'carryover';

/** 월말 항목별 남은 돈. categoryId=null 은 예전 '생활비' 한 줄 또는 '기타(예산 없음)' 묶음 */
export interface MonthEndItem {
  categoryId: Id | null;
  leftover: Won; // 음수 가능 (넘긴 항목)
}

/** 월말 처리. 월(month)이 키. */
export interface MonthEnd {
  month: YearMonth;
  /** 항목별 남은 돈의 합 */
  leftover: Won;
  choice: MonthEndChoice;
  decidedBy: string | null;
  decidedAt: Timestamp | null;
  /**
   * 항목별 남은 돈 (0 인 항목은 뺀다). 이월이면 같은 항목의 다음 달 예산에 더해진다.
   * null = 예전 기록 (항목 구분 없음) → 이월 금액 전체가 categoryId=null 묶음으로 간다
   */
  items: MonthEndItem[] | null;
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
  /**
   * 청구 정산일(매달 며칠). null · 없음 = 자동: 수입통장 → 이벤트통장 매달 배분의 이체일, 그것도 없으면 21일 (PLAN 4-9)
   */
  settleDay?: number | null;
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

/** 생활비 항목 하나의 이번 달 상태 (PLAN 4-1) */
export interface LivingItem {
  /** 예산 항목 카테고리. null = 예전 '생활비' 한 줄 또는 '기타(예산 없음)' 묶음 */
  categoryId: Id | null;
  name: string;
  /** UI 키트 Icon 이름 */
  icon: string;
  spread: LivingSpread;
  /** 이번 달 예산 행 합 (이월 빼고) */
  base: Won;
  /** base + 지난달 이월 */
  monthBudget: Won;
  carryIn: Won;
  spent: Won;
  spentToday: Won;
  remaining: Won; // monthBudget - spent (음수 가능)
  /** daily 항목만. monthly 는 null */
  dailyBudget: Won | null;
  /** daily 항목만 (dailyBudget - spentToday, 음수 가능). monthly 는 null */
  todayAvailable: Won | null;
  /** 예산 행 없이 지출·이월만 있는 '기타(예산 없음)' 묶음 */
  unbudgeted: boolean;
}

export interface LivingStatus {
  month: YearMonth;
  /** 이번 달 생활비 전체 = 항목 monthBudget 합 */
  monthBudget: Won;
  carryIn: Won;
  spent: Won; // 이번 달 생활비 지출 합 (오늘 포함)
  spentToday: Won;
  remaining: Won; // monthBudget - spent (음수 가능) = 항목 remaining 합
  daysLeft: number; // 오늘 포함 말일까지
  /** daily 항목의 dailyBudget 합 */
  dailyBudget: Won;
  /** daily 항목의 todayAvailable 합 — 홈의 큰 숫자 (음수 가능) */
  todayAvailable: Won;
  /** 생활비 지출이 나가는 통장 id (없으면 null) */
  livingAccountId: Id | null;
  /** 항목별 상태. 카테고리 순서, categoryId=null 묶음은 맨 뒤 */
  items: LivingItem[];
}

/** 아직 고르지 않은 월말 처리 (항목별 남은 돈 포함) */
export interface PendingMonthEnd {
  month: YearMonth;
  leftover: Won;
  items: (MonthEndItem & { name: string; icon: string })[];
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
  /** 그달 돌려줄 청구 (아직 안 돌려준 개인 돈 지출, 정산일 기준. 지난 정산일은 이번 달). 0 이면 생략 */
  claims?: Won;
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

/** 아직 돌려주지 않은 청구 하나 (PLAN 4-9) */
export interface PendingClaim {
  expense: Expense;
  /** 낸 사람 이름 */
  payer: string;
  amount: Won;
  /** 돌려주는 통장 (지출의 통장) */
  accountId: Id;
  /** 돌려받을 통장 (없으면 null) */
  claimAccountId: Id | null;
  /** 돌려줄 날 */
  due: ISODate;
  /** 정산일이 오늘이거나 지났는지 */
  dueNow: boolean;
}

export interface ClaimSummary {
  /** 돌려받을 돈 합 */
  total: Won;
  /** 사람별 합 (많은 순) */
  byPayer: { name: string; amount: Won }[];
  /** 가장 이른 정산일 (없으면 null) */
  nextDue: ISODate | null;
  /** 오늘 돌려줄 청구 (정산일이 오늘이거나 지남), 정산일 순 */
  dueNow: PendingClaim[];
  /** 아직 안 돌려준 청구 모두, 정산일 순 */
  pending: PendingClaim[];
}
