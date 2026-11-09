import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: '멤버' };

export default function MembersLayout({ children }: { children: ReactNode }) {
  return children;
}
