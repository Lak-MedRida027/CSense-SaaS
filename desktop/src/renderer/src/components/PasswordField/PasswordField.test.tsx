import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { PasswordField } from './PasswordField';

describe('PasswordField', () => {
  it('toggles visibility with an aria-pressed button', () => {
    render(<PasswordField label="Password" />);
    const input = screen.getByLabelText('Password');
    expect(input.getAttribute('type')).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('current-password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(input.getAttribute('type')).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('warns when Caps Lock is on', () => {
    render(<PasswordField label="Password" />);
    const input = screen.getByLabelText('Password');
    fireEvent.keyDown(input, { key: 'A', modifierCapsLock: true });
    expect(screen.getByText('Caps Lock is on')).toBeDefined();
  });

  it('has no axe violations', async () => {
    const { container } = render(<PasswordField label="Password" />);
    await expectNoA11yViolations(container);
  });
});
