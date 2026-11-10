'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLedger, useSession } from '@/state';
import { AppShell, Avatar, Banner, isNavActive, useToast } from '@/ui';
import { CreateSheet, type CreateState } from './_components/CreateSheet';
import { LedgerSwitcher } from './_components/LedgerSwitcher';
import { MonthEndDialog } from './_components/MonthEndDialog';
import { APP_NAV, FAB_HIDDEN_PATHS, MOBILE_NAV, SETTINGS_HREF } from './_components/nav';
import { PageSkeleton, SwitcherSkeleton } from './_components/PageSkeleton';
import { syncStatus } from './_components/syncLabel';
// 설정·예산 화면 스타일도 앱 틀과 같은 묶음으로 불러요. 화면마다 따로 두면 메뉴 링크를 미리 불러올 때마다
// 쓰지 않는 CSS 를 미리 받아 두고 브라우저가 경고를 남겨요
import './settings/settings.css';

const OFFLINE_TITLE = '연결이 안 돼서 마지막으로 맞춘 내용을 보여 줘요';

/**
 * 앱 틀 (로그인 + 가계부 선택 뒤의 화면들).
 * 로그인 안 했거나 고른 가계부가 없으면 /start 로 보내요. 세션을 읽는 동안은 뼈대만 보여요.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const session = useSession();
  const ledger = useLedger();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const toast = useToast();
  const [create, setCreate] = useState<CreateState>(null);

  const needsStart = session.status === 'signedOut' || (session.status === 'signedIn' && !session.activeLedger);
  const ready = session.status === 'signedIn' && session.activeLedger !== null;

  useEffect(() => {
    if (needsStart) router.replace('/start');
  }, [needsStart, router]);

  // 가계부를 바꾸면 이전 가계부의 '되돌리기' 알림을 닫아요 (누르면 새 가계부에 이전 가계부의 행이 써지지 않게)
  const ledgerId = ledger.ref?.id ?? null;
  const lastLedgerId = useRef(ledgerId);
  useEffect(() => {
    if (lastLedgerId.current === ledgerId) return;
    lastLedgerId.current = ledgerId;
    toast.dismissActions();
  }, [ledgerId, toast]);

  // 화면에 데이터가 있는 채로 뒤에서 다시 읽다가 실패하면 알림만 띄워요 (첫 불러오기 실패는 RequireLedger 가 보여요).
  // 연결이 안 돼 보관한 내용을 보여 주는 중이면 알림 대신 본문 위 안내로 보여요
  const hasData = ledger.data !== null;
  const offline = ledger.sync.offline;
  const shownError = useRef<string | null>(null);
  useEffect(() => {
    if (!ledger.error) {
      shownError.current = null;
      return;
    }
    if (!hasData || offline || shownError.current === ledger.error) return;
    shownError.current = ledger.error;
    toast.error(ledger.error);
  }, [ledger.error, hasData, offline, toast]);

  // 열 때 시트를 자동으로 고쳤으면 한 번 알려요 (예: '통장 주인을 멤버와 이었어요')
  const { notice, dismissNotice } = ledger;
  useEffect(() => {
    if (!notice) return;
    toast.success(notice);
    dismissNotice();
  }, [notice, dismissNotice, toast]);

  // 마지막으로 맞춘 시각 글을 30초마다 다시 써요
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const { reload } = ledger;
  const onRefresh = useCallback(() => reload(), [reload]);
  const showRefresh = ready && hasData;

  const user = session.user;
  const userName = user ? user.name || user.email : '내 정보';

  return (
    <AppShell
      nav={APP_NAV}
      mobileNav={MOBILE_NAV}
      current={pathname}
      header={ready ? <LedgerSwitcher variant="block" /> : <SwitcherSkeleton />}
      create={
        ready
          ? {
              label: '기록',
              onClick: () => setCreate('menu'),
              expanded: create === 'menu',
              fab: !FAB_HIDDEN_PATHS.some((p) => isNavActive(p, pathname)),
            }
          : undefined
      }
      profile={{
        href: SETTINGS_HREF,
        name: userName,
        caption: session.mode === 'demo' ? '설정 · 체험 모드' : '설정',
        avatar: <Avatar name={userName} src={user?.picture} size="sm" />,
      }}
      refresh={showRefresh ? { onRefresh, busy: ledger.sync.syncing, status: syncStatus(ledger.sync, ledger.now()) } : undefined}
    >
      {ready && offline ? (
        <Banner tone="warning" title={OFFLINE_TITLE}>
          기록하거나 고치는 건 연결된 뒤에 할 수 있어요
        </Banner>
      ) : null}
      {ready ? children : <PageSkeleton />}
      {ready ? <MonthEndDialog /> : null}
      {ready ? <CreateSheet state={create} onChange={setCreate} /> : null}
    </AppShell>
  );
}
