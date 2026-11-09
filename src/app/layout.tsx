import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './globals.css';
import { AppProviders } from '@/state/Providers';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { THEME_COLORS, themeInitScript } from '@/theme/script';
import { ToastProvider } from '@/ui/Toast';

export const metadata: Metadata = {
  title: { default: '가계부', template: '%s · 가계부' },
  description: '사기 전에 써도 되는지 알려 주는 통장 쪼개기 가계부',
  applicationName: '가계부',
  appleWebApp: { capable: true, title: '가계부', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 그리기 전에 테마를 정해서 다크 모드 깜빡임을 막아요 */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>
          <ToastProvider>
            <AppProviders>{children}</AppProviders>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
