import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { XPBar } from './XPBar';

describe('XPBar', () => {
  it('shows XP remaining to the next level from props', () => {
    render(
      <XPBar
        totalXP={1240}
        currentLevel="Practitioner"
        currentLevelFloorXP={900}
        nextLevelXP={2000}
        nextLevel="Guardian"
      />,
    );
    expect(screen.getByText('760 XP to Guardian')).toBeDefined();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('31');
  });

  it('handles the top level', () => {
    render(
      <XPBar
        totalXP={4000}
        currentLevel="Defender"
        currentLevelFloorXP={3500}
        nextLevelXP={undefined}
        nextLevel={undefined}
      />,
    );
    expect(screen.getByText('Top level reached')).toBeDefined();
  });
});
