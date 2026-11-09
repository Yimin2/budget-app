'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isGoogleError } from '@/google';
import { useSession } from '@/state';
import type { LedgerRef } from '@/storage/types';
import { Badge, Button, Card, EmptyState, Icon, useToast } from '@/ui';
import { LEDGER_KIND_TEXT, LedgerKindBadge } from '@/app/(app)/_components/LedgerKindBadge';

/** 로그인했지만 가계부를 고르지 않았을 때: 최근 가계부 · 새로 만들기 · 공유받은 가계부 열기 */
export function LedgerPicker() {
  const session = useSession();
  const router = useRouter();
  const toast = useToast();
  const [opening, setOpening] = useState(false);
  const user = session.user;
  const canOpenShared = session.mode === 'google';

  function open(ref: LedgerRef) {
    session.selectLedger(ref);
    router.push('/');
  }

  async function openShared() {
    setOpening(true);
    try {
      const ref = await session.openSharedLedger();
      if (ref) {
        router.push('/');
        return;
      }
    } catch (e) {
      if (!(isGoogleError(e) && e.code === 'popup_closed')) {
        toast.error(e instanceof Error && e.message ? e.message : '가계부를 열지 못했어요');
      }
    }
    setOpening(false);
  }

  return (
    <>
      <div className="sp-title">
        <h1>어떤 가계부를 열까요?</h1>
        <span className="sub">
          {session.mode === 'demo' ? '체험 모드예요. 이 브라우저에만 저장돼요.' : `${user?.name || user?.email}님으로 로그인했어요.`}
        </span>
      </div>

      <Card title="최근 가계부" padding="sm">
        {session.recentLedgers.length === 0 ? (
          <EmptyState
            icon="wallet"
            headingLevel={3}
            title="아직 연 가계부가 없어요"
            description="새로 만들거나, 함께 쓰는 사람이 공유해 준 가계부를 열어 주세요."
          />
        ) : (
          <ul className="sp-ledgers">
            {session.recentLedgers.map((ref) => {
              const isActive = ref.id === session.activeLedger?.id;
              return (
                <li key={ref.id} className="sp-ledger">
                  <button
                    type="button"
                    className="open"
                    onClick={() => open(ref)}
                    aria-label={`${ref.name || '이름 없는 가계부'}, ${LEDGER_KIND_TEXT[ref.kind]} 가계부, ${
                      ref.source === 'sheets' ? '구글 시트' : '이 브라우저'
                    }${isActive ? ', 지금 가계부' : ''}`}
                  >
                    <span className="lead" aria-hidden>
                      <Icon name={ref.kind === 'shared' ? 'users' : 'user'} size={20} />
                    </span>
                    <span className="main">
                      <span className="t">
                        <span className="nm">{ref.name || '이름 없는 가계부'}</span>
                        <LedgerKindBadge kind={ref.kind} />
                      </span>
                      <span className="s">
                        {ref.source === 'sheets' ? '구글 시트' : '이 브라우저'}
                        {/* 좁은 화면에서 이름이 잘리지 않도록 '지금 가계부'는 아랫줄에 둬요 */}
                        {isActive ? (
                          <Badge tone="success" size="sm">
                            지금 가계부
                          </Badge>
                        ) : null}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={20} className="muted" />
                  </button>
                  <Button
                    variant="ghost"
                    plain
                    iconOnly
                    icon="x"
                    aria-label={`${ref.name || '가계부'} 목록에서 빼기`}
                    title="목록에서 빼기"
                    onClick={() => session.forgetLedger(ref.id)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="stack gap-3">
        <div className="sp-actions">
          <Button size="lg" icon="plus" href="/start/new">
            새 가계부 만들기
          </Button>
          <Button
            size="lg"
            variant="outline"
            icon="link"
            onClick={openShared}
            loading={opening}
            disabled={!canOpenShared}
            aria-describedby={canOpenShared ? undefined : 'sp-shared-off'}
          >
            공유받은 가계부 열기
          </Button>
        </div>
        {canOpenShared ? (
          <p className="sp-note">
            <Icon name="info" size={16} />
            <span>공유받은 가계부는 구글 파일 선택 창에서 그 시트를 고르면 열려요.</span>
          </p>
        ) : (
          <p id="sp-shared-off" className="sp-note">
            <Icon name="info" size={16} />
            <span>공유받은 가계부는 구글로 시작하면 열 수 있어요.</span>
          </p>
        )}
      </div>

      <div className="row between wrap">
        {session.activeLedger ? (
          <Button variant="ghost" icon="arrow-left" href="/">
            지금 가계부로 돌아가기
          </Button>
        ) : (
          <span />
        )}
        <Button variant="ghost" plain icon="logout" onClick={() => session.signOut()}>
          로그아웃
        </Button>
      </div>
    </>
  );
}
