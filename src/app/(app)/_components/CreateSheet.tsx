'use client';

import { useRouter } from 'next/navigation';
import { Dialog, ListRow } from '@/ui';
import { ExpenseDialog } from '../history/_expenses/ExpenseDialog';
import { TransferDialog } from '../history/_accounts/TransferDialog';

/** + 버튼이 여는 것: 고르는 시트 · 지출 기록 창 · 이체 기록 창 */
export type CreateState = 'menu' | 'expense' | 'transfer' | null;

export interface CreateSheetProps {
  state: CreateState;
  onChange: (next: CreateState) => void;
}

/**
 * 가운데 + (데스크톱은 '+ 기록')을 누르면 뜨는 시트. 모바일은 아래에서 올라오고 768px 이상은 가운데 창이에요.
 * 지출 기록 · 사도 돼? · 이체 기록 중 하나를 고르면 그 창(또는 사도 돼? 화면)으로 이어져요.
 */
export function CreateSheet({ state, onChange }: CreateSheetProps) {
  const router = useRouter();
  return (
    <>
      <Dialog open={state === 'menu'} onClose={() => onChange(null)} title="무엇을 기록할까요?">
        <ul className="list cs-list">
          <li>
            <ListRow icon="receipt" title="지출 기록" subtitle="쓴 돈을 남겨요" onClick={() => onChange('expense')} />
          </li>
          <li>
            <ListRow
              icon="cart"
              title="사도 돼?"
              subtitle="사기 전에 써도 되는지 알아봐요"
              onClick={() => {
                onChange(null);
                router.push('/check');
              }}
            />
          </li>
          <li>
            <ListRow icon="arrow-left-right" title="이체 기록" subtitle="통장 사이에 옮긴 돈을 남겨요" onClick={() => onChange('transfer')} />
          </li>
        </ul>
      </Dialog>
      {state === 'expense' ? <ExpenseDialog onClose={() => onChange(null)} /> : null}
      {state === 'transfer' ? <TransferDialog mode="transfer" onClose={() => onChange(null)} /> : null}
    </>
  );
}
