import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FeedbackPanel } from './FeedbackPanel';

describe('FeedbackPanel', () => {
  it('says Correct/Incorrect in words and focuses its heading', () => {
    render(<FeedbackPanel correct={false} explanation="IT never asks for passwords." />);
    const heading = screen.getByRole('heading', { name: 'Incorrect' });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText('IT never asks for passwords.')).toBeDefined();
  });

  it('can skip focus (e.g. in review lists)', () => {
    render(<FeedbackPanel correct explanation="Yes" focusOnMount={false} />);
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'Correct' }));
  });
});
