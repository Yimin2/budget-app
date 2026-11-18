'use client';

import { useRouter } from 'next/navigation';
import { SegmentedControl } from '@/ui';
import { ExpenseDialog } from '../history/_expenses/ExpenseDialog';
import { TransferDialog } from '../history/_accounts/TransferDialog';

/** + 버튼이 여는 것: 지출 기록 창(기본) · 이체 기록 창 */
export type CreateState = 'expense' | 'transfer' | null;

export interface CreateSheetProps {
  state: CreateState;
  onChange: (next: CreateState) => void;
}

type Kind = 'expense' | 'check' | 'transfer';

/** 창 맨 위 '지출 · 사도 돼? · 이체' 탭. 사도 돼?는 화면으로 넘어가요 */
function KindSwitch({ value, onPick }: { value: Kind; onPick: (k: Kind) => void }) {
  return (
    <SegmentedControl<Kind>
      ariaLabel="무엇을 기록할까요"
      block
      value={value}
      onChange={onPick}
      options={[
        { value: 'expense', label: '지출' },
        { value: 'check', label: '사도 돼?' },
        { value: 'transfer', label: '이체' },
      ]}
    />
  );
}

/**
 * 오른쪽 아래 + (태블릿 · 데스크톱은 사이드바 '+ 기록')을 누르면 바로 지출 기록 창이 열려요.
 * 위쪽 탭으로 사도 돼?(화면으로 이동) · 이체 기록으로 바꿔요. 한 번 덜 눌러도 금액부터 칠 수 있게
 */
export function CreateSheet({ state, onChange }: CreateSheetProps) {
  const router = useRouter();
  const pick = (k: Kind) => {
    if (k === 'check') {
      onChange(null);
      router.push('/check');
      return;
    }
    onChange(k);
  };
  return (
    <>
      {state === 'expense' ? <ExpenseDialog onClose={() => onChange(null)} kindSwitch={<KindSwitch value="expense" onPick={pick} />} /> : null}
      {state === 'transfer' ? (
        <TransferDialog mode="transfer" onClose={() => onChange(null)} kindSwitch={<KindSwitch value="transfer" onPick={pick} />} />
      ) : null}
    </>
  );
}
