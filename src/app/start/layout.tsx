import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: '시작하기' };

export default function StartLayout({ children }: { children: ReactNode }) {
  return children;
}
