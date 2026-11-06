import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { RadioGroup } from './RadioGroup';

const options = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'off', label: 'Unavailable', disabled: true },
];

describe('RadioGroup', () => {
  it('renders a named group of native radios', () => {
    const onChange = vi.fn();
    render(<RadioGroup legend="Theme" options={options} value="dark" onChange={onChange} />);
    expect(screen.getByRole('group', { name: 'Theme' })).toBeDefined();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Dark' }).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(onChange).toHaveBeenCalledWith('light');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Unavailable' }).disabled).toBe(
      true,
    );
  });

  it('has no axe violations with an error', async () => {
    const { container } = render(
      <RadioGroup
        legend="Theme"
        options={options}
        value={null}
        onChange={() => undefined}
        error="Pick one"
      />,
    );
    await expectNoA11yViolations(container);
  });
});
