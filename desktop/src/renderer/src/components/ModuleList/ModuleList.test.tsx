import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { ModuleList } from './ModuleList';

const modules = [
  { id: 'm1', order: 1, title: 'Welcome', status: 'completed' as const },
  { id: 'm2', order: 2, title: 'Passwords', status: 'in_progress' as const },
  {
    id: 'm3',
    order: 3,
    title: 'Phishing',
    status: 'locked' as const,
    lockedReason: 'Pass the Module 2 quiz to unlock',
  },
];

describe('ModuleList', () => {
  it('marks the current module and blocks locked ones', () => {
    const onSelect = vi.fn();
    render(<ModuleList modules={modules} currentId="m2" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: /2 Passwords/ }).getAttribute('aria-current')).toBe(
      'page',
    );
    const locked = screen.getByRole('button', { name: /3 Phishing, locked/ });
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(locked);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /1 Welcome/ }));
    expect(onSelect).toHaveBeenCalledWith('m1');
  });

  it('includes the final assessment entry', () => {
    render(
      <ModuleList
        modules={modules}
        onSelect={() => undefined}
        finalAssessment={{ status: 'locked', lockedReason: 'After all modules' }}
      />,
    );
    expect(screen.getByRole('button', { name: /Final assessment, locked/ })).toBeDefined();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <ModuleList modules={modules} currentId="m2" onSelect={() => undefined} />,
    );
    await expectNoA11yViolations(container);
  });
});
