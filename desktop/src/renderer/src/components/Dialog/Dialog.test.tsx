import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { Dialog } from './Dialog';

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(<Dialog open={false} title="T" onClose={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a labelled modal dialog that closes on Escape', () => {
    const onClose = vi.fn();
    render(<Dialog open title="Badge" description="Earned today" onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Badge' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Earned today').id).toBe(dialog.getAttribute('aria-describedby'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('moves focus inside', () => {
    render(<Dialog open title="Badge" onClose={() => undefined} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('has no axe violations', async () => {
    const { baseElement } = render(
      <Dialog
        open
        title="Badge"
        description="d"
        onClose={() => undefined}
        footer={<button type="button">OK</button>}
      />,
    );
    await expectNoA11yViolations(baseElement);
  });
});
