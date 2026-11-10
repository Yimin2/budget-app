'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import {
  SAFARI_ONCE, buildInviteLink, chromeIntentUrl, kakaoOpenExternalUrl, openInSafari, parseInviteInput, useSession, type BrowserEnv,
} from '@/state';
import { Banner, Button, Field, Icon, TextInput, cx, useToast } from '@/ui';

/** 링크 복사. 안 되면 false (화면에 주소를 보여 줘요) */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 아래로 */
  }
  return false;
}

function currentHref(): string {
  return typeof window === 'undefined' ? '' : window.location.href;
}

/** 복사가 안 될 때 길게 눌러 복사할 수 있게 주소를 보여 줘요 */
function ManualLink({ link }: { link: string }) {
  return (
    <Field label="이 주소를 길게 눌러 복사해 주세요">
      <TextInput readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
    </Field>
  );
}

export const IN_APP_TITLE = '카카오톡 같은 앱 안에서는 구글 로그인이 막혀요. Chrome이나 Safari로 열어 주세요';

/**
 * 앱 안 브라우저(카카오톡 등): 구글 로그인 · 파일 선택 창 전에 보여 줘요.
 * 안드로이드는 Chrome 으로 여는 링크, 아이폰은 링크 복사 + 'Safari로 열기' 방법 (카카오톡은 바로 Safari 로 여는 링크)
 */
export function InAppNotice({ env, href }: { env: BrowserEnv; href?: string }) {
  const toast = useToast();
  const [manual, setManual] = useState(false);
  if (env.kind !== 'in-app') return null;
  const link = href ?? currentHref();
  const intent = env.os === 'android' ? chromeIntentUrl(link) : null;
  const kakao = env.os === 'ios' && env.inApp === 'kakaotalk' ? kakaoOpenExternalUrl(link) : null;
  const target = env.os === 'android' ? 'Chrome' : env.os === 'ios' ? 'Safari' : '브라우저';

  async function copy() {
    if (await copyText(link)) {
      setManual(false);
      toast.success(`링크를 복사했어요. ${target}에 붙여넣어 주세요`);
    } else {
      setManual(true);
    }
  }

  const how =
    env.os === 'android'
      ? '아래 [Chrome으로 열기]를 누르거나, 링크를 복사해 Chrome에 붙여넣어 주세요.'
      : env.os === 'ios'
        ? env.inApp === 'kakaotalk'
          ? '아래 [Safari로 열기]를 누르거나, 오른쪽 아래 ··· → Safari로 열기를 눌러 주세요.'
          : '화면의 ··· 메뉴 → Safari로 열기(또는 외부 브라우저로 열기)를 누르거나, 링크를 복사해 Safari에 붙여넣어 주세요.'
        : '링크를 복사해 Chrome이나 Safari에 붙여넣어 주세요.';

  return (
    <div className="sp-env" data-testid="in-app-notice">
      <Banner tone="warning" title={IN_APP_TITLE}>
        {how}
      </Banner>
      <div className="sp-env-acts">
        {intent ? (
          <a className="btn primary lg block" href={intent}>
            <Icon name="external" size={24} />
            Chrome으로 열기
          </a>
        ) : null}
        {kakao ? (
          <a className="btn primary lg block" href={kakao}>
            <Icon name="external" size={24} />
            Safari로 열기
          </a>
        ) : null}
        <Button size="lg" block variant={intent || kakao ? 'outline' : 'primary'} icon="copy" onClick={copy}>
          링크 복사
        </Button>
      </div>
      {manual ? <ManualLink link={link} /> : null}
    </div>
  );
}

function browserSafariDeps() {
  return {
    navigate: (url: string) => {
      window.location.href = url;
    },
    open: (url: string) => window.open(url, '_blank', 'noopener'),
    isHidden: () => document.visibilityState === 'hidden',
    later: (fn: () => void, ms: number) => {
      window.setTimeout(fn, ms);
    },
  };
}

/**
 * 아이폰 홈 화면 앱에서 바로 열리지 않을 때: Safari 에서 초대 링크를 한 번 열어 파일을 고르면
 * (drive.file 권한이 계정에 생겨요) 그다음부터 이 앱에서도 열려요
 */
export function SafariNotice({ link, standalone = true }: { link: string; standalone?: boolean }) {
  const toast = useToast();
  const [manual, setManual] = useState(false);

  async function open() {
    // 링크 복사를 먼저 (Safari 로 넘어가지 않아도 붙여넣을 수 있게)
    const copied = await copyText(link);
    if (copied) toast.success('링크를 복사했어요. Safari에 붙여넣어 주세요');
    setManual(!copied);
    openInSafari(link, browserSafariDeps(), { standalone });
  }

  return (
    <div className="sp-env" data-testid="safari-notice">
      <Banner tone="warning" title={SAFARI_ONCE.title}>
        {SAFARI_ONCE.body}
      </Banner>
      <Button size="lg" block icon="external" onClick={open}>
        Safari로 열기
      </Button>
      {manual ? <ManualLink link={link} /> : null}
    </div>
  );
}

type PasteState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string } | { kind: 'denied'; link: string };

/** 아이폰 홈 화면 앱: 구글 파일 선택 창 대신 초대 링크를 붙여 넣어 바로 열어요 */
export function PasteInvite({ className }: { className?: string }) {
  const session = useSession();
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState('');
  const [state, setState] = useState<PasteState>({ kind: 'idle' });
  const formId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const id = parseInviteInput(value);
    if (!id) {
      setState({ kind: 'error', message: '초대 링크나 구글 시트 주소를 확인해 주세요' });
      return;
    }
    setState({ kind: 'busy' });
    try {
      const result = await session.openLedgerDirect(id);
      if (result.kind === 'opened') {
        toast.success('공유받은 가계부를 열었어요');
        router.push('/');
        return;
      }
      setState({ kind: 'denied', link: buildInviteLink(window.location.origin, id) });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error && err.message ? err.message : '가계부를 열지 못했어요. 잠시 뒤 다시 시도해 주세요' });
    }
  }

  return (
    <div className={cx('sp-env', className)}>
      <form className="sp-paste" onSubmit={submit} aria-labelledby={`${formId}-t`} noValidate>
        <span id={`${formId}-t`} className="sr-only">
          공유받은 가계부 열기
        </span>
        <Field
          label="초대 링크 붙여넣기"
          hint="받은 초대 링크나 구글 시트 주소를 붙여 넣어 주세요."
          error={state.kind === 'error' ? state.message : undefined}
        >
          <TextInput
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (state.kind === 'error' || state.kind === 'denied') setState({ kind: 'idle' });
            }}
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="https://…/start?open=…"
          />
        </Field>
        <Button type="submit" size="lg" block loading={state.kind === 'busy'} disabled={!value.trim()}>
          열기
        </Button>
      </form>
      {state.kind === 'denied' ? <SafariNotice link={state.link} /> : null}
    </div>
  );
}
