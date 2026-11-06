import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('is a native checkbox labelled by its text', () => {
    const onChange = vi.fn();
    render(<Checkbox label="Remember me" onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remember me' }));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('links description and error', () => {
    render(<Checkbox label="Accept" description="Read the policy" error="Required" />);
    const box = screen.getByRole('checkbox', { name: 'Accept' });
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        <Checkbox label="One" />
        <Checkbox label="Two" disabled />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
