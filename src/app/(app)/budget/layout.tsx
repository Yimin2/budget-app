import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: '예산' };

export default function BudgetLayout({ children }: { children: ReactNode }) {
  return children;
}
