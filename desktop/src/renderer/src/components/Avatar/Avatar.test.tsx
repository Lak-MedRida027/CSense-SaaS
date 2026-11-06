import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar, initials } from './Avatar';

describe('Avatar', () => {
  it('derives initials', () => {
    expect(initials('Amina Benali')).toBe('AB');
    expect(initials('Sofia')).toBe('S');
    expect(initials('  ')).toBe('?');
  });

  it('is decorative by default and named when it is the only identifier', () => {
    const { container, rerender } = render(<Avatar name="Amina Benali" />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    rerender(<Avatar name="Amina Benali" decorative={false} />);
    expect(screen.getByRole('img', { name: 'Amina Benali' })).toBeDefined();
  });
});
