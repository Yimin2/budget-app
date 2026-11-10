import type { LivingView } from '@/domain/living';
import type { Spender } from '@/domain/household';
import type { AnnualDraft } from '@/domain/annual';
import type {
  Account, AllocationRule, Category, ClaimSummary, EventProjection, Expense, Favorite, FixedExpense, Id, IncomePlan,
  InstallmentHint, InstallmentPlan, ISODate, LedgerData, LivingStatus, PendingMonthEnd, PlannedEvent, ShortageFix, Transfer,
  Trip, TripItem, TripStatus, Verdict, Won, YearMonth,
} from '@/domain/types';
import type { TripInput } from '@/domain/trips';
import type { InstallmentInput, InstallmentPatch } from '@/domain/installments';
import type { ImportFile, ImportPlan } from '@/domain/importFile';
import type { Settlement } from '@/domain/settlement';
import type { BudgetTable } from '@/domain/budgetMonth';
import type { CategoryMergePlan } from '@/domain/categoryMerge';
import type { LedgerRef } from '@/storage/types';
import type { DirectOpenResult, InviteOpenResult } from './invite';

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
  /** 로그인 화면에 보여 줄 안내 (예: '로그인이 만료됐어요. 다시 로그인해 주세요'). 없으면 null */
  notice: string | null;
  /** 구글 로그인 가능 여부 (환경 변수 설정됨) */
  googleAvailable: boolean;
  /**
   * 구글로 시작하기. 로그인 서버가 있으면 구글 로그인 화면으로 이동하고(돌아오면 returnTo, 기본은 지금 주소) 끝나지 않아요.
   * 없으면 팝업 동의 창
   */
  signInWithGoogle(opts?: { returnTo?: string }): Promise<void>;
  startDemo(): Promise<void>;
  /** everywhere: 구글에 앱 권한 철회까지 (모든 기기에서 로그아웃) */
  signOut(opts?: { everywhere?: boolean }): void;
  /** 최근 연 가계부 목록 (브라우저 저장) */
  recentLedgers: LedgerRef[];
  activeLedger: LedgerRef | null;
  selectLedger(ref: LedgerRef): void;
  createLedger(input: { kind: 'shared' | 'personal'; name: string; sharedLedgerId?: string | null }): Promise<LedgerRef>;
  /** 공유받은 가계부 열기 (sheets: 구글 파일 선택 창) */
  openSharedLedger(): Promise<LedgerRef | null>;
  /**
   * 초대 링크(/start?open=<id>)로 열기 (구글 모드만). 바로 읽히면 그대로 열고, 아니면 그 파일을 미리 골라 둔 선택 창을 띄워요.
   * 열리면 최근 목록에 넣고 지금 가계부로 골라요. 선택 창을 닫으면 { kind: 'cancelled' }
   */
  openInvitedLedger(spreadsheetId: string): Promise<InviteOpenResult>;
  /**
   * 선택 창 없이 바로 열기 (아이폰 홈 화면 앱 · 앱 안 브라우저, 구글 모드만). 열리면 최근 목록에 넣고 지금 가계부로 골라요.
   * 아직 이 앱에 허락되지 않은 파일이면 { kind: 'denied' } (Safari 에서 한 번 골라야 해요)
   */
  openLedgerDirect(spreadsheetId: string): Promise<DirectOpenResult>;
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
  /**
   * 개인 돈으로 낸 사람 이름 (청구, PLAN 4-9). 주면 돌려받을 통장(그 사람 수입통장)과 정산일을 정해 함께 적어요.
   * 이벤트통장 · 고정지출통장 · 저수지통장 지출만 돼요
   */
  paidBy?: string | null;
  /** 여행에 쓴 돈이면 여행 id (PLAN 4-11). 통장은 실제로 나간 통장 그대로 */
  tripId?: Id | null;
  /** 여행 항목 (항공 · 숙박 …). 비우면 기타 */
  tripItem?: TripItem | null;
  /** 예외 (평소 지출 아님, PLAN 4-2): '평소 쓰는 돈' 계산에서 빼요. 잔액에는 그대로 들어가요 */
  excluded?: boolean;
}
/** 새 여행 · 여행 고치기 (PLAN 4-11): 이름 · 떠나는 날 · 돌아오는 날 · 총예산 · 항목 예산(선택) */
export type NewTrip = TripInput;
/** 새 할부 (PLAN 4-10): 이름 · 총액 또는 매달 금액 · 개월 · 첫 달 · 결제일 · 통장 · 카테고리 */
export type NewInstallment = InstallmentInput;

