'use client';

import { useState, useSyncExternalStore } from 'react';
import { buildInviteLink, useSession } from '@/state';
import { Avatar, Badge, Banner, Button, Card, EmptyState, Field, ListRow, PageHeader, TextInput, useToast } from '@/ui';
import { isEmail } from '@/app/start/new/wizard';
import { PageSkeleton } from '../_components/PageSkeleton';
import { RequireLedger, type ReadyLedger } from '../_components/RequireLedger';
import { spreadsheetUrl } from '../settings/helpers';

/** 멤버: 목록 · 이메일로 초대 (구글 시트 공유) */
export default function MembersPage() {
  return (
    <>
      <PageHeader title="멤버" subtitle="기록마다 누가 썼는지 이름으로 보여요" />
      <RequireLedger skeleton={<PageSkeleton withHeader={false} cards={1} label="멤버를 불러오는 중이에요" />}>
        {(ledger) => <Members ledger={ledger} />}
      </RequireLedger>
    </>
  );
}

function Members({ ledger }: { ledger: ReadyLedger }) {
  const session = useSession();
  const me = session.user?.email.toLowerCase() ?? '';
  const members = [...ledger.data.members].sort((a, b) => {
    // 나를 맨 위에
    const am = a.email.toLowerCase() === me ? 0 : 1;
    const bm = b.email.toLowerCase() === me ? 0 : 1;
    return am - bm || a.displayName.localeCompare(b.displayName, 'ko');
  });
  const isShared = ledger.data.settings.kind === 'shared';

  return (
    <div className="st-grid">
      <Card title="함께 쓰는 사람" aside={<span className="muted">{members.length}명</span>}>
        {members.length === 0 ? (
          <EmptyState icon="users" headingLevel={3} title="멤버가 없어요" description="이메일로 함께 쓸 사람을 초대해 주세요." />
        ) : (
          <ul className="list">
            {members.map((m, i) => {
              const mine = m.email.toLowerCase() === me;
              return (
                <li key={m.email}>
                  <ListRow
                    leading={
                      <Avatar
                        name={m.displayName || m.email}
                        src={mine ? (session.user?.picture ?? null) : null}
                        alt={i % 2 === 1}
                      />
                    }
                    title={m.displayName || m.email}
                    subtitle={m.email}
                    trailing={
                      mine ? (
                        <Badge size="sm" tone="brand" dot={false}>
                          나
                        </Badge>
                      ) : undefined
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
        {ledger.ref.source === 'sheets' ? (
          <p className="st-desc">멤버를 빼려면 구글 시트의 공유 설정에서 그 사람의 권한을 지워 주세요.</p>
        ) : null}
      </Card>

      {isShared ? <InviteCard ledger={ledger} /> : <PersonalNote />}
    </div>
  );
}

function InviteCard({ ledger }: { ledger: ReadyLedger }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  /** 방금 초대한 사람 (링크를 보내 달라고 알려 줘요) */
  const [invited, setInvited] = useState<string | null>(null);
  const isLocal = ledger.ref.source === 'local';

  async function invite() {
    const clean = email.trim();
    if (!isEmail(clean)) {
      setError('이메일 주소를 확인해 주세요');
      return;
    }
    if (ledger.data.members.some((m) => m.email.toLowerCase() === clean.toLowerCase())) {
      setError('이미 멤버예요');
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await ledger.inviteMember(clean, name);
      toast.success(isLocal ? '멤버로 기록했어요' : `${name.trim() || clean}님에게 시트를 공유했어요`);
      setInvited(name.trim() || clean);
      setEmail('');
      setName('');
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : '초대하지 못했어요. 잠시 뒤 다시 시도해 주세요');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="멤버 초대">
      {isLocal ? (
        <Banner tone="info" title="체험 모드에서는 이름만 기록돼요">
          이 브라우저의 멤버 목록에만 더해지고, 실제로 공유되지는 않아요.
        </Banner>
      ) : null}
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void invite();
        }}
      >
        <Field label="이메일" error={error} required hint="구글 계정 이메일을 적어 주세요.">
          <TextInput
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(undefined);
            }}
            placeholder="name@gmail.com"
          />
        </Field>
        <Field label="표시 이름" optional hint="기록에 보일 이름이에요. 비우면 이메일 앞부분을 써요.">
          <TextInput value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div>
          <Button type="submit" icon="user-plus" loading={busy}>
            초대하기
          </Button>
        </div>
      </form>

      <InviteLink ledger={ledger} invited={invited} />

      <section className="stack gap-3" aria-labelledby="mb-how">
        <h3 id="mb-how" className="section-title">
          초대하면 이렇게 돼요
        </h3>
        <ol className="mb-steps">
          <li>이 가계부의 구글 시트가 그 이메일로 공유돼요. 편집할 수 있는 권한이에요.</li>
          <li>초대 링크를 보내 주세요. 상대가 링크를 열고 구글로 로그인한 뒤 [선택]만 누르면 함께 쓸 수 있어요.</li>
          <li>링크 없이도 상대가 &lsquo;공유받은 가계부 열기&rsquo;에서 이 시트를 고르면 돼요.</li>
          <li>기록마다 누가 썼는지 이름이 보여요. 정산(더치페이)은 하지 않아요.</li>
        </ol>
      </section>
      {!isLocal ? (
        <div className="st-foot">
          <Button variant="ghost" icon="external" href={spreadsheetUrl(ledger.ref.id)} external>
            구글 시트 공유 설정 보기
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

const noSubscribe = () => () => {};
const readOrigin = () => window.location.origin;
const serverOrigin = () => '';

/** 클립보드에 복사. 못 하면 false (링크 칸에서 직접 복사하게 안내) */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 아래 방법으로
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    el.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 초대 링크: /start?open=<시트 id>. 받은 사람이 열면 구글 선택 창이 이 시트를 골라 둔 채로 떠요 */
function InviteLink({ ledger, invited }: { ledger: ReadyLedger; invited: string | null }) {
  const toast = useToast();
  const origin = useSyncExternalStore(noSubscribe, readOrigin, serverOrigin);
  const isLocal = ledger.ref.source === 'local';
  const link = isLocal ? '' : buildInviteLink(origin, ledger.ref.id);

  async function copy() {
    if (isLocal) {
      toast.show('초대 링크는 구글 시트 가계부에서만 쓸 수 있어요. 구글로 로그인해 가계부를 만들어 주세요.', { tone: 'info' });
      return;
    }
    if (await copyText(link)) toast.success('초대 링크를 복사했어요');
    else toast.error('복사하지 못했어요. 링크 칸을 길게 눌러 복사해 주세요');
  }

  return (
    <section className="stack gap-3" aria-labelledby="mb-link">
      <h3 id="mb-link" className="section-title">
        초대 링크
      </h3>
      {invited && !isLocal ? (
        <Banner tone="success" title={`${invited}님에게 이 링크를 보내 주세요`}>
          링크를 열고 구글로 로그인하면 이 가계부가 바로 열려요.
        </Banner>
      ) : null}
      {isLocal ? (
        <p id="mb-link-off" className="st-desc">
          체험 모드는 이 브라우저에만 저장돼서 링크로 공유할 수 없어요. 구글 가계부에서 쓸 수 있어요.
        </p>
      ) : (
        <Field label="초대 링크" hideLabel hint="초대한 구글 계정으로 열어야 해요.">
          <TextInput readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        </Field>
      )}
      <div>
        <Button
          variant="outline"
          icon="copy"
          onClick={() => void copy()}
          aria-describedby={isLocal ? 'mb-link-off' : undefined}
        >
          링크 복사
        </Button>
      </div>
    </section>
  );
}

function PersonalNote() {
  return (
    <Card title="개인 가계부예요">
      <p className="st-desc">개인 가계부는 혼자 쓰는 가계부라 초대하지 않아요. 함께 쓰려면 공용 가계부를 만들어 주세요.</p>
      <div className="st-foot">
        <Button variant="outline" icon="plus" href="/start/new">
          공용 가계부 만들기
        </Button>
      </div>
    </Card>
  );
}
