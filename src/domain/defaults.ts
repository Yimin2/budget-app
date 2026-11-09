import { addDays, addMonths, dateInMonth, monthOf } from './dates';
import { newId } from './ids';
import { pendingAutoRecords } from './recurring';
import type {
  Account, AccountRole, AllocationRule, Category, Expense, Favorite, FixedExpense, LedgerData, LedgerKind,
  PlannedEvent, Transfer,
} from './types';

export const SCHEMA_VERSION = 1;

/** 기본 카테고리 정의. icon 은 UI 키트 Icon 이름 (CATEGORY_ICON_NAMES) */
export const DEFAULT_CATEGORIES: { key: string; name: string; icon: string; role: 'fixed' | 'event' }[] = [
  { key: 'food', name: '식비', icon: 'utensils', role: 'fixed' },
  { key: 'cafe', name: '카페', icon: 'coffee', role: 'fixed' },
  { key: 'transport', name: '교통', icon: 'bus', role: 'fixed' },
  { key: 'living', name: '생활', icon: 'home', role: 'fixed' },
  { key: 'shopping', name: '쇼핑', icon: 'bag', role: 'fixed' },
  { key: 'medical', name: '의료', icon: 'heart-pulse', role: 'fixed' },
  { key: 'culture', name: '문화', icon: 'ticket', role: 'fixed' },
  { key: 'occasion', name: '경조사', icon: 'envelope', role: 'event' },
  { key: 'travel', name: '여행', icon: 'plane', role: 'event' },
  { key: 'holiday', name: '명절', icon: 'calendar', role: 'event' },
  { key: 'gift', name: '선물', icon: 'gift', role: 'event' },
  { key: 'big', name: '큰 구매', icon: 'box', role: 'event' },
  { key: 'etc', name: '기타', icon: 'dots', role: 'fixed' },
];

/** 기본 카테고리가 쓰는 아이콘 이름 목록 (UI 키트가 이 이름들을 그릴 수 있어야 함) */
export const CATEGORY_ICON_NAMES: string[] = DEFAULT_CATEGORIES.map((c) => c.icon);

const SHARED_ACCOUNTS: { name: string; role: AccountRole }[] = [
  { name: '수입통장', role: 'income' },
  { name: '고정지출통장', role: 'fixed' },
  { name: '이벤트통장', role: 'event' },
  { name: '저수지통장', role: 'reservoir' },
  { name: '저축투자통장', role: 'savings' },
];

function buildCategories(kind: LedgerKind, makeId: (key: string) => string): Category[] {
  return DEFAULT_CATEGORIES.map((c, i) => ({
    id: makeId(c.key),
    name: c.name,
    icon: c.icon,
    defaultAccountRole: kind === 'personal' ? 'allowance' : c.role,
    order: i,
    deleted: false,
  }));
}

/**
 * 새 가계부 기본 데이터.
 * shared: 통장 5개(수입/고정지출/이벤트/저수지/저축투자, 시작 잔액 0, openingDate=today), 기본 카테고리, 규칙·고정지출 없음
 * personal: 통장 1개(용돈, role='allowance'), 기본 카테고리(기본 통장 역할 allowance)
 * 기본 카테고리 (PLAN 5): 식비 카페 교통 생활 쇼핑 의료 문화 → fixed / 경조사 여행 명절 선물 큰구매 → event / 기타 → fixed
 * members: [{ email: authorEmail, displayName }]
 */
export function createDefaultLedger(
  kind: LedgerKind,
  name: string,
  today: string,
  now: string,
  authorEmail: string,
  displayName: string,
): LedgerData {
  const defs = kind === 'shared' ? SHARED_ACCOUNTS : [{ name: '용돈', role: 'allowance' as AccountRole }];
  const accounts: Account[] = defs.map((d, i) => ({
    id: newId(),
    name: d.name,
    role: d.role,
    openingBalance: 0,
    openingDate: today,
    order: i,
    deleted: false,
  }));
  return {
    settings: { name, kind, sharedLedgerId: null, schemaVersion: SCHEMA_VERSION, createdAt: now },
    accounts,
    rules: [],
    transfers: [],
    fixedExpenses: [],
    events: [],
    expenses: [],
    monthEnds: [],
    categories: buildCategories(kind, () => newId()),
    favorites: [],
    members: [{ email: authorEmail, displayName }],
  };
}

/* ---------- 체험 모드 ---------- */

export const DEMO_MEMBERS = [
  { email: 'minji@demo', displayName: '민지' },
  { email: 'junho@demo', displayName: '준호' },
] as const;

