import { formatMonthKo, formatWon, type RemainderView } from '@/domain';
import { Banner, Button, Card, EmptyState, Icon, Money, cx } from '@/ui';
import type { FlowSummary } from './selectors';
import styles from './accounts.module.css';

const SWATCHES = [styles.c1, styles.c2, styles.c3, styles.c4, styles.c5, styles.c6];

function pct(part: number, whole: number): string {
  if (!(whole > 0)) return '0%';
  const p = (part / whole) * 100;
  return `${p > 0 && p < 1 ? '<1' : Math.round(p)}%`;
}

/** 월급 → 수입통장 → 각 통장. 매달 배분을 가로 막대 + 목록으로, 배분이 수입보다 많으면 경고 */
export function FlowCard({ flow, thisYear, remainders = [] }: { flow: FlowSummary; thisYear: number; remainders?: RemainderView[] }) {
  const settingsLink = (
    <Button href="/budget#st-rules" variant="ghost" iconRight="chevron-right" className={styles.cardLink}>
      바꾸기
    </Button>
  );

  if (flow.items.length === 0) {
    return (
      <Card title="매달 배분" aside={settingsLink}>
        <EmptyState
          icon="arrow-left-right"
          headingLevel={3}
          title="매달 배분이 없어요"
          description="월급이 들어오면 각 통장으로 얼마씩 보낼지 예산에서 정해 주세요."
        />
      </Card>
    );
  }

  const whole = flow.income?.amount || flow.total;
  const multi = flow.incomeAccounts.length > 1;
  const incomeName = multi ? `수입통장 ${flow.incomeAccounts.length}개` : (flow.incomeAccount?.name ?? '수입통장');
  const aria = [
    ...flow.items.map((it) => `${it.name} ${formatWon(it.amount)}`),
    flow.left > 0 ? `남는 돈 ${formatWon(flow.left)}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card title="매달 배분" aside={settingsLink} className={styles.flowCard}>
      <ol className={styles.path} aria-label="돈이 흐르는 길">
        <li>
          <span className={styles.pathNode}>
            <Icon name="coins" size={16} />
            월급
          </span>
        </li>
        <li>
          <Icon name="arrow-right" size={16} className={styles.pathArrow} />
          <span className={styles.pathNode}>{incomeName}</span>
        </li>
        <li>
          <Icon name="arrow-right" size={16} className={styles.pathArrow} />
          <span className={styles.pathNode}>통장 {flow.items.length}개</span>
        </li>
      </ol>

      <div className={cx(styles.stackWrap, flow.incomeMark !== null && styles.withMark)}>
        <div className={styles.stack} role="img" aria-label={`매달 배분: ${aria}`}>
          {flow.items.map((it, i) => (
            <span key={it.accountId} className={SWATCHES[i % SWATCHES.length]} style={{ width: `${it.share * 100}%` }} />
          ))}
          {flow.left > 0 ? <span className={styles.leftSeg} style={{ width: `${flow.leftShare * 100}%` }} /> : null}
        </div>
        {flow.incomeMark !== null ? (
          <span className={styles.mark} style={{ left: `${flow.incomeMark * 100}%` }} aria-hidden>
            <span>수입</span>
          </span>
        ) : null}
      </div>

      <ul className={styles.legend}>
        {flow.items.map((it, i) => (
          <li key={it.accountId}>
            <span className={cx(styles.dot, SWATCHES[i % SWATCHES.length])} aria-hidden />
            <span className={styles.legendName}>{it.name}</span>
            <span className={styles.legendPct}>{pct(it.amount, whole)}</span>
            <Money amount={it.amount} className={styles.legendAmt} />
          </li>
        ))}
        {flow.left > 0 ? (
          <li>
            <span className={cx(styles.dot, styles.leftDot)} aria-hidden />
            <span className={styles.legendName}>{incomeName}에 남아요</span>
            <span className={styles.legendPct}>{pct(flow.left, whole)}</span>
            <Money amount={flow.left} className={styles.legendAmt} />
          </li>
        ) : null}
      </ul>

      {remainders.length > 0 ? (
        <ul className={styles.sources} aria-label="남는 돈 전부 예상">
          {remainders.map((v) => (
            <li key={v.rule.id}>
              <span className={styles.legendName} style={v.empty ? { color: 'var(--danger-text)', fontWeight: 500 } : undefined}>
                {v.text}
              </span>
              {v.monthlyText ? <span className={styles.sourceNums}>{v.monthlyText}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <dl className={styles.flowTotals}>
        <div>
          <dt>배분 합계</dt>
          <dd>{formatWon(flow.total)}</dd>
        </div>
        <div>
          <dt>{flow.income ? `${formatMonthKo(flow.income.month, thisYear)} 수입` : '수입'}</dt>
          <dd>{flow.income ? formatWon(flow.income.amount) : '기록 없음'}</dd>
        </div>
      </dl>

      {multi && flow.sources.length > 0 ? (
        <ul className={styles.sources} aria-label="사람별 수입통장">
          {flow.sources.map((x) => (
            <li key={x.account.id}>
              <span className={styles.legendName}>{x.account.name}</span>
              <span className={styles.sourceNums}>
                배분 {formatWon(x.total)} · 수입 {x.income ? formatWon(x.income.amount) : '기록 없음'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {multi
        ? flow.sources
            .filter((x) => x.over > 0)
            .map((x) => (
              <Banner
                key={x.account.id}
                tone="warning"
                title={`${x.account.name}에서 보내는 돈이 수입보다 ${formatWon(x.over)} 많아요`}
                action={{ label: '배분 바꾸기', href: '/budget#st-rules' }}
              >
                {x.account.name} 잔액이 모자랄 수 있어요.
              </Banner>
            ))
        : null}

      {!multi && flow.over > 0 ? (
        <Banner tone="warning" title={`배분 합계가 수입보다 ${formatWon(flow.over)} 많아요`} action={{ label: '배분 바꾸기', href: '/budget#st-rules' }}>
          수입통장 잔액이 모자랄 수 있어요.
        </Banner>
      ) : null}
      {!flow.income ? (
        <p className={styles.note}>이번 달과 지난달 수입 기록이 없어서 수입과 비교하지 못했어요.</p>
      ) : null}
    </Card>
  );
}
