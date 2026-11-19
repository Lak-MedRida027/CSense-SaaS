import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../design/theme/ThemeProvider';
import { expectNoA11yViolations } from '../../test/axe';
import { DisplaySettingsDialog } from '../DisplaySettingsDialog';
import { InteractiveExercise } from '../InteractiveExercise';
import { TranscriptPanel } from '../TranscriptPanel';
import { AchievementDialog, achievementTitle } from './AchievementDialog';

const badge = { id: 'b', name: 'First Steps', motif: 'welcome', moduleTitle: 'M1', earned: true };

describe('AchievementDialog', () => {
  it('titles each variant and announces it through the dialog title', () => {
    expect(achievementTitle({ badge })).toBe('Badge earned: First Steps');
    expect(achievementTitle({ levelUp: { from: 'Apprentice', to: 'Aware' } })).toBe(
      'Level up: Aware',
    );
    expect(achievementTitle({ badge, levelUp: { from: 'Apprentice', to: 'Aware' } })).toBe(
      'Badge earned and level up: Aware',
    );
    expect(achievementTitle({ trainingComplete: true })).toBe("You've completed your training");
  });

  it.each(['dark', 'light'] as const)('renders badge, level and closes (%s)', async (theme) => {
    const onClose = vi.fn();
    const { baseElement } = render(
      <ThemeProvider initialPreferences={{ theme }}>
        <AchievementDialog
          open
          badge={badge}
          levelUp={{ from: 'Apprentice', to: 'Aware' }}
          onClose={onClose}
        />
      </ThemeProvider>,
    );
    expect(screen.getByRole('dialog', { name: /Badge earned and level up: Aware/ })).toBeDefined();
    expect(screen.getByText('First Steps')).toBeDefined();
    await expectNoA11yViolations(baseElement);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('marks reduced motion and renders nothing when closed', () => {
    const { container, rerender } = render(
      <ThemeProvider initialPreferences={{ motion: 'reduced' }}>
        <AchievementDialog open badge={badge} onClose={() => undefined} />
      </ThemeProvider>,
    );
    expect(document.querySelector('[data-motion="reduced"]')).not.toBeNull();
    rerender(
      <ThemeProvider initialPreferences={{ motion: 'reduced' }}>
        <AchievementDialog open={false} badge={badge} onClose={() => undefined} />
      </ThemeProvider>,
    );
    expect(container.textContent).toBe('');
  });
});

describe('DisplaySettingsDialog', () => {
  it('changes preferences through the theme provider and has no axe violations', async () => {
    const onChange = vi.fn();
    const { baseElement } = render(
      <ThemeProvider onPreferencesChange={onChange}>
        <DisplaySettingsDialog open onClose={() => undefined} />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    fireEvent.click(screen.getByRole('switch', { name: /Reduce motion/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      theme: 'light',
      motion: 'reduced',
      textSize: 'default',
    });
    await expectNoA11yViolations(baseElement);
  });
});

describe('InteractiveExercise additions', () => {
  const base = {
    scenarioNumber: 1,
    totalScenarios: 2,
    prompt: 'P',
    choices: [
      { id: '0', text: 'A' },
      { id: '1', text: 'B' },
    ],
    onAnswer: vi.fn(),
    onNext: vi.fn(),
  };
  it('pending disables the choices and marks the region busy', () => {
    const { container } = render(<InteractiveExercise {...base} selectedChoiceId="0" pending />);
    expect(screen.getAllByRole('radio').every((r) => (r as HTMLInputElement).disabled)).toBe(true);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
  it('tags the correct option once feedback arrives and uses the custom title', () => {
    render(
      <InteractiveExercise
        {...base}
        selectedChoiceId="0"
        correctChoiceId="1"
        feedback={{ correct: false, title: 'Not quite', explanation: 'Because' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Not quite' })).toBeDefined();
    expect(screen.getByText('Correct answer')).toBeDefined();
    expect(screen.getByText('Your answer')).toBeDefined();
  });
});

describe('TranscriptPanel onReachedEnd', () => {
  const cues = [{ id: 'a', startSeconds: 0, text: 'one' }];
  const metrics = (el: HTMLElement, m: { top: number; client: number; scroll: number }) => {
    Object.defineProperty(el, 'scrollTop', { value: m.top, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: m.client, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: m.scroll, configurable: true });
  };
  it('fires once when everything fits (nothing to scroll)', () => {
    const cb = vi.fn();
    render(<TranscriptPanel cues={cues} onReachedEnd={cb} />);
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('fires only after the last cue is scrolled into view, and only once', () => {
    const cb = vi.fn();
    const sh = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(400);
    const ch = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
    render(<TranscriptPanel cues={cues} onReachedEnd={cb} />);
    const region = screen.getByRole('region', { name: 'Transcript' });
    expect(cb).not.toHaveBeenCalled();
    metrics(region, { top: 150, client: 100, scroll: 400 });
    fireEvent.scroll(region);
    expect(cb).not.toHaveBeenCalled();
    metrics(region, { top: 300, client: 100, scroll: 400 });
    fireEvent.scroll(region);
    fireEvent.scroll(region);
    expect(cb).toHaveBeenCalledTimes(1);
    sh.mockRestore();
    ch.mockRestore();
  });
});
