import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MainEvent, SessionView } from '../../../shared/ipcChannels';
import { ThemeProvider } from '../design/theme/ThemeProvider';
import { expectNoA11yViolations } from '../test/axe';
import { AppProvider } from './AppProvider';
import { AppRouter } from './AppRouter';
import {
  EX1,
  EX2,
  M1,
  M2,
  badgesDto,
  detailView,
  interactiveDetail,
  overviewDto,
  quizDto,
  summary,
  xpDto,
} from './testing/learningFixtures';
import {
  OID,
  attemptDto,
  createFakeBridge,
  err,
  gateView,
  ok,
  sessionDto,
  signedInEmployee,
  type FakeBridge,
} from './testing/fakeBridge';

const onboardingEmployee: SessionView = {
  ...signedInEmployee,
  user: {
    ...(signedInEmployee.user as NonNullable<SessionView['user']>),
    onboardingRequired: true,
  },
};

function released(session: SessionView = signedInEmployee): FakeBridge {
  const fb = createFakeBridge({ gate: gateView({ phase: 'released' }), session });
  fb.mocks.getOverview.mockResolvedValue(ok(overviewDto()));
  fb.mocks.getXp.mockResolvedValue(ok(xpDto()));
  fb.mocks.getBadges.mockResolvedValue(ok(badgesDto()));
  return fb;
}

function mount(fb: FakeBridge) {
  return render(
    <ThemeProvider>
      <AppProvider bridge={fb.bridge}>
        <AppRouter />
      </AppProvider>
    </ThemeProvider>,
  );
}

const send = async (fb: FakeBridge, e: MainEvent): Promise<void> => {
  await act(async () => {
    fb.emit(e);
    await Promise.resolve();
  });
};

afterEach(() => {
  vi.useRealTimers();
});

const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });

describe('DashboardContainer', () => {
  it('shows a loading state, then real data from the three reads', async () => {
    const fb = released();
    let release!: () => void;
    fb.mocks.getXp.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve(ok(xpDto()));
          };
        }),
    );
    mount(fb);
    expect(await screen.findByText('Loading your dashboard')).toBeDefined();
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(await heading(/Welcome, Amina/)).toBeDefined();
    expect((await screen.findAllByText(/Welcome to CSense/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Pass the Module 1 quiz to unlock/)).toBeDefined();
    expect(fb.mocks.getOverview).toHaveBeenCalledTimes(1);
    expect(fb.mocks.getXp).toHaveBeenCalledTimes(1);
    expect(fb.mocks.getBadges).toHaveBeenCalledTimes(1);
  });

  it('shows an error with retry, using offline wording for network failures', async () => {
    const fb = released();
    fb.mocks.getXp.mockResolvedValueOnce(err('NETWORK_UNAVAILABLE'));
    mount(fb);
    expect(
      await screen.findByText("Can't reach CSense. Check your connection and try again."),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await heading(/Welcome, Amina/)).toBeDefined();
  });

  it('shows the empty state when no modules are assigned', async () => {
    const fb = released();
    fb.mocks.getOverview.mockResolvedValue(
      ok(overviewDto({ modules: [], totalModules: 0, nextModuleId: null })),
    );
    mount(fb);
    expect(await screen.findByText('No training has been assigned yet')).toBeDefined();
  });

  it('says so when the workstation was released offline', async () => {
    const fb = released();
    mount(fb);
    await heading(/Welcome/);
    await send(fb, { type: 'gate', view: gateView({ phase: 'released', releasedOffline: true }) });
    expect(await screen.findByText(/working offline/)).toBeDefined();
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
    expect(fb.mocks.getXp).not.toHaveBeenCalled();
  });

  it('sign-out goes through main and returns to Login', async () => {
    const fb = released();
    mount(fb);
    await heading(/Welcome/);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(fb.mocks.logout).toHaveBeenCalled();
    await send(fb, { type: 'gate', view: gateView({ phase: 'signed_out' }) });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined();
  });

  it('has no axe violations', async () => {
    const fb = released();
    const { container } = mount(fb);
    await heading(/Welcome/);
    await expectNoA11yViolations(container);
  });
});

