'use client';

import { useId, useMemo, useState } from 'react';
import {
  annualItems,
  customAnnualEvents,
  customAnnualId,
  formatWon,
  lunarPreview,
  lunarShortLabel,
  nextAnnualDate,
  planAnnualRegistration,
  registeredAnnualEvent,
} from '@/domain';
import type { AnnualCalendar, AnnualItem, AnnualSelection, ISODate, LedgerData, PlannedEvent } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, Card, Icon, MoneyInput, SegmentedControl, Select, TextInput, cx, useToast } from '@/ui';
import { ExpandButton } from '../_components/ExpandButton';
import { dateLabel, errorText } from './selectors';
import shared from './events.module.css';
import styles from './AnnualCard.module.css';

const CALENDAR_OPTIONS: { value: AnnualCalendar; label: string }[] = [
  { value: 'solar', label: '양력' },
  { value: 'lunar', label: '음력' },
];
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}월` }));
/** 양력은 그달의 날 수까지(2월은 29일), 음력은 30일까지 (그해 29일까지인 달이면 29일로 셈하고 알려 줘요) */
const SOLAR_MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const maxDay = (calendar: AnnualCalendar, month: string) => (calendar === 'lunar' ? 30 : (SOLAR_MONTH_DAYS[Number(month) - 1] ?? 31));
const dayOptions = (calendar: AnnualCalendar, month: string) =>
  Array.from({ length: maxDay(calendar, month) }, (_, i) => ({ value: String(i + 1), label: `${i + 1}일` }));
/** 월 · 양력/음력이 바뀌어 고른 일이 그달에 없으면 마지막 날로 */
const fitDay = (calendar: AnnualCalendar, month: string, day: string) =>
  day && Number(day) > maxDay(calendar, month) ? String(maxDay(calendar, month)) : day;

interface RowDraft {
  checked: boolean;
  amount: number | null;
  month: string;
  day: string;
  calendar: AnnualCalendar;
  name: string;
}

const emptyRow = (calendar: AnnualCalendar = 'solar'): RowDraft => ({ checked: false, amount: null, month: '', day: '', calendar, name: '' });

type RowError = { amount?: string; date?: string; name?: string };

/** '음력 1/1 · 올해 양력: 2026-02-17 (지났어요 · 다음 2027-02-07)' / '매년 5월 8일 · 다음 …' */
function whenText(month: number, day: number, calendar: AnnualCalendar, today: ISODate): string {
  if (calendar === 'lunar') {
    const p = lunarPreview(month, day, today);
    const base = lunarShortLabel(`${month}-${day}`);
    return p ? `${base} · ${p.line}` : base;
  }
  const next = nextAnnualDate(month, day, calendar, today);
  const base = `매년 ${month}월 ${day}일`;
  return next ? `${base} · 다음 ${dateLabel(next, today, false)}` : base;
}

/**
 * '매년 일정 한 번에 등록' (PLAN 4-3): 설날 · 추석 · 어버이날 · 양가 부모님 생신 · 결혼기념일 · 크리스마스 · 직접 추가를 체크하고
 * 금액을 넣어 [등록하기]를 누르면 이벤트통장의 매년 반복 예정 일정이 돼요. 이미 있는 항목은 '등록됨'과 고치기 링크.
 * 같은 항목은 늘 같은 일정 id 라 다시 눌러도 두 번 생기지 않아요
 */
export function AnnualCard({ data, today, onEdit }: { data: LedgerData; today: ISODate; onEdit: (event: PlannedEvent) => void }) {
  const ledger = useLedger();
  const toast = useToast();
  const titleId = useId();
  const ids = useId().replace(/:/g, '');
  const items = useMemo(() => annualItems(data), [data]);
  const registered = useMemo(() => new Map(items.map((i) => [i.id, registeredAnnualEvent(data, i)])), [data, items]);
  const customs = useMemo(() => customAnnualEvents(data), [data]);
  const doneCount = items.filter((i) => registered.get(i.id)).length;
  // 다른 카드처럼 처음에는 접힌 요약 한 줄만, [펼치기]로 같은 자리에서 체크 목록을 펼쳐요
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, RowDraft>>({});
  const [extra, setExtra] = useState<RowDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, RowError>>({});
  const [busy, setBusy] = useState(false);

  const rowOf = (item: AnnualItem): RowDraft => rows[item.id] ?? emptyRow(item.fixed?.calendar ?? 'solar');
  const patch = (id: string, next: Partial<RowDraft>, item?: AnnualItem) =>
    setRows((r) => ({ ...r, [id]: { ...(r[id] ?? emptyRow(item?.fixed?.calendar ?? 'solar')), ...next } }));
  const patchExtra = (i: number, next: Partial<RowDraft>) => setExtra((list) => list.map((x, k) => (k === i ? { ...x, ...next } : x)));

  const checkedCount =
    items.filter((i) => !registered.get(i.id) && rowOf(i).checked).length + extra.filter((x) => x.checked).length;

  function collect(): { selections: AnnualSelection[]; found: Record<string, RowError> } {
    const selections: AnnualSelection[] = [];
    const found: Record<string, RowError> = {};
    const check = (key: string, r: RowDraft, needName: boolean, fixed: AnnualItem['fixed']) => {
      const e: RowError = {};
      if (r.amount === null || !(r.amount > 0)) e.amount = '금액을 입력해 주세요';
      const month = fixed ? fixed.month : Number(r.month);
      const day = fixed ? fixed.day : Number(r.day);
      const calendar = fixed ? fixed.calendar : r.calendar;
      if (!fixed && (!r.month || !r.day)) e.date = '날짜를 골라 주세요';
      else if (!nextAnnualDate(month, day, calendar, today)) e.date = '이 날짜는 셈할 수 없어요';
      if (needName && !r.name.trim()) e.name = '이름을 입력해 주세요';
      if (Object.keys(e).length > 0) found[key] = e;
      return { month, day, calendar };
    };
    for (const item of items) {
      const r = rowOf(item);
      if (registered.get(item.id) || !r.checked) continue;
      const { month, day, calendar } = check(item.id, r, false, item.fixed);
      selections.push({ id: item.id, name: item.name, categoryName: item.categoryName, month, day, calendar, amount: r.amount ?? 0 });
    }
    extra.forEach((r, i) => {
      if (!r.checked) return;
      const key = `extra-${i}`;
      const { month, day, calendar } = check(key, r, true, null);
      const name = r.name.trim();
      if (name && customs.some((c) => customAnnualId(name) === c.id.split('@')[0])) {
        found[key] = { ...found[key], name: '이미 등록한 이름이에요' };
      }
      selections.push({ id: customAnnualId(name), name, categoryName: '경조사', month, day, calendar, amount: r.amount ?? 0 });
    });
    return { selections, found };
  }

  async function register() {
    if (busy) return;
    const { selections, found } = collect();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const first = Object.keys(found)[0]!;
      const which = found[first]!.name ? 'name' : found[first]!.date ? 'date' : 'amount';
      document.getElementById(`${ids}-${first}-${which}`)?.focus();
      return;
    }
    const drafts = planAnnualRegistration(data, today, selections);
    if (drafts.length === 0) {
      toast.show('새로 넣을 일정이 없어요. 이미 모두 등록돼 있어요');
      return;
    }
    setBusy(true);
    try {
      const added = await ledger.registerAnnualEvents(drafts);
      setRows({});
      setExtra([]);
      toast.success(added.length > 0 ? `매년 일정 ${added.length}개를 넣었어요` : '이미 모두 등록돼 있어요', {
        ...(added.length > 0
          ? {
              action: {
                label: '되돌리기',
                onClick: () => {
                  Promise.all(added.map((ev) => ledger.updateEvent({ ...ev, deleted: true }))).catch((e: unknown) =>
                    toast.error(errorText(e, '되돌리지 못했어요')),
                  );
                },
              },
            }
          : {}),
      });
    } catch (e) {
      toast.error(errorText(e, '매년 일정을 넣지 못했어요'));
    } finally {
      setBusy(false);
    }
  }

  const registeredRow = (key: string, label: string, ev: PlannedEvent) => (
    <li key={key} className={cx(styles.annualRow, styles.annualDone)}>
      <span className={styles.annualCheckSpace} aria-hidden>
        <Icon name="check" size={20} />
      </span>
      <div className={styles.annualText}>
        <span className={styles.annualName}>{label}</span>
        <span className={styles.annualMeta}>
          {ev.lunar ? `매년 ${lunarShortLabel(ev.lunar)} · ` : ''}
          {dateLabel(ev.date, today, false)} · {formatWon(ev.amount)}
        </span>
      </div>
      <div className={styles.annualSide}>
        <Badge tone="success" size="sm">
          등록됨
        </Badge>
        <Button variant="ghost" onClick={() => onEdit(ev)} aria-label={`‘${ev.name}’ 일정 고치기`}>
          고치기
        </Button>
      </div>
    </li>
  );

  const dateInputs = (key: string, r: RowDraft, update: (next: Partial<RowDraft>) => void, calendarChoice: boolean, label: string) => (
    <div className={styles.annualDate}>
      {calendarChoice ? (
        <SegmentedControl
          options={CALENDAR_OPTIONS}
          value={r.calendar}
          onChange={(v) => update({ calendar: v, day: fitDay(v, r.month, r.day) })}
          ariaLabel={`${label} 양력 또는 음력`}
        />
      ) : null}
      <div className={shared.annualMonthDay} id={`${key}-date`} tabIndex={-1}>
        <Select
          value={r.month}
          onChange={(v) => update({ month: v, day: fitDay(r.calendar, v, r.day) })}
          options={MONTH_OPTIONS}
          placeholder={r.calendar === 'lunar' ? '음력 월' : '월'}
          aria-label={`${label} ${r.calendar === 'lunar' ? '음력 ' : ''}월`}
          disabled={busy}
        />
        <Select
          value={r.day}
          onChange={(v) => update({ day: v })}
          options={dayOptions(r.calendar, r.month)}
          placeholder={r.calendar === 'lunar' ? '음력 일' : '일'}
          aria-label={`${label} ${r.calendar === 'lunar' ? '음력 ' : ''}일`}
          disabled={busy}
        />
      </div>
      {datePreview(key, r)}
    </div>
  );

  /** 고른 날짜를 바로 보여 줘요: 음력이면 '올해 양력: 2026-10-03' (+ 29일로 줄인 안내 · 윤달 안내) */
  const datePreview = (key: string, r: RowDraft) => {
    const month = Number(r.month);
    const day = Number(r.day);
    if (r.calendar !== 'lunar') {
      const next = r.month && r.day ? nextAnnualDate(month, day, 'solar', today) : null;
      return next ? (
        <p className={styles.annualMeta} id={`${key}-preview`} aria-live="polite">
          다음 {next}
        </p>
      ) : null;
    }
    const p = r.month && r.day ? lunarPreview(month, day, today) : null;
    return (
      <p className={styles.annualMeta} id={`${key}-preview`} aria-live="polite" data-testid="annual-lunar-preview">
        {r.month && r.day ? (p ? p.line : '이 음력 날짜는 셈할 수 없어요') : '음력 월 · 일을 골라 주세요'}
        {p?.note ? ` · ${p.note}` : ''}
        {' · 윤달은 따로 고르지 않고 평달 같은 날로 셈해요'}
      </p>
    );
  };

  const errorLine = (key: string) => {
    const e = errors[key];
    const text = e ? [e.name, e.date, e.amount].filter(Boolean).join(' · ') : '';
    return text ? (
      <p className={styles.annualError} role="alert">
        {text}
      </p>
    ) : null;
  };

  return (
    <Card as="section" className={styles.annual} aria-labelledby={titleId}>
      <div className={shared.insightHead}>
        <Icon name="calendar" size={20} />
        <div className={shared.txt}>
          <h2 id={titleId} className={shared.insightTitle}>
            매년 일정 한 번에 등록
          </h2>
          <p className={shared.recurringSub} data-testid="annual-summary">
            {doneCount > 0 ? `등록됨 ${doneCount}개` : '아직 등록한 매년 일정이 없어요'}
          </p>
        </div>
        <ExpandButton open={open} onToggle={() => setOpen((o) => !o)} controls={`${ids}-list`} openLabel="펼치기" label="매년 일정 한 번에 등록" />
      </div>

      {open ? (
        <div id={`${ids}-list`} className={styles.annualBody}>
          <p className={shared.recurringSub}>명절 · 생신 · 기념일을 체크하고 금액을 넣으면 매년 반복 일정이 돼요. 등록한 {doneCount}/{items.length}</p>
          <ul className={styles.annualList}>
            {items.map((item) => {
              const ev = registered.get(item.id);
              if (ev) return registeredRow(item.id, item.label, ev);
              const r = rowOf(item);
              const key = `${ids}-${item.id}`;
              const update = (next: Partial<RowDraft>) => patch(item.id, next, item);
              return (
                <li key={item.id} className={cx(styles.annualRow, r.checked && styles.annualOn)}>
                  <input
                    id={`${key}-check`}
                    type="checkbox"
                    checked={r.checked}
                    disabled={busy}
                    onChange={(e) => update({ checked: e.target.checked })}
                  />
                  <label htmlFor={`${key}-check`} className={styles.annualText}>
                    <span className={styles.annualName}>{item.label}</span>
                    <span className={styles.annualMeta}>
                      {item.fixed
                        ? whenText(item.fixed.month, item.fixed.day, item.fixed.calendar, today)
                        : item.kind === 'birthday'
                          ? '생신 날짜와 양력/음력을 골라 주세요'
                          : '날짜를 골라 주세요'}
                      {' · '}
                      {item.categoryName}
                    </span>
                  </label>
                  {r.checked ? (
                    <div className={styles.annualInputs}>
                      {item.fixed ? null : dateInputs(key, r, update, item.calendarChoice, item.label)}
                      <div className={styles.annualAmount} id={`${key}-amount`} tabIndex={-1}>
                        <MoneyInput value={r.amount} onChange={(v) => update({ amount: v })} placeholder="금액" aria-label={`${item.label} 금액`} />
                      </div>
                      {errorLine(item.id)}
                    </div>
                  ) : null}
                </li>
              );
            })}
            {customs.map((ev) => registeredRow(ev.id, ev.name, ev))}
            {extra.map((r, i) => {
              const errKey = `extra-${i}`;
              const key = `${ids}-${errKey}`;
              const update = (next: Partial<RowDraft>) => patchExtra(i, next);
              return (
                <li key={errKey} className={cx(styles.annualRow, r.checked && styles.annualOn)}>
                  <input
                    id={`${key}-check`}
                    type="checkbox"
                    checked={r.checked}
                    disabled={busy}
                    onChange={(e) => update({ checked: e.target.checked })}
                    aria-label="직접 추가한 일정 넣기"
                  />
                  <div className={styles.annualInputs}>
                    <TextInput
                      id={`${key}-name`}
                      value={r.name}
                      onChange={(e) => update({ name: e.target.value })}
                      placeholder="이름 (예: 할머니 생신)"
                      maxLength={40}
                      aria-label="일정 이름"
                      disabled={busy}
                    />
                    {dateInputs(key, r, update, true, r.name.trim() || '직접 추가')}
                    <div className={styles.annualAmount} id={`${key}-amount`} tabIndex={-1}>
                      <MoneyInput value={r.amount} onChange={(v) => update({ amount: v })} placeholder="금액" aria-label="직접 추가 금액" />
                    </div>
                    {errorLine(errKey)}
                    <Button variant="ghost" icon="x" onClick={() => setExtra((list) => list.filter((_, k) => k !== i))} disabled={busy}>
                      빼기
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <Button variant="outline" icon="plus" onClick={() => setExtra((list) => [...list, { ...emptyRow(), checked: true }])} disabled={busy}>
            직접 추가
          </Button>
          <div className={shared.applyRow}>
            <Button icon="check" onClick={() => void register()} loading={busy} disabled={checkedCount === 0}>
              등록하기
            </Button>
            <p className={shared.applyNote}>
              {checkedCount > 0 ? `${checkedCount}개를 이벤트통장의 매년 반복 일정으로 넣어요` : '넣을 항목을 체크해 주세요'}
            </p>
          </div>
          <p className={shared.foot}>
            설날 · 추석과 음력 생신은 해마다 그해 양력 날짜로 바뀌어요. 넣은 일정은 그달 같은 카테고리의 ‘평소 쓰는 돈’에서 빠져 두 번 세지 않아요
          </p>
        </div>
      ) : null}
    </Card>
  );
}
