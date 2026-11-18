'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { LedgerApi } from './types';
import { useLedgerCore } from './ledger-hooks/core';
import { useLedgerDerived } from './ledger-hooks/derived';
import { useExpenseActions } from './ledger-hooks/expenses';
import { useClaimActions } from './ledger-hooks/claims';
import { useSettleRecordActions } from './ledger-hooks/settleRecords';
import { useTripActions } from './ledger-hooks/trips';
import { useEventActions } from './ledger-hooks/events';
import { useRuleActions } from './ledger-hooks/rules';
import { useIncomePlanActions } from './ledger-hooks/incomePlans';
import { useShortageActions } from './ledger-hooks/shortage';
import { useInstallmentActions } from './ledger-hooks/installments';
import { useAccountActions } from './ledger-hooks/accounts';
import { useFixedActions } from './ledger-hooks/fixed';
import { useNextMonthActions } from './ledger-hooks/nextMonth';
import { useMonthEndActions } from './ledger-hooks/monthEnd';
import { useMemberActions } from './ledger-hooks/members';
import { useImportActions } from './ledger-hooks/importFile';

export { AUTO_REFRESH_MS, OFFLINE_MESSAGE, OFFLINE_WRITE_MESSAGE } from './ledger-hooks/helpers';

/**
 * 가계부 상태. 뼈대(불러오기 · 쓰기 공통)와 계산값, 그리고 일마다 나눈 동작을 순서대로 이어 붙여요.
 * 뒤의 묶음은 앞 묶음이 만든 값을 받아 써요 — 각 묶음은 ./ledger-hooks 에 있어요.
 */
