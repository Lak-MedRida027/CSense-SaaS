import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { InteractiveExercise } from './InteractiveExercise';

const choices = [
  { id: 'a', text: 'Tap the link' },
  { id: 'b', text: 'Check the official site' },
];

describe('InteractiveExercise', () => {
  it('blocks Next until answered, then shows immediate feedback and locks choices', () => {
    const onAnswer = vi.fn();
    const onNext = vi.fn();
    const { rerender } = render(
      <InteractiveExercise
        scenarioNumber={1}
        totalScenarios={4}
        prompt="What now?"
        choices={choices}
        selectedChoiceId={null}
        onAnswer={onAnswer}
        onNext={onNext}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next scenario' }));
    expect(onNext).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: /official site/ }));
    expect(onAnswer).toHaveBeenCalledWith('b');

    rerender(
      <InteractiveExercise
        scenarioNumber={1}
        totalScenarios={4}
        prompt="What now?"
        choices={choices}
        selectedChoiceId="b"
        feedback={{ correct: true, explanation: 'Go direct.' }}
        onAnswer={onAnswer}
        onNext={onNext}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Correct' })).toBeDefined();
    expect(screen.getByRole('radio', { name: /Tap the link/ })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Next scenario' }));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <InteractiveExercise
        scenarioNumber={1}
        totalScenarios={4}
        prompt="What now?"
        choices={choices}
        selectedChoiceId={null}
        onAnswer={() => undefined}
        onNext={() => undefined}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
