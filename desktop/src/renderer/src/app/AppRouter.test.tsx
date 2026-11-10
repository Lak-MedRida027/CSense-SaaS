import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MainEvent } from '../../../shared/ipcChannels';
import { ThemeProvider } from '../design/theme/ThemeProvider';
import { expectNoA11yViolations } from '../test/axe';
import { AppProvider } from './AppProvider';
import { AppRouter } from './AppRouter';
import {
  OID,
  attemptDto,
  challengeView,
  createFakeBridge,
  err,
  gateView,
  ok,
  sessionDto,
  signedInEmployee,
  signedOut,
  type FakeBridge,
} from './testing/fakeBridge';

function mount(fb: FakeBridge) {
  return render(
    <ThemeProvider>
      <AppProvider bridge={fb.bridge}>
        <AppRouter />
      </AppProvider>
    </ThemeProvider>,
  );
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

const send = async (fb: FakeBridge, e: MainEvent): Promise<void> => {
  await act(async () => {
    fb.emit(e);
    await Promise.resolve();
  });
};

afterEach(() => {
  vi.useRealTimers();
});

describe('AppRouter: boot and sign-in', () => {
  it('shows a spinner until the first state arrives, then Login when main says signed_out', async () => {
    const fb = createFakeBridge({ gate: gateView({ phase: 'signed_out' }), session: signedOut });
    mount(fb);
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeDefined();
    expect(screen.getByText('Workstation locked')).toBeDefined();
  });

  it('renders nothing but the boot state while main is still checking', async () => {
    const fb = createFakeBridge({ gate: gateView({ phase: 'checking' }) });
    mount(fb);
    await flush();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Checking your access…' })).toBeDefined();
  });

  it('the renderer never decides access: no gate state means no workspace', async () => {
    const fb = createFakeBridge({ gate: gateView({ phase: 'challenge', challenge: null }) });
    mount(fb);
    await flush();
    expect(screen.queryByText('Your training')).toBeNull();
  });

  describe('login error mapping (generic, never reveals whether an account exists)', () => {
    const attempt = async (fb: FakeBridge, password = 'pw-secret') => {
      fireEvent.change(await screen.findByLabelText(/Work email/), {
        target: { value: 'amina@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/Password/), { target: { value: password } });
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      await waitFor(() => {
        expect(fb.mocks.login).toHaveBeenCalled();
      });
      await flush();
    };

    it.each([
      [err('INVALID_CREDENTIALS'), 'Email or password is incorrect.'],
      [err('VALIDATION_ERROR'), 'Email or password is incorrect.'],
      [err('INVALID_INPUT'), 'Email or password is incorrect.'],
      [
        err('RATE_LIMITED', { retryAfterSeconds: 290 }),
        'Too many attempts. Try again in 5 minutes.',
      ],
      [err('RATE_LIMITED', { retryAfterSeconds: 30 }), 'Too many attempts. Try again in 1 minute.'],
      [err('NETWORK_UNAVAILABLE'), "Can't reach CSense."],
      [err('MISCONFIGURED'), 'CSense is misconfigured. Contact IT.'],
    ])('maps %j', async (result, message) => {
      const fb = createFakeBridge({ gate: gateView({ phase: 'signed_out' }), session: signedOut });
      fb.mocks.login.mockResolvedValue(result);
      mount(fb);
      await attempt(fb);
      expect(await screen.findByText(message)).toBeDefined();
    });

    it('clears the password after every attempt but keeps the email', async () => {
      const fb = createFakeBridge({ gate: gateView({ phase: 'signed_out' }), session: signedOut });
      fb.mocks.login.mockResolvedValue(err('INVALID_CREDENTIALS'));
      mount(fb);
      await attempt(fb);
      await screen.findByText('Email or password is incorrect.');
      expect(screen.getByLabelText<HTMLInputElement>(/Password/).value).toBe('');
      expect(screen.getByLabelText<HTMLInputElement>(/Work email/).value).toBe('amina@example.com');
      expect(fb.mocks.login).toHaveBeenCalledWith({
        email: 'amina@example.com',
        password: 'pw-secret',
      });
    });

    it('shows the session-ended notice from main', async () => {
      const fb = createFakeBridge({
        gate: gateView({ phase: 'signed_out' }),
        session: { ...signedOut, endedNotice: 'session_ended' },
      });
      mount(fb);
      expect(await screen.findByText('Your session ended. Please sign in again.')).toBeDefined();
    });

    it('has no axe violations', async () => {
      const fb = createFakeBridge({ gate: gateView({ phase: 'signed_out' }) });
      const { container } = mount(fb);
      await screen.findByRole('heading', { name: 'Sign in' });
      await expectNoA11yViolations(container);
    });
  });
});

describe('AppRouter: security gate wiring', () => {
  it('maps options to index ids and submits {challengeId, optionIndex}', async () => {
    const fb = createFakeBridge({ gate: challengeView(), session: signedInEmployee });
    fb.mocks.submitAnswer.mockResolvedValue(
      ok({ correct: false, explanation: 'x', xpEarned: 0, view: challengeView() }),
    );
    mount(fb);
    expect(
      await screen.findByText('An email asks for your password. What do you do?'),
    ).toBeDefined();
    expect(screen.getByText('3 of 3', { exact: false })).toBeDefined();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    fireEvent.click(radios[1] as HTMLElement); // "Report it"
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    await waitFor(() => {
      expect(fb.mocks.submitAnswer).toHaveBeenCalledWith({
        challengeId: 'a'.repeat(24),
        optionIndex: 1,
      });
    });
  });

  it('a wrong answer shows "Not quite", the explanation and a DIFFERENT question with a fresh selection', async () => {
    const fb = createFakeBridge({ gate: challengeView(), session: signedInEmployee });
    mount(fb);
    fireEvent.click((await screen.findAllByRole('radio'))[0] as HTMLElement);
    await send(fb, {
      type: 'gate',
      view: challengeView({
        attemptsRemaining: 2,
        challenge: {
          challengeId: 'b'.repeat(24),
          prompt: 'A different question?',
          options: ['One', 'Two', 'Three'],
        },
        feedback: { correct: false, explanation: 'Real IT never asks for passwords.' },
      }),
    });
    expect(screen.getByText('Not quite')).toBeDefined();
    expect(screen.getByText('Real IT never asks for passwords.')).toBeDefined();
    expect(screen.getByText('A different question?')).toBeDefined();
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText('2 of 3', { exact: false })).toBeDefined();
  });

  it('a transport failure is shown as an error, not as a wrong answer', async () => {
    const fb = createFakeBridge({ gate: challengeView(), session: signedInEmployee });
    fb.mocks.submitAnswer.mockResolvedValue(err('NETWORK_UNAVAILABLE'));
    mount(fb);
    fireEvent.click((await screen.findAllByRole('radio'))[0] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(await screen.findByText(/Can't reach CSense\. Check your connection/)).toBeDefined();
    expect(screen.queryByText('Not quite')).toBeNull();
  });

  it('granted by an existing clearance auto-continues after 2 s through main; Continue now is always there', async () => {
    vi.useFakeTimers();
    const fb = createFakeBridge({
      gate: gateView({
        phase: 'granted',
        autoContinue: true,
        clearedUntil: '2026-11-10T20:00:00Z',
      }),
      session: signedInEmployee,
    });
    mount(fb);
    await flush();
    expect(screen.getByRole('heading', { name: 'Access granted' })).toBeDefined();
    expect(screen.getByRole('button', { name: /Continue now/ })).toBeDefined();
    expect(fb.mocks.gateContinue).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001);
    });
    expect(fb.mocks.gateContinue).toHaveBeenCalledTimes(1);
  });

  it('a pass just earned does NOT auto-continue (the user presses Continue)', async () => {
    vi.useFakeTimers();
    const fb = createFakeBridge({
      gate: gateView({ phase: 'granted', autoContinue: false }),
      session: signedInEmployee,
    });
    mount(fb);
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fb.mocks.gateContinue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Continue now/ }));
    expect(fb.mocks.gateContinue).toHaveBeenCalledTimes(1);
  });

  it('restricted shows the server reference and a sign-out, never a way forward', async () => {
    const fb = createFakeBridge({
      gate: gateView({
        phase: 'restricted',
        restricted: { referenceId: 'GATE-20261110-ABC123', since: '2026-11-10T09:00:00Z' },
      }),
      session: signedInEmployee,
    });
    mount(fb);
    expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeDefined();
    expect(screen.getByText('GATE-20261110-ABC123')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(fb.mocks.logout).toHaveBeenCalled();
  });

  it('offline: retry now; "Continue offline" appears only when main says the grace has elapsed', async () => {
    const fb = createFakeBridge({
      gate: gateView({
        phase: 'offline',
        offline: { since: '2026-11-10T09:00:00Z', graceElapsed: false, canContinueOffline: false },
      }),
    });
    mount(fb);
    expect(await screen.findByRole('heading', { name: "Can't reach CSense" })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Continue offline' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Retry now/ }));
    expect(fb.mocks.requestChallenge).toHaveBeenCalled();

    await send(fb, {
      type: 'gate',
      view: gateView({
        phase: 'offline',
        offline: { since: '2026-11-10T09:00:00Z', graceElapsed: true, canContinueOffline: true },
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue offline' }));
    expect(fb.mocks.continueOffline).toHaveBeenCalled();
  });

  it('misconfigured explains itself and offers nothing', async () => {
    const fb = createFakeBridge({ gate: gateView({ phase: 'misconfigured' }) });
    mount(fb);
    expect(await screen.findByRole('heading', { name: 'CSense is misconfigured' })).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    [
      'offline',
      gateView({
        phase: 'offline',
        offline: { since: 'x', graceElapsed: true, canContinueOffline: true },
      }),
    ],
    ['misconfigured', gateView({ phase: 'misconfigured' })],
    ['boot', gateView({ phase: 'checking' })],
  ])('axe: %s state has no violations', async (_name, view) => {
    const fb = createFakeBridge({ gate: view, session: signedInEmployee });
    const { container } = mount(fb);
    await screen.findAllByRole('heading').catch(() => undefined);
    await flush();
    await expectNoA11yViolations(container);
  });
});

describe('AppRouter: released workstation', () => {
  const overview = {
    modules: [
      {
        id: OID.module1,
        position: 1,
        title: 'Phishing basics',
        description: 'd',
        format: 'video' as const,
        durationMinutes: 10,
        status: 'in_progress' as const,
        lockedBy: null,
        attempts: 0,
        bestScore: null,
        passed: false,
        completedAt: null,
      },
      {
        id: 'e'.repeat(24),
        position: 2,
        title: 'Passwords',
        description: 'd',
        format: 'interactive' as const,
        durationMinutes: 10,
        status: 'locked' as const,
        lockedBy: { moduleId: OID.module1, position: 1, title: 'Phishing basics' },
        attempts: 0,
        bestScore: null,
        passed: false,
        completedAt: null,
      },
    ],
    totalModules: 7,
    completedCount: 0,
    nextModuleId: OID.module1,
    finalTest: null,
  };
  const quizOverview = {
    quizId: 'f'.repeat(24),
    moduleId: OID.module1,
    title: 'Quiz',
    questionCount: 2,
    passingScore: 70,
    attempts: 0,
    nextAttemptNumber: 1,
    bestScore: null,
    passed: false,
    canStart: true,
    blockedReason: null,
    cooldownUntil: null,
  };

  function released() {
    const fb = createFakeBridge({
      gate: gateView({ phase: 'released' }),
      session: signedInEmployee,
    });
    fb.mocks.getOverview.mockResolvedValue(ok(overview));
    fb.mocks.getQuizOverview.mockResolvedValue(ok(quizOverview));
    return fb;
  }

  it('TrainingHome lists modules from main and offers a quiz only where main says it can start', async () => {
    const fb = released();
    mount(fb);
    expect(await screen.findByRole('heading', { level: 1, name: 'Your training' })).toBeDefined();
    expect(await screen.findByText(/Phishing basics/)).toBeDefined();
    expect(screen.getByText('Amina Benali')).toBeDefined();
    expect(screen.getByText(/Pass the Module 1 quiz first/)).toBeDefined();
    expect(screen.getAllByRole('button', { name: /Start quiz/ })).toHaveLength(1);
    // Only unlocked / in-progress modules are asked about their quiz.
    expect(fb.mocks.getQuizOverview).toHaveBeenCalledTimes(1);
  });

  it('TrainingHome error state offers a retry', async () => {
    const fb = released();
    fb.mocks.getOverview.mockResolvedValueOnce(err('NETWORK_UNAVAILABLE'));
    mount(fb);
    expect(await screen.findByText('Your training could not be loaded.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText(/Phishing basics/)).toBeDefined();
  });

  it('administrators get the placeholder and never load learning content', async () => {
    const fb = createFakeBridge({
      gate: gateView({ phase: 'released', admin: true }),
      session: {
        status: 'signed_in',
        persistence: 'encrypted',
        user: { id: 'a1', name: 'Ada', role: 'administrator' },
      },
    });
    mount(fb);
    expect(await screen.findByText('Admin console arrives in a later release')).toBeDefined();
    expect(fb.mocks.getOverview).not.toHaveBeenCalled();
  });

  it('a released-offline workstation says so', async () => {
    const fb = released();
    await act(async () => {
      fb.emit({ type: 'gate', view: gateView({ phase: 'released', releasedOffline: true }) });
      await Promise.resolve();
    });
    mount(fb);
    await flush();
    await send(fb, { type: 'gate', view: gateView({ phase: 'released', releasedOffline: true }) });
    expect(await screen.findByText(/working offline/)).toBeDefined();
  });

  it('a sign-out sends the user back to Login (via main events)', async () => {
    const fb = released();
    mount(fb);
    await screen.findByText(/Phishing basics/);
    fireEvent.click(screen.getByRole('button', { name: /Sign out/ }));
    expect(fb.mocks.logout).toHaveBeenCalled();
    await send(fb, { type: 'gate', view: gateView({ phase: 'signed_out' }) });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined();
  });

  describe('quiz', () => {
    async function openIntro(fb: FakeBridge) {
      mount(fb);
      fireEvent.click(await screen.findByRole('button', { name: /Start quiz/ }));
      return screen.findByRole('heading', { level: 1, name: 'Ready for the quiz?' });
    }
    const startSession = (fb: FakeBridge) =>
      fb.mocks.startSecure.mockImplementation(async () => {
        await Promise.resolve();
        fb.emit({ type: 'lockdown', state: 'entering', sessionId: null });
        fb.emit({ type: 'lockdown', state: 'active', sessionId: OID.session1 });
        return ok({ session: sessionDto(), resumed: false, remainingFocusLosses: 3 }) as never;
      });

    it('intro -> secure start -> questions mapped from the session -> submit with index answers -> result', async () => {
      const fb = released();
      startSession(fb);
      await openIntro(fb);
      fireEvent.click(screen.getByRole('button', { name: /Start secure quiz|Start quiz|Begin/ }));
      await waitFor(() => {
        expect(fb.mocks.startSecure).toHaveBeenCalledWith({ kind: 'quiz', moduleId: OID.module1 });
      });
      expect(await screen.findByText('What is phishing?')).toBeDefined();
      expect(screen.getByRole('region', { name: 'Secure quiz mode' })).toBeDefined();

      fireEvent.click(screen.getByRole('radio', { name: /A scam email/ }));
      fireEvent.click(screen.getByRole('button', { name: /Next/ }));
      expect(await screen.findByText('Who do you tell?')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: /Review and submit/ }));

      fb.mocks.submit.mockImplementation(async () => {
        await Promise.resolve();
        fb.emit({
          type: 'lockdown',
          state: 'inactive',
          sessionId: OID.session1,
          reason: 'submitted',
        });
        return ok(attemptDto()) as never;
      });
      fireEvent.click(await screen.findByRole('button', { name: /Submit/ }));
      await waitFor(() => {
        expect(fb.mocks.submit).toHaveBeenCalledWith({
          sessionId: OID.session1,
          answers: [
            { questionId: OID.q1, selectedIndex: 1 },
            { questionId: OID.q2, selectedIndex: null }, // unanswered -> null, not 0
          ],
        });
      });
      expect(await screen.findByText('100%', { exact: false })).toBeDefined();
      expect(screen.getByText(/120/)).toBeDefined(); // XP from effects.xpEarned
      // No "Review answers" in Phase 5 (arrives with Phase 6).
      expect(screen.queryByRole('button', { name: /Review answers/ })).toBeNull();
    });

    it('questions are not requested or shown until the user starts; a failed start returns to the intro with the reason', async () => {
      const fb = released();
      fb.mocks.startSecure.mockResolvedValue(
        err('ASSESSMENT_COOLDOWN', { details: { retryAt: '2026-11-10T12:30:00.000Z' } }),
      );
      await openIntro(fb);
      expect(fb.mocks.startSecure).not.toHaveBeenCalled();
      expect(screen.queryByText('What is phishing?')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Start secure quiz|Start quiz|Begin/ }));
      expect(await screen.findByText(/You can try again after/)).toBeDefined();
      expect(screen.getByRole('heading', { name: 'Ready for the quiz?' })).toBeDefined();
    });

    it('a focus-loss violation from main shows the warning in the banner', async () => {
      const fb = released();
      startSession(fb);
      await openIntro(fb);
      fireEvent.click(screen.getByRole('button', { name: /Start secure quiz|Start quiz|Begin/ }));
      await screen.findByText('What is phishing?');
      await send(fb, { type: 'lockdown-violation', kind: 'focus_lost', count: 1, remaining: 2 });
      const banner = screen.getByRole('region', { name: 'Secure quiz mode' });
      expect(
        within(banner).getByText('You left secure mode. Leaving 2 more times ends this attempt.'),
      ).toBeDefined();
      expect(within(banner).getByRole('alert')).toBeDefined();
    });

    it('when main ends the attempt (focus policy) the renderer shows it as ended and abandoned', async () => {
      const fb = released();
      startSession(fb);
      await openIntro(fb);
      fireEvent.click(screen.getByRole('button', { name: /Start secure quiz|Start quiz|Begin/ }));
      await screen.findByText('What is phishing?');
      await send(fb, {
        type: 'lockdown',
        state: 'inactive',
        sessionId: OID.session1,
        reason: 'focus_lost',
      });
      expect(
        await screen.findByText('This attempt ended because CSense lost focus.'),
      ).toBeDefined();
      expect(screen.queryByText('What is phishing?')).toBeNull();
    });

    it('Exit quiz is reachable and confirms with Keep going focused; confirming calls assessment.exit', async () => {
      const fb = released();
      startSession(fb);
      fb.mocks.exit.mockImplementation(async () => {
        await Promise.resolve();
        fb.emit({
          type: 'lockdown',
          state: 'inactive',
          sessionId: OID.session1,
          reason: 'user_exit',
        });
        return ok({
          attempt: attemptDto({
            endReason: 'abandoned',
            score: 0,
            passed: false,
            correctCount: 0,
            effects: {},
          }),
        }) as never;
      });
      await openIntro(fb);
      fireEvent.click(screen.getByRole('button', { name: /Start secure quiz|Start quiz|Begin/ }));
      await screen.findByText('What is phishing?');
      fireEvent.click(screen.getByRole('button', { name: 'Exit quiz' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(document.activeElement).toBe(
        within(dialog).getByRole('button', { name: 'Keep going' }),
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('alertdialog')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Exit quiz' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Leave quiz' }));
      await waitFor(() => {
        expect(fb.mocks.exit).toHaveBeenCalledWith({ sessionId: OID.session1 });
      });
      expect(await screen.findByText(/You left the quiz/)).toBeDefined();
    });

    it('copy, cut and paste are prevented inside the quiz (second layer behind main)', async () => {
      const fb = released();
      startSession(fb);
      await openIntro(fb);
      fireEvent.click(screen.getByRole('button', { name: /Start secure quiz|Start quiz|Begin/ }));
      const stem = await screen.findByText('What is phishing?');
      for (const name of ['copy', 'cut', 'paste', 'contextMenu'] as const) {
        const ev = fireEvent[name](stem);
        expect(ev, name).toBe(false); // false = defaultPrevented
      }
    });

    it('after a renderer reload main resumes the cached session: straight back into the quiz with a notice', async () => {
      const fb = createFakeBridge({
        gate: gateView({ phase: 'released' }),
        session: signedInEmployee,
        resume: { session: sessionDto(), resumed: true, remainingFocusLosses: 3 },
      });
      mount(fb);
      expect(await screen.findByText('What is phishing?')).toBeDefined();
      expect(screen.getByText(/CSense restarted the quiz screen/)).toBeDefined();
      expect(fb.mocks.startSecure).not.toHaveBeenCalled();
      expect(fb.mocks.getOverview).not.toHaveBeenCalled();
    });

    it('a network failure on submit keeps the answers and the lockdown, and says so', async () => {
      const fb = released();
      startSession(fb);
      fb.mocks.submit.mockResolvedValue(err('NETWORK_UNAVAILABLE'));
      await openIntro(fb);
      fireEvent.click(screen.getByRole('button', { name: /Start secure quiz|Start quiz|Begin/ }));
      await screen.findByText('What is phishing?');
      fireEvent.click(screen.getByRole('button', { name: /Next/ }));
      fireEvent.click(await screen.findByRole('button', { name: /Review and submit/ }));
      fireEvent.click(await screen.findByRole('button', { name: /Submit/ }));
      expect(await screen.findByText(/Your answers are kept/)).toBeDefined();
      expect(screen.getByRole('region', { name: 'Secure quiz mode' })).toBeDefined();
    });
  });
});

describe('notification clicks', () => {
  it('a navigate event (notification click) keeps the user on the home page', async () => {
    const fb = createFakeBridge({
      gate: gateView({ phase: 'released' }),
      session: signedInEmployee,
    });
    fb.mocks.getOverview.mockResolvedValue(
      ok({
        modules: [],
        totalModules: 0,
        completedCount: 0,
        nextModuleId: null,
        finalTest: null,
      }),
    );
    mount(fb);
    expect(await screen.findByRole('heading', { name: 'Your training' })).toBeDefined();
    await send(fb, { type: 'navigate', to: 'home' });
    expect(screen.getByRole('heading', { name: 'Your training' })).toBeDefined();
  });
});
