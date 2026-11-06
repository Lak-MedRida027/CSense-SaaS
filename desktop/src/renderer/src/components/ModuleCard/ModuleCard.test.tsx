import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { ModuleCard, type ModuleCardData } from './ModuleCard';

const base: ModuleCardData = {
  id: 'm5',
  order: 5,
  title: 'Safe browsing',
  description: 'Spot unsafe sites.',
  format: 'video',
  durationMinutes: 9,
  status: 'locked',
};

describe('ModuleCard', () => {
  it('locked modules stay focusable, explain the rule and do not open', () => {
    const onOpen = vi.fn();
    render(
      <ModuleCard
        module={base}
        totalModules={7}
        lockedReason="Pass the Module 4 quiz to unlock"
        onOpen={onOpen}
      />,
    );
    const btn = screen.getByRole('button', { name: /Safe browsing, locked/ });
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn).toHaveProperty('disabled', false);
    expect(screen.getByText('Pass the Module 4 quiz to unlock').id).toBe(
      btn.getAttribute('aria-describedby'),
    );
    fireEvent.click(btn);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('completed modules show status, score and badge as text', () => {
    render(
      <ModuleCard
        module={{ ...base, status: 'completed', scorePercent: 80, badgeName: 'Safe Surfer' }}
        totalModules={7}
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByText('Completed')).toBeDefined();
    expect(screen.getByText(/80%/)).toBeDefined();
    expect(screen.getByText('Safe Surfer')).toBeDefined();
  });

  it('opens unlocked modules', () => {
    const onOpen = vi.fn();
    render(
      <ModuleCard module={{ ...base, status: 'in_progress' }} totalModules={7} onOpen={onOpen} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /resume module/ }));
    expect(onOpen).toHaveBeenCalledWith('m5');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <ModuleCard module={base} totalModules={7} lockedReason="Locked" onOpen={() => undefined} />,
    );
    await expectNoA11yViolations(container);
  });
});
