'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { TRIP_ITEMS, TRIP_ITEM_LABELS, addDays, validateTrip } from '@/domain';
import type { Trip, TripItem, Won } from '@/domain';
import { useLedger } from '@/state';
import { Button, DateInput, Dialog, Field, MoneyInput, TextInput, focusFirstInvalid, useToast } from '@/ui';
import { errorText } from '../selectors';
import { itemBudgetHint, itemFormValues } from './selectors';
import styles from './trips.module.css';

type Errors = Partial<Record<'name' | 'start' | 'end' | 'budget', string>>;

export interface TripDialogProps {
  /** 고칠 여행. 없으면 새로 만들어요 */
  trip?: Trip | null;
  onClose: () => void;
  /** 저장 · 지우기가 끝나면 (창은 스스로 닫혀요) */
  onDone?: (trip: Trip | null, action: 'added' | 'updated' | 'deleted') => void;
}

/**
 * 여행 추가 · 고치기. 이름 → 떠나는 날 · 돌아오는 날 → 총예산 → 항목 예산(선택: 항공 · 숙박 · 교통 · 식비 · 투어 · 쇼핑 · 기타).
 * 고칠 때는 아래에 지우기가 있고 같은 창에서 한 번 더 물어요. 여행 예산은 늘 이벤트통장에서 나가요.
 */
