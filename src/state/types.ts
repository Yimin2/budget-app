import type {
  Account, AllocationRule, Category, EventProjection, Expense, Favorite, FixedExpense, Id,
  ISODate, LedgerData, LivingStatus, PendingMonthEnd, PlannedEvent, ShortageFix, Transfer, Verdict, Won, YearMonth,
} from '@/domain/types';
import type { LedgerRef } from '@/storage/types';

export type SessionMode = 'google' | 'demo';

export interface SessionUser {
  email: string; // 체험 모드 'minji@demo' (DEMO_USER)
  name: string;
  picture: string | null;
}

/** 로그인·가계부 선택 상태 (앱 전체) */
export interface SessionApi {
  status: 'loading' | 'signedOut' | 'signedIn';
  mode: SessionMode | null;
  user: SessionUser | null;
  /** 구글 로그인 가능 여부 (환경 변수 설정됨) */
  googleAvailable: boolean;
  signInWithGoogle(): Promise<void>;
  startDemo(): Promise<void>;
  signOut(): void;
  /** 최근 연 가계부 목록 (브라우저 저장) */
  recentLedgers: LedgerRef[];
  activeLedger: LedgerRef | null;
  selectLedger(ref: LedgerRef): void;
  createLedger(input: { kind: 'shared' | 'personal'; name: string; sharedLedgerId?: string | null }): Promise<LedgerRef>;
  /** 공유받은 가계부 열기 (sheets: 구글 파일 선택 창) */
  openSharedLedger(): Promise<LedgerRef | null>;
  forgetLedger(id: string): void;
  /** 구글 연결 다시 맺기 (버튼 클릭 안에서). 조용한 복구가 막혀 가계부를 못 불러올 때 */
  reconnectGoogle(): Promise<void>;
}

export interface NewExpense {
  date: ISODate;
  amount: Won;
  accountId: Id;
  categoryId: Id | null;
  memo?: string;
  eventId?: Id | null;
}
export interface NewEvent {
  date: ISODate;
  name: string;
  amount: Won;
  accountId?: Id; // 기본 이벤트통장
  categoryId?: Id | null;
  repeat?: PlannedEvent['repeat'];
  memo?: string;
}

/** 선택된 가계부의 데이터·계산값·행동 */
export interface LedgerApi {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** 오류가 구글 연결 끊김(토큰을 조용히 받지 못함 · 401)이라 '구글 다시 연결'이 필요한지 */
  needsReconnect: boolean;
  ref: LedgerRef | null;
  data: LedgerData | null;
  today: ISODate;
  saving: boolean;
  reload(): Promise<void>;

  // 계산값 (data 가 있을 때)
  living: LivingStatus | null;
  balances: Record<Id, Won>;
  eventProjection: EventProjection | null;
  shortageFix: ShortageFix | null;
  pendingMonthEnd: PendingMonthEnd | null;
  activeAccounts: Account[];
  activeCategories: Category[];
  /** 그 역할의 첫 통장 (순서대로). 수입통장은 사람마다 있을 수 있어 incomeAccounts 도 봐요 */
  accountByRole(role: Account['role']): Account | null;
  /** 수입 역할 통장 모두 (사람별 수입통장, 순서대로) */
  incomeAccounts: Account[];
  /**
   * "사도 돼?" 판단. living 은 생활비 항목(categoryId, null = 카테고리 없는 묶음)으로 판단해요.
   * categoryId 를 안 주면(undefined) 항목이 하나뿐일 때만 그 항목으로, 여럿이면 null
   */
  judge(amount: Won, source: 'living' | 'event', categoryId?: Id | null): Verdict | null;

  // 지출
  addExpense(input: NewExpense): Promise<Expense>;
  updateExpense(expense: Expense): Promise<void>;
  deleteExpense(id: Id): Promise<void>;
  // 일정
  addEvent(input: NewEvent): Promise<PlannedEvent>;
  updateEvent(event: PlannedEvent): Promise<void>;
  /** 실제 금액으로 완료: 지출 기록 + 상태 done + 반복이면 다음 회차 생성 */
  completeEvent(id: Id, actualAmount: Won, date?: ISODate): Promise<void>;
  cancelEvent(id: Id): Promise<void>;
  deleteEvent(id: Id): Promise<void>;
  // 부족 대처
  applyIncreaseMonthly(fix: NonNullable<ShortageFix['increaseMonthly']>): Promise<void>;
  applyFromReservoir(fix: NonNullable<ShortageFix['fromReservoir']>): Promise<void>;
  // 통장·이체
  saveAccount(account: Account): Promise<void>;
  addAccount(
    input: Pick<Account, 'name' | 'role' | 'openingBalance'> & Partial<Pick<Account, 'ownerName' | 'ownerEmail'>>,
  ): Promise<Account>;
  addTransfer(input: Pick<Transfer, 'date' | 'kind' | 'fromAccountId' | 'toAccountId' | 'amount' | 'memo'>): Promise<void>;
  deleteTransfer(id: Id): Promise<void>;
  adjustBalance(accountId: Id, actual: Won): Promise<void>;
  // 설정
  saveRule(rule: AllocationRule): Promise<void>;
  addRule(input: Omit<AllocationRule, 'id' | 'deleted'>): Promise<AllocationRule>;
  /** 적립액 변경: 기존 규칙을 지난달로 끝내고 이번 달부터 새 규칙 */
  changeRuleAmount(ruleId: Id, amount: Won): Promise<void>;
  saveFixed(fixed: FixedExpense): Promise<void>;
  addFixed(input: Omit<FixedExpense, 'id' | 'deleted'>): Promise<FixedExpense>;
  saveCategory(category: Category): Promise<void>;
  addCategory(input: Omit<Category, 'id' | 'deleted' | 'order'>): Promise<Category>;
  saveFavorite(favorite: Favorite): Promise<void>;
  addFavorite(input: Omit<Favorite, 'id' | 'deleted' | 'order'>): Promise<Favorite>;
  /** 즐겨찾기 한 번에 기록 */
  recordFavorite(id: Id): Promise<Expense>;
  // 월말
  decideMonthEnd(choice: 'reservoir' | 'carryover'): Promise<void>;
  // 멤버
  inviteMember(email: string, displayName: string): Promise<void>;
  renameLedger(name: string): Promise<void>;
  displayName(email: string): string;
}
