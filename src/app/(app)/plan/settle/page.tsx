import type { Metadata } from 'next';
import { SettleScreen } from './SettleScreen';

export const metadata: Metadata = { title: '정산' };

/** '/plan/settle' 정산 — 달별 기록에서 줄 돈을 골라 지급해요 (이벤트 화면의 [정산하기]) */
export default function SettlePage() {
  return <SettleScreen />;
}
