import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOAST_MIN_DURATION_MS, ToastRegion } from './Toast';

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('auto-dismisses no sooner than the 6s minimum', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ToastRegion
        toasts={[{ id: 't1', tone: 'success', message: 'Saved', durationMs: 1000 }]}
        onDismiss={onDismiss}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(TOAST_MIN_DURATION_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });

  it('pauses while hovered and can be dismissed manually', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ToastRegion toasts={[{ id: 't1', tone: 'info', message: 'Hello' }]} onDismiss={onDismiss} />,
    );
    fireEvent.mouseEnter(screen.getByText('Hello').parentElement as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(TOAST_MIN_DURATION_MS * 2);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });

  it('lives in a polite status region', () => {
    render(<ToastRegion toasts={[]} onDismiss={() => undefined} />);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });
});
