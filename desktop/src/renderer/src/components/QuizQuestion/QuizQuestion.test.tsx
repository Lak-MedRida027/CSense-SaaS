import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { QuizQuestion } from './QuizQuestion';

const options = [
  { id: 'a', text: 'Mismatched link' },
  { id: 'b', text: 'Sent at 9am' },
];

describe('QuizQuestion', () => {
  it('has a counter heading and the stem as the group name', () => {
    const onSelect = vi.fn();
    render(
      <QuizQuestion
        questionNumber={2}
        totalQuestions={5}
        stem="Which sign suggests phishing?"
        options={options}
        selectedOptionId={null}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Question 2 of 5' })).toBeDefined();
    expect(screen.getByRole('group', { name: 'Which sign suggests phishing?' })).toBeDefined();
    fireEvent.click(screen.getByRole('radio', { name: /Mismatched link/ }));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('review mode shows the explanation and correctness', () => {
    render(
      <QuizQuestion
        questionNumber={1}
        totalQuestions={5}
        stem="S"
        options={options}
        selectedOptionId="b"
        onSelect={() => undefined}
        mode="review"
        correctOptionId="a"
        explanation="Hover links."
      />,
    );
    expect(screen.getByRole('heading', { name: 'Incorrect' })).toBeDefined();
    expect(screen.getByText('Hover links.')).toBeDefined();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <QuizQuestion
        questionNumber={1}
        totalQuestions={5}
        stem="S"
        options={options}
        selectedOptionId="a"
        onSelect={() => undefined}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
