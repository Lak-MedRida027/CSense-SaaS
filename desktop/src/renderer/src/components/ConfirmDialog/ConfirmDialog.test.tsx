import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('is an alertdialog that focuses the safe option', () => {
    render(
      <ConfirmDialog
        open
        title="Leave the quiz?"
        description="This counts as an attempt."
        confirmLabel="Leave quiz"
        cancelLabel="Keep going"
        tone="danger"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole('alertdialog', { name: 'Leave the quiz?' })).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep going' }));
  });

  it('wires confirm, cancel and Escape', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="T"
        description="D"
        confirmLabel="Yes"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