/** 하루 생활비 지출 패턴 (일자별로 돌아가며 사용). [작성자 0/1, 카테고리 key, 금액, 내용] */
const DAILY_PATTERN: [0 | 1, string, number, string][][] = [
  [[0, 'cafe', 4500, '커피'], [1, 'food', 9000, '점심']],
  [[1, 'transport', 1500, '버스'], [0, 'food', 12800, '저녁 장보기']],
  [[0, 'food', 9000, '점심'], [1, 'cafe', 4500, '커피'], [0, 'living', 6900, '세제']],
  [[1, 'food', 23000, '마트']],
  [[0, 'cafe', 4500, '커피'], [1, 'transport', 1500, '버스'], [0, 'food', 8500, '김밥']],
  [[1, 'culture', 15000, '영화'], [0, 'food', 9000, '점심']],
  [[0, 'shopping', 19900, '양말·티셔츠']],
  [[1, 'food', 9000, '점심'], [0, 'transport', 1500, '버스'], [1, 'cafe', 5200, '라테']],
  [[0, 'food', 31000, '외식']],
  [[1, 'medical', 6500, '약국'], [0, 'cafe', 4500, '커피']],
];

/** 오늘 기록은 가볍게 둬요. 체험 첫 화면의 '오늘 써도 되는 생활비'가 날짜와 상관없이 0원보다 크게 보이도록 */
const TODAY_PATTERN: [0 | 1, string, number, string][] = [[0, 'cafe', 4500, '커피']];

/** 체험 모드용 예시 데이터 (민지·준호 부부 예시: 월급 500만, 배분 고정 200 / 이벤트 30 / 저축투자 150 / 저수지 120, 생활비 60, 이벤트 일정: 설날·제주 여행·5월 결혼식 4건·어버이날 → 5월 부족 발생) — today 기준 상대 날짜
 *
 * 구성 (today 가 속한 달 M 기준):
 * - 통장 시작 잔액(M-01 기준): 수입 0 / 고정지출 1,350,000 / 이벤트 600,000 / 저수지 5,200,000 / 저축투자 12,400,000
 * - M-01 월급 5,000,000 수입 → 같은 날 월배분 4건 (자동 기록 id 사용)
 * - 고정 지출: 월세 800,000(10일) · 통신비 120,000(15일) · 보험 180,000(20일) · 용돈 민지/준호 각 150,000(1일), 생활비 600,000
 * - 생활비 지출: 1일부터 오늘까지 매일 두 사람이 번갈아 기록 (하루 평균 약 18,000원). 오늘은 커피 한 잔만
 * - 이벤트 일정: M+2 명절 400,000 · M+3 제주 여행 900,000 · M+5 결혼식 4건 800,000 + 어버이날 600,000 → M+5 에 300,000 부족
 */
