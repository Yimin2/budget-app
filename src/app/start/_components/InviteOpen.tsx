'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isGoogleError } from '@/google';
import { buildInviteLink, useSession } from '@/state';
import { Banner, Button, Icon, useToast } from '@/ui';
import { InAppNotice, SafariNotice } from './EnvNotices';
import { useBrowserEnv } from './useBrowserEnv';

type Phase = { kind: 'opening' } | { kind: 'cancelled' } | { kind: 'error'; message: string };

/**
 * 초대 링크(/start?open=<id>)로 들어왔을 때.
 * 로그인 전: 구글 로그인 요청 → 로그인하면 바로 열기 시도.
 * 구글 로그인: 바로 열리면 홈으로, 아니면 그 파일을 미리 골라 둔 구글 선택 창 → [선택] 하면 홈으로.
 * 체험 모드: 구글 가계부에서만 된다고 안내.
 * 아이폰 홈 화면 앱 · 앱 안 브라우저: 선택 창 없이 바로 열어 보고, 안 되면 Safari(또는 Chrome)에서 한 번 열라고 안내
 */
export function InviteOpen({ spreadsheetId, onDismiss }: { spreadsheetId: string; onDismiss: () => void }) {
  const session = useSession();

  if (session.status === 'signedOut') return <InviteSignIn onDismiss={onDismiss} />;
  if (session.mode === 'demo') return <InviteDemo onDismiss={onDismiss} />;
  return <InviteOpening spreadsheetId={spreadsheetId} onDismiss={onDismiss} />;
}

function InviteTitle({ sub }: { sub: string }) {
  return (
    <section className="sp-hero" aria-labelledby="sp-invite-title">
      <span className="sp-invite-ic" aria-hidden>
        <Icon name="users" size={24} />
      </span>
      <h1 id="sp-invite-title">가계부에 초대받았어요</h1>
      <p className="lead">{sub}</p>
    </section>
  );
}

function InviteSignIn({ onDismiss }: { onDismiss: () => void }) {
  const session = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const env = useBrowserEnv();

  async function signIn() {
    setBusy(true);
    try {
      // 로그인되면 화면이 InviteOpening 으로 바뀌어 바로 열기를 시작해요
      await session.signInWithGoogle();
    } catch (e) {
      if (!(isGoogleError(e) && e.code === 'popup_closed')) {
        toast.error(e instanceof Error && e.message ? e.message : '로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요');
      }
      setBusy(false);
    }
  }

  return (
    <>
      <InviteTitle sub="함께 쓰는 가계부예요. 초대받은 구글 계정으로 로그인하면 바로 열려요." />
      {session.notice ? <Banner tone="warning" title={session.notice} /> : null}
      {session.googleAvailable ? <InAppNotice env={env} /> : null}
      <div className="sp-cta">
        <Button
          size="lg"
          block
          onClick={signIn}
          loading={busy}
          disabled={!session.googleAvailable}
          aria-describedby={session.googleAvailable ? 'sp-invite-how' : 'sp-google-off'}
        >
          {busy ? null : (
            <span className="sp-g" aria-hidden>
              <Icon name="google" size={20} />
            </span>
          )}
          구글로 로그인하고 열기
        </Button>
        {session.googleAvailable ? (
          <p id="sp-invite-how" className="sp-note">
            <Icon name="info" size={16} />
            <span>
              {env.kind === 'ios-standalone'
                ? '로그인하면 바로 열어 볼게요. 이 앱에서 열리지 않으면 Safari에서 한 번만 열어 주세요.'
                : '로그인한 뒤 구글 파일 선택 창이 뜨면 [선택]을 눌러 주세요. 처음 한 번만 하면 돼요.'}
            </span>
          </p>
        ) : (
          <p id="sp-google-off" className="sp-note">
            <Icon name="info" size={16} />
            <span>구글 로그인이 아직 설정되지 않아 초대받은 가계부를 열 수 없어요.</span>
          </p>
        )}
        <Button size="lg" block variant="ghost" onClick={onDismiss} disabled={busy}>
          초대 없이 둘러보기
        </Button>
      </div>
    </>
  );
}

function InviteDemo({ onDismiss }: { onDismiss: () => void }) {
  const session = useSession();
  return (
    <>
      <InviteTitle sub="초대받은 가계부는 구글로 로그인해야 열 수 있어요." />
      <Banner tone="info" title="지금은 체험 모드예요">
        체험 모드는 이 브라우저에만 저장돼서 공유한 가계부를 열 수 없어요. 체험 모드를 끝내고 구글로 로그인해 주세요.
      </Banner>
      <div className="sp-cta">
        <Button size="lg" block icon="logout" onClick={() => session.signOut()}>
          체험 모드 끝내기
        </Button>
        <Button size="lg" block variant="ghost" onClick={onDismiss}>
          체험 계속하기
        </Button>
      </div>
    </>
  );
}

function InviteOpening({ spreadsheetId, onDismiss }: { spreadsheetId: string; onDismiss: () => void }) {
  const env = useBrowserEnv();
  const [forcePicker, setForcePicker] = useState(false);
  if (env.kind === 'normal' || forcePicker) return <InvitePickerOpening spreadsheetId={spreadsheetId} onDismiss={onDismiss} />;
  return (
    <InviteDirectOpening
      spreadsheetId={spreadsheetId}
      onDismiss={onDismiss}
      standalone={env.kind === 'ios-standalone'}
      onUsePicker={() => setForcePicker(true)}
    />
  );
}

