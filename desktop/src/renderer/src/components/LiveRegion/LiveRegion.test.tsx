import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LiveRegion } from './LiveRegion';

describe('LiveRegion', () => {
  it('is a polite status region by default', () => {
    render(<LiveRegion>12 results</LiveRegion>);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('12 results');
  });

  it('uses role=alert when assertive', () => {
    render(<LiveRegion politeness="assertive">Access restricted</LiveRegion>);
    expect(screen.getByRole('alert')).toBeDefined();
  });
});