export function createDemoLedger(today: string, now: string): LedgerData {
  const M = monthOf(today);
  const first = `${M}-01`;
  const minji = DEMO_MEMBERS[0].email;
  const junho = DEMO_MEMBERS[1].email;
  const who = [minji, junho];
  const cat = (key: string) => `demo-cat-${key}`;

  const acc = (key: string, name: string, role: AccountRole, openingBalance: number, order: number): Account => ({
    id: `demo-acc-${key}`,
    name,
    role,
    openingBalance,
    openingDate: first,
    order,
    deleted: false,
  });
  const accounts: Account[] = [
    acc('income', '수입통장', 'income', 0, 0),
    acc('fixed', '고정지출통장', 'fixed', 1_350_000, 1),
    acc('event', '이벤트통장', 'event', 600_000, 2),
    acc('reservoir', '저수지통장', 'reservoir', 5_200_000, 3),
    acc('savings', '저축투자통장', 'savings', 12_400_000, 4),
  ];
  const [income, fixed, event, reservoir, savings] = accounts as [Account, Account, Account, Account, Account];

  const rule = (key: string, to: Account, amount: number): AllocationRule => ({
    id: `demo-rule-${key}`,
    fromAccountId: income.id,
    toAccountId: to.id,
    amount,
    dayOfMonth: 1,
    startMonth: M,
    endMonth: null,
    deleted: false,
  });
  const rules: AllocationRule[] = [
    rule('fixed', fixed, 2_000_000),
    rule('event', event, 300_000),
    rule('savings', savings, 1_500_000),
    rule('reservoir', reservoir, 1_200_000),
  ];

  const transfers: Transfer[] = [
    {
      id: 'demo-salary',
      date: first,
      kind: 'income',
      fromAccountId: null,
      toAccountId: income.id,
      amount: 5_000_000,
      status: 'done',
      ruleId: null,
      memo: '월급',
      author: minji,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    },
  ];

  const fx = (
    key: string,
    name: string,
    amount: number,
    kind: FixedExpense['kind'],
    dayOfMonth: number | null,
    categoryKey: string | null,
    targetEmail: string | null = null,
  ): FixedExpense => ({
    id: `demo-fixed-${key}`,
    name,
    amount,
    accountId: fixed.id,
    categoryId: categoryKey ? cat(categoryKey) : null,
    dayOfMonth,
    kind,
    targetEmail,
    startMonth: M,
    endMonth: null,
    deleted: false,
  });
  const fixedExpenses: FixedExpense[] = [
    fx('rent', '월세', 800_000, 'bill', 10, 'living'),
    fx('phone', '통신비', 120_000, 'bill', 15, 'living'),
    fx('insurance', '보험', 180_000, 'bill', 20, 'medical'),
    fx('living', '생활비', 600_000, 'living', null, null),
    fx('allowance-minji', '용돈(민지)', 150_000, 'allowance', 1, null, minji),
    fx('allowance-junho', '용돈(준호)', 150_000, 'allowance', 1, null, junho),
  ];

  const expenses: Expense[] = [];
  const todayDay = Number(today.slice(8, 10));
  for (let d = 1; d <= todayDay; d++) {
    const date = addDays(first, d - 1);
    const items = d === todayDay ? TODAY_PATTERN : DAILY_PATTERN[(d - 1) % DAILY_PATTERN.length]!;
    items.forEach(([w, key, amount, memo], i) => {
      expenses.push({
        id: `demo-exp-${date}-${i}`,
        date,
        amount,
        accountId: fixed.id,
        categoryId: cat(key),
        memo,
        eventId: null,
        fixedExpenseId: null,
        author: who[w]!,
        createdAt: `${date}T12:00:00.000Z`,
        updatedAt: `${date}T12:00:00.000Z`,
        deleted: false,
      });
    });
  }

  const ev = (
    key: string,
    offset: number,
    day: number,
    name: string,
    amount: number,
    categoryKey: string,
    author: string,
    repeat: PlannedEvent['repeat'] = 'none',
  ): PlannedEvent => ({
    id: `demo-event-${key}`,
    date: dateInMonth(addMonths(M, offset), day),
    name,
    amount,
    accountId: event.id,
    categoryId: cat(categoryKey),
    status: 'planned',
    repeat,
    memo: '',
    author,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  });
  const events: PlannedEvent[] = [
    ev('holiday', 2, 14, '명절 부모님 용돈', 400_000, 'holiday', minji),
    ev('jeju', 3, 20, '제주 여행', 900_000, 'travel', junho),
    ev('wedding1', 5, 2, '지수 결혼식', 300_000, 'occasion', minji),
    ev('wedding2', 5, 9, '민수 결혼식', 200_000, 'occasion', junho),
    ev('wedding3', 5, 16, '회사 동기 결혼식', 200_000, 'occasion', junho),
    ev('wedding4', 5, 23, '사촌 결혼식', 100_000, 'occasion', minji),
    ev('parents', 5, 8, '어버이날', 600_000, 'gift', minji),
    ev('anniversary', 9, 12, '결혼기념일', 100_000, 'gift', junho, 'yearly'),
  ];

  const favorites: Favorite[] = [
    { id: 'demo-fav-coffee', name: '커피', amount: 4_500, categoryId: cat('cafe'), accountId: fixed.id, order: 0, deleted: false },
    { id: 'demo-fav-lunch', name: '점심', amount: 9_000, categoryId: cat('food'), accountId: fixed.id, order: 1, deleted: false },
    { id: 'demo-fav-bus', name: '버스', amount: 1_500, categoryId: cat('transport'), accountId: fixed.id, order: 2, deleted: false },
  ];

  const data: LedgerData = {
    settings: { name: '민지·준호 가계부', kind: 'shared', sharedLedgerId: null, schemaVersion: SCHEMA_VERSION, createdAt: now },
    accounts,
    rules,
    transfers,
    fixedExpenses,
    events,
    expenses,
    monthEnds: [],
    categories: buildCategories('shared', cat),
    favorites,
    members: DEMO_MEMBERS.map((m) => ({ ...m })),
  };

  // 오늘까지 도래한 월배분·고정 지출 자동 기록을 미리 만들어 둔다 (앱의 자동 기록과 같은 id)
  const auto = pendingAutoRecords(data, today, minji, now);
  data.transfers.push(...auto.transfers);
  data.expenses.push(...auto.expenses);
  return data;
}
