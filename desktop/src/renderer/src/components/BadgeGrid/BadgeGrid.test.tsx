import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { BadgeGrid } from './BadgeGrid';

const badges = ['A', 'B', 'C'].map((n, i) => ({
  id: `b${i}`,
  name: `Badge ${n}`,
  motif: 'shield',
  moduleTitle: `Module ${i + 1}`,
  earned: i === 0,
}));

describe('BadgeGrid', () => {
  it('is a single tab stop with arrow-key roving focus', () => {
    render(<BadgeGrid label="Badges" badges={badges} onOpenBadge={() => undefined} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    buttons[0]?.focus();
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(buttons[2]);
  });

  it('shows an empty state', () => {
    render(<BadgeGrid label="Badges" badges={[]} />);
    expect(screen.getByText('No badges yet')).toBeDefined();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <BadgeGrid label="Badges" badges={badges} onOpenBadge={() => undefined} />,
    );
    await expectNoA11yViolations(container);
  });
});
