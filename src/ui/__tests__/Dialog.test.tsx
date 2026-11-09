// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from '../Button';
import { Dialog } from '../Dialog';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="일정 지우기"
        description="지운 일정은 되돌릴 수 없어요"
        actions={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button variant="danger">지우기</Button>
          </>
        }
      >
        <input aria-label="메모" />
      </Dialog>
    </>
  );
}

afterEach(cleanup);

describe('Dialog', () => {
  it('열리면 제목으로 이름이 붙고 첫 입력에 포커스가 가요', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('열기'));
    const dialog = screen.getByRole('dialog', { name: '일정 지우기' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText('메모'));
    expect(document.body.hasAttribute('data-scroll-lock')).toBe(true);
  });

  it('Tab 은 창 안에서만 돌아요', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('열기'));
    const del = screen.getByRole('button', { name: '지우기' });
    const close = screen.getByRole('button', { name: '닫기' });
    del.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(del);
  });

  it('Esc 로 닫히고 연 버튼으로 포커스가 돌아가요', () => {
    render(<Harness />);
    const opener = screen.getByText('열기');
    opener.focus();
    fireEvent.click(opener);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.hasAttribute('data-scroll-lock')).toBe(false);
  });
});
