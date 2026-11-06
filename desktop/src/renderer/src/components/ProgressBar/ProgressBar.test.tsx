import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('exposes value, range and a human value text', () => {
    render(<ProgressBar label="Modules complete" value={3} max={7} valueText="3 of 7 modules" />);
    const bar = screen.getByRole('progressbar', { name: 'Modules complete' });
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('7');
    expect(bar.getAttribute('aria-valuetext')).toBe('3 of 7 modules');
    expect(screen.getByText('3 of 7 modules')).toBeDefined();
  });

  it('clamps out-of-range values', () => {
    render(<ProgressBar label="X" value={150} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('indeterminate omits the value', () => {
    render(<ProgressBar label="Loading" value={0} indeterminate />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect(bar.getAttribute('aria-busy')).toBe('true');
  });

  it('has no axe violations', async () => {
    const { container } = render(<ProgressBar label="Done" value={40} />);
    await expectNoA11yViolations(container);
  });
});
