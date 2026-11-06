import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { Stepper } from './Stepper';

describe('Stepper', () => {
  const steps = [
    { id: '1', label: 'Sign in', status: 'complete' as const },
    { id: '2', label: 'Security check', status: 'current' as const },
    { id: '3', label: 'Access granted', status: 'upcoming' as const },
  ];

  it('marks the current step and states status in text', () => {
    render(<Stepper label="Access" steps={steps} />);
    const items = screen.getAllByRole('listitem');
    expect(items[1]?.getAttribute('aria-current')).toBe('step');
    expect(items[0]?.textContent).toContain('completed');
  });

  it('has no axe violations', async () => {
    const { container } = render(<Stepper label="Access" steps={steps} />);
    await expectNoA11yViolations(container);
  });
});
