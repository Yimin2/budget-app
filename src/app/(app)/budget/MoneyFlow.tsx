"use client";

import type { CSSProperties } from "react";
import { formatMan, monthOf } from "@/domain";
import { Card } from "@/ui";
import type { ReadyLedger } from "../_components/RequireLedger";
import { paydayFlows, type FlowKind, type PaydayFlow } from "./flow";
import styles from "./budget.module.css";

const KIND_TEXT: Record<FlowKind, string> = {
  fixed: "매달 같은 금액",
  auto: "알아서 맞추기",
  remainder: "남는 돈 전부",
  left: "월급통장에 남아요",
};

const KIND_CLASS: Record<FlowKind, string> = {
  fixed: styles.kFixed!,
  auto: styles.kAuto!,
  remainder: styles.kRemainder!,
  left: styles.kLeft!,
};

/** 막대 길이 (그날 돈 대비 %) · 굵기 (8px ~ 28px, 금액에 비례) */
function barStyle(amount: number, scale: number): CSSProperties {
  const r = scale > 0 ? Math.max(0, Math.min(1, amount / scale)) : 0;
  return {
    "--w": `${Math.max(r * 100, amount > 0 ? 2 : 0)}%`,
    "--h": `${Math.round(8 + r * 20)}px`,
  } as CSSProperties;
}

/**
 * 예산 맨 위 '월급날 돈 흐름' (작업정리 8-3): 월급날마다 월급통장 → 받는 통장 막대, 길이 · 굵기 = 금액.
 * 그림은 보조라 화면 읽기 프로그램에는 같은 내용의 표를 읽어 줘요. 보기만 하는 그림이고, 배분 · 수입 계획은 아래 통장 카드의 들어오는 돈에서 고쳐요
 */
export function MoneyFlow({ ledger, readOnly = false }: { ledger: ReadyLedger; readOnly?: boolean }) {
  const month = monthOf(ledger.today);
  const flows = paydayFlows(ledger.data, month);
  const multiSource = new Set(flows.map((f) => f.sourceId)).size > 1;

  return (
    <div className="stack gap-4">
      {flows.length === 0 ? (
        <p className="st-desc">
          {readOnly
            ? "이 달에는 월급날 배분이 없어요."
            : "아직 월급날 배분이 없어요. 아래 통장 카드의 [+ 수입] · [+ 들어오는 돈]으로 수입 계획과 매달 배분을 정해 주세요."}
        </p>
      ) : (
        <div className={styles.flowGrid}>
          {flows.map((f) => (
            <FlowCard
              key={`${f.sourceId}-${f.day}`}
              flow={f}
              showSource={multiSource}
            />
          ))}
        </div>
      )}
      {flows.length > 0 ? (
        <ul className={styles.legend} aria-label="막대 색">
          {(["fixed", "auto", "remainder"] as const).map((k) => (
            <li key={k}>
              <span
                className={`${styles.swatch} ${KIND_CLASS[k]}`}
                aria-hidden
              />
              {KIND_TEXT[k]}
            </li>
          ))}
        </ul>
      ) : null}
      {flows.length > 0 && !readOnly ? (
        <p className={styles.summaryText}>
          금액은 아래 통장 카드의 들어오는 돈 줄을 눌러 고쳐요. 바꾸면 이 그림도 바로 바뀌어요.
        </p>
      ) : null}
    </div>
  );
}

function FlowCard({
  flow: f,
  showSource,
}: {
  flow: PaydayFlow;
  showSource: boolean;
}) {
  const title = `${f.day}일 월급날`;
  const headId = `bd-flow-${f.sourceId}-${f.day}`;
  const inText =
    f.income > 0
      ? `${f.sourceName}에 ${formatMan(f.income)} 들어와요${f.earners.length > 0 ? ` (${f.earners.join(" · ")})` : ""}`
      : `${f.sourceName}에서 보내요`;
  return (
    <Card
      as="section"
      aria-labelledby={headId}
      className={styles.flowCard}
      data-testid="payday-flow"
    >
      <div className={styles.flowHead}>
        <h3 id={headId} className={styles.flowTitle}>
          {title}
          {showSource ? <span className="muted"> · {f.sourceName}</span> : null}
        </h3>
        <p className={styles.flowSub}>{inText}</p>
        {f.carried > 0 ? (
          <p className={styles.flowSub}>
            앞 월급날에서 넘어온 돈 {formatMan(f.carried)}
          </p>
        ) : null}
      </div>

      {/* 그림 (화면 읽기 프로그램은 아래 표를 읽어요) */}
      <div className={styles.flow} aria-hidden>
        <div className={styles.source}>
          <span className={styles.sourceName}>{f.sourceName}</span>
          <span className={styles.sourceAmount}>
            {f.income > 0 ? formatMan(f.income) : formatMan(f.sent)}
          </span>
        </div>
        <ol className={styles.rows}>
          {f.bars.map((b, i) => (
            <li key={b.rule?.id ?? `left-${i}`} className={styles.row}>
              <span className={styles.rowLabel}>{b.label}</span>
              <span className={styles.track}>
                <span
                  className={`${styles.bar} ${KIND_CLASS[b.kind]}`}
                  style={barStyle(b.amount, f.scale)}
                />
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="sr-only">
        <table>
          <caption>
            {title} 돈 흐름: {inText}
          </caption>
          <thead>
            <tr>
              <th scope="col">받는 곳</th>
              <th scope="col">금액</th>
              <th scope="col">방식</th>
            </tr>
          </thead>
          <tbody>
            {f.bars.map((b, i) => (
              <tr key={b.rule?.id ?? `left-${i}`}>
                <th scope="row">{b.kind === "left" ? f.sourceName : b.name}</th>
                <td>{b.amount.toLocaleString("en-US")}원</td>
                <td>{KIND_TEXT[b.kind]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {f.short > 0 ? (
        <p className={styles.warn} role="note">
          매달 같은 금액과 알아서 맞추기가 그날 들어온 돈보다{" "}
          {formatMan(f.short)} 많아요
        </p>
      ) : null}
    </Card>
  );
}
