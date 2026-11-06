import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AttemptsIndicator } from './AttemptsIndicator';

describe('AttemptsIndicator', () => {
  it.each([
    [3, '3 of 3 attempts remaining', 'neutral'],
    [1, 'Last attempt: 1 of 3 remaining', 'caution'],
    [0, 'No attempts remaining', 'critical'],
  ] as const)('remaining=%i reads "%s" with tone %s', (remaining, text, tone) => {
    const { container } = render(<AttemptsIndicator remaining={remaining} max={3} />);
    expect(screen.getByRole('status').textContent).toBe(text);
    expect(container.firstElementChild?.getAttribute('data-tone')).toBe(tone);
  });
});
