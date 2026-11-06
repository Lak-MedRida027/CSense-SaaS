import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { THEME_NAMES } from '../design/tokens';
import { ThemeProvider } from '../design/theme/ThemeProvider';
import { SCREENS } from '../dev/styleguide/screenRegistry';
import { expectNoA11yViolations } from '../test/axe';
import { AdminDashboardScreen } from './AdminDashboard';
import {
  adminDashboardFixture,
  adminDashboardPhishingFlagFixture,
} from './AdminDashboard/AdminDashboard.fixtures';
import { LoginScreen } from './Login';
import { loginIdleFixture } from './Login/Login.fixtures';
import { ModulePlayerScreen } from './ModulePlayer';
import { modulePlayerVideoFixture } from './ModulePlayer/ModulePlayer.fixtures';
import { QuizScreen } from './Quiz';
import { quizActiveFixture, quizEnteringFixture, quizIntroFixture } from './Quiz/Quiz.fixtures';
import { SecurityGateScreen } from './SecurityGate';
import {
  securityGateChallengeFixture,
  securityGateRestrictedFixture,
} from './SecurityGate/SecurityGate.fixtures';

const variants = SCREENS.flatMap((s) =>
  s.variants.map((v) => [`${s.id}/${v.id}`, v.render] as const),
);

describe.each(THEME_NAMES)('screens render without axe violations (%s)', (themeName) => {
  it.each(variants)('%s', async (_id, renderVariant) => {
    const { baseElement } = render(
      <ThemeProvider initialPreferences={{ theme: themeName }}>{renderVariant()}</ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe(themeName);
    expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0);
    await expectNoA11yViolations(baseElement);
  });
});

describe('screen seams (presentational only)', () => {
  it('login: no registration, submits credentials through the seam', () => {
    const onSubmitCredentials = vi.fn();
    render(<LoginScreen {...loginIdleFixture} onSubmitCredentials={onSubmitCredentials} />);
    expect(screen.queryByText(/sign up|register|create account/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Work email/), {
      target: { value: ' amina@example.com ' },
    });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSubmitCredentials).toHaveBeenCalledWith({
      email: 'amina@example.com',
      password: 'pw',
    });
  });

  it('security gate: submit needs a selection and goes through the seam', () => {
    const onSubmitGateAnswer = vi.fn();
    render(
      <SecurityGateScreen
        {...securityGateChallengeFixture}
        onSubmitGateAnswer={onSubmitGateAnswer}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(onSubmitGateAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: /Report it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(onSubmitGateAnswer).toHaveBeenCalledWith('b');
  });

  it('security gate: restricted state has no way to retry', () => {
    render(<SecurityGateScreen {...securityGateRestrictedFixture} />);
    expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeDefined();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull();
    expect(screen.getByText('GATE-2026-10-24-0042')).toBeDefined();
  });

  it('quiz: questions only render once lockdown is active', () => {
    const { rerender } = render(<QuizScreen {...quizEnteringFixture} />);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('Preparing secure mode...')).toBeDefined();
    rerender(<QuizScreen {...quizActiveFixture} />);
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Secure quiz mode' })).toBeDefined();
  });

  it('quiz: intro requests lockdown through the seam', () => {
    const onRequestStartLockdown = vi.fn();
    render(<QuizScreen {...quizIntroFixture} onRequestStartLockdown={onRequestStartLockdown} />);
    expect(screen.getByText(/70% to pass/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Start secure quiz' }));
    expect(onRequestStartLockdown).toHaveBeenCalledOnce();
  });

  it('quiz: Exit asks for confirmation before calling the seam', () => {
    const onConfirmExit = vi.fn();
    render(<QuizScreen {...quizActiveFixture} onConfirmExit={onConfirmExit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Exit quiz' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Leave the quiz?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep going' }));
    expect(onConfirmExit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Exit quiz' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave quiz' }));
    expect(onConfirmExit).toHaveBeenCalledOnce();
  });

  it('module player: locked modules in the sidebar cannot be opened', () => {
    const onSelectModule = vi.fn();
    render(<ModulePlayerScreen {...modulePlayerVideoFixture} onSelectModule={onSelectModule} />);
    fireEvent.click(screen.getByRole('button', { name: /5 Safe browsing and downloads, locked/ }));
    expect(onSelectModule).not.toHaveBeenCalled();
    const quizButton = screen.getByRole('button', { name: 'Continue to practice' });
    expect(quizButton).toBeDefined();
  });

  it('admin: phishing nav only appears behind the feature flag', () => {
    const { unmount } = render(<AdminDashboardScreen {...adminDashboardFixture} />);
    expect(screen.queryByRole('button', { name: 'Phishing simulations' })).toBeNull();
    unmount();
    render(<AdminDashboardScreen {...adminDashboardPhishingFlagFixture} />);
    expect(screen.getByRole('button', { name: 'Phishing simulations' })).toBeDefined();
  });

  it('admin: report dialog passes the chosen kind to the seam', () => {
    const onGenerateReport = vi.fn();
    render(<AdminDashboardScreen {...adminDashboardFixture} onGenerateReport={onGenerateReport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    fireEvent.click(screen.getByRole('radio', { name: /Risk and escalations/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(onGenerateReport).toHaveBeenCalledWith('risk');
  });
});
