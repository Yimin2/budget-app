'use client';

import { useSession } from '@/state';
import { ThemeToggle } from '@/theme';
import { Avatar, Button } from '@/ui';
import './screens.css';

/** 데스크톱 사이드바 아래: 테마 · 사용자 · 로그아웃 */
export function SidebarFooter() {
  const session = useSession();
  const user = session.user;
  return (
    <>
      <ThemeToggle />
      {user ? (
        <div className="sx-user">
          <Avatar name={user.name || user.email} src={user.picture} size="md" />
          <span className="txt">
            <strong>{user.name || user.email}</strong>
            <span>{session.mode === 'demo' ? '체험 모드' : user.email}</span>
          </span>
        </div>
      ) : null}
      <Button variant="ghost" plain icon="logout" block onClick={() => session.signOut()}>
        로그아웃
      </Button>
    </>
  );
}
