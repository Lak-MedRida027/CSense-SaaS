import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { Switch } from './Switch';

describe('Switch', () => {
  it('is a role=switch with aria-checked and toggles', () => {
    const onChange = vi.fn();
    render(<Switch label="Reduce motion" checked={false} onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Reduce motion' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('shows on/off text, not only position', () => {
    render(<Switch label="X" checked onChange={() => undefined} />);
    expect(screen.getByText('On')).toBeDefined();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Switch
        label="Reduce motion"
        description="No animations"
        checked
        onChange={() => undefined}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
