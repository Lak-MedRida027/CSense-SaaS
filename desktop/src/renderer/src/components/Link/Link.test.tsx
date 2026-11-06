import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { Link } from './Link';

describe('Link', () => {
  it('marks external links for screen readers and isolates the opener', () => {
    render(
      <Link href="https://example.com" external>
        Guidance
      </Link>,
    );
    const a = screen.getByRole('link', { name: /^Guidance\s*\(opens in browser\)$/ });
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it('has no axe violations', async () => {
    const { container } = render(<Link href="#/x">Internal</Link>);
    await expectNoA11yViolations(container);
  });
});
