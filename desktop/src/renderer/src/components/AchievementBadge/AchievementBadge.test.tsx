import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Award } from '../../icons';
import { expectNoA11yViolations } from '../../test/axe';
import { AchievementBadge } from './AchievementBadge';
import { badgeIcon } from './badgeMotifs';

const earned = {
  id: 'b1',
  name: 'Phish Spotter',
  motif: 'phishing',
  moduleTitle: 'Phishing',
  earned: true,
  earnedAt: '2026-10-12',
};

describe('AchievementBadge', () => {
  it('states earned / not earned in text', () => {
    const { rerender } = render(<AchievementBadge badge={earned} />);
    expect(screen.getByText(/Earned 12 Oct 2026/)).toBeDefined();
    rerender(<AchievementBadge badge={{ ...earned, earned: false, earnedAt: undefined }} />);
    expect(screen.getByText('Not earned yet')).toBeDefined();
  });

  it('is a button when it can be opened', () => {
    const onOpen = vi.fn();
    render(<AchievementBadge badge={earned} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Phish Spotter/ }));
    expect(onOpen).toHaveBeenCalledWith('b1');
  });

  it('falls back to a generic icon for unknown motifs', () => {
    expect(badgeIcon('nope')).toBe(Award);
  });

  it('has no axe violations', async () => {
    const { container } = render(<AchievementBadge badge={earned} onOpen={() => undefined} />);
    await expectNoA11yViolations(container);
  });
});
