import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FocusTrap } from './FocusTrap';

describe('FocusTrap', () => {
  it('focuses the first element and wraps Tab in both directions', () => {
    render(
      <FocusTrap>
        <button type="button">First</button>
        <button type="button">Last</button>
      </FocusTrap>,
    );
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    expect(document.activeElement).toBe(first);
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('restores focus to the previous element on unmount', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const { unmount } = render(
      <FocusTrap>
        <button type="button">Inside</button>
      </FocusTrap>,
    );
    unmount();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
