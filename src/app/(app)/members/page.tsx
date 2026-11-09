'use client';

import { useState } from 'react';
import { useSession } from '@/state';
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

      <section className="stack gap-3" aria-labelledby="mb-how">
        <h3 id="mb-how" className="section-title">
          초대하면 이렇게 돼요
        </h3>
        <ol className="mb-steps">
          <li>이 가계부의 구글 시트가 그 이메일로 공유돼요. 편집할 수 있는 권한이에요.</li>
          <li>상대가 구글로 로그인한 뒤 &lsquo;공유받은 가계부 열기&rsquo;에서 이 시트를 고르면 함께 쓸 수 있어요.</li>
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
