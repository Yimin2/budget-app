/**
 * 예산 달별 보기 (작업정리 13): 고른 달의 예산 화면이 쓸 가계부.
 * 예산 카드(배분 · 수입 계획 · 고정비 · 할부 · 생활비 항목)는 모두 `ledger.today` 의 달을 보고 그리므로,
 * 그달 1일을 오늘로 둔 가계부를 넘기면 그달 유효한 행이 그대로 보여요 (지난 달 = 그때 적용된 예산).
 * - 지난 달: 고치기는 모두 막아요 (화면도 고치는 단추를 숨겨요)
 * - 다음 달(준비함): 고치기 전에 이번 달과 걸친 행을 나눠(splitForNextMonth) 다음 달 행만 고쳐요 — 이번 달은 그대로.
 *   새로 만드는 행에는 다음 달 표시를 붙여 [초기화] 때 함께 지워져요. 할부는 이번 달 화면에서만 고쳐요
 */
import {
  addMonths, billSeriesId, billSeriesRows, computeLiving, dateInMonth, daysInMonth, installmentPlans, isLivingOverride,
  livingOverridesOf, newId, nextMonthNewId, rowStart, type BudgetMonthView,
} from '@/domain';
import type { AllocationRule, FixedExpense, IncomePlan } from '@/domain/types';
import type { ReadyLedger } from '../_components/RequireLedger';

export const PAST_READ_ONLY = '지난 달은 보기만 할 수 있어요';
export const INSTALLMENT_THIS_MONTH = '할부는 이번 달 화면에서 고쳐요';

const reject = (message: string) => async (): Promise<never> => {
  throw new Error(message);
};

/** 고른 달의 예산 화면이 쓸 가계부 (이번 달은 그대로) */
export function ledgerForMonth(ledger: ReadyLedger, view: BudgetMonthView): ReadyLedger {
  if (view.kind === 'current') return ledger;
  const data = ledger.data;
  const today = view.asOf;
  const base: ReadyLedger = {
    ...ledger,
    today,
    living: computeLiving(data, today),
    installments: installmentPlans(data, today),
    addInstallment: reject(view.kind === 'past' ? PAST_READ_ONLY : INSTALLMENT_THIS_MONTH),
    reviseInstallment: reject(view.kind === 'past' ? PAST_READ_ONLY : INSTALLMENT_THIS_MONTH),
    prepayInstallment: reject(view.kind === 'past' ? PAST_READ_ONLY : INSTALLMENT_THIS_MONTH),
    endInstallment: reject(view.kind === 'past' ? PAST_READ_ONLY : INSTALLMENT_THIS_MONTH),
    deleteInstallment: reject(view.kind === 'past' ? PAST_READ_ONLY : INSTALLMENT_THIS_MONTH),
  };
  if (!view.editable) {
    const no = reject(view.kind === 'past' ? PAST_READ_ONLY : '다음 달은 [전달 복사]로 먼저 준비해 주세요');
    return {
      ...base,
      saveRule: no, addRule: no, changeRuleAmount: no, addIncomePlan: no, saveIncomePlan: no, saveFixed: no, addFixed: no,
      changeFixedAmount: no, endFixedSeries: no, saveLivingItem: no, setLivingOverride: no,
    };
  }
  return { ...base, ...nextMonthActions(ledger, view) };
}

