import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MainEvent } from '../../../shared/ipcChannels';
import { ThemeProvider } from '../design/theme/ThemeProvider';
import { expectNoA11yViolations } from '../test/axe';
import { AppProvider } from './AppProvider';
import { AppRouter } from './AppRouter';
import {
  challengeView,
  createFakeBridge,
  err,
  gateView,
  ok,
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