/**
 * 할부 고치기. fromMonth(기본: 아직 내지 않은 다음 회차의 달)부터 적용하고 지난 회차는 그대로 둬요.
 * monthly · remaining 을 안 주면 지금 그대로. name 은 모든 회차 이름에
 */
export interface InstallmentChange extends InstallmentPatch {
  monthly?: Won;
  remaining?: number;
  fromMonth?: YearMonth;
}

export interface NewEvent {
  date: ISODate;
  name: string;
  amount: Won;
  accountId?: Id; // 기본 이벤트통장
  categoryId?: Id | null;
  repeat?: PlannedEvent['repeat'];
  memo?: string;
  /** 음력 반복 'MM-DD' (매년일 때만) */
  lunar?: string;
}

/** 선택된 가계부의 데이터·계산값·행동 */
/** 고치기 · 취소하기 전 행 (되돌리기용) */
export interface RowSnapshot {
  expenses: Expense[];
  transfers: Transfer[];
}

export interface LedgerApi {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** 오류가 구글 연결 끊김(토큰을 조용히 받지 못함 · 401)이라 '구글 다시 연결'이 필요한지 */
  needsReconnect: boolean;
  ref: LedgerRef | null;
  data: LedgerData | null;
  today: ISODate;
  saving: boolean;
  /** 시트에서 다시 읽기 (새로고침 버튼 · 당겨서 새로고침도 이걸 불러요). 저장 중인 쓰기와 합쳐요 */
  reload(): Promise<void>;
  /**
   * 시트와 맞춘 상태 (PLAN 7). syncing: 읽는 중 · syncedAt: 마지막으로 맞춘 시각(ISO) ·
   * fromCache: 보관한 내용을 보여 주는 중(아직 시트에서 못 읽음) · offline: 시트를 못 읽어 읽기 전용(쓰기는 막혀요)
   */
  sync: { syncing: boolean; syncedAt: string | null; fromCache: boolean; offline: boolean };
  /** 지금 시각 (테스트에서 고정한 시계를 따라가요) */
  now(): Date;

  // 계산값 (data 가 있을 때)
  /** 생활비 (사람별 생활비 통장이 여럿이면 모두 합친 것) */
  living: LivingStatus | null;
  /** 생활비 통장마다의 생활비 (PLAN 4-14, 통장 순서). 통장이 하나면 한 줄 */
  livingViews: LivingView[];
  /**
   * 로그인한 사람의 생활비 통장 (멤버와 이어진 통장). 이어진 통장이 없고 생활비 통장이 여럿이면 null —
   * 첫 통장을 짐작하지 않아요 (체험 모드는 첫 통장)
   */
  myLivingAccountId: Id | null;
  /** 내가 어느 생활비 통장과도 이어지지 않았을 때 고를 통장 주인 이름 (홈 '누가 나인지 골라 주세요'). 필요 없으면 빈 목록 */
  meChoices: string[];
  /** '이 사람이 나예요': 주인 이름이 ownerName 이고 주인 이메일이 빈 통장을 모두 내 이메일과 이어요 (한 번에 저장) */
  claimOwner(ownerName: string): Promise<void>;
  /** 열 때 시트를 자동으로 고쳤으면 한 번 보여 줄 알림 (예: '통장 주인을 멤버와 이었어요'). 보여 준 뒤 dismissNotice */
  notice: string | null;
  dismissNotice(): void;
  /** 이 생활비 통장의 생활비 (안 주면 나). 통장이 하나뿐이면 living 과 같다 */
  livingFor(accountId?: Id | null): LivingStatus | null;
  /** '누가 썼나요?'에서 고를 사람 (가계부의 사람, 그 사람의 생활비 통장과 함께) */
  spenders: Spender[];
  /** 로그인한 사람의 spenders 키 */
  mySpenderKey: string | null;
  balances: Record<Id, Won>;
  eventProjection: EventProjection | null;
  shortageFix: ShortageFix | null;
  pendingMonthEnd: PendingMonthEnd | null;
  activeAccounts: Account[];
  activeCategories: Category[];
  /** 고르는 목록(기록 창 · 사도 돼? 칩 · 설정의 카테고리 고르기)에 보일 카테고리: 지우지 않고 숨기지 않은 것, 순서대로 */
  pickableCategories: Category[];
  /** 최근 90일 카테고리마다 쓴 점수 (가까울수록 무겁게). 기록 창의 자주 쓴 카테고리 6개에 써요 */
  categoryScores: Map<Id, number>;
  /** 그 역할의 첫 통장 (순서대로). 수입통장은 사람마다 있을 수 있어 incomeAccounts 도 봐요 */
  accountByRole(role: Account['role']): Account | null;
  /** 수입 역할 통장 모두 (사람별 수입통장, 순서대로) */
  incomeAccounts: Account[];
  /**
   * "사도 돼?" 판단. living 은 생활비 항목(categoryId, null = 카테고리 없는 묶음)으로 판단해요.
   * categoryId 를 안 주면(undefined) 항목이 하나뿐일 때만 그 항목으로, 여럿이면 null
   */
  judge(
    amount: Won,
    source: 'living' | 'event',
    categoryId?: Id | null,
    opts?: { tripId?: Id | null; livingAccountId?: Id | null },
  ): Verdict | null;

