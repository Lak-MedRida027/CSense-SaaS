import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { QuizOption } from './QuizOption';

describe('QuizOption', () => {
  it('is a native radio and reports selection', () => {
    const onSelect = vi.fn();
    render(
      <fieldset>
        <legend>Q</legend>
        <QuizOption
          name="q"
          optionId="a"
          letter="A"
          label="Report it"
          checked={false}
          onSelect={onSelect}
        />
      </fieldset>,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Report it/ }));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('review mode tags answers in text and locks input', () => {
    render(
      <fieldset>
        <legend>Q</legend>
        <QuizOption
          name="q"
          optionId="a"
          letter="A"
          label="Wrong"
          checked
          onSelect={() => undefined}
          review={{ isCorrect: false, isSelected: true }}
        />
        <QuizOption
          name="q"
          optionId="b"
          letter="B"
          label="Right"
          checked={false}
          onSelect={() => undefined}
          review={{ isCorrect: true, isSelected: false }}
        />
      </fieldset>,
    );
    expect(screen.getByRole('radio', { name: /Wrong.*Your answer/ })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('radio', { name: /Right.*Correct answer/ })).toBeDefined();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <fieldset>
        <legend>Q</legend>
        <QuizOption
          name="q"
          optionId="a"
          letter="A"
          label="One"
          checked
          onSelect={() => undefined}
        />
        <QuizOption
          name="q"
          optionId="b"
          letter="B"
          label="Two"
          checked={false}
          onSelect={() => undefined}
        />
      </fieldset>,
    );
    await expectNoA11yViolations(container);
  });
});