const LedgerContext = createContext<LedgerApi | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const core = useLedgerCore();
  const derivedPart = useLedgerDerived(core);
  const c1 = { ...core, ...derivedPart };
  const expensesPart = useExpenseActions(c1);
  const c2 = { ...c1, ...expensesPart };
  const claimsPart = useClaimActions(c2);
  const c3 = { ...c2, ...claimsPart };
  const settleRecordsPart = useSettleRecordActions(c3);
  const c4 = { ...c3, ...settleRecordsPart };
  const tripsPart = useTripActions(c4);
  const c5 = { ...c4, ...tripsPart };
  const eventsPart = useEventActions(c5);
  const c6 = { ...c5, ...eventsPart };
  const rulesPart = useRuleActions(c6);
  const c7 = { ...c6, ...rulesPart };
  const incomePlansPart = useIncomePlanActions(c7);
  const c8 = { ...c7, ...incomePlansPart };
  const shortagePart = useShortageActions(c8);
  const c9 = { ...c8, ...shortagePart };
  const installmentsPart = useInstallmentActions(c9);
  const c10 = { ...c9, ...installmentsPart };
  const accountsPart = useAccountActions(c10);
  const c11 = { ...c10, ...accountsPart };
  const fixedPart = useFixedActions(c11);
  const c12 = { ...c11, ...fixedPart };
  const nextMonthPart = useNextMonthActions(c12);
  const c13 = { ...c12, ...nextMonthPart };
  const monthEndPart = useMonthEndActions(c13);
  const c14 = { ...c13, ...monthEndPart };
  const membersPart = useMemberActions(c14);
  const c15 = { ...c14, ...membersPart };
  const importFilePart = useImportActions(c15);
  const c16 = { ...c15, ...importFilePart };
  const {
    deps, ref, savingCount, loadingCount, notice, today, sharingRef, status, data, error, needsReconnect, syncedAt, fromCache, offline,
    loadAll, activeAccounts, activeCategories, pickableCategories, categoryScores, accountByRole, incomeAccounts, living, myLivingId,
    livingViews, spenders, mySpender, livingFor, meChoices, balances, eventProjection, shortageFix, pendingMonthEnd, claims, claimPayers,
    settlement, loanCandidates, installments, trips, installmentHint, previewClaimDue, judge, displayName, addExpense,
    setExpenseExclusions, updateExpense, settleClaims, unsettleClaims, borrowAndSettleClaims, repayLoan, undoRepayLoan, convertToLoan,
    unconvertLoan, borrowReservoirClaims, convertSettledReservoirClaims, undoReservoirClaims, undoClaimPayments, cancelClaimLoans,
    cancelLoanTransfer, updateLoanAmount, restoreRows, saveSettleDay, saveDaysOff, saveDismissedRecurring, deleteExpense, addTrip,
    updateTrip, deleteTrip, restoreTrip, addEvent, registerAnnualEvents, updateEvent, completeEvent, cancelEvent, deleteEvent, saveRule,
    addRule, addIncomePlan, saveIncomePlan, changeRuleAmount, applyIncreaseMonthly, applyFromReservoir, addInstallment, reviseInstallment,
    prepayInstallment, endInstallment, deleteInstallment, saveAccount, addAccount, addTransfer, deleteTransfer, adjustBalance, saveFixed,
    changeFixedAmount, saveLivingItem, setLivingOverride, endFixedSeries, prepareNextMonth, resetNextMonth, splitForNextMonth, addFixed,
    saveCategory, addCategory, moveCategoryTo, setCategoriesHidden, mergeCategory, undoCategoryMerge, moveCategory, decideMonthEnd,
    linkMemberAccount, claimOwner, dismissNotice, inviteMember, renameLedger, previewImport, importFile, reload,
  } = c16;

  const sync = useMemo<LedgerApi['sync']>(
    () => ({ syncing: loadingCount > 0, syncedAt, fromCache, offline }),
    [loadingCount, syncedAt, fromCache, offline],
  );
  const refreshSharing = useCallback(async () => {
    await loadAll();
    return sharingRef.current;
  }, [loadAll, sharingRef]);

  const api = useMemo<LedgerApi>(
    () => ({
      status,
      error,
      needsReconnect,
      ref,
      data,
      today,
      saving: savingCount > 0,
      reload,
      sync,
      now: deps.now,
      living,
      livingViews,
      myLivingAccountId: myLivingId,
      meChoices,
      claimOwner,
      notice,
      dismissNotice,
      livingFor,
      spenders,
      mySpenderKey: mySpender,
      balances,
      eventProjection,
      shortageFix,
      pendingMonthEnd,
      activeAccounts,
      activeCategories,
      pickableCategories,
      categoryScores,
      accountByRole,
      incomeAccounts,
      judge,
      claims,
      claimPayers,
      previewClaimDue,
      settleClaims,
      unsettleClaims,
      settlement,
      loanCandidates,
      borrowAndSettleClaims,
      repayLoan,
      undoRepayLoan,
      convertToLoan,
      unconvertLoan,
      saveSettleDay,
      saveDaysOff,
      saveDismissedRecurring,
      borrowReservoirClaims,
      convertSettledReservoirClaims,
      undoReservoirClaims,
      undoClaimPayments,
      cancelClaimLoans,
      cancelLoanTransfer,
      updateLoanAmount,
      restoreRows,
      installments,
      installmentHint,
      addInstallment,
      reviseInstallment,
      prepayInstallment,
      endInstallment,
      deleteInstallment,
      trips,
      addTrip,
      updateTrip,
      deleteTrip,
      restoreTrip,
      addExpense,
      updateExpense,
      deleteExpense,
      setExpenseExclusions,
      addEvent,
      registerAnnualEvents,
      updateEvent,
      completeEvent,
      cancelEvent,
      deleteEvent,
      applyIncreaseMonthly,
      applyFromReservoir,
      saveAccount,
      addAccount,
      addTransfer,
      deleteTransfer,
      adjustBalance,
      saveRule,
      addRule,
      changeRuleAmount,
      changeFixedAmount,
      endFixedSeries,
      saveLivingItem,
      setLivingOverride,
      addIncomePlan,
      saveIncomePlan,
      saveFixed,
      addFixed,
      prepareNextMonth,
      resetNextMonth,
      splitForNextMonth,
      saveCategory,
      moveCategory,
      moveCategoryTo,
      addCategory,
      setCategoriesHidden,
      mergeCategory,
      undoCategoryMerge,
      decideMonthEnd,
      inviteMember,
      linkMemberAccount,
      refreshSharing,
      renameLedger,
      previewImport,
      importFile,
      displayName,
    }),
    [
      status, error, needsReconnect, ref, data, today, savingCount, reload, sync, deps.now, living, livingViews, myLivingId, meChoices, claimOwner, notice, dismissNotice, livingFor, spenders,
      mySpender, addIncomePlan, saveIncomePlan, balances, eventProjection, shortageFix,
      pendingMonthEnd, activeAccounts, activeCategories, pickableCategories, categoryScores, accountByRole, incomeAccounts, judge, claims, claimPayers,
      previewClaimDue, settleClaims, unsettleClaims, settlement, loanCandidates, borrowAndSettleClaims, repayLoan,
      undoRepayLoan, convertToLoan, unconvertLoan, saveSettleDay, saveDaysOff, saveDismissedRecurring, borrowReservoirClaims, convertSettledReservoirClaims, undoReservoirClaims, undoClaimPayments, cancelClaimLoans, cancelLoanTransfer, updateLoanAmount, restoreRows, installments, installmentHint, addInstallment,
      reviseInstallment, prepayInstallment, endInstallment, deleteInstallment, trips, addTrip, updateTrip, deleteTrip,
      restoreTrip, addExpense, updateExpense,
      deleteExpense, setExpenseExclusions, addEvent, registerAnnualEvents, updateEvent, completeEvent, cancelEvent, deleteEvent, applyIncreaseMonthly,
      applyFromReservoir, saveAccount, addAccount, addTransfer, deleteTransfer, adjustBalance, saveRule, addRule,
      changeRuleAmount, changeFixedAmount, endFixedSeries, saveLivingItem, setLivingOverride, saveFixed, addFixed, prepareNextMonth, resetNextMonth, splitForNextMonth, saveCategory, moveCategory, moveCategoryTo, addCategory, setCategoriesHidden, mergeCategory, undoCategoryMerge,
      decideMonthEnd, inviteMember, linkMemberAccount, refreshSharing, renameLedger, displayName, previewImport, importFile,
    ],
  );

  return <LedgerContext.Provider value={api}>{children}</LedgerContext.Provider>;
}

export function useLedger(): LedgerApi {
  const v = useContext(LedgerContext);
  if (!v) throw new Error('useLedger 는 AppProviders 안에서만 쓸 수 있어요');
  return v;
}

