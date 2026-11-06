import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { ScoreSummary } from './ScoreSummary';

describe('ScoreSummary', () => {
  it('pass: words + pass mark from props + continue', () => {
    const onContinue = vi.fn();
    render(
      <ScoreSummary
        title="Module 3 quiz"
        scorePercent={80}
        passMarkPercent={75}
        passed
        correctCount={4}
        totalCount={5}
        xpEarned={150}
        onContinue={onContinue}
        continueLabel="Continue to Module 4"
      />,
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('80%');
    expect(heading.textContent).toContain('Passed');
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText(/pass mark 75%/)).toBeDefined();
    expect(screen.getByText('+150 XP')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Module 4' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('fail: offers review and retry, not continue', () => {
    render(
      <ScoreSummary
        title="Q"
        scorePercent={60}
        passMarkPercent={70}
        passed={false}
        correctCount={3}
        totalCount={5}
        onReview={() => undefined}
        onRetry={() => undefined}
        onContinue={() => undefined}
      />,
    );
    expect(screen.getByText('Not passed')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Retry quiz' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <ScoreSummary
        title="Q"
        scorePercent={80}
        passMarkPercent={70}
        passed
        correctCount={4}
        totalCount={5}
        onReview={() => undefined}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
