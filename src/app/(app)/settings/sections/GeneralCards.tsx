'use client';

import { useState } from 'react';
import { autoSettleDay, createDemoLedger, formatDateKo, localDateOf, monthOf, toISODate } from '@/domain';
import { DEMO_LEDGER_ID, useSession } from '@/state';
import { LocalBackend } from '@/storage/local';
import { ThemeToggle } from '@/theme';
import { Avatar, Button, Card, ConfirmDialog, Field, Select, TextInput, focusFirstInvalid } from '@/ui';
import { LedgerKindBadge } from '../../_components/LedgerKindBadge';
import { LedgerSwitcher } from '../../_components/LedgerSwitcher';
import type { ReadyLedger } from '../../_components/RequireLedger';
import { spreadsheetUrl } from '../helpers';
import { useRunner } from '../useRunner';

/** 가계부 이름 (공용/개인 표시, 개인이면 연결된 공용 가계부) */
export function LedgerNameCard({ ledger }: { ledger: ReadyLedger }) {
  const session = useSession();
  const { busy, run } = useRunner();
  const settings = ledger.data.settings;
  const [name, setName] = useState(settings.name);
  const [error, setError] = useState<string | undefined>();
  const linked = settings.sharedLedgerId
    ? (session.recentLedgers.find((r) => r.id === settings.sharedLedgerId)?.name ?? '연결된 공용 가계부')
    : null;

  async function save() {
    if (!name.trim()) {
      setError('가계부 이름을 입력해 주세요');
      focusFirstInvalid();
      return;
    }
    setError(undefined);
    await run('rename', () => ledger.renameLedger(name), '이름을 바꿨어요');
  }

  return (
    <Card title="가계부" aside={<LedgerKindBadge kind={settings.kind} />}>
      <form
        className="st-inline"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="이름" error={error}>
          <TextInput value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button type="submit" variant="outline" loading={busy === 'rename'} disabled={name.trim() === settings.name}>
          저장
        </Button>
      </form>
      {settings.kind === 'personal' ? (
        <p className="st-desc">
          {linked
            ? `${linked}에서 나에게 배분한 용돈이 매달 수입으로 들어와요.`
            : '연결된 공용 가계부가 없어요. 용돈 수입은 내역의 통장 잔액에서 직접 기록해 주세요.'}
        </p>
      ) : (
        <>
          <p className="st-desc">함께 쓰는 사람은 아래 멤버 · 공유에서 초대할 수 있어요.</p>
          <SettleDayField ledger={ledger} />
        </>
      )}
    </Card>
  );
}

/** 청구 정산일: 개인 돈으로 낸 지출을 돌려주는 날 (기본: 다음 월급날) */
function SettleDayField({ ledger }: { ledger: ReadyLedger }) {
  const { busy, run } = useRunner();
  const current = ledger.data.settings.settleDay ?? null;
  const auto = autoSettleDay(ledger.data, monthOf(ledger.today));
  const options = [
    { value: '', label: `월급날 (매달 ${auto}일)` },
    ...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `매달 ${i + 1}일` })),
  ];
  return (
    <Field label="정산일" hint="개인 돈으로 낸 지출을 함께 쓰는 통장에서 돌려주는 날이에요. 이벤트통장 잔액이 넉넉하면 바로 돌려줘요.">
      <Select
        value={current === null ? '' : String(current)}
        disabled={busy === 'settle'}
        onChange={(v) => void run('settle', () => ledger.saveSettleDay(v ? Number(v) : null), '정산일을 바꿨어요')}
        options={options}
      />
    </Field>
  );
}

/** 계정: 사용자 · 가계부 바꾸기 · 로그아웃 */
export function AccountCard() {
  const session = useSession();
  const user = session.user;
  return (
    <Card id="st-account" title="계정 · 가계부 바꾸기">
      {user ? (
        <div className="st-user">
          <Avatar name={user.name || user.email} src={user.picture} />
          <span className="txt">
            <strong>{user.name || user.email}</strong>
            <span>{session.mode === 'demo' ? '체험 모드 · 이 브라우저에만 저장돼요' : user.email}</span>
          </span>
        </div>
      ) : null}
      <LedgerSwitcher variant="block" />
      <div className="st-foot">
        <Button variant="outline" icon="logout" onClick={() => session.signOut()}>
          로그아웃
        </Button>
        {session.mode === 'google' ? (
          <Button variant="ghost" onClick={() => session.signOut({ everywhere: true })}>
            모든 기기에서 로그아웃
          </Button>
        ) : null}
      </div>
      {session.mode === 'google' ? (
        <p className="st-desc">
          모든 기기에서 로그아웃하면 이 앱에 준 구글 권한을 거둬요. 다른 기기에서도 다시 로그인해야 하고, 가계부 시트는 그대로 남아요.
        </p>
      ) : null}
    </Card>
  );
}