type DirectPhase = { kind: 'opening' } | { kind: 'denied' } | { kind: 'error'; message: string };

/** 아이폰 홈 화면 앱 · 앱 안 브라우저: 선택 창 없이 바로 열기 (내 파일이거나 한 번 고른 적 있으면 열려요) */
function InviteDirectOpening({
  spreadsheetId,
  onDismiss,
  standalone,
  onUsePicker,
}: {
  spreadsheetId: string;
  onDismiss: () => void;
  standalone: boolean;
  onUsePicker: () => void;
}) {
  const session = useSession();
  const router = useRouter();
  const toast = useToast();
  const env = useBrowserEnv();
  const [phase, setPhase] = useState<DirectPhase>({ kind: 'opening' });
  const started = useRef(false);
  const { openLedgerDirect } = session;

  const run = useCallback(() => {
    openLedgerDirect(spreadsheetId).then(
      (result) => {
        if (result.kind === 'denied') {
          setPhase({ kind: 'denied' });
          return;
        }
        toast.success('초대받은 가계부를 열었어요');
        router.replace('/');
      },
      (e: unknown) => {
        setPhase({ kind: 'error', message: e instanceof Error && e.message ? e.message : '가계부를 열지 못했어요. 잠시 뒤 다시 시도해 주세요' });
      },
    );
  }, [openLedgerDirect, spreadsheetId, toast, router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
  }, [run]);

  function retry() {
    setPhase({ kind: 'opening' });
    run();
  }

  if (phase.kind === 'opening') {
    return (
      <>
        <InviteTitle sub="가계부를 여는 중이에요." />
        <div className="sp-invite-wait" role="status" aria-live="polite">
          <span className="spin" aria-hidden />
          <span>잠시만 기다려 주세요.</span>
        </div>
      </>
    );
  }

  const link = typeof window === 'undefined' ? '' : buildInviteLink(window.location.origin, spreadsheetId);
  return (
    <>
      <InviteTitle sub={phase.kind === 'denied' ? '여기서는 아직 이 가계부를 열 수 없어요.' : '가계부를 열지 못했어요.'} />
      {phase.kind === 'error' ? (
        <Banner tone="danger" title="가계부를 열지 못했어요">
          {phase.message}
        </Banner>
      ) : standalone ? (
        <SafariNotice link={link} />
      ) : (
        <InAppNotice env={env} href={link} />
      )}
      <div className="sp-cta">
        <Button size="lg" block variant={phase.kind === 'error' ? 'primary' : 'outline'} icon="refresh" onClick={retry}>
          다시 시도
        </Button>
        {phase.kind === 'denied' && !standalone ? (
          <Button size="lg" block variant="ghost" onClick={onUsePicker}>
            그래도 파일 선택 창 열기
          </Button>
        ) : null}
        <Button size="lg" block variant="ghost" onClick={onDismiss}>
          다른 가계부 고르기
        </Button>
      </div>
    </>
  );
}

function InvitePickerOpening({ spreadsheetId, onDismiss }: { spreadsheetId: string; onDismiss: () => void }) {
  const session = useSession();
  const router = useRouter();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: 'opening' });
  const started = useRef(false);
  const { openInvitedLedger } = session;

  const run = useCallback(() => {
    openInvitedLedger(spreadsheetId).then(
      (result) => {
        if (result.kind === 'cancelled') {
          setPhase({ kind: 'cancelled' });
          return;
        }
        toast.success('초대받은 가계부를 열었어요');
        router.replace('/');
      },
      (e: unknown) => {
        if (isGoogleError(e) && e.code === 'popup_closed') {
          setPhase({ kind: 'cancelled' });
          return;
        }
        setPhase({ kind: 'error', message: e instanceof Error && e.message ? e.message : '가계부를 열지 못했어요. 잠시 뒤 다시 시도해 주세요' });
      },
    );
  }, [openInvitedLedger, spreadsheetId, toast, router]);

  // 처음 한 번만 자동으로 열어요 (다시 열기는 버튼 클릭 안에서 — 구글 창이 막히지 않게)
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
  }, [run]);

  function retry() {
    setPhase({ kind: 'opening' });
    run();
  }

  if (phase.kind === 'opening') {
    return (
      <>
        <InviteTitle sub="가계부를 여는 중이에요." />
        <div className="sp-invite-wait" role="status" aria-live="polite">
          <span className="spin" aria-hidden />
          <span>구글 파일 선택 창이 뜨면 [선택]을 눌러 주세요.</span>
        </div>
      </>
    );
  }

  return (
    <>
      <InviteTitle sub={phase.kind === 'cancelled' ? '파일 선택 창을 닫았어요.' : '가계부를 열지 못했어요.'} />
      {phase.kind === 'cancelled' ? (
        <Banner tone="info" title="아직 열지 않았어요">
          구글 파일 선택 창에서 [선택]을 눌러야 이 가계부를 읽을 수 있어요. 처음 한 번만 하면 돼요.
        </Banner>
      ) : (
        <Banner tone="danger" title="가계부를 열지 못했어요">
          {phase.message}
        </Banner>
      )}
      <div className="sp-cta">
        <Button size="lg" block icon="refresh" onClick={retry}>
          {phase.kind === 'cancelled' ? '다시 열기' : '다시 시도'}
        </Button>
        <Button size="lg" block variant="ghost" onClick={onDismiss}>
          다른 가계부 고르기
        </Button>
      </div>
    </>
  );
}