  // 청구 (개인 돈으로 내고 돌려받기)
  /** 돌려받을 돈 요약 (data 가 있을 때) */
  claims: ClaimSummary | null;
  /** 낸 사람으로 고를 수 있는 이름 (이 가계부의 멤버, 이어진 통장 주인 이름으로 한 번씩) */
  claimPayers: string[];
  /** 이 통장에서 이 금액을 개인 돈으로 내면 돌려줄 날 (청구할 수 없는 통장이면 null). expenseId: 고치는 지출 */
  previewClaimDue(accountId: Id, amount: Won, expenseId?: Id): ISODate | null;
  /**
   * 돌려줬어요: 청구마다 이체 claim:<지출id> (함께 쓰는 통장 → 낸 사람 통장, 없으면 받는 통장 없이)를 남겨요.
   * 이미 돌려준 청구는 건너뛰어 다시 눌러도 한 번만 기록돼요
   */
  settleClaims(expenseIds: Id[], date?: ISODate): Promise<void>;
  /** 돌려준 기록 되돌리기 (이체를 지워요. 저수지에서 빌려 지급했으면 빌린 이체도) */
  unsettleClaims(expenseIds: Id[]): Promise<void>;
  /** 이번 달 정산 (이벤트통장이 있을 때) — 지급할 수 있는 돈 · 사람별 지급 · 넘어가는 돈 · 저수지 몫 · 갚을 돈 */
  settlement: Settlement | null;
  /** 이벤트통장이 갚을 돈으로 바꿀 수 있는 저수지 지출 (이벤트 카테고리 · 일정 · 여행) */
  loanCandidates: Expense[];
  /**
   * 저수지에서 빌려 지급: 청구마다 빌린 이체 loan:claim:<지출id>(저수지 → 이벤트통장)와 돌려준 이체 claim:<지출id>를 남겨요.
   * 다시 눌러도 같은 키라 하나씩만 남아요
   */
  borrowAndSettleClaims(expenseIds: Id[]): Promise<void>;
  /**
   * 저수지에서 빌려 지급 (저수지통장의 이벤트 청구): 지출을 이벤트통장으로 옮기고 loan:claim:<id>(저수지 → 이벤트통장) ·
   * claim:<id>(이벤트통장 → 낸 사람)를 남겨요. 다시 눌러도 하나씩
   */
  borrowReservoirClaims(expenseIds: Id[]): Promise<void>;
  /** 저수지에서 이미 돌려준 이벤트 청구를 저수지에 갚을 돈으로 바꾸기 (잔액 그대로) */
  convertSettledReservoirClaims(expenseIds: Id[]): Promise<void>;
  /** 위 두 가지 되돌리기 (borrowed = 아직 안 돌려준 청구로, converted = 저수지에서 돌려준 청구로) */
  undoReservoirClaims(expenseIds: Id[], mode: 'borrowed' | 'converted'): Promise<void>;
  /**
   * 지급 취소 (정산 화면 '지급한 기록'): 돌려준 이체와 빌린 이체(있으면)를 지우고, 빌려 지급하며 옮긴 저수지 지출은 저수지로 되돌려요.
   * 다시 해도 같아요. 바꾸기 전 행을 돌려줘요 (restoreRows 로 되돌리기)
   */
  undoClaimPayments(expenseIds: Id[]): Promise<RowSnapshot>;
  /** 빌린 기록만 취소 (지급은 그대로). 옮긴 저수지 지출이면 지출 · 돌려준 이체를 저수지로 되돌려요 */
  cancelClaimLoans(expenseIds: Id[]): Promise<RowSnapshot>;
  /** 갚은 기록(loanpay:) 또는 지출을 바꾼 빌린 기록(loan:<지출id>) 하나 취소 */
  cancelLoanTransfer(transferId: Id): Promise<RowSnapshot>;
  /** 빌린 · 갚은 이체의 금액만 고치기 (저수지에 갚을 돈 셈만 바뀌어요) */
  updateLoanAmount(transferId: Id, amount: Won): Promise<RowSnapshot>;
  /** 위 고치기 · 취소 되돌리기: 바꾸기 전 행을 다시 써요 */
  restoreRows(snapshot: RowSnapshot): Promise<void>;
  /** 저수지에 갚았어요: 이번 달 이체 loanpay:<월> (이벤트통장 → 저수지) */
  repayLoan(amount: Won): Promise<void>;
  /** 이번 달 갚은 기록 되돌리기 */
  undoRepayLoan(): Promise<void>;
  /** 저수지에서 쓴 이벤트 지출을 이벤트통장이 갚을 돈으로 바꾸기 (지출 통장 → 이벤트통장, 이체 loan:<지출id>) */
  convertToLoan(expenseIds: Id[]): Promise<void>;
  /** 갚을 돈으로 바꾼 것 되돌리기 */
  unconvertLoan(expenseIds: Id[]): Promise<void>;
  /** 정산일(매달 며칠). null = 자동 (수입통장 → 이벤트통장 배분 이체일, 없으면 21일) */
  saveSettleDay(day: number | null): Promise<void>;
  /** 쉬는 날 목록 (회사 휴무 등). '공휴일 빼기' 생활비 항목은 이 날도 빼요 (PLAN 4-1) */
  saveDaysOff(days: ISODate[]): Promise<void>;
  /** '매년 돌아오는 일' 제안 중 숨긴 키 목록 (설정 '숨긴매년제안', 가계부에 저장돼 함께 쓰는 사람도 같아요) */
  saveDismissedRecurring(keys: string[]): Promise<void>;

