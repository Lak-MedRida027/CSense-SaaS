import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton, SkeletonText } from './Skeleton';

describe('Skeleton', () => {
  it('is hidden from assistive tech', () => {
    const { container } = render(<Skeleton width={120} height={16} />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders the requested number of lines', () => {
    const { container } = render(<SkeletonText lines={4} />);
    expect(container.firstElementChild?.children).toHaveLength(4);
  });
});
