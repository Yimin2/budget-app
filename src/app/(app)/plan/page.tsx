import type { Metadata } from 'next';
import { EventsView } from './EventsView';

export const metadata: Metadata = { title: '계획' };

/** '/plan' 계획 (이벤트통장 — 화면은 클라이언트 컴포넌트(EventsView)가 그려요 */
export default function EventsPage() {
  return <EventsView />;
}
