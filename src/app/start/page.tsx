'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { preloadGoogle } from '@/google';
import { parseInviteSearch, useSession } from '@/state';
import { ThemeToggle } from '@/theme';
import { FocusShell } from '@/ui';
import { InviteOpen } from './_components/InviteOpen';
import { LedgerPicker } from './_components/LedgerPicker';
import { StartSkeleton } from './_components/StartSkeleton';
import { Welcome } from './_components/Welcome';
import './start.css';

const noSubscribe = () => () => {};
const readSearch = () => window.location.search;
const serverSearch = () => '';

/** 시작: 로그인 전이면 첫 화면, 로그인했으면 가계부 고르기. 초대 링크(?open=<id>)면 그 가계부 열기 */
export default function StartPage() {
  const session = useSession();
  const router = useRouter();
  const afterGoogle = useRef(false);
  // 주소의 ?open= 은 브라우저에서만 읽어요 (서버 렌더에서는 빈 값)
  const search = useSyncExternalStore(noSubscribe, readSearch, serverSearch);
  const [dismissed, setDismissed] = useState(false);
  const inviteId = dismissed ? null : parseInviteSearch(search);

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
      ) : inviteId ? (
        <InviteOpen
          key={`${inviteId}:${session.mode ?? 'out'}:${session.user?.email ?? ''}`}
          spreadsheetId={inviteId}
          onDismiss={() => {
            setDismissed(true);
            router.replace('/start');
          }}
        />
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
