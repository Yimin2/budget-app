import type { ReactNode } from 'react';
import { cx } from './cx';

const HANGUL = /[가-힣]/;

/** 이름에서 두 글자: '김민지' → '민지', '민지' → '민지', 'Jane Doe' → 'JD', 'a@b.com' → 'A' */
export function initialsOf(name: string): string {
  const s = name.trim();
  if (!s) return '?';
  const base = s.includes('@') ? s.split('@')[0]! : s;
  if (HANGUL.test(base)) {
    const compact = base.replace(/\s+/g, '');
    return compact.length >= 3 ? compact.slice(-2) : compact.slice(0, 2);
  }
  const words = base.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return base.slice(0, 1).toUpperCase();
}

export interface AvatarProps {
  name: string;
  /** 프로필 사진 주소 */
  src?: string | null;
  /** sm 32 · md 36 · (기본) 40 · lg 56 */
  size?: 'sm' | 'md' | 'default' | 'lg';
  /** 회색 바탕 (두 번째 멤버 등) */
  alt?: boolean;
  className?: string;
}

export function Avatar({ name, src, size = 'default', alt, className }: AvatarProps) {
  return (
    <span className={cx('av', size !== 'default' && size, alt && 'alt', className)} title={name}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span aria-hidden>{initialsOf(name)}</span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}

/** 겹친 아바타 묶음. max 를 넘으면 '+N' */
export function AvatarGroup({
  people, max = 3, size = 'md', label,
}: { people: { name: string; src?: string | null }[]; max?: number; size?: AvatarProps['size']; label?: string }): ReactNode {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="avs" role="group" aria-label={label ?? `멤버 ${people.length}명`}>
      {shown.map((p, i) => (
        <Avatar key={`${p.name}-${i}`} name={p.name} src={p.src} size={size} alt={i % 2 === 1} />
      ))}
      {rest > 0 ? (
        <span className={cx('av more', size !== 'default' && size)} aria-label={`외 ${rest}명`}>
          +{rest}
        </span>
      ) : null}
    </span>
  );
}
