import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Award } from '../../icons';
import { expectNoA11yViolations } from '../../test/axe';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('shows title, description and the next action', async () => {
    const { container } = render(
      <EmptyState
        icon={Award}
        title="No badges yet"
        description="Complete a module to earn one."
        action={<button type="button">Start module</button>}
      />,
    );
    expect(screen.getByText('No badges yet')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Start module' })).toBeDefined();
    await expectNoA11yViolations(container);
  });
});
