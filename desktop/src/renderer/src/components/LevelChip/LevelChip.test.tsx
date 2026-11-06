import { LEVELS } from '@csense/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LevelChip } from './LevelChip';

describe('LevelChip', () => {
  it.each(LEVELS.map((l, i) => [l, i + 1] as const))(
    '%s shows numeral L%i and name',
    (level, tier) => {
      const { container } = render(<LevelChip level={level} />);
      expect(container.textContent).toContain(`L${tier}`);
      expect(container.textContent).toContain(level);
      expect(container.firstElementChild?.getAttribute('data-level')).toBe(level);
    },
  );

  it('compact keeps the name for screen readers', () => {
    render(<LevelChip level="Guardian" compact />);
    expect(screen.getByText('Guardian').className).toBe('sr-only');
  });

  it('Defender crest carries a star (shape cue beyond colour)', () => {
    const { container } = render(<LevelChip level="Defender" />);
    expect(container.querySelector('.lucide-star')).not.toBeNull();
  });
});
