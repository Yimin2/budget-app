import type { SharingList } from '@/domain/members';
import type {
  Account, AllocationRule, Category, Expense, Favorite, FixedExpense, ForecastSnapshot, LedgerData, LedgerKind,
  IncomePlan, LedgerSettings, Member, MonthEnd, PlannedEvent, Transfer, Trip,
} from '@/domain/types';

export interface TableRows {
  accounts: Account;
  rules: AllocationRule;
  transfers: Transfer;
  fixedExpenses: FixedExpense;
  events: PlannedEvent;
  expenses: Expense;
  monthEnds: MonthEnd; // 키 = month
  categories: Category;
  favorites: Favorite;
  members: Member; // 키 = email
  trips: Trip;
  incomePlans: IncomePlan;
  forecasts: ForecastSnapshot;
}
export type TableName = keyof TableRows;

export type LedgerSource = 'sheets' | 'local';

export interface LedgerRef {
  /** sheets: 스프레드시트 id / local: 'local:<uuid>' */
  id: string;
  name: string;
  kind: LedgerKind;
  source: LedgerSource;
}

/** 한 가계부(스프레드시트 1개 또는 로컬 저장 1개)에 대한 읽기·쓰기 */
export interface LedgerRepository {
  readonly ref: LedgerRef;
  /** 모든 탭을 한 번에 읽는다 */
  load(): Promise<LedgerData>;
  /** 행 추가 (append). 같은 키가 이미 있으면 건너뛴다 (자동 기록 중복 방지) */
  insert<T extends TableName>(table: T, rows: TableRows[T][]): Promise<void>;
  /** 키(id / month / email)로 찾아 행 전체 교체. 없으면 추가 */
  upsert<T extends TableName>(table: T, row: TableRows[T]): Promise<void>;
  /** 여러 행을 한꺼번에 upsert (탭을 한 번 읽고, 있는 행은 한 번의 batchUpdate, 없는 행은 한 번의 append) */
  upsertMany<T extends TableName>(table: T, rows: TableRows[T][]): Promise<void>;
  updateSettings(patch: Partial<LedgerSettings>): Promise<void>;
}

/** 가계부 목록·생성·공유 (백엔드 단위) */
export interface LedgerBackend {
  readonly source: LedgerSource;
  /** 새 가계부를 만들고 기본 데이터를 써 넣는다 */
  create(data: LedgerData): Promise<LedgerRef>;
  open(ref: LedgerRef): LedgerRepository;
  /** 멤버 초대 (sheets: Drive 공유 writer / local: members 행만 추가) */
  share(ref: LedgerRef, email: string): Promise<void>;
  /**
   * 구글 시트를 공유받은 사람 목록 (sheets: Drive permissions.list). 로컬은 없음.
   * 볼 권한이 없거나(보기 · 댓글 권한) 연결이 안 되면 던진다 — 부르는 쪽이 조용히 건너뛴다
   */
  listSharing?(ref: LedgerRef): Promise<SharingList>;
  /** 이름과 종류만 빠르게 읽기 (목록 표시용) */
  describe(id: string): Promise<LedgerRef>;
}
