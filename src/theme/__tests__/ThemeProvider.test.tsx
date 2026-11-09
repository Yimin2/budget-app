// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '../ThemeProvider';
import { ThemeToggle } from '../ThemeToggle';
import { THEME_STORAGE_KEY } from '../script';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(cleanup);

describe('ThemeProvider + ThemeToggle', () => {
  it('다크를 고르면 html 에 data-theme 를 달고 저장해요', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle showLabels />
      </ThemeProvider>,
    );
    expect(screen.getByRole('radio', { name: '시스템' }).getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: '다크' }));
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: '시스템' }));
    });
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('저장된 값을 읽어 와요', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    document.documentElement.setAttribute('data-theme', 'light');
    await act(async () => {
      render(
        <ThemeProvider>
          <ThemeToggle />
        </ThemeProvider>,
      );
    });
    expect(screen.getByRole('radio', { name: '라이트' }).getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