  // 할부
  /** 할부 상태 (진행 중 먼저) */
  installments: InstallmentPlan[];
  /** 큰 금액이면 "12개월 할부면 매달 ○원"과 그 금액이 맞는지 (생활비 항목 예산 · 이벤트통장 예측 기준). 아니면 null */
  /** opts.tripId: 사도 돼?에서 고른 여행 (judge 와 같게 회차를 그 여행에 묶어 본다) */
  installmentHint(
    amount: Won,
    source: 'living' | 'event',
    categoryId?: Id | null,
    opts?: { tripId?: Id | null; livingAccountId?: Id | null },
  ): InstallmentHint | null;
  /** 할부 추가. 결제일이 지난 회차는 이미 낸 것으로 보고 기록하지 않아요. 할부 id 를 돌려줘요 */
  addInstallment(input: NewInstallment): Promise<Id>;
  /** 도중에 고치기: 다음 회차부터(또는 fromMonth 부터) 새 금액 · 남은 회차. 지난 회차와 자동 기록은 그대로 */
  reviseInstallment(planId: Id, change: InstallmentChange): Promise<void>;
  /**
   * 미리 갚기: 지출(id prepay:…)을 남기고, 다음 회차부터 남은 금액을 줄여 다시 짜요.
   * keep='monthly' 는 매달 금액 그대로 회차를 줄이고, 'months' 는 회차 그대로 매달 금액을 줄여요
   */
  prepayInstallment(planId: Id, input: { amount: Won; keep: 'monthly' | 'months'; date?: ISODate }): Promise<void>;
  /** 그만 내기: 다음 회차부터 기록하지 않아요 */
  endInstallment(planId: Id): Promise<void>;
  /** 할부 지우기 (모든 행). 이미 자동 기록된 지출은 남아요 */
  deleteInstallment(planId: Id): Promise<void>;

