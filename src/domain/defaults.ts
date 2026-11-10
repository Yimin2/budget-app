import { claimTransferId, computeClaimDue } from './claims';
import { addDays, addMonths, dateInMonth, monthOf } from './dates';
import { newId } from './ids';
import { buildInstallmentRows } from './installments';
import { pendingAutoRecords } from './recurring';
import type {
  Account, AccountRole, AllocationRule, Category, Expense, Favorite, FixedExpense, IncomePlan, LedgerData, LedgerKind,
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
    ownerName: null,
    ownerEmail: null,
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
    trips: [],
    incomePlans: [],
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

/** 체험 모드 생활비 항목 예산 [카테고리 key, 금액, 쓰는 방식]. 합 600,000 */
export const DEMO_LIVING_ITEMS: [string, number, 'daily' | 'monthly'][] = [
  ['food', 340_000, 'daily'],
  ['cafe', 80_000, 'daily'],
  ['transport', 20_000, 'daily'],
  ['living', 30_000, 'monthly'],
  ['shopping', 60_000, 'monthly'],
  ['medical', 20_000, 'monthly'],
  ['culture', 50_000, 'monthly'],
];

/** 체험 모드용 예시 데이터 (민지·준호 부부 예시: 월급 민지 300만 + 준호 200만, 배분 합 고정 200 / 이벤트 30 / 저축투자 150 / 저수지 120, 생활비 항목 합 60, 이벤트 일정: 설날·제주 여행·5월 결혼식 4건·어버이날 → 5월 부족 발생) — today 기준 상대 날짜
 *
 * 구성 (today 가 속한 달 M 기준):
 * - 통장 시작 잔액(M-01 기준): 수입 2개 0 / 고정지출 1,350,000 / 이벤트 600,000 / 저수지 5,200,000 / 저축투자 12,400,000
 * - 사람별 수입통장: 민지 수입통장(월급 3,000,000) · 준호 수입통장(월급 2,000,000). M-01 월급 수입 → 같은 날 월배분 (자동 기록 id 사용)
 *   민지 → 고정 1,200,000 · 이벤트 300,000 · 저축투자 900,000 · 저수지 600,000 / 준호 → 고정 800,000 · 저축투자 600,000 · 저수지 600,000
 * - 고정 지출: 월세 800,000(10일) · 통신비 120,000(15일) · 보험 180,000(20일) · 용돈 민지/준호 각 150,000(1일)
 * - 생활비 항목: 식비 340,000 · 카페 80,000 · 교통 20,000 (하루에 나눠 쓰기) / 생활 30,000 · 쇼핑 60,000 · 의료 20,000 · 문화 50,000 (한 달 한도만)
 * - 생활비 지출: 1일부터 오늘까지 매일 두 사람이 번갈아 기록 (하루 평균 약 18,000원). 오늘은 커피 한 잔만
 * - 이벤트 일정: M+2 명절 400,000 · M+3 제주 여행 900,000 · M+5 결혼식 4건 800,000 + 어버이날 600,000 → M+5 에 300,000 부족
 * - 청구(opts.claims, 체험 모드에서 켬. 다른 숫자 테스트가 기대는 기본 예시는 그대로 두려고 따로 켜요): 민지 제주 항공권 300,000 (이벤트통장 · 제주 여행 일정 연결, 잔액이 넉넉해 오늘 돌려줌) ·
 *   준호 마트 장보기 24,000 (식비, 다음 월급날) · 1일 준호 세제·휴지 8,000 (생활, 돌려줌). 일정 합은 그대로라 부족 금액은 같다
 * - 할부(opts.installments, 체험 모드에서 켬): TV 할부 2,400,000원 24개월 (매달 100,000원, 5일, 고정지출통장, 큰 구매).
 *   1회차가 M-15 라 이번 달이 16회차. 지난 회차는 통장 시작 전이라 기록하지 않는다 (5일이 지나면 16회차가 자동 기록)
 * - 여행(opts.trips, 체험 모드에서 켬): 제주 여행 일정 대신 여행 '제주 여행' (M+3 20~23일, 예산 900,000 = 항공 300,000 · 숙박 300,000 ·
 *   식비 200,000 · 투어 100,000). 이미 낸 돈: 숙소 예약금 150,000 (이벤트통장) + 항공권 300,000 (청구를 켜면 민지 청구, 아니면 이벤트통장).
 *   남은 예산 450,000 은 M+3 에 예측으로 들어가 나가는 돈 합이 일정일 때와 같다 → 부족 금액도 같다
 */
/** 체험 모드 여행 id (opts.trips) */
export const DEMO_TRIP_ID = 'demo-trip-jeju';

/**
 * 부부 체험 예시 (opts.couple, 체험 모드에서 켬) — PLAN 4-13 · 4-14 의 돈 흐름.
 * - 함께 쓰는 월급통장 하나: 민지 월급 3,200,000 (21일) · 준호 월급 2,800,000 (25일) 수입 계획
 * - 21일: 월급통장 → 생활비(민지) 900,000 · 생활비(준호) 1,100,000 · 이벤트 300,000, 나머지 전부 → 저수지 (900,000)
 * - 25일: 월급통장 → 용돈(민지) 400,000 · 용돈(준호) 350,000 · 저축투자 1,000,000, 나머지 전부 → 저수지 (1,050,000)
 * - 사람마다 생활비 통장(고정비 · 생활비 항목)과 용돈 통장. 회비 · 보험 · 통신비는 사람마다 따로 한 줄
 * - 하루 지출은 기록한 사람의 생활비 통장에서 나간다
 */
export const DEMO_COUPLE = {
  income: [
    { key: 'minji', member: 0, amount: 3_200_000, day: 21 },
    { key: 'junho', member: 1, amount: 2_800_000, day: 25 },
  ],
  /** [받는 통장 key, 금액, 날짜] (금액 null = 나머지 전부) */
  rules: [
    ['living-minji', 900_000, 21],
    ['living-junho', 1_100_000, 21],
    ['event', 300_000, 21],
    ['reservoir', null, 21],
    ['allowance-minji', 400_000, 25],
    ['allowance-junho', 350_000, 25],
    ['savings', 1_000_000, 25],
    ['reservoir', null, 25],
  ] as [string, number | null, number][],
  /** 사람마다 고정비 [key, 이름, 금액, 결제일, 카테고리] */
  bills: [
    [
      ['dues', '회비', 30_000, 5, 'culture'],
      ['insurance', '보험', 120_000, 20, 'medical'],
      ['phone', '통신비', 60_000, 15, 'living'],
    ],
    [
      ['rent', '월세', 500_000, 10, 'living'],
      ['dues', '회비', 30_000, 5, 'culture'],
      ['insurance', '보험', 150_000, 20, 'medical'],
      ['phone', '통신비', 55_000, 15, 'living'],
    ],
  ] as [string, string, number, number, string][][],
  /** 사람마다 생활비 항목 [카테고리 key, 금액, 쓰는 방식] */
  living: [
    [
      ['food', 300_000, 'daily'],
      ['cafe', 60_000, 'daily'],
      ['transport', 50_000, 'daily'],
      ['living', 80_000, 'monthly'],
      ['shopping', 100_000, 'monthly'],
      ['medical', 30_000, 'monthly'],
      ['culture', 50_000, 'monthly'],
    ],
    [
      ['food', 200_000, 'daily'],
      ['cafe', 40_000, 'daily'],
      ['transport', 60_000, 'daily'],
      ['living', 30_000, 'monthly'],
      ['shopping', 30_000, 'monthly'],
      ['medical', 20_000, 'monthly'],
      ['culture', 30_000, 'monthly'],
    ],
  ] as [string, number, 'daily' | 'monthly'][][],
};

export function createDemoLedger(
  today: string,
  now: string,
  opts: { claims?: boolean; installments?: boolean; trips?: boolean; couple?: boolean } = {},
): LedgerData {
  const M = monthOf(today);
  const first = `${M}-01`;
  const minji = DEMO_MEMBERS[0].email;
  const junho = DEMO_MEMBERS[1].email;
  const who = [minji, junho];
  const cat = (key: string) => `demo-cat-${key}`;

  const acc = (
    key: string,
    name: string,
    role: AccountRole,
    openingBalance: number,
    order: number,
    owner: { displayName: string; email: string } | null = null,
  ): Account => ({
    id: `demo-acc-${key}`,
    name,
    role,
    openingBalance,
    openingDate: first,
    order,
    ownerName: owner?.displayName ?? null,
    ownerEmail: owner?.email ?? null,
    deleted: false,
  });
  const couple = !!opts.couple;
  const accounts: Account[] = couple
    ? [
        acc('income', '월급통장', 'income', 0, 0),
        acc('living-minji', '생활비(민지)', 'fixed', 1_100_000, 1, DEMO_MEMBERS[0]),
        acc('living-junho', '생활비(준호)', 'fixed', 1_300_000, 2, DEMO_MEMBERS[1]),
        acc('allowance-minji', '용돈(민지)', 'allowance', 300_000, 3, DEMO_MEMBERS[0]),
        acc('allowance-junho', '용돈(준호)', 'allowance', 250_000, 4, DEMO_MEMBERS[1]),
        acc('event', '이벤트통장', 'event', 600_000, 5),
        acc('reservoir', '저수지통장', 'reservoir', 5_200_000, 6),
        acc('savings', '저축투자통장', 'savings', 12_400_000, 7),
      ]
    : [
        acc('income', '민지 수입통장', 'income', 0, 0, DEMO_MEMBERS[0]),
        acc('income-junho', '준호 수입통장', 'income', 0, 1, DEMO_MEMBERS[1]),
        acc('fixed', '고정지출통장', 'fixed', 1_350_000, 2),
        acc('event', '이벤트통장', 'event', 600_000, 3),
        acc('reservoir', '저수지통장', 'reservoir', 5_200_000, 4),
        acc('savings', '저축투자통장', 'savings', 12_400_000, 5),
      ];
  const byKey = (key: string) => accounts.find((a) => a.id === `demo-acc-${key}`)!;
  const incomeMinji = byKey('income');
  const incomeJunho = couple ? byKey('income') : byKey('income-junho');
  const event = byKey('event');
  const reservoir = byKey('reservoir');
  const savings = byKey('savings');
  /** 사람(0 민지 · 1 준호)의 생활비 통장 (예전 예시는 함께 쓰는 고정지출통장) */
  const livingOf = (w: 0 | 1) => (couple ? byKey(w === 0 ? 'living-minji' : 'living-junho') : byKey('fixed'));
  /** 청구를 돌려받을 통장 (예전 예시는 그 사람 수입통장, 부부 예시는 용돈 통장) */
  const payerAccountOf = (w: 0 | 1) => (couple ? byKey(w === 0 ? 'allowance-minji' : 'allowance-junho') : w === 0 ? incomeMinji : incomeJunho);
  const fixed = livingOf(0);

  const rule = (key: string, from: Account, to: Account, amount: number): AllocationRule => ({
    id: `demo-rule-${key}`,
    fromAccountId: from.id,
    toAccountId: to.id,
    amount,
    dayOfMonth: 1,
    startMonth: M,
    endMonth: null,
    deleted: false,
  });
  const rules: AllocationRule[] = couple
    ? DEMO_COUPLE.rules.map(([to, amount, day]) => ({
        ...rule(`${day}-${to}`, incomeMinji, byKey(to), amount ?? 0),
        dayOfMonth: day,
        kind: amount === null ? ('remainder' as const) : ('fixed' as const),
      }))
    : [
        rule('fixed', incomeMinji, fixed, 1_200_000),
        rule('event', incomeMinji, event, 300_000),
        rule('savings', incomeMinji, savings, 900_000),
        rule('reservoir', incomeMinji, reservoir, 600_000),
        rule('junho-fixed', incomeJunho, fixed, 800_000),
        rule('junho-savings', incomeJunho, savings, 600_000),
        rule('junho-reservoir', incomeJunho, reservoir, 600_000),
      ];
  const incomePlans: IncomePlan[] = couple
    ? DEMO_COUPLE.income.map((x) => ({
        id: `demo-income-${x.key}`,
        personName: DEMO_MEMBERS[x.member as 0 | 1].displayName,
        personEmail: DEMO_MEMBERS[x.member as 0 | 1].email,
        amount: x.amount,
        dayOfMonth: x.day,
        accountId: incomeMinji.id,
        startMonth: M,
        endMonth: null,
        memo: '',
        deleted: false,
      }))
    : [];

  const salary = (id: string, to: Account, amount: number, author: string): Transfer => ({
    id,
    date: first,
    kind: 'income',
    fromAccountId: null,
    toAccountId: to.id,
    amount,
    status: 'done',
    ruleId: null,
    memo: '월급',
    author,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  });
  // 부부 예시는 수입 계획이 월급날에 수입을 기록한다
  const transfers: Transfer[] = couple
    ? []
    : [salary('demo-salary', incomeMinji, 3_000_000, minji), salary('demo-salary-junho', incomeJunho, 2_000_000, junho)];

  const fx = (
    key: string,
    name: string,
    amount: number,
    kind: FixedExpense['kind'],
    dayOfMonth: number | null,
    categoryKey: string | null,
    targetEmail: string | null = null,
    spread: FixedExpense['spread'] = 'daily',
  ): FixedExpense => ({
    id: `demo-fixed-${key}`,
    name,
    amount,
    accountId: fixed.id,
    categoryId: categoryKey ? cat(categoryKey) : null,
    dayOfMonth,
    kind,
    targetEmail,
    spread,
    startMonth: M,
    endMonth: null,
    deleted: false,
  });
  const fixedExpenses: FixedExpense[] = couple
    ? ([0, 1] as const).flatMap((w) => {
        const owner = w === 0 ? 'minji' : 'junho';
        const account = livingOf(w).id;
        return [
          ...DEMO_COUPLE.bills[w]!.map(([key, name, amount, day, catKey]) => ({
            ...fx(`${owner}-${key}`, name, amount, 'bill', day, catKey),
            accountId: account,
          })),
          ...DEMO_COUPLE.living[w]!.map(([key, amount, spread]) => ({
            ...fx(`${owner}-living-${key}`, DEFAULT_CATEGORIES.find((c) => c.key === key)!.name, amount, 'living', null, key, null, spread),
            accountId: account,
          })),
        ];
      })
    : [
    fx('rent', '월세', 800_000, 'bill', 10, 'living'),
    fx('phone', '통신비', 120_000, 'bill', 15, 'living'),
    fx('insurance', '보험', 180_000, 'bill', 20, 'medical'),
    fx('allowance-minji', '용돈(민지)', 150_000, 'allowance', 1, null, minji),
    fx('allowance-junho', '용돈(준호)', 150_000, 'allowance', 1, null, junho),
    ...DEMO_LIVING_ITEMS.map(([key, amount, spread]) =>
      fx(`living-${key}`, DEFAULT_CATEGORIES.find((c) => c.key === key)!.name, amount, 'living', null, key, null, spread),
    ),
  ];

  if (opts.installments) {
    fixedExpenses.push(
      ...buildInstallmentRows(
        {
          name: 'TV 할부',
          amount: 2_400_000,
          amountKind: 'total',
          months: 24,
          firstMonth: addMonths(M, -15),
          dayOfMonth: 5,
          accountId: couple ? livingOf(1).id : fixed.id,
          categoryId: cat('big'),
        },
        'demo-installment-tv',
        first,
      ),
    );
  }

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
        accountId: livingOf(w).id,
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
    // 여행을 켜면 제주 여행은 일정 대신 여행(예산 · 항목 예산 · 묶은 지출)으로 둔다
    ...(opts.trips ? [] : [ev('jeju', 3, 20, '제주 여행', 900_000, 'travel', junho)]),
    ev('wedding1', 5, 2, '지수 결혼식', 300_000, 'occasion', minji),
    ev('wedding2', 5, 9, '민수 결혼식', 200_000, 'occasion', junho),
    ev('wedding3', 5, 16, '회사 동기 결혼식', 200_000, 'occasion', junho),
    ev('wedding4', 5, 23, '사촌 결혼식', 100_000, 'occasion', minji),
    ev('parents', 5, 8, '어버이날', 600_000, 'gift', minji),
    ev('anniversary', 9, 12, '결혼기념일', 100_000, 'gift', junho, 'yearly'),
  ];

  // 부부 예시의 즐겨찾기는 통장을 비워 두어 누른 사람의 생활비 통장에서 나가요
  const favAccount = couple ? null : fixed.id;
  const favorites: Favorite[] = [
    { id: 'demo-fav-coffee', name: '커피', amount: 4_500, categoryId: cat('cafe'), accountId: favAccount, order: 0, deleted: false },
    { id: 'demo-fav-lunch', name: '점심', amount: 9_000, categoryId: cat('food'), accountId: favAccount, order: 1, deleted: false },
    { id: 'demo-fav-bus', name: '버스', amount: 1_500, categoryId: cat('transport'), accountId: favAccount, order: 2, deleted: false },
  ];

  const data: LedgerData = {
    settings: { name: '민지·준호 가계부', kind: 'shared', sharedLedgerId: null, schemaVersion: SCHEMA_VERSION, createdAt: now },
    incomePlans,
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
    trips: opts.trips
      ? [
          {
            id: DEMO_TRIP_ID,
            name: '제주 여행',
            startDate: dateInMonth(addMonths(M, 3), 20),
            endDate: dateInMonth(addMonths(M, 3), 23),
            budget: 900_000,
            items: { flight: 300_000, stay: 300_000, food: 200_000, tour: 100_000 },
            memo: '',
            author: junho,
            createdAt: now,
            updatedAt: now,
            deleted: false,
          },
        ]
      : [],
  };

  // 오늘까지 도래한 월배분·고정 지출 자동 기록을 미리 만들어 둔다 (앱의 자동 기록과 같은 id)
  const auto = pendingAutoRecords(data, today, minji, now);
  data.transfers.push(...auto.transfers);
  data.expenses.push(...auto.expenses);

  const atFirst = (date: string) => (date < first ? first : date);
  if (opts.trips) {
    // 여행에 이미 낸 돈: 숙소 예약금 (이벤트통장). 항공권은 청구를 켜면 민지가 개인 돈으로 낸 청구, 아니면 이벤트통장에서 바로
    const tripExpense = (key: string, date: string, amount: number, memo: string, tripItem: Expense['tripItem'], author: string): Expense => ({
      id: `demo-trip-${key}`,
      date,
      amount,
      accountId: event.id,
      categoryId: cat('travel'),
      memo,
      eventId: null,
      fixedExpenseId: null,
      author,
      createdAt: `${date}T12:00:00.000Z`,
      updatedAt: `${date}T12:00:00.000Z`,
      deleted: false,
      tripId: DEMO_TRIP_ID,
      tripItem,
    });
    data.expenses.push(tripExpense('stay', atFirst(addDays(today, -3)), 150_000, '제주 숙소 예약금', 'stay', minji));
    if (!opts.claims) data.expenses.push(tripExpense('flight', atFirst(addDays(today, -2)), 300_000, '제주 항공권', 'flight', minji));
  }

  if (!opts.claims) return data;
  // 청구: 개인 돈으로 내고 돌려받을 지출 (정산일은 앱과 같은 규칙으로)
  const claim = (
    key: string,
    date: string,
    amount: number,
    account: Account,
    categoryKey: string,
    memo: string,
    payer: (typeof DEMO_MEMBERS)[number],
    payerAccount: Account,
    eventId: string | null = null,
  ): Expense => ({
    id: `demo-claim-${key}`,
    date,
    amount,
    accountId: account.id,
    categoryId: cat(categoryKey),
    memo,
    eventId,
    fixedExpenseId: null,
    author: payer.email,
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
    deleted: false,
    paidBy: payer.displayName,
    claimAccountId: payerAccount.id,
    claimDue: computeClaimDue(data, { accountId: account.id, amount }, today),
  });
  data.expenses.push(
    opts.trips
      ? {
          ...claim('jeju', atFirst(addDays(today, -2)), 300_000, event, 'travel', '제주 항공권', DEMO_MEMBERS[0], payerAccountOf(0)),
          tripId: DEMO_TRIP_ID,
          tripItem: 'flight',
        }
      : claim('jeju', atFirst(addDays(today, -2)), 300_000, event, 'travel', '제주 항공권', DEMO_MEMBERS[0], payerAccountOf(0), 'demo-event-jeju'),
  );
  // 1일에는 어제가 지난달이라 오늘 날짜가 돼요. 오늘 써도 되는 돈이 0원 아래로 가지 않게 한 달 한도 항목(쇼핑)으로
  const martDate = atFirst(addDays(today, -1));
  data.expenses.push(
    claim('mart', martDate, 24_000, livingOf(1), martDate === today ? 'shopping' : 'food', '마트 장보기', DEMO_MEMBERS[1], payerAccountOf(1)),
  );
  // 이미 돌려준 청구 (1일에 준호가 낸 생활용품, 같은 날 돌려줌)
  const done: Expense = { ...claim('done', first, 8_000, livingOf(1), 'living', '세제·휴지', DEMO_MEMBERS[1], payerAccountOf(1)), claimDue: first };
  data.expenses.push(done);
  data.transfers.push({
    id: claimTransferId(done.id),
    date: first,
    kind: 'transfer',
    fromAccountId: livingOf(1).id,
    toAccountId: payerAccountOf(1).id,
    amount: done.amount,
    status: 'done',
    ruleId: null,
    memo: '준호에게 돌려줌 · 세제·휴지',
    author: minji,
    createdAt: `${first}T13:00:00.000Z`,
    updatedAt: `${first}T13:00:00.000Z`,
    deleted: false,
  });
  return data;
}
