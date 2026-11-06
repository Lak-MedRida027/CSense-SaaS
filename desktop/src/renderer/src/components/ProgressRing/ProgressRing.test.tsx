import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { ProgressRing } from './ProgressRing';

describe('ProgressRing', () => {
  it('is a labelled progressbar coloured by level', async () => {
    const { container } = render(
      <ProgressRing
        label="XP progress"
        value={340}
        max={1100}
        level="Practitioner"
        valueText="1,240 XP"
      >
        1,240
      </ProgressRing>,
    );
    const ring = screen.getByRole('progressbar', { name: 'XP progress' });
    expect(ring.getAttribute('aria-valuetext')).toBe('1,240 XP');
    expect(ring.getAttribute('data-level')).toBe('Practitioner');
    await expectNoA11yViolations(container);
  });

  it('loading state has no value', () => {
    render(<ProgressRing label="Loading" value={10} loading />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull();
  });
});