export function TripDialog({ trip, onClose, onDone }: TripDialogProps) {
  const ledger = useLedger();
  const toast = useToast();
  const uid = useId().replace(/:/g, '');
  const formId = `trip-${uid}`;
  const editing = !!trip;
  const defaultStart = addDays(ledger.today, 30);
  const [name, setName] = useState(trip?.name ?? '');
  const [startDate, setStartDate] = useState(trip?.startDate ?? defaultStart);
  const [endDate, setEndDate] = useState(trip?.endDate ?? addDays(defaultStart, 2));
  const [budget, setBudget] = useState<Won | null>(trip && trip.budget > 0 ? trip.budget : null);
  const [items, setItems] = useState<Record<TripItem, Won | null>>(() => itemFormValues(trip?.items ?? {}));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState<'save' | 'delete' | null>(null);
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [stepChanged, setStepChanged] = useState(false);
  useEffect(() => {
    if (!stepChanged) return;
    document.getElementById(step === 'confirm' ? `${uid}-keep` : `${uid}-delete`)?.focus();
  }, [step, stepChanged, uid]);

  const hint = itemBudgetHint(budget, items);

  function input() {
    const cleanItems: Partial<Record<TripItem, Won>> = {};
    for (const k of TRIP_ITEMS) if (items[k]) cleanItems[k] = items[k]!;
    return { name, startDate, endDate, budget: budget ?? 0, items: cleanItems };
  }

  function validate(): boolean {
    const next: Errors = {};
    if (!name.trim()) next.name = '여행 이름을 입력해 주세요';
    if (!startDate) next.start = '떠나는 날을 골라 주세요';
    if (!endDate) next.end = '돌아오는 날을 골라 주세요';
    else if (startDate && endDate < startDate) next.end = '돌아오는 날이 떠나는 날보다 빨라요';
    if (Object.keys(next).length === 0) {
      const err = validateTrip(input());
      if (err) next.budget = err;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) focusFirstInvalid();
    return Object.keys(next).length === 0;
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving || !validate()) return;
    setSaving('save');
    try {
      if (trip) {
        await ledger.updateTrip(trip.id, input());
        toast.success(`‘${name.trim()}’ 여행을 고쳤어요`);
        onDone?.(trip, 'updated');
      } else {
        const created = await ledger.addTrip(input());
        toast.success(`‘${created.name}’ 여행을 추가했어요`);
        onDone?.(created, 'added');
      }
      onClose();
    } catch (err) {
      toast.error(errorText(err, trip ? '여행을 고치지 못했어요' : '여행을 추가하지 못했어요'));
      setSaving(null);
    }
  }

  async function remove() {
    if (!trip || saving) return;
    setSaving('delete');
    try {
      await ledger.deleteTrip(trip.id);
      toast.success(`‘${trip.name}’ 여행을 지웠어요`, {
        action: {
          label: '되돌리기',
          onClick: () => {
            ledger.restoreTrip(trip.id).catch((err: unknown) => toast.error(errorText(err, '여행을 되살리지 못했어요')));
          },
        },
      });
      onDone?.(null, 'deleted');
      onClose();
    } catch (err) {
      toast.error(errorText(err, '여행을 지우지 못했어요'));
      setSaving(null);
    }
  }

  const goStep = (next: 'form' | 'confirm') => {
    setStep(next);
    setStepChanged(true);
  };
  const close = () => {
    if (!saving) onClose();
  };

  if (step === 'confirm' && trip) {
    return (
      <Dialog
        open
        onClose={close}
        dismissible={!saving}
        showClose={false}
        title="여행을 지울까요?"
        description={`‘${trip.name}’ 여행을 지우면 남은 예산이 이벤트통장 예측에서 빠져요. 기록한 지출은 그대로 남아요.`}
        actions={
          <>
            <Button id={`${uid}-keep`} variant="outline" onClick={() => goStep('form')} disabled={saving === 'delete'}>
              취소
            </Button>
            <Button variant="danger" icon="trash" onClick={() => void remove()} loading={saving === 'delete'}>
              지우기
            </Button>
          </>
        }
      />
    );
  }

  return (
    <Dialog
      open
      wide
      onClose={close}
      dismissible={!saving}
      title={editing ? '여행 고치기' : '여행 추가'}
      description="여행 예산은 이벤트통장에서 나가요. 아직 안 쓴 예산은 여행 날짜의 달 예측에 들어가요."
      actions={
        <>
          <Button variant="outline" onClick={close} disabled={!!saving}>
            취소
          </Button>
          <Button type="submit" form={formId} icon="check" loading={saving === 'save'} disabled={saving === 'delete'}>
            {editing ? '저장하기' : '추가하기'}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={save} noValidate>
        <Field label="이름" error={errors.name} required>
          <TextInput
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setErrors((x) => ({ ...x, name: undefined }));
            }}
            placeholder="예: 제주 여행"
            maxLength={40}
            data-autofocus=""
          />
        </Field>
        <div className={styles.formGrid}>
          <Field label="떠나는 날" error={errors.start} required>
            <DateInput
              value={startDate}
              onChange={(v) => {
                setStartDate(v);
                if (v && endDate && endDate < v) setEndDate(v);
                if (errors.start) setErrors((x) => ({ ...x, start: undefined }));
              }}
            />
          </Field>
          <Field label="돌아오는 날" error={errors.end} required>
            <DateInput
              value={endDate}
              min={startDate || undefined}
              onChange={(v) => {
                setEndDate(v);
                if (errors.end) setErrors((x) => ({ ...x, end: undefined }));
              }}
            />
          </Field>
        </div>
        <Field label="총예산" error={errors.budget} required hint="항목 예산만 넣으면 그 합이 총예산이 돼요">
          <MoneyInput
            size="lg"
            value={budget}
            onChange={(v) => {
              setBudget(v);
              if (errors.budget) setErrors((x) => ({ ...x, budget: undefined }));
            }}
          />
        </Field>
        <fieldset className={styles.fieldset}>
          <legend className="label">
            항목 예산 <span className="opt-text">(선택)</span>
          </legend>
          <div className={styles.itemGrid}>
            {TRIP_ITEMS.map((k) => (
              <Field key={k} label={TRIP_ITEM_LABELS[k]}>
                <MoneyInput value={items[k]} onChange={(v) => setItems((x) => ({ ...x, [k]: v }))} />
              </Field>
            ))}
          </div>
          {hint ? <p className={styles.hint}>{hint}</p> : null}
        </fieldset>
        {editing ? (
          <div className={styles.dangerRow}>
            <Button
              id={`${uid}-delete`}
              variant="ghost"
              icon="trash"
              className={styles.dangerBtn}
              onClick={() => goStep('confirm')}
              disabled={!!saving}
            >
              여행 지우기
            </Button>
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
