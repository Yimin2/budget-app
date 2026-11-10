'use client';

import { useId, useState, type FormEvent } from 'react';
import { formatLunarMonthDay, lunarPreview, lunarToSolar, parseLunarMonthDay, solarToLunar } from '@/domain';
import type { Id, PlannedEvent, Repeat } from '@/domain';
import { useLedger } from '@/state';
import {
  Button,
  Chip,
  ChipGroup,
  DateInput,
  Dialog,
  Field,
  MoneyInput,
  SegmentedControl,
  Select,
  TextInput,
  Textarea,
  isIconName,
  useToast,
} from '@/ui';
import { dateLabel, errorText, eventCategories, REPEAT_OPTIONS } from './selectors';
import styles from './events.module.css';

/** 새 일정 창을 열 때 미리 채울 값 (빈 상태 예시 등) */
export interface EventPreset {
  name?: string;
  categoryId?: Id | null;
  date?: string;
  amount?: number | null;
  repeat?: Repeat;
}

export interface EventDialogProps {
  /** 없으면 새 일정 */
  event?: PlannedEvent | null;
  preset?: EventPreset;
  onClose: () => void;
  /** '썼어요' — 이 창을 닫고 실제 금액 창을 열어요 */
  onComplete?: (event: PlannedEvent) => void;
  /** '취소됐어요' */
  onCancelEvent?: (event: PlannedEvent) => void;
  /** '지우기' — 이 창을 닫고 확인 창을 열어요 */
  onDelete?: (event: PlannedEvent) => void;
}

const NAME_MAX = 40;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type CalendarKind = 'solar' | 'lunar';
const CALENDAR_OPTIONS: { value: CalendarKind; label: string }[] = [
  { value: 'solar', label: '양력' },
  { value: 'lunar', label: '음력' },
];

/** 고른 양력 날짜의 음력 월-일 'MM-DD'. 원래 음력 값이 그 날짜와 맞으면 그대로(30일 → 29일로 줄어든 해 등) */
function lunarFor(date: string, original?: string): string | null {
  const l = solarToLunar(date);
  if (!l) return null;
  const md = parseLunarMonthDay(original);
  if (md && lunarToSolar(l.year, md.month, md.day) === date) return formatLunarMonthDay(md.month, md.day);
  return formatLunarMonthDay(l.month, l.day);
}
const LUNAR_MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}월` }));
const LUNAR_DAY_OPTIONS = Array.from({ length: 30 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}일` }));

/** 처음 보여 줄 음력 월 · 일: 일정의 음력 값, 없으면 그 양력 날짜의 음력 */
function initialLunar(lunar: string | undefined, date: string): { month: string; day: string } {
  const md = parseLunarMonthDay(lunar) ?? (DATE_RE.test(date) ? solarToLunar(date) : null);
  return md ? { month: String(md.month), day: String(md.day) } : { month: '', day: '' };
}
const MEMO_MAX = 200;

interface Errors {
  date?: string;
  name?: string;
  amount?: string;
}