  // 여행 (이벤트통장에서 나가는 여행 예산)
  /** 여행 상태 (여행 중 → 다가오는 여행 → 지난 여행) */
  trips: TripStatus[];
  /** 여행 추가. 여행 id 를 돌려줘요 */
  addTrip(input: NewTrip): Promise<Trip>;
  /** 여행 고치기 (이름 · 날짜 · 예산 · 항목 예산). 묶은 지출은 그대로 */
  updateTrip(id: Id, input: NewTrip): Promise<void>;
  /** 여행 지우기 (삭제됨). 묶은 지출은 남고 예측에서만 빠져요 */
  deleteTrip(id: Id): Promise<void>;
  /** 지운 여행 되살리기 */
  restoreTrip(id: Id): Promise<void>;

  // 파일에서 가져오기 (PLAN 4-12)
  /** 가져오기 미리보기: 무엇이 몇 개 더해지고 무엇을 합치는지 (쓰지 않아요). data 가 없으면 null */
  previewImport(file: ImportFile): ImportPlan | null;
  /**
   * 가져오기: 지금 데이터로 계획을 다시 만들어 써요 (문제가 있으면 쓰지 않고 오류). 쓴 계획을 돌려줘요.
   * 행 id 가 파일의 source · key 로 정해져 같은 파일을 다시 가져와도 행이 늘지 않아요
   */
  importFile(file: ImportFile): Promise<ImportPlan>;

