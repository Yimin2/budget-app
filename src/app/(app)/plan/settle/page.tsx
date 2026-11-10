import type { Metadata } from 'next';
import { SettleScreen } from './SettleScreen';

export const metadata: Metadata = { title: '이번 달 정산' };

/** '/plan/settle' 이번 달 정산 — 항목을 골라 지급해요 (이벤트 화면의 [정산하기]) */
export default function SettlePage() {
  return <SettleScreen />;
}