/** 일정 추가 · 고치기 창. 열 때마다 새로 그려서(부모가 조건부로 그림) 입력이 초기화돼요 */
export function EventDialog({ event, preset, onClose, onComplete, onCancelEvent, onDelete }: EventDialogProps) {
  const ledger = useLedger();
  const toast = useToast();
  const ids = useId().replace(/:/g, '');
  const editing = Boolean(event);

  const [date, setDate] = useState(event?.date ?? preset?.date ?? ledger.today);
  const [name, setName] = useState(event?.name ?? preset?.name ?? '');
  const [amount, setAmount] = useState<number | null>(event ? event.amount : (preset?.amount ?? null));
  const [categoryId, setCategoryId] = useState<Id | null>(event?.categoryId ?? preset?.categoryId ?? null);
  const [repeat, setRepeat] = useState<Repeat>(event?.repeat ?? preset?.repeat ?? 'none');
  const [calendar, setCalendar] = useState<CalendarKind>(event?.lunar && event.repeat === 'yearly' ? 'lunar' : 'solar');
  // 음력 기준 월 · 일 (음력이면 이 값이 기준이고, 고치면 날짜를 그 음력의 다음 양력 회차로 옮겨요)
  const [lunarMd, setLunarMd] = useState(() => initialLunar(event?.lunar, event?.date ?? preset?.date ?? ledger.today));
  const [memo, setMemo] = useState(event?.memo ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState(false);

  const categories = eventCategories(ledger.pickableCategories);
  // 지운 · 숨긴 카테고리를 쓰던 일정이면 고른 값을 그대로 보여 주려고 목록에 더해요
  const missing =
    categoryId && !categories.some((c) => c.id === categoryId)
      ? (ledger.data?.categories.find((c) => c.id === categoryId) ?? null)
      : null;
  const shownCategories = missing ? [...categories, missing] : categories;

  function validate(): Errors {
    const e: Errors = {};
    if (!DATE_RE.test(date)) e.date = '날짜를 골라 주세요';
    if (!name.trim()) e.name = '일정 이름을 입력해 주세요';
    else if (name.trim().length > NAME_MAX) e.name = `이름은 ${NAME_MAX}자까지 쓸 수 있어요`;
    if (amount === null || !(amount > 0)) e.amount = '예상 금액을 입력해 주세요';
    if (!e.date && repeat === 'yearly' && calendar === 'lunar') {
      const md = chosenLunar();
      if (!md) e.date = '음력 월 · 일을 골라 주세요';
      else if (!lunarMatchesDate(md, date)) e.date = '이 날짜는 고른 음력 날짜와 맞지 않아요. 음력 월 · 일을 다시 골라 주세요';
    }
    return e;
  }

  /** 고른 음력 월 · 일 (말이 안 되면 null) */
  function chosenLunar(): { month: number; day: number } | null {
    return parseLunarMonthDay(lunarMd.month && lunarMd.day ? `${lunarMd.month}-${lunarMd.day}` : '');
  }

  /** 양력 날짜가 그 음력 월-일의 어느 해 회차인지 (그달에 없는 30일 → 29일 포함) */
  function lunarMatchesDate(md: { month: number; day: number }, d: string): boolean {
    const l = solarToLunar(d);
    if (!l) return false;
    return [l.year - 1, l.year, l.year + 1].some((y) => lunarToSolar(y, md.month, md.day) === d);
  }

  /** 날짜를 고치면 음력 월 · 일도 그 날짜의 음력으로 맞춰요 (원래 30일이 29일로 줄어든 해면 30일 그대로) */
  function changeDate(next: string) {
    setDate(next);
    if (!DATE_RE.test(next)) return;
    const md = chosenLunar();
    if (md && lunarMatchesDate(md, next)) return;
    const l = lunarFor(next, event?.lunar);
    const parsed = parseLunarMonthDay(l);
    if (parsed) setLunarMd({ month: String(parsed.month), day: String(parsed.day) });
  }

  /** 음력 월 · 일을 고치면 날짜를 그 음력의 다음 양력 회차(오늘 포함)로 옮겨요 */
  function changeLunar(next: { month: string; day: string }) {
    setLunarMd(next);
    const md = parseLunarMonthDay(next.month && next.day ? `${next.month}-${next.day}` : '');
    if (!md) return;
    if (DATE_RE.test(date) && lunarMatchesDate(md, date)) return;
    const p = lunarPreview(md.month, md.day, ledger.today);
    if (p?.next) setDate(p.next);
  }

  function changeCalendar(next: CalendarKind) {
    setCalendar(next);
    // 음력으로 바꾸면 지금 날짜의 음력부터 보여 줘요
    if (next === 'lunar' && DATE_RE.test(date)) {
      const md = chosenLunar();
      if (!md || !lunarMatchesDate(md, date)) {
        const parsed = parseLunarMonthDay(lunarFor(date, event?.lunar));
        if (parsed) setLunarMd({ month: String(parsed.month), day: String(parsed.day) });
      }
    }
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (saving) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const first = found.date ? 'date' : found.name ? 'name' : 'amount';
      document.getElementById(`${ids}-${first}`)?.focus();
      return;
    }
    setSaving(true);
    const md = chosenLunar();
    const lunar = repeat === 'yearly' && calendar === 'lunar' && md ? formatLunarMonthDay(md.month, md.day) : undefined;
    const clean = { date, name: name.trim(), amount: amount!, categoryId, repeat, memo: memo.trim() };
    try {
      if (event) {
        const { lunar: _old, ...rest } = event;
        await ledger.updateEvent({ ...rest, ...clean, ...(lunar ? { lunar } : {}) });
        toast.success(`‘${clean.name}’ 일정을 고쳤어요`);
      } else {
        await ledger.addEvent({ ...clean, ...(lunar ? { lunar } : {}) });
        toast.success(`‘${clean.name}’ 일정을 넣었어요`);
      }
      onClose();
    } catch (e) {
      toast.error(errorText(e, editing ? '일정을 고치지 못했어요' : '일정을 추가하지 못했어요'));
      setSaving(false);
    }
  }

  async function revertCanceled() {
    if (!event || reverting) return;
    setReverting(true);
    try {
      await ledger.updateEvent({ ...event, status: 'planned' });
      toast.success(`‘${event.name}’ 일정을 다시 예정으로 바꿨어요`);
      onClose();
    } catch (e) {
      toast.error(errorText(e, '일정을 되돌리지 못했어요'));
      setReverting(false);
    }
  }

  const busy = saving || reverting;
  const isPastDate = DATE_RE.test(date) && date < ledger.today;
  const dateHint =
    isPastDate && (!event || event.status === 'planned')
      ? '지난 날짜예요. 저장하면 썼는지 물어볼게요'
      : DATE_RE.test(date)
        ? dateLabel(date, ledger.today)
        : undefined;
  const formId = `${ids}-form`;
  const lunarHint = (() => {
    const md = chosenLunar();
    if (!md) return '음력 월 · 일을 골라 주세요';
    const p = lunarPreview(md.month, md.day, ledger.today);
    const head = `음력 ${md.month}월 ${md.day}일이에요`;
    if (!p) return `${head}. 이 음력 날짜는 셈할 수 없어요`;
    return [head, p.line, p.note, '해마다 그해 양력 날짜로 바뀌어요 (윤달은 평달 같은 날)'].filter(Boolean).join(' · ');
  })();

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      dismissible={!busy}
      title={editing ? '일정 고치기' : '일정 추가'}
      description={editing ? undefined : '고정비가 아닌 큰 지출을 미리 넣어 두면 모자라는 달을 알려 드려요'}
      wide
      actions={
        <>
          {event && onDelete ? (
            <Button
              variant="ghost"
              icon="trash"
              className={styles.deleteBtn}
              onClick={() => onDelete(event)}
              disabled={busy}
            >
              지우기
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            닫기
          </Button>
          <Button type="submit" form={formId} loading={saving} disabled={reverting}>
            {editing ? '저장하기' : '추가하기'}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.formRow}>
          <Field label="이름" required error={errors.name} id={`${ids}-name`}>
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 민수 결혼식"
              maxLength={NAME_MAX + 10}
              autoComplete="off"
              enterKeyHint="next"
              data-autofocus=""
            />
          </Field>
          <Field label="날짜" required error={errors.date} hint={errors.date ? undefined : dateHint} id={`${ids}-date`}>
            <DateInput value={date} onChange={changeDate} />
          </Field>
        </div>

        <Field label="예상 금액" required error={errors.amount} id={`${ids}-amount`}>
          <MoneyInput value={amount} onChange={setAmount} placeholder="예: 200,000" />
        </Field>

        {shownCategories.length > 0 ? (
          <div className={styles.group2} role="group" aria-labelledby={`${ids}-cat`}>
            <span id={`${ids}-cat`} className="label">
              카테고리<span className="opt-text">(선택)</span>
            </span>
            <ChipGroup>
              {shownCategories.map((c) => (
                <Chip
                  key={c.id}
                  icon={isIconName(c.icon) ? c.icon : 'dots'}
                  selected={categoryId === c.id}
                  onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
                >
                  {c.name}
                </Chip>
              ))}
            </ChipGroup>
          </div>
        ) : null}

        <div className={styles.group2}>
          <span id={`${ids}-repeat`} className="label">
            반복
          </span>
          <SegmentedControl options={REPEAT_OPTIONS} value={repeat} onChange={setRepeat} ariaLabel="반복" />
          <span className={styles.groupHint}>
            {repeat === 'yearly'
              ? '생일 · 명절 · 기념일처럼 해마다 돌아와요. 쓰고 나면 내년 일정을 새로 만들어요'
              : repeat === 'monthly'
                ? '달마다 돌아와요. 쓰고 나면 다음 달 일정을 새로 만들어요'
                : '한 번만 있는 일정이에요'}
          </span>
        </div>

        {repeat === 'yearly' ? (
          <div className={styles.group2}>
            <span className="label">날짜 기준</span>
            <SegmentedControl options={CALENDAR_OPTIONS} value={calendar} onChange={changeCalendar} ariaLabel="양력 또는 음력" />
            {calendar === 'lunar' ? (
              <div className={styles.annualMonthDay}>
                <Select
                  value={lunarMd.month}
                  onChange={(v) => changeLunar({ ...lunarMd, month: v })}
                  options={LUNAR_MONTH_OPTIONS}
                  placeholder="음력 월"
                  aria-label="음력 월"
                  disabled={busy}
                />
                <Select
                  value={lunarMd.day}
                  onChange={(v) => changeLunar({ ...lunarMd, day: v })}
                  options={LUNAR_DAY_OPTIONS}
                  placeholder="음력 일"
                  aria-label="음력 일"
                  disabled={busy}
                />
              </div>
            ) : null}
            <span className={styles.groupHint} aria-live="polite" data-testid="event-calendar-hint">
              {calendar === 'lunar' ? lunarHint : '해마다 같은 양력 날짜예요'}
            </span>
          </div>
        ) : null}

        <Field label="메모" optional id={`${ids}-memo`}>
          <Textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
            maxLength={MEMO_MAX}
            placeholder="예: 축의금, 꽃 보내기"
          />
        </Field>
      </form>

      {event && event.status === 'planned' && (onComplete || onCancelEvent) ? (
        <div className={styles.statusBox}>
          <p>이미 썼거나 일정이 취소됐나요?</p>
          <div className={styles.btns}>
            {onComplete ? (
              <Button variant="secondary" icon="check" onClick={() => onComplete(event)} disabled={busy}>
                썼어요
              </Button>
            ) : null}
            {onCancelEvent ? (
              <Button variant="outline" icon="x" onClick={() => onCancelEvent(event)} disabled={busy}>
                취소됐어요
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {event && event.status === 'canceled' ? (
        <div className={styles.statusBox}>
          <p>취소된 일정이에요. 다시 하게 됐다면 예정으로 되돌릴 수 있어요.</p>
          <Button variant="outline" icon="refresh" onClick={revertCanceled} loading={reverting} disabled={saving}>
            예정으로 되돌리기
          </Button>
        </div>
      ) : null}
      {event && event.status === 'done' ? (
        <div className={styles.statusBox}>
          <p>이미 쓴 일정이에요. 실제로 쓴 금액은 내역의 지출에서 고칠 수 있어요.</p>
        </div>
      ) : null}
    </Dialog>
  );
}
