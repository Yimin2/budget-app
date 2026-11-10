/** 한국어 조사 고르기 (이름 뒤에 붙는 은/는 · 이/가) */

/** 받침이 있으면 true (한글이 아니면 false) */
export function hasBatchim(word: string): boolean {
  const ch = word.trim().slice(-1);
  const code = ch ? ch.charCodeAt(0) - 0xac00 : -1;
  if (code < 0 || code > 11171) return false;
  return code % 28 !== 0;
}

/** '가람' → '가람이', '나래' → '나래가' */
export function withSubject(name: string): string {
  return `${name}${hasBatchim(name) ? '이' : '가'}`;
}

/** '식비' → '식비는', '쇼핑' → '쇼핑은' */
export function withTopic(name: string): string {
  return `${name}${hasBatchim(name) ? '은' : '는'}`;
}

/** '식비' → '로', '쇼핑' → '으로', '술' → '로' (ㄹ 받침은 '로') */
export function directionParticle(name: string): string {
  const ch = name.trim().slice(-1);
  const code = ch ? ch.charCodeAt(0) - 0xac00 : -1;
  if (code < 0 || code > 11171) return '로';
  const jong = code % 28;
  return jong === 0 || jong === 8 ? '로' : '으로';
}

/** '카페' → '를', '쇼핑' → '을' */
export function objectParticle(word: string): string {
  return hasBatchim(word) ? '을' : '를';
}
