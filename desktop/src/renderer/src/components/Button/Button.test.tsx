import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { Button } from './Button';

describe('Button', () => {
  it('calls onClick and defaults to type="button"', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.getAttribute('type')).toBe('button');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('loading keeps the label, sets aria-busy and ignores clicks', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Submit
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Submit' });
    expect(btn.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('softDisabled stays focusable but inert', () => {
    const onClick = vi.fn();
    render(
      <Button softDisabled onClick={onClick}>
        Continue
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Continue' });
    expect(btn.hasAttribute('disabled')).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('has no axe violations across variants', async () => {
    const { container } = render(
      <div>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Delete</Button>
        <Button disabled>Disabled</Button>
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
