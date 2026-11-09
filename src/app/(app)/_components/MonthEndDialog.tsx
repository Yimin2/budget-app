'use client';

import { useEffect, useRef, useState } from 'react';
import { addMonths, formatMonthKo, formatWon, monthOf } from '@/domain';
import { useLedger, useSession } from '@/state';
import { Button, Dialog, Icon, useToast } from '@/ui';
import './screens.css';

type Choice = 'reservoir' | 'carryover';

/**
 * 월말 처리. 지난 달 생활비가 남았고 아직 아무도 고르지 않았으면 저절로 열려요.
 * 고르지 않은 달이 여럿이면 오래된 달부터 차례로 물어요 (한 달을 고르면 다음 달이 이어서 보여요).
 * '나중에 고를게요' 로 닫으면 이번 접속 동안은 다시 열지 않아요 (다음에 열면 다시 물어요).
 * 이월하는 달은 남은 달의 다음 달이에요 — 지난달이면 '이번 달', 더 앞이면 '12월'처럼 달 이름으로 적어요.
 */
export function MonthEndDialog() {
  const ledger = useLedger();
  const session = useSession();
  const toast = useToast();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<Choice | null>(null);
  // 고른 뒤 실제로 적용된 선택(다른 사람이 먼저 골랐을 수도 있어요)을 알리기 위해 기억해요
  const watching = useRef<{ ledgerId: string; month: string } | null>(null);

  const pending = ledger.status === 'ready' ? ledger.pendingMonthEnd : null;
  const ledgerId = ledger.ref?.id ?? null;
  const key = pending && ledgerId ? `${ledgerId}:${pending.month}` : null;
  const open = key !== null && key !== dismissedKey;

  const data = ledger.data;
  const isShared = data?.settings.kind === 'shared';
  const reservoir = ledger.accountByRole('reservoir');
  const livingAccountName = ledger.living?.livingAccountId
    ? (ledger.activeAccounts.find((a) => a.id === ledger.living?.livingAccountId)?.name ?? null)
    : null;
  const me = session.user?.email.toLowerCase() ?? '';

  useEffect(() => {
    const w = watching.current;
    if (!w || !data || ledgerId !== w.ledgerId) return;
    const row = data.monthEnds.find((m) => m.month === w.month && m.choice !== 'pending');
    if (!row) return;
    watching.current = null;
    const amount = formatWon(row.leftover);
    const byOther = row.decidedBy !== null && row.decidedBy.toLowerCase() !== me;
    const what =
      row.choice === 'reservoir'
        ? `저수지로 ${amount}을 보냈어요`
        : `${amount}을 ${targetLabel(w.month, ledger.today)} 생활비로 넘겼어요`;
    if (byOther) toast.show(`${ledger.displayName(row.decidedBy!)}님이 먼저 골랐어요. ${what}`, { tone: 'info' });
    else toast.success(what);
  }, [data, ledgerId, me, ledger, toast]);

  if (!pending || !key) return null;

  async function decide(choice: Choice) {
    if (!pending || !ledgerId) return;
    setBusy(choice);
    watching.current = { ledgerId, month: pending.month };
    try {
      await ledger.decideMonthEnd(choice);
    } catch (e) {
      watching.current = null;
      toast.error(e instanceof Error && e.message ? e.message : '월말 처리를 저장하지 못했어요');
    } finally {
      setBusy(null);
    }
  }

  const baseYear = Number(ledger.today.slice(0, 4));
  const monthText = formatMonthKo(pending.month, baseYear);
  const isLastMonth = addMonths(monthOf(ledger.today), -1) === pending.month;
  const amountText = formatWon(pending.leftover);
  const target = targetLabel(pending.month, ledger.today);

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : setDismissedKey(key))}
      dismissible={!busy}
      wide
      title={`${isLastMonth ? '지난달' : monthText} 생활비가 ${amountText} 남았어요`}
      description={`${monthText} 생활비를 다 쓰지 않았어요. 남은 돈을 어디로 보낼지 골라 주세요.`}
      actions={
        <>
          <Button variant="ghost" onClick={() => setDismissedKey(key)} disabled={busy !== null}>
            나중에 고를게요
          </Button>
          <Button
            variant="outline"
            onClick={() => decide('carryover')}
            loading={busy === 'carryover'}
            disabled={busy === 'reservoir'}
          >
            {target} 생활비로 넘기기
          </Button>
          <Button
            onClick={() => decide('reservoir')}
            loading={busy === 'reservoir'}
            disabled={!reservoir || busy === 'carryover'}
            data-autofocus=""
          >
            저수지로 보내기
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="me-amount">
          <span className="lbl">{monthText}에 남은 생활비</span>
          <span className="val">{amountText}</span>
        </div>
        <ul className="me-choices">
          <li className="me-choice">
            <Icon name="piggy-bank" size={20} />
            <div>
              <strong>저수지로 보내기</strong>
              <span>
                {reservoir
                  ? `${livingAccountName ?? '생활비 통장'} → ${reservoir.name} 이체로 기록해요`
                  : '저수지통장이 없어서 고를 수 없어요. 설정에서 통장을 추가할 수 있어요'}
              </span>
            </div>
          </li>
          <li className="me-choice">
            <Icon name="repeat" size={20} />
            <div>
              <strong>{target} 생활비로 넘기기</strong>
              <span>
                {target} 생활비가 {amountText} 늘어나요
              </span>
            </div>
          </li>
        </ul>
        {isShared ? (
          <p className="me-note">
            <Icon name="users" size={16} />
            <span>공용 가계부는 먼저 고른 사람의 선택이 적용돼요. 누가 골랐는지 기록에 남아요.</span>
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** 남은 달의 다음 달 이름: 이번 달이면 '이번 달', 아니면 '12월' · '2027년 1월' */
function targetLabel(month: string, today: string): string {
  const target = addMonths(month, 1);
  if (target === monthOf(today)) return '이번 달';
  return formatMonthKo(target, Number(today.slice(0, 4)));
}
