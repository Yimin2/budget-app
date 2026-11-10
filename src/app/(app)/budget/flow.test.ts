/* 흐름 그림 이름 (작업정리 8-3) */
import { describe, expect, it } from 'vitest';
import { createDemoLedger } from '@/domain';
import { flowLabel, flowName } from './flow';

const data = createDemoLedger('2026-11-10', '2026-11-10T00:00:00.000Z', { couple: true });

describe('flowName · flowLabel', () => {
  it("'생활비(민구)' → '민구 생활비', '이벤트통장' → '이벤트', 주인 이름이 앞에 있으면 한 번만", () => {
    expect(flowName(data, { name: '생활비(민구)', ownerName: '민구', ownerEmail: null })).toBe('민구 생활비');
    expect(flowName(data, { name: '이벤트통장', ownerName: null, ownerEmail: null })).toBe('이벤트');
    expect(flowName(data, { name: '저수지통장', ownerName: null, ownerEmail: null })).toBe('저수지');
    expect(flowName(data, { name: '기쁜 용돈', ownerName: '기쁜', ownerEmail: null })).toBe('기쁜 용돈');
    expect(flowName(data, { name: '용돈(민지)', ownerName: null, ownerEmail: 'minji@demo' })).toBe('민지 용돈');
    expect(flowName(data, null)).toBe('지운 통장');
  });

  it("막대 이름: '민구 생활비 127만 (자동)' · '이벤트 50만' · '저수지 남는 돈 37만'", () => {
    expect(flowLabel('민구 생활비', 1_270_000, 'auto')).toBe('민구 생활비 127만 (자동)');
    expect(flowLabel('이벤트', 500_000, 'fixed')).toBe('이벤트 50만');
    expect(flowLabel('저수지', 370_000, 'remainder')).toBe('저수지 남는 돈 37만');
  });
});
