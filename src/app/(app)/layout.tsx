'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { useLedger, useSession } from '@/state';
import { AppShell, useToast } from '@/ui';
import { LedgerSwitcher } from './_components/LedgerSwitcher';
import { MonthEndDialog } from './_components/MonthEndDialog';
import { APP_NAV, MOBILE_NAV } from './_components/nav';
import { PageSkeleton, SwitcherSkeleton } from './_components/PageSkeleton';
import { SidebarFooter } from './_components/SidebarFooter';
// 설정·멤버 화면 스타일도 앱 틀과 같은 묶음으로 불러요. 화면마다 따로 두면 메뉴 링크를 미리 불러올 때마다
// 쓰지 않는 CSS 를 미리 받아 두고 브라우저가 경고를 남겨요
import './settings/settings.css';

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

  // 화면에 데이터가 있는 채로 뒤에서 다시 읽다가 실패하면 알림만 띄워요 (첫 불러오기 실패는 RequireLedger 가 보여요)
  const hasData = ledger.data !== null;
  const shownError = useRef<string | null>(null);
  useEffect(() => {
    if (!ledger.error) {
      shownError.current = null;
      return;
    }
    if (!hasData || shownError.current === ledger.error) return;
    shownError.current = ledger.error;
    toast.error(ledger.error);
  }, [ledger.error, hasData, toast]);

  return (
    <AppShell
      nav={APP_NAV}
      mobileNav={MOBILE_NAV}
      current={pathname}
      header={ready ? <LedgerSwitcher variant="block" /> : <SwitcherSkeleton />}
      footer={ready ? <SidebarFooter /> : null}
    >
      {ready ? children : <PageSkeleton />}
      {ready ? <MonthEndDialog /> : null}
    </AppShell>
  );
}