/** 준비한 다음 달의 고치기: 이번 달과 걸친 행은 먼저 나눠서 다음 달 행만 고쳐요 */
function nextMonthActions(ledger: ReadyLedger, view: BudgetMonthView): Partial<ReadyLedger> {
  const next = view.month;
  const first = `${next}-01`;
  const cur = addMonths(next, -1);
  const curEnd = dateInMonth(cur, daysInMonth(cur));
  /** 이번 달에 끝나는(다음 달에 없는) 앞 행인지 — 다음 달 화면에서는 건드리지 않아요 (예: 이름을 모든 행에 맞추기) */
  const endsBefore = (r: { startMonth: string; endMonth: string | null }) => r.startMonth < next && r.endMonth !== null && r.endMonth !== '' && r.endMonth < next;
  const rowOf = <T extends { id: string }>(list: T[], id: string) => list.find((r) => r.id === id);

  return {
    saveRule: async (rule: AllocationRule) => {
      const orig = rowOf(ledger.data.rules, rule.id);
      if (orig && endsBefore(orig)) return;
      if (!orig || orig.startMonth >= next) return ledger.saveRule(rule);
      const id = await ledger.splitForNextMonth('rules', rule.id);
      return ledger.saveRule({ ...rule, id, startMonth: next });
    },
    addRule: (input) => ledger.addRule({ ...input, id: input.id || nextMonthNewId(newId(), 'rules', null, next), startMonth: input.startMonth < next ? next : input.startMonth }),
    changeRuleAmount: async (ruleId, amount) => {
      const id = await ledger.splitForNextMonth('rules', ruleId);
      return ledger.changeRuleAmount(id, amount, next);
    },
    addIncomePlan: (input) =>
      ledger.addIncomePlan({ ...input, id: input.id || nextMonthNewId(newId(), 'incomePlans', null, next), startMonth: input.startMonth < next ? next : input.startMonth }),
    saveIncomePlan: async (plan: IncomePlan) => {
      const orig = rowOf(ledger.data.incomePlans, plan.id);
      if (orig && endsBefore(orig)) return;
      if (!orig || orig.startMonth >= next) return ledger.saveIncomePlan(plan);
      const id = await ledger.splitForNextMonth('incomePlans', plan.id);
      return ledger.saveIncomePlan({ ...plan, id, startMonth: next });
    },
    addFixed: (input) =>
      ledger.addFixed({
        ...input,
        id: input.id || nextMonthNewId(newId(), 'fixedExpenses', input.kind, next),
        startMonth: input.startMonth < next ? next : input.startMonth,
        ...(input.startDate && input.startDate < first ? { startDate: first } : {}),
      }),
    saveFixed: async (row: FixedExpense) => {
      const orig = rowOf(ledger.data.fixedExpenses, row.id);
      if (!orig || orig.kind === 'installment' || isLivingOverride(orig)) return ledger.saveFixed(row);
      if (endsBefore(orig) || (orig.endDate && orig.endDate < first)) return;
      const startsBefore = orig.kind === 'living' ? orig.startMonth < next : rowStart(orig) < first;
      if (!startsBefore) return ledger.saveFixed(row);
      const id = await ledger.splitForNextMonth('fixedExpenses', row.id);
      const moved: FixedExpense =
        orig.kind === 'living' ? { ...row, id, startMonth: next } : { ...row, id, startMonth: next, startDate: row.startDate && row.startDate > first ? row.startDate : first };
      return ledger.saveFixed(moved);
    },
    changeFixedAmount: async (rowId, amount, from) => {
      const id = await ledger.splitForNextMonth('fixedExpenses', rowId);
      return ledger.changeFixedAmount(id, amount, from < first ? first : from);
    },
    endFixedSeries: async (seriesId, end) => {
      // 지우기 · 이번 달 날짜로 끝내기는 다음 달 행만: 이번 달 말일로 끝내면 그 뒤 행이 지워져요
      if (end !== null && end >= first) return ledger.endFixedSeries(seriesId, end);
      const rows = billSeriesRows(ledger.data.fixedExpenses, billSeriesId(seriesId));
      if (rows.length > 0 && rows.every((r) => rowStart(r) >= first)) return ledger.endFixedSeries(seriesId, null);
      return ledger.endFixedSeries(seriesId, curEnd);
    },
    saveLivingItem: async (rowId, nextRow) => {
      const orig = rowOf(ledger.data.fixedExpenses, rowId);
      if (!orig) return ledger.saveLivingItem(rowId, nextRow);
      const id = orig.startMonth < next ? await ledger.splitForNextMonth('fixedExpenses', rowId) : rowId;
      if (nextRow.deleted) {
        // 다음 달 행만 지우고, 다음 달 이후 '이 달만 다른 금액'도 함께 (이번 달 이전 것은 그대로)
        const after = livingOverridesOf(ledger.data.fixedExpenses, orig, next);
        await ledger.saveFixed({ ...orig, id, startMonth: next, endMonth: orig.endMonth, deleted: true });
        for (const o of after) await ledger.setLivingOverride(id, o.startMonth, null);
        return;
      }
      return ledger.saveLivingItem(id, { ...nextRow, id, startMonth: orig.startMonth < next ? next : nextRow.startMonth });
    },
  };
}
