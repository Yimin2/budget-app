/**
 * 초대 링크 (PLAN 6장 · 공유받은 가계부 열기).
 * 앱은 drive.file 권한만 써서, 남이 공유한 시트는 구글 파일 선택 창(Picker)에서 한 번 골라야 읽을 수 있어요.
 * 링크 https://<주소>/start?open=<스프레드시트 id> 를 열면 그 파일을 미리 골라 둔 선택 창을 띄워요.
 * 이 파일은 React · 구글 전역에 닿지 않아요 (단위 테스트용)
 */
import type { LedgerRef } from '@/storage/types';

export const INVITE_PARAM = 'open';

/** 구글 스프레드시트 id: 영문 · 숫자 · - · _ (보통 44자) */
const ID_RE = /^[A-Za-z0-9_-]{20,128}$/;
/** 시트 주소를 그대로 붙여 넣어도 id 만 꺼내요 */
const URL_ID_RE = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,128})/;

/** 스프레드시트 id 로 보이면 그 id, 아니면 null */
export function normalizeSpreadsheetId(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (ID_RE.test(v)) return v;
  const m = URL_ID_RE.exec(v);
  return m?.[1] ?? null;
}

/** 초대 링크. origin 은 'https://budget.example' 처럼 끝 / 없이 */
export function buildInviteLink(origin: string, spreadsheetId: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/start?${INVITE_PARAM}=${encodeURIComponent(spreadsheetId)}`;
}

/** location.search ('?open=…') 에서 초대받은 스프레드시트 id. 없거나 이상하면 null */
export function parseInviteSearch(search: string | null | undefined): string | null {
  if (!search) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  } catch {
    return null;
  }
  return normalizeSpreadsheetId(params.get(INVITE_PARAM));
}

/** 첫 로그인 안내 ("공유받은 가계부가 있나요?"): 구글로 로그인했고 최근 가계부가 하나도 없을 때 */
export function shouldPromptShared(s: { status: string; mode: string | null; recentLedgers: readonly unknown[] }): boolean {
  return s.status === 'signedIn' && s.mode === 'google' && s.recentLedgers.length === 0;
}

/* ---------- 초대 링크로 열기 ---------- */

export interface InviteOpenDeps {
  /** 가계부인지 확인하고 이름·종류를 읽어요. 읽을 수 없으면 status 가 있는 오류 */
  describe(id: string): Promise<LedgerRef>;
  /** 구글 파일 선택 창. fileId 를 미리 골라 둬요. 닫으면 null */
  pick(fileId: string): Promise<{ id: string; name: string } | null>;
}

export type InviteOpenResult = { kind: 'opened'; ref: LedgerRef; picked: boolean } | { kind: 'cancelled' };

export const INVITE_MESSAGES = {
  noAccess: '이 가계부를 열 권한이 없어요. 초대한 사람에게 이 구글 계정으로 공유해 달라고 부탁해 주세요',
  failed: '가계부를 열지 못했어요. 잠시 뒤 다시 시도해 주세요',
} as const;

function statusOf(e: unknown): number | null {
  if (e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number') {
    return (e as { status: number }).status;
  }
  return null;
}

/** 아직 이 앱에 허락되지 않은 파일 (drive.file): 구글은 403 이나 404 로 답해요 */
function needsPicker(e: unknown): boolean {
  const s = statusOf(e);
  return s === 403 || s === 404;
}

function toKorean(e: unknown, fallback: string): Error {
  if (e instanceof Error && /[가-힣]/.test(e.message)) return e;
  return new Error(fallback);
}

/**
 * 1) 바로 읽어 보고 (내 파일이거나 이미 고른 적 있으면 선택 창 없이 열려요)
 * 2) 권한이 없으면 선택 창을 그 파일로 띄우고, 고르면 다시 읽어요.
 * 가계부가 아닌 파일 · 연결 오류는 선택 창 없이 그대로 알려요
 */
export async function openInvitedLedger(deps: InviteOpenDeps, spreadsheetId: string): Promise<InviteOpenResult> {
  try {
    const ref = await deps.describe(spreadsheetId);
    return { kind: 'opened', ref, picked: false };
  } catch (e) {
    if (!needsPicker(e)) throw toKorean(e, INVITE_MESSAGES.failed);
  }
  const picked = await deps.pick(spreadsheetId);
  if (!picked) return { kind: 'cancelled' };
  try {
    const ref = await deps.describe(picked.id);
    return { kind: 'opened', ref, picked: true };
  } catch (e) {
    if (needsPicker(e)) throw new Error(INVITE_MESSAGES.noAccess);
    throw toKorean(e, INVITE_MESSAGES.failed);
  }
}
