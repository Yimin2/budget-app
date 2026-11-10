'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isGoogleError } from '@/google';
import { useSession } from '@/state';
import { Banner, Button, Icon, type IconName, useToast } from '@/ui';
import { InAppNotice } from './EnvNotices';
import { useBrowserEnv } from './useBrowserEnv';

const FEATURES: { icon: IconName; title: string; desc: string }[] = [
  { icon: 'cart', title: '사도 돼? 를 신호등으로', desc: '오늘 생활비와 앞으로의 일정을 보고 바로 알려 드려요' },
  { icon: 'wallet', title: '통장 쪼개기 그대로', desc: '수입·고정지출·이벤트·저수지·저축투자 통장별 잔액을 자동으로 계산해요' },
  { icon: 'calendar', title: '모자라는 달을 미리', desc: '12개월 이벤트 일정을 보고 이벤트통장이 모자라는 달을 알려 드려요' },
];

/**
 * 로그인 전 첫 화면: 앱 약속 + 구글로 시작하기 / 체험해 보기.
 * onGoogleStart: 구글 로그인을 시작하기 직전에 불려요 (로그인 뒤 쓰던 가계부가 있으면 바로 홈으로 가려고). 실패하면 onGoogleFail
 */
export function Welcome({ onGoogleStart, onGoogleFail }: { onGoogleStart?: () => void; onGoogleFail?: () => void }) {
  const session = useSession();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<'google' | 'demo' | null>(null);
  const env = useBrowserEnv();

  async function signIn() {
    setBusy('google');
    onGoogleStart?.();
    try {
      // 로그인 서버가 있으면 구글 로그인 화면으로 이동했다가 홈으로 돌아와요 (고른 가계부가 없으면 다시 이 화면)
      await session.signInWithGoogle({ returnTo: '/' });
    } catch (e) {
      onGoogleFail?.();
      if (!(isGoogleError(e) && e.code === 'popup_closed')) {
        toast.error(e instanceof Error && e.message ? e.message : '로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요');
      }
      setBusy(null);
    }
  }

  async function demo() {
    setBusy('demo');
    try {
      await session.startDemo();
      router.replace('/');
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : '체험 모드를 시작하지 못했어요');
      setBusy(null);
    }
  }

  return (
    <>
      <section className="sp-hero" aria-labelledby="sp-hero-title">
        <h1 id="sp-hero-title">사기 전에 써도 되는지 알려주는 가계부</h1>
        <p className="lead">
          기록만 하는 가계부가 아니에요. 통장 쪼개기를 그대로 옮겨서, 지금 사도 괜찮은지 먼저 알려 드려요.
        </p>
      </section>

      <ul className="sp-features">
        {FEATURES.map((f) => (
          <li key={f.title}>
            <span className="ic" aria-hidden>
              <Icon name={f.icon} size={20} />
            </span>
            <span>
              <strong>{f.title}</strong>
              <span className="s">{f.desc}</span>
            </span>
          </li>
        ))}
      </ul>

      {session.notice ? (
        <Banner tone="warning" title={session.notice}>
          구글로 시작하기를 누르면 같은 계정으로 이어서 쓸 수 있어요.
        </Banner>
      ) : null}

      {session.googleAvailable ? <InAppNotice env={env} /> : null}

      <div className="sp-cta">
        <Button
          size="lg"
          block
          onClick={signIn}
          loading={busy === 'google'}
          disabled={!session.googleAvailable || busy === 'demo'}
          aria-describedby={session.googleAvailable ? undefined : 'sp-google-off'}
        >
          {busy === 'google' ? null : (
            <span className="sp-g" aria-hidden>
              <Icon name="google" size={20} />
            </span>
          )}
          구글로 시작하기
        </Button>
        {session.googleAvailable ? null : (
          <p id="sp-google-off" className="sp-note">
            <Icon name="info" size={16} />
            <span>구글 로그인이 아직 설정되지 않았어요. 체험해 보기로 먼저 둘러볼 수 있어요.</span>
          </p>
        )}
        <Button size="lg" block variant="outline" onClick={demo} loading={busy === 'demo'} disabled={busy === 'google'}>
          체험해 보기
        </Button>
        <p className="sp-note">
          <Icon name="lock" size={16} />
          <span>
            구글로 시작하면 가계부가 내 구글 드라이브의 시트로 만들어져요. 체험 모드는 이 브라우저에만 저장돼요.
          </span>
        </p>
      </div>
    </>
  );
}
