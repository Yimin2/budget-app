'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { preloadGoogle } from '@/google';
import { useSession } from '@/state';
import { ThemeToggle } from '@/theme';
import { FocusShell } from '@/ui';
import { LedgerPicker } from './_components/LedgerPicker';
import { StartSkeleton } from './_components/StartSkeleton';
import { Welcome } from './_components/Welcome';
import './start.css';

/** 시작: 로그인 전이면 첫 화면, 로그인했으면 가계부 고르기 */
export default function StartPage() {
  const session = useSession();
  const router = useRouter();
  const afterGoogle = useRef(false);

  // 구글 스크립트를 미리 불러 두면 버튼을 누르는 순간 로그인 창이 떠서 팝업 차단을 피해요
  useEffect(() => {
    void preloadGoogle();
  }, []);

  // 같은 계정으로 다시 로그인해서 쓰던 가계부가 남아 있으면 바로 홈으로
  useEffect(() => {
    if (!afterGoogle.current || session.status !== 'signedIn') return;
    afterGoogle.current = false;
    if (session.activeLedger) router.replace('/');
  }, [session.status, session.activeLedger, router]);

  return (
    // 고른 가계부가 없으면 로고도 이 화면에 머물러요 ('/' 는 다시 여기로 돌아오고, 미리 불러오기만 낭비돼요)
    <FocusShell headerAside={<ThemeToggle />} homeHref={session.activeLedger ? '/' : '/start'}>
      {session.status === 'loading' ? (
        <StartSkeleton />
      ) : session.status === 'signedOut' ? (
        <Welcome
          onGoogleStart={() => {
            afterGoogle.current = true;
          }}
          onGoogleFail={() => {
            afterGoogle.current = false;
          }}
        />
      ) : (
        <LedgerPicker />
      )}
    </FocusShell>
  );
}
