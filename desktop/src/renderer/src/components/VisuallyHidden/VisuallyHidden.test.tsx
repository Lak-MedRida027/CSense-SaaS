import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VisuallyHidden } from './VisuallyHidden';

describe('VisuallyHidden', () => {
  it('keeps text available to screen readers via .sr-only', () => {
    render(<VisuallyHidden>Hidden label</VisuallyHidden>);
    expect(screen.getByText('Hidden label').className).toBe('sr-only');
  });
});