describe('navigation', () => {
  it('Modules and Badges pages read the cache and the badge fallback motif never breaks', async () => {
    const fb = released();
    mount(fb);
    await heading(/Welcome/);
    fireEvent.click(screen.getByRole('button', { name: 'Badges' }));
    expect(await heading('Badges')).toBeDefined();
    expect(await screen.findByText('Odd One')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Modules' }));
    expect(await heading('Modules')).toBeDefined();
  });

  it('a notification click goes home, but a deep link to a locked module goes to the dashboard', async () => {
    const fb = released();
    fb.mocks.getModule.mockResolvedValue(ok(detailView()));
    mount(fb);
    await heading(/Welcome/);
    fireEvent.click(screen.getByRole('button', { name: 'Badges' }));
    await heading('Badges');
    await send(fb, { type: 'navigate', to: 'home' });
    expect(await heading(/Welcome/)).toBeDefined();
    await send(fb, { type: 'navigate', to: { module: M2 } });
    expect(await heading(/Welcome/)).toBeDefined();
    expect(fb.mocks.getModule).not.toHaveBeenCalled();
    await send(fb, { type: 'navigate', to: { module: M1 } });
    expect(await heading('Welcome to CSense')).toBeDefined();
  });
});

describe('OnboardingContainer', () => {
  it('shows after the gate for a first-time employee and is marked done on Start Module 1', async () => {
    const fb = released(onboardingEmployee);
    fb.mocks.getModule.mockResolvedValue(ok(detailView()));
    mount(fb);
    expect(await heading('Welcome to CSense, Amina')).toBeDefined();
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Start Module 1' }));
    expect(await heading('Welcome to CSense')).toBeDefined();
    expect(fb.mocks.completeOnboarding).toHaveBeenCalledWith({ outcome: 'completed' });
  });

  it('skip records "skipped" and lands on the dashboard', async () => {
    const fb = released(onboardingEmployee);
    mount(fb);
    await heading(/Welcome to CSense, Amina/);
    fireEvent.click(screen.getByRole('button', { name: 'Skip intro' }));
    expect(await heading(/Welcome, Amina/)).toBeDefined();
    expect(fb.mocks.completeOnboarding).toHaveBeenCalledWith({ outcome: 'skipped' });
  });

  it('a failed save never blocks training: a toast, then the dashboard', async () => {
    const fb = released(onboardingEmployee);
    fb.mocks.completeOnboarding.mockResolvedValue(err('NETWORK_UNAVAILABLE'));
    mount(fb);
    await heading(/Welcome to CSense, Amina/);
    fireEvent.click(screen.getByRole('button', { name: 'Skip intro' }));
    expect(await heading(/Welcome, Amina/)).toBeDefined();
    expect(await screen.findByText(/could not be saved/)).toBeDefined();
  });

  it('does not show for an employee who has already onboarded', async () => {
    const fb = released();
    mount(fb);
    await heading(/Welcome, Amina/);
    expect(fb.mocks.completeOnboarding).not.toHaveBeenCalled();
  });
});

async function openModule1(fb: FakeBridge) {
  mount(fb);
  await heading(/Welcome, Amina/);
  fireEvent.click(await screen.findByRole('button', { name: /Start module/ }));
  return heading('Welcome to CSense');
}

describe('ModulePlayerContainer: video module', () => {
  const setup = (detail = detailView()) => {
    const fb = released();
    fb.mocks.getModule.mockResolvedValue(ok(detail));
    fb.mocks.startModule.mockResolvedValue(ok(detail.progress));
    return fb;
  };

  it('starts an unstarted module once and shows the lesson as text (TXT1)', async () => {
    const detail = detailView({
      content: {
        ...detailView().content,
        body: '<img src=x onerror="alert(1)">\n\nSecond',
      },
      progress: { ...detailView().progress, startedAt: null },
    });
    const fb = setup(detail);
    await openModule1(fb);
    expect(await screen.findByText(/<img src=x onerror/)).toBeDefined();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    await waitFor(() => {
      expect(fb.mocks.startModule).toHaveBeenCalledTimes(1);
    });
  });

  it('the quiz action is soft-disabled with its reason until the transcript is read', async () => {
    const fb = setup();
    await openModule1(fb);
    const action = await screen.findByRole('button', { name: 'Continue to quiz' });
    expect(action.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Watch the video or read the transcript to continue')).toBeDefined();
    fireEvent.click(action);
    expect(fb.mocks.completeContent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Continue to quiz' }).getAttribute('aria-disabled'),
      ).toBeNull();
    });
  });

  it('a video error opens the transcript and enables the action', async () => {
    const fb = setup();
    await openModule1(fb);
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('app://csense/media/placeholder-lesson.webm');
    expect(document.querySelector('track')?.getAttribute('src')).toBe('app://csense/media/m1.vtt');
    fireEvent.error(video);
    expect(await screen.findByText('Video unavailable')).toBeDefined();
    expect(screen.getByRole('region', { name: 'Transcript' })).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Continue to quiz' }).getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('a missing media file (src null) is the same unavailable path', async () => {
    const base = detailView();
    const fb = setup(
      detailView({
        content: {
          ...base.content,
          video: {
            ...(base.content.video as NonNullable<typeof base.content.video>),
            src: null,
            captionsSrc: null,
          },
        },
      }),
    );
    await openModule1(fb);
    expect(await screen.findByText('Video unavailable')).toBeDefined();
  });

  it('watching 90% of the video, contiguously, enables the action', async () => {
    const fb = setup();
    await openModule1(fb);
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 10, configurable: true });
    for (let t = 1; t <= 9; t++) {
      Object.defineProperty(video, 'currentTime', { value: t, configurable: true });
      fireEvent.timeUpdate(video);
    }
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Continue to quiz' }).getAttribute('aria-disabled'),
      ).toBeNull();
    });
  });

  it('a forward seek does not count as watching', async () => {
    const fb = setup();
    await openModule1(fb);
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 10, configurable: true });
    Object.defineProperty(video, 'currentTime', { value: 9.5, configurable: true });
    fireEvent.timeUpdate(video);
    expect(
      screen.getByRole('button', { name: 'Continue to quiz' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('continue to quiz marks the content complete, then shows the intro with the pass mark', async () => {
    const fb = setup();
    fb.mocks.completeContent.mockResolvedValue(
      ok({ ...detailView().progress, contentCompletedAt: '2026-11-10T09:05:00.000Z' }),
    );
    await openModule1(fb);
    fireEvent.click(await screen.findByRole('button', { name: 'Show transcript' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to quiz' }));
    expect(await heading('Ready for the quiz?')).toBeDefined();
    expect(fb.mocks.completeContent).toHaveBeenCalledWith({ moduleId: M1 });
    expect(screen.getByText(/5 questions · 70% to pass/)).toBeDefined();
  });

  it('a cooldown disables Start and says when to come back', async () => {
    const fb = setup(
      detailView({
        quiz: quizDto({
          attempts: 3,
          canStart: false,
          blockedReason: 'cooldown',
          cooldownUntil: new Date(Date.now() + 3600_000).toISOString(),
        }),
        progress: { ...detailView().progress, contentCompletedAt: '2026-11-10T09:05:00.000Z' },
      }),
    );
    await openModule1(fb);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to quiz' }));
    await heading('Ready for the quiz?');
    expect(screen.getByText(/You can try again at/)).toBeDefined();
    expect(
      screen.getByRole('button', { name: /Start secure quiz/ }).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(fb.mocks.completeContent).not.toHaveBeenCalled();
  });

  it('a completed module stays readable and the quiz stage shows the result', async () => {
    const done = detailView({
      module: summary({ status: 'completed', passed: true, bestScore: 80, attempts: 2 }),
      quiz: quizDto({
        passed: true,
        bestScore: 80,
        attempts: 2,
        canStart: false,
        blockedReason: 'already_passed',
      }),
      progress: {
        ...detailView().progress,
        contentCompletedAt: '2026-11-10T09:05:00.000Z',
        status: 'completed',
      },
    });
    const fb = setup(done);
    await openModule1(fb);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to quiz' }));
    expect(await screen.findByText('Passed with 80%')).toBeDefined();
    expect(fb.mocks.startSecure).not.toHaveBeenCalled();
    expect(fb.mocks.startModule).not.toHaveBeenCalled();
  });

  it('locked, missing and failed modules each have their own state', async () => {
    const fb = setup();
    fb.mocks.getModule.mockResolvedValueOnce(err('MODULE_LOCKED'));
    mount(fb);
    await heading(/Welcome, Amina/);
    fireEvent.click(await screen.findByRole('button', { name: /Start module/ }));
    expect(await screen.findByText('This module is locked')).toBeDefined();
    fireEvent.click(screen.getAllByRole('button', { name: /Dashboard/ })[0] as HTMLElement);
    await heading(/Welcome/);
    fb.mocks.getModule.mockResolvedValueOnce(err('NOT_FOUND'));
    fireEvent.click(await screen.findByRole('button', { name: /Start module/ }));
    expect(await screen.findByText('This module is no longer available')).toBeDefined();
    fireEvent.click(screen.getAllByRole('button', { name: /Dashboard/ })[0] as HTMLElement);
    await heading(/Welcome/);
    fb.mocks.getModule.mockResolvedValueOnce(err('NETWORK_UNAVAILABLE'));
    fireEvent.click(await screen.findByRole('button', { name: /Start module/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Try again/ }));
    expect(await heading('Welcome to CSense')).toBeDefined();
  });
});

describe('ModulePlayerContainer: interactive module', () => {
  function setup() {
    const detail = interactiveDetail();
    const fb = released();
    fb.mocks.getOverview.mockResolvedValue(
      ok(
        overviewDto({
          modules: [
            summary({ status: 'completed', passed: true, bestScore: 100 }),
            summary({
              id: M2,
              position: 2,
              format: 'interactive',
              title: 'Passwords',
              status: 'in_progress',
            }),
          ],
          nextModuleId: M2,
        }),
      ),
    );
    fb.mocks.getModule.mockResolvedValue(ok(detail));
    fb.mocks.startModule.mockResolvedValue(ok(detail.progress));
    return fb;
  }
  const open = async (fb: FakeBridge) => {
    mount(fb);
    await heading(/Good to see you|Welcome, Amina/);
    fireEvent.click(await screen.findByRole('button', { name: /Resume module|Start module/ }));
    await heading('Passwords');
  };

  it('goes lesson, practice with immediate feedback, then the quiz', async () => {
    const fb = setup();
    fb.mocks.answerExercise
      .mockResolvedValueOnce(
        ok({
          exerciseId: EX1,
          selectedIndex: 0,
          correct: false,
          correctIndex: 1,
          explanation: 'Length wins.',
          recorded: true,
        }),
      )
      .mockResolvedValueOnce(
        ok({
          exerciseId: EX2,
          selectedIndex: 1,
          correct: true,
          correctIndex: 1,
          explanation: 'Deny it.',
          recorded: true,
        }),
      );
    fb.mocks.completeContent.mockResolvedValue(
      ok({ ...interactiveDetail().progress, contentCompletedAt: '2026-11-10T09:05:00.000Z' }),
    );
    await open(fb);
    expect(screen.getByText('Use long passphrases.')).toBeDefined();
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to practice' }));
    expect(await screen.findByText('Scenario 1 of 2')).toBeDefined();

    fireEvent.click(screen.getByRole('radio', { name: /abc/ }));
    expect(fb.mocks.answerExercise).toHaveBeenCalledWith({
      moduleId: M2,
      exerciseId: EX1,
      selectedIndex: 0,
    });
    const panel = await screen.findByRole('heading', { name: 'Not quite' });
    expect(panel).toBeDefined();
    expect(document.activeElement).toBe(panel);
    expect(screen.getByText('Length wins.')).toBeDefined();
    expect(screen.getByText('Correct answer')).toBeDefined();
    expect(screen.getByText('Your answer')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Next scenario' }));
    expect(await screen.findByText('Scenario 2 of 2')).toBeDefined();
    fireEvent.click(screen.getByRole('radio', { name: 'No' }));
    expect(await screen.findByRole('heading', { name: 'Correct' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to quiz' }));
    expect(await heading('Ready for the quiz?')).toBeDefined();
    expect(fb.mocks.completeContent).toHaveBeenCalledTimes(1);
  });

  it('a failed save leaves the choices open and says so', async () => {
    const fb = setup();
    fb.mocks.answerExercise.mockResolvedValueOnce(err('NETWORK_UNAVAILABLE'));
    await open(fb);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to practice' }));
    fireEvent.click(await screen.findByRole('radio', { name: /abc/ }));
    expect(await screen.findByText(/Your choice was not saved/)).toBeDefined();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /abc/ }).disabled).toBe(false);
  });

  it('CONTENT_INCOMPLETE names the unanswered scenario and jumps back to practice', async () => {
    const fb = setup();
    fb.mocks.completeContent.mockResolvedValue(err('CONTENT_INCOMPLETE'));
    fb.mocks.answerExercise.mockImplementation((...args: unknown[]) => {
      const a = args[0] as { exerciseId: string; selectedIndex: number };
      return ok({
        exerciseId: a.exerciseId,
        selectedIndex: a.selectedIndex,
        correct: true,
        correctIndex: a.selectedIndex,
        explanation: 'ok',
        recorded: true,
      }) as never;
    });
    await open(fb);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to practice' }));
    fireEvent.click(await screen.findByRole('radio', { name: /long passphrase/ }));
    await screen.findByRole('heading', { name: 'Correct' });
    fireEvent.click(screen.getByRole('button', { name: 'Next scenario' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'No' }));
    await screen.findByRole('heading', { name: 'Correct' });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to quiz' }));
    expect(await screen.findByText(/Answer every practice scenario before the quiz/)).toBeDefined();
  });

  it('an exercise already answered on the server is shown again with its explanation', async () => {
    const fb = setup();
    const base = interactiveDetail();
    fb.mocks.getModule.mockResolvedValue(
      ok({
        ...base,
        progress: {
          ...base.progress,
          exerciseAnswers: [{ exerciseId: EX1, selectedIndex: 1, correct: true }],
        },
      }),
    );
    fb.mocks.answerExercise.mockResolvedValue(
      ok({
        exerciseId: EX1,
        selectedIndex: 1,
        correct: true,
        correctIndex: 1,
        explanation: 'Seen before.',
        recorded: false,
      }),
    );
    await open(fb);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to practice' }));
    expect(await screen.findByText('Seen before.')).toBeDefined();
    expect(fb.mocks.answerExercise).toHaveBeenCalledWith({
      moduleId: M2,
      exerciseId: EX1,
      selectedIndex: 1,
    });
  });
});

describe('quiz result, review and achievements', () => {
  function quizRun(result: ReturnType<typeof attemptDto>) {
    const fb = released();
    fb.mocks.getModule.mockResolvedValue(
      ok(
        detailView({
          progress: { ...detailView().progress, contentCompletedAt: '2026-11-10T09:05:00.000Z' },
        }),
      ),
    );
    fb.mocks.startModule.mockResolvedValue(ok(detailView().progress));
    fb.mocks.startSecure.mockImplementation(async () => {
      await Promise.resolve();
      fb.emit({ type: 'lockdown', state: 'entering', sessionId: null });
      fb.emit({ type: 'lockdown', state: 'active', sessionId: OID.session1 });
      return ok({ session: sessionDto(), resumed: false, remainingFocusLosses: 3 }) as never;
    });
    fb.mocks.submit.mockImplementation(async () => {
      await Promise.resolve();
      fb.emit({
        type: 'lockdown',
        state: 'inactive',
        sessionId: OID.session1,
        reason: 'submitted',
      });
      return ok(result) as never;
    });
    return fb;
  }
  async function takeQuiz(fb: FakeBridge) {
    await openModule1(fb);
    fireEvent.click(await screen.findByRole('button', { name: 'Show transcript' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to quiz' }));
    await heading('Ready for the quiz?');
    fireEvent.click(screen.getByRole('button', { name: /Start secure quiz/ }));
    await screen.findByText('What is phishing?');
    fireEvent.click(screen.getByRole('radio', { name: /A scam email/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Review and submit/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Submit/ }));
  }

  const review = [
    {
      questionId: OID.q1,
      text: 'What is phishing?',
      options: ['A fish', 'A scam email', 'A game'],
      selectedIndex: 1,
      correct: true,
      explanation: 'It is a scam.',
    },
    {
      questionId: OID.q2,
      text: 'Who do you tell?',
      options: ['Nobody', 'Security', 'Everyone'],
      selectedIndex: 0,
      correct: false,
      explanation: 'Tell security.',
    },
  ];

  it('a failed attempt gets its result at once and a review without the answer key', async () => {
    const fb = quizRun(
      attemptDto({
        score: 50,
        passed: false,
        correctCount: 1,
        effects: {},
        review,
        progression: { moduleCompleted: false, nextModuleId: null, finalTestUnlocked: false },
      }),
    );
    await takeQuiz(fb);
    expect(await screen.findByText('50%', { exact: false })).toBeDefined();
    fireEvent.click(await screen.findByRole('button', { name: /Review answers/ }));
    expect(await heading('Answer review')).toBeDefined();
    expect(screen.getByText('It is a scam.')).toBeDefined();
    expect(screen.getByText('Tell security.')).toBeDefined();
    expect(screen.queryByText('Correct answer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Back to results/ }));
    expect(await screen.findByRole('button', { name: /Retry/ })).toBeDefined();
  });

  it('review after a pass tags the correct option', async () => {
    const withKey = review.map((r, i) => ({ ...r, correctIndex: i === 0 ? 1 : 1 }));
    const fb = quizRun(attemptDto({ review: withKey }));
    await takeQuiz(fb);
    fireEvent.click(await screen.findByRole('button', { name: /Review answers/ }));
    await heading('Answer review');
    expect(screen.getAllByText('Correct answer').length).toBe(2);
  });

  it('no review button when the attempt has nothing to review (abandoned)', async () => {
    const fb = quizRun(
      attemptDto({ score: 0, passed: false, endReason: 'abandoned', review: [], effects: {} }),
    );
    await takeQuiz(fb);
    await screen.findAllByText('0%', { exact: false });
    expect(screen.queryByRole('button', { name: /Review answers/ })).toBeNull();
  });

  it('pass: refreshes after lockdown ends and shows one achievement dialog on the dashboard', async () => {
    const fb = quizRun(
      attemptDto({
        effects: {
          xpEarned: 320,
          badge: { id: 'ba'.repeat(12), name: 'First Steps', iconMotif: 'welcome' },
        },
        progression: { moduleCompleted: true, nextModuleId: M2, finalTestUnlocked: false },
      }),
    );
    let xpCalls = 0;
    fb.mocks.getXp.mockImplementation(() => {
      xpCalls += 1;
      return ok(
        xpCalls === 1
          ? xpDto()
          : xpDto({
              totalXP: 330,
              level: 'Aware',
              tier: 2,
              currentLevelFloorXP: 300,
              nextLevel: 'Practitioner',
              nextLevelXP: 900,
            }),
      ) as never;
    });
    await takeQuiz(fb);
    await screen.findByText('100%', { exact: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Badge earned and level up: Aware/)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(await heading(/Good to see you|Welcome/)).toBeDefined();
  });
});

describe('FinalAssessmentContainer', () => {
  const finalDto = (over = {}) => ({
    status: 'unlocked' as const,
    title: 'Final assessment',
    questionCount: 15,
    passingScore: 70,
    remainingModules: 0,
    attempts: 0,
    bestScore: null,
    passed: false,
    completedAt: null,
    finalTestId: 'a'.repeat(24),
    nextAttemptNumber: 1,
    canStart: true,
    blockedReason: null,
    cooldownUntil: null,
    ...over,
  });
  async function openFinal(fb: FakeBridge) {
    mount(fb);
    await heading(/Welcome, Amina/);
    fireEvent.click(screen.getByRole('button', { name: 'Final assessment' }));
    return heading('Final assessment');
  }

  it('available: shows count and pass mark from the API and opens the quiz intro', async () => {
    const fb = released();
    fb.mocks.getFinalTestOverview.mockResolvedValue(ok(finalDto()));
    await openFinal(fb);
    expect(await screen.findByText(/15 questions covering every module/)).toBeDefined();
    expect(screen.getByText(/70% to pass/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Start final assessment' }));
    expect(await heading('Ready for the quiz?')).toBeDefined();
  });

  it('locked, cooldown, completed and not configured', async () => {
    const fb = released();
    fb.mocks.getFinalTestOverview.mockResolvedValueOnce(
      ok(finalDto({ status: 'locked', remainingModules: 3 })),
    );
    await openFinal(fb);
    expect(await screen.findByText('Pass 3 more modules to unlock.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    await heading(/Welcome/);

    fb.mocks.getFinalTestOverview.mockResolvedValueOnce(
      ok(
        finalDto({
          canStart: false,
          blockedReason: 'cooldown',
          cooldownUntil: new Date(Date.now() + 3600_000).toISOString(),
          attempts: 2,
          nextAttemptNumber: 3,
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Final assessment' }));
    expect(await screen.findByText(/You can try again at/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    await heading(/Welcome/);

    fb.mocks.getFinalTestOverview.mockResolvedValueOnce(
      ok(
        finalDto({
          status: 'completed',
          passed: true,
          bestScore: 93,
          completedAt: '2026-10-30T10:00:00.000Z',
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Final assessment' }));
    expect(await screen.findByText('Training complete')).toBeDefined();
    expect(screen.getByText(/with 93%/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Start final assessment' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }));
    await heading(/Welcome/);

    fb.mocks.getFinalTestOverview.mockResolvedValueOnce(err('NOT_FOUND'));
    fireEvent.click(screen.getByRole('button', { name: 'Final assessment' }));
    expect(await screen.findByText('No final assessment is configured yet')).toBeDefined();
  });

  it('a network failure offers a retry', async () => {
    const fb = released();
    fb.mocks.getFinalTestOverview.mockResolvedValueOnce(err('NETWORK_UNAVAILABLE'));
    fb.mocks.getFinalTestOverview.mockResolvedValue(ok(finalDto()));
    await openFinal(fb);
    fireEvent.click(await screen.findByRole('button', { name: /Try again/ }));
    expect(await screen.findByText(/15 questions/)).toBeDefined();
  });
});

describe('settings dialog', () => {
  it('opens from the gear, changes the theme and text size, and closes', async () => {
    const fb = released();
    mount(fb);
    await heading(/Welcome/);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Display settings' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Light' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Large' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.textSize).toBe('large');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
