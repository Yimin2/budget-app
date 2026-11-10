'use client';

import { Button } from '@/ui';
import styles from './claims.module.css';

/**
 * 같은 화면에서 목록을 펼치고 접는 버튼 (창 · 이동 없음). aria-expanded · aria-controls 로 펼친 칸을 가리켜요.
 * 높이 44px (UI 키트 버튼)
 */
export function ExpandButton({
  open,
  onToggle,
  controls,
  openLabel = '모두 보기',
  closeLabel = '접기',
  label,
  disabled,
}: {
  open: boolean;
  onToggle: () => void;
  controls: string;
  openLabel?: string;
  closeLabel?: string;
  /** 화면 읽기 프로그램용 이름 (예: '지급한 기록 모두 보기') */
  label?: string;
  disabled?: boolean;
}) {
  const text = open ? closeLabel : openLabel;
  return (
    <Button
      variant="ghost"
      className={styles.expandBtn}
      aria-expanded={open}
      aria-controls={controls}
      iconRight={open ? 'chevron-up' : 'chevron-down'}
      onClick={onToggle}
      disabled={disabled}
      {...(label ? { 'aria-label': `${label} ${text}` } : {})}
    >
      {text}
    </Button>
  );
}
