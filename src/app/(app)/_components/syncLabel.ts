import type { LedgerApi } from '@/state';

/** 마지막으로 맞춘 시각을 짧게: '방금 맞췄어요' · '5분 전에 맞췄어요' · '3시간 전에 맞췄어요' · '11월 9일에 맞췄어요' */
export function syncedAgo(syncedAt: string | null, now: Date): string {
  if (!syncedAt) return '';
  const at = new Date(syncedAt);
  const ms = now.getTime() - at.getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return '방금 맞췄어요';
  if (min < 60) return `${min}분 전에 맞췄어요`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 전에 맞췄어요`;
  return `${at.getMonth() + 1}월 ${at.getDate()}일에 맞췄어요`;
}

/** 새로고침 버튼 옆 상태 글 */
export function syncStatus(sync: LedgerApi['sync'], now: Date): string {
  if (sync.syncing) return '맞추는 중…';
  return syncedAgo(sync.syncedAt, now);
}
