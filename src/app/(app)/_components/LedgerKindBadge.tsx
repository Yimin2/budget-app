import type { LedgerKind } from '@/domain/types';
import { Badge } from '@/ui';

export const LEDGER_KIND_TEXT: Record<LedgerKind, string> = { shared: '공용', personal: '개인' };

/** 공용 / 개인 표시 (상태가 아니라서 점 없이 글자만) */
export function LedgerKindBadge({ kind, className }: { kind: LedgerKind; className?: string }) {
  return (
    <Badge tone={kind === 'shared' ? 'brand' : 'neutral'} size="sm" dot={false} className={className}>
      {LEDGER_KIND_TEXT[kind]}
    </Badge>
  );
}
