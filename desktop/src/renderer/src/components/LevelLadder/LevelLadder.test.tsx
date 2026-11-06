import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { LevelLadder } from './LevelLadder';

describe('LevelLadder', () => {
  it('marks reached, current and locked tiers in text', async () => {
    const { container } = render(
      <LevelLadder currentLevel="Practitioner" thresholds={{ Guardian: 2000 }} />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]?.textContent).toContain('Reached');
    expect(items[2]?.getAttribute('aria-current')).toBe('step');
    expect(items[4]?.textContent).toContain('Locked');
    expect(screen.getByText('2,000 XP')).toBeDefined();
    await expectNoA11yViolations(container);
  });
});
