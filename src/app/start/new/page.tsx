'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/state';
import { ThemeToggle } from '@/theme';
import { FocusShell } from '@/ui';
import { StartSkeleton } from '../_components/StartSkeleton';
import '../start.css';
import { Wizard } from './Wizard';

/** 새 가계부 만들기 (로그인해야 해요) */
export default function NewLedgerPage() {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session.status === 'signedOut') router.replace('/start');
  }, [session.status, router]);

  return (
    <FocusShell wide headerAside={<ThemeToggle />}>
      {session.status === 'signedIn' ? <Wizard /> : <StartSkeleton />}
    </FocusShell>
  );
}
