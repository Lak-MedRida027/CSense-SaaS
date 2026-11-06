import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { TextField } from './TextField';

describe('TextField', () => {
  it('associates label, hint and error', () => {
    render(<TextField label="Work email" hint="Company address" error="Enter a valid email" />);
    const input = screen.getByLabelText('Work email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ')).toHaveLength(2);
    expect(screen.getByText('Enter a valid email')).toBeDefined();
  });

  it('announces required in the label', () => {
    render(<TextField label="Email" required />);
    expect(screen.getByLabelText(/Email/)).toBeDefined();
    expect(screen.getByText('(required)')).toBeDefined();
  });

  it('has no axe violations in default, error and disabled states', async () => {
    const { container } = render(
      <div>
        <TextField label="A" />
        <TextField label="B" error="Bad" />
        <TextField label="C" disabled />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
