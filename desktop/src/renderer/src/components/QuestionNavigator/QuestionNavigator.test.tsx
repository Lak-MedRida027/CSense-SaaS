import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { QuestionNavigator } from './QuestionNavigator';

const questions = Array.from({ length: 15 }, (_, i) => ({
  id: `q${i}`,
  answered: i < 3,
  flagged: i === 1,
}));

describe('QuestionNavigator', () => {
  it('names each button with its state and jumps on click', () => {
    const onJump = vi.fn();
    render(<QuestionNavigator questions={questions} currentIndex={3} onJump={onJump} />);
    expect(screen.getByText('3 of 15 answered')).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Question 2, answered, flagged for review' }),
    ).toBeDefined();
    const current = screen.getByRole('button', { name: 'Question 4, unanswered' });
    expect(current.getAttribute('aria-current')).toBe('step');
    fireEvent.click(screen.getByRole('button', { name: 'Question 10, unanswered' }));
    expect(onJump).toHaveBeenCalledWith(9);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <QuestionNavigator questions={questions} currentIndex={0} onJump={() => undefined} />,
    );
    await expectNoA11yViolations(container);
  });
});
