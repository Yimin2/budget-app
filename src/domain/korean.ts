/** 한국어 조사 고르기 (이름 뒤에 붙는 은/는 · 이/가) */

/** 받침이 있으면 true (한글이 아니면 false) */
export function hasBatchim(word: string): boolean {
  const ch = word.trim().slice(-1);
  const code = ch ? ch.charCodeAt(0) - 0xac00 : -1;
  if (code < 0 || code > 11171) return false;
  return code % 28 !== 0;
}

/** '기쁜' → '기쁜이', '민구' → '민구가' */
export function withSubject(name: string): string {
  return `${name}${hasBatchim(name) ? '이' : '가'}`;
}

/** '식비' → '식비는', '쇼핑' → '쇼핑은' */
export function withTopic(name: string): string {
  return `${name}${hasBatchim(name) ? '은' : '는'}`;
}