  // 지출
  addExpense(input: NewExpense): Promise<Expense>;
  updateExpense(expense: Expense): Promise<void>;
  deleteExpense(id: Id): Promise<void>;
  /**
   * 지출 여러 건의 예외(평소 지출 아님) 표시를 한 번에 저장 (PLAN 4-2 '예외 지출 빼기'). 지금과 같은 것 · 없는 지출은 건너뛰고,
   * 실제로 바꾼 건수를 돌려줘요
   */
  setExpenseExclusions(changes: { id: Id; excluded: boolean }[]): Promise<number>;
  // 일정
  addEvent(input: NewEvent): Promise<PlannedEvent>;
  /** 매년 일정 한 번에 등록 (PLAN 4-3). 이미 있는 시리즈는 건너뛰고 새로 넣은 행을 돌려줘요 */
  registerAnnualEvents(drafts: AnnualDraft[]): Promise<PlannedEvent[]>;
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
  /** id 를 주면 그 id 로 (용돈 배분 `allowance-rule-…`), 없으면 새 id */
  addRule(input: Omit<AllocationRule, 'id' | 'deleted'> & { id?: string }): Promise<AllocationRule>;
  /**
   * 적립액 변경: 기존 규칙을 지난달로 끝내고 이번 달부터 새 규칙. fromMonth 를 주면 그 달부터
   * ([배분 금액 맞추기]는 다음 배분의 달부터)
   */
  changeRuleAmount(ruleId: Id, amount: Won, fromMonth?: YearMonth): Promise<void>;
  /**
   * 고정비 금액 변경 (언제부터 from, PLAN 4-15): 앞 행을 from 전날로 끝내고 '<id>@<from>' 새 행. 그 행의 첫 결제 전이면 그 자리에서.
   * from 뒤 결제가 이미 기록됐으면 오류 (지난 기록은 그대로)
   */
  changeFixedAmount(rowId: Id, amount: Won, from: ISODate): Promise<void>;
  /**
   * 생활비 항목 저장 (PLAN 4-1). 금액 · 쓰는 방식 · 쓰는 날이 바뀌면 이번 달부터만: 앞 행은 지난달로 끝내고 '<id>@<이번 달>' 새 행.
   * 이번 달에 시작한 행은 그 자리에서. 끝내거나 지우면 끝 달 뒤 '이 달만 다른 금액'도 지워요
   */
  saveLivingItem(rowId: Id, next: FixedExpense): Promise<void>;
  /** 생활비 항목의 '이 달만 다른 금액' (그 달만 평소 금액 대신). amount=null 이면 지우기 */
  setLivingOverride(rowId: Id, month: YearMonth, amount: Won | null): Promise<void>;
  /** 고정비 끝내기: end = 해지일 (그 뒤 시작하는 행은 지움), null = 모든 행 지우기 */
  endFixedSeries(seriesId: Id, end: ISODate | null): Promise<void>;
  /** 수입 계획 추가 (PLAN 4-13). 받는 날이 지난 이번 달 회차는 바로 기록해요 */
  addIncomePlan(input: Omit<IncomePlan, 'id' | 'deleted'> & { id?: string }): Promise<IncomePlan>;
  /** 수입 계획 고치기 · 지우기 (deleted). 이미 생긴 수입 기록은 그대로 */
  saveIncomePlan(plan: IncomePlan): Promise<void>;
  saveFixed(fixed: FixedExpense): Promise<void>;
  addFixed(input: Omit<FixedExpense, 'id' | 'deleted'> & { id?: string }): Promise<FixedExpense>;
  // 예산 달별 보기 (작업정리 13)
  /** [전달 복사]: 이번 달 예산 중 다음 달에도 이어지는 행을 이번 달로 끝내고 '<id>@<다음 달>' 행을 다음 달부터 (설정 '준비한달' = 다음 달) */
  prepareNextMonth(): Promise<void>;
  /** [초기화]: 다음 달 표시가 붙은 행을 지우고 앞 행의 끝을 되돌려요 — 다시 이번 달 예산이 이어져요 (설정 '준비한달' 비움) */
  resetNextMonth(): Promise<void>;
  /** 다음 달 화면에서 고치기 전에 이번 달과 걸친 행을 나눠요. 다음 달 행 id (나눌 것이 없으면 그대로) */
  splitForNextMonth(table: BudgetTable, rowId: Id): Promise<Id>;
  saveCategory(category: Category): Promise<void>;
  /**
   * 카테고리를 delta 칸 옮겨요 (-1 = 위로, +1 = 아래로). 순서(order)를 0..n-1 로 다시 매기고 바뀐 행만 한 번에 저장해요.
   * 못 옮기면(맨 위 · 맨 아래) false. 모든 화면이 이 순서를 따라요
   */
  moveCategory(id: Id, delta: number): Promise<boolean>;
  /** 끌어 놓기: 순서의 toIndex 번째(0부터)로 옮기고 바뀐 행을 한 번에 저장해요 (먼저 화면에, 실패하면 되돌림). 못 옮기면 false */
  moveCategoryTo(id: Id, toIndex: number): Promise<boolean>;
  addCategory(input: Omit<Category, 'id' | 'deleted' | 'order'>): Promise<Category>;
  /** 카테고리 숨기기 · 다시 보기 (여럿 한 번에, 바뀐 행만 저장). 바꾼 개수 */
  setCategoriesHidden(ids: Id[], hidden: boolean): Promise<number>;
  /**
   * 카테고리 합치기: source 의 지출 · 생활비 예산 · 고정비 · 자주 쓰는 지출 · 일정을 target 으로 옮기고 source 를 지운 것으로 표시해요.
   * 표마다 한 번에 저장하고, 다시 해도 같아요. 돌려준 plan 으로 undoCategoryMerge 하면 되돌려요
   */
  mergeCategory(sourceId: Id, targetId: Id): Promise<CategoryMergePlan>;
  undoCategoryMerge(plan: CategoryMergePlan): Promise<void>;
  saveFavorite(favorite: Favorite): Promise<void>;
  addFavorite(input: Omit<Favorite, 'id' | 'deleted' | 'order'>): Promise<Favorite>;
  /** 즐겨찾기 한 번에 기록 */
  recordFavorite(id: Id): Promise<Expense>;
  // 월말
  decideMonthEnd(choice: 'reservoir' | 'carryover'): Promise<void>;
  // 멤버
  /** 멤버 초대. incomeAccountId 를 주면 그 수입통장과 이어요 (linkMemberAccount) */
  inviteMember(email: string, displayName: string, incomeAccountId?: Id | null): Promise<void>;
  /**
   * 멤버와 통장 잇기: 그 통장의 주인 이메일을 멤버 이메일로 바꾸고, 같은 이메일인 다른 통장은 비워요.
   * accountId=null 이면 이어진 통장을 모두 풀어요
   */
  linkMemberAccount(email: string, accountId: Id | null): Promise<void>;
  /**
   * 구글 시트 공유 목록을 다시 읽어 멤버에 맞춰요 (가계부를 다시 불러와요).
   * 'synced' = 공유 목록을 읽었어요 / 'unavailable' = 못 읽었어요(보기 · 댓글 권한, 연결 오류, 체험 모드) — 멤버는 그대로
   */
  refreshSharing(): Promise<'synced' | 'unavailable'>;
  renameLedger(name: string): Promise<void>;
  /** 기록한 사람 이름: 멤버면 이어진 통장 주인 이름 → 표시 이름, 공유가 풀린 멤버는 표시 이름, 아니면 이메일 앞부분 */
  displayName(email: string): string;
}