/** 화면 테마 */
export function DisplayCard() {
  return (
    <Card id="st-theme" title="테마">
      <ThemeToggle showLabels />
      <p className="st-desc">시스템을 고르면 기기의 밝기 설정을 따라가요.</p>
    </Card>
  );
}

/** 정보: 데이터가 어디에 있는지 · 체험 모드 초기화 · 목록에서 빼기 */
export function InfoCard({ ledger }: { ledger: ReadyLedger }) {
  const session = useSession();
  const { busy, run } = useRunner();
  const [confirm, setConfirm] = useState<'reset' | 'remove' | null>(null);
  const ref = ledger.ref;
  const isDemo = ref.source === 'local' && ref.id === DEMO_LEDGER_ID;

  async function apply() {
    if (confirm === 'reset') {
      const ok = await run(
        'reset',
        async () => {
          const now = new Date();
          await new LocalBackend().create(createDemoLedger(toISODate(now), now.toISOString(), { claims: true, installments: true, trips: true, couple: true }), DEMO_LEDGER_ID);
          await ledger.reload();
        },
        '체험 데이터를 처음으로 되돌렸어요',
      );
      if (ok) setConfirm(null);
      return;
    }
    if (confirm === 'remove') {
      if (ref.source === 'local') new LocalBackend().remove(ref.id);
      setConfirm(null);
      session.forgetLedger(ref.id);
    }
  }

  const createdDate = localDateOf(ledger.data.settings.createdAt);
  return (
    <Card title="정보">
      <dl className="st-facts">
        <dt>저장 위치</dt>
        <dd>{ref.source === 'sheets' ? '내 구글 드라이브의 구글 시트' : '이 브라우저 (체험 모드)'}</dd>
        <dt>만든 날</dt>
        <dd>{createdDate ? formatDateKo(createdDate, false) : '-'}</dd>
      </dl>
      {ref.source === 'sheets' ? (
        <>
          <p className="st-desc">시트를 직접 고쳐도 돼요. 행을 지우는 대신 &lsquo;삭제됨&rsquo; 칸을 쓰면 함께 쓰는 사람과 꼬이지 않아요.</p>
          <div className="st-foot">
            <Button variant="outline" icon="external" href={spreadsheetUrl(ref.id)} external>
              구글 시트에서 열기
            </Button>
            <Button variant="ghost" onClick={() => setConfirm('remove')}>
              목록에서 빼기
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="st-desc">
            체험 모드 데이터는 이 브라우저에만 저장돼요. 다른 기기에서는 보이지 않고, 브라우저 데이터를 지우면 함께 사라져요.
          </p>
          <div className="st-foot">
            {isDemo ? (
              <Button variant="outline" icon="refresh" onClick={() => setConfirm('reset')}>
                체험 데이터 처음으로 되돌리기
              </Button>
            ) : (
              <Button variant="outline" icon="trash" onClick={() => setConfirm('remove')}>
                이 가계부 지우기
              </Button>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        tone="danger"
        title={
          confirm === 'reset'
            ? '체험 데이터를 처음으로 되돌릴까요?'
            : ref.source === 'sheets'
              ? '목록에서 뺄까요?'
              : '이 가계부를 지울까요?'
        }
        description={
          confirm === 'reset'
            ? '지금까지 체험하며 남긴 기록이 모두 지워지고 예시 데이터로 다시 채워져요.'
            : ref.source === 'sheets'
              ? '이 기기의 가계부 목록에서만 빠져요. 구글 드라이브의 시트는 그대로 있어서 언제든 다시 열 수 있어요.'
              : '이 브라우저에서 이 가계부의 기록이 모두 지워져요. 되돌릴 수 없어요.'
        }
        confirmLabel={confirm === 'reset' ? '되돌리기' : ref.source === 'sheets' ? '빼기' : '지우기'}
        loading={busy === 'reset'}
        onConfirm={() => void apply()}
        onCancel={() => setConfirm(null)}
      />
    </Card>
  );
}
