import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExerciseFeedbackDTO } from '../../../../shared/dto';
import type { DesktopError, ModuleDetailView } from '../../../../shared/ipcChannels';
import {
  ModulePlayerScreen,
  type ModulePlayerExercise,
  type ModulePlayerState,
} from '../../screens/ModulePlayer';
import { useBridge, useLearningStore } from '../AppProvider';
import type { ModuleStageName } from '../navigation';
import {
  lockReasonFor,
  startBlockedReason,
  toModuleListItem,
  toQuizTarget,
  toFinalCard,
} from '../learning/mappers';
import { createWatchTracker } from '../learning/watchProgress';
import { moduleActionErrorMessage } from '../messages';
import { useWorkspace } from '../WorkspaceContext';
import { useLearningView } from './shell';

type Load =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'locked' }
  | { status: 'not_found' }
  | { status: 'ready'; detail: ModuleDetailView };

function classify(error: DesktopError): Load {
  if (error.code === 'MODULE_LOCKED') return { status: 'locked' };
  if (error.code === 'NOT_FOUND') return { status: 'not_found' };
  return { status: 'error' };
}

export const WATCH_REASON = 'Watch the video or read the transcript to continue';

/**
 * One module (plan 7.4): load, start once, lesson (video with the watched rule, or text), practice
 * with immediate per-exercise feedback, then the content-complete call and the quiz intro.
 */
export function ModulePlayerContainer({
  moduleId,
  stage,
}: {
  moduleId: string;
  stage: ModuleStageName;
}) {
  const bridge = useBridge();
  const learning = useLearningStore();
  const ws = useWorkspace();
  const { state: lstate } = useLearningView(['overview']);
  const overview = lstate.overview.data;

  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [exIndex, setExIndex] = useState(0);
  const [pendingEx, setPendingEx] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, ExerciseFeedbackDTO>>({});
  const [videoFailed, setVideoFailed] = useState(false);
  const [watched, setWatched] = useState(false);
  const [transcriptRead, setTranscriptRead] = useState(false);
  const tracker = useRef(createWatchTracker());
  const started = useRef(false);

  // ---- load ------------------------------------------------------------------------------------
  useEffect(() => {
    const run = { stale: false };
    tracker.current.reset();
    started.current = false;
    void (async () => {
      setLoad({ status: 'loading' });
      setNotice(undefined);
      try {
        const res = await bridge.learning.getModule({ moduleId });
        if (run.stale) return;
        setLoad(res.ok ? { status: 'ready', detail: res.data } : classify(res.error));
      } catch {
        if (!run.stale) setLoad({ status: 'error' });
      }
    })();
    return () => {
      run.stale = true;
    };
  }, [bridge, moduleId, attempt]);

  const detail = load.status === 'ready' ? load.detail : null;

  // First open of an unlocked module: record the start once (A7), then refresh the sidebar.
  useEffect(() => {
    if (!detail || started.current) return;
    started.current = true;
    if (detail.progress.startedAt === null && detail.module.status !== 'completed') {
      void bridge.learning
        .startModule({ moduleId })
        .then(() => learning.refresh(['overview']))
        .catch(() => undefined);
    }
  }, [detail, bridge, learning, moduleId]);

  // Answers already recorded on the server are shown again with their explanation: re-posting the
  // recorded choice returns `recorded: false` and no new fact (D6-14).
  const exercises = detail?.content.exercises ?? [];
  const recorded = detail?.progress.exerciseAnswers ?? [];
  const current = exercises[exIndex];
  const currentFeedback = current ? feedback[current.exerciseId] : undefined;
  const currentRecorded = current
    ? recorded.find((r) => r.exerciseId === current.exerciseId)
    : undefined;
  const fetchedFor = useRef(new Set<string>());
  useEffect(() => {
    if (stage !== 'practice' || !current || currentFeedback || !currentRecorded) return;
    if (fetchedFor.current.has(current.exerciseId)) return;
    fetchedFor.current.add(current.exerciseId);
    void bridge.learning
      .answerExercise({
        moduleId,
        exerciseId: current.exerciseId,
        selectedIndex: currentRecorded.selectedIndex,
      })
      .then((res) => {
        if (res.ok) setFeedback((f) => ({ ...f, [res.data.exerciseId]: res.data }));
      })
      .catch(() => undefined);
  }, [stage, current, currentFeedback, currentRecorded, bridge, moduleId]);

  // ---- derived ---------------------------------------------------------------------------------
  const video = detail?.content.video ?? null;
  const unavailable = video !== null && (video.src === null || videoFailed);
  const isVideo = detail?.module.format === 'video';
  const contentDone =
    detail?.progress.contentCompletedAt != null || detail?.module.status === 'completed';
  const canContinue = !isVideo || contentDone || watched || transcriptRead || unavailable;
  const hasExercises = exercises.length > 0;
  const passed = detail?.module.passed === true;

  const continueToQuiz = useCallback(async () => {
    if (!detail) return;
    setNotice(undefined);
    if (detail.module.passed) {
      ws.dispatch({ type: 'setStage', stage: 'quiz' });
      return;
    }
    setBusy(true);
    try {
      if (detail.progress.contentCompletedAt === null) {
        const res = await bridge.learning.completeContent({ moduleId });
        if (!res.ok) {
          if (res.error.code === 'CONTENT_INCOMPLETE') {
            const firstOpen = detail.content.exercises.findIndex(
              (e) =>
                !detail.progress.exerciseAnswers.some((a) => a.exerciseId === e.exerciseId) &&
                !feedback[e.exerciseId],
            );
            setExIndex(firstOpen >= 0 ? firstOpen : 0);
            ws.dispatch({ type: 'setStage', stage: 'practice' });
            setNotice(
              firstOpen >= 0
                ? `Answer scenario ${String(firstOpen + 1)} before the quiz.`
                : moduleActionErrorMessage(res.error),
            );
          } else {
            setNotice(moduleActionErrorMessage(res.error));
          }
          return;
        }
      }
      void learning.refresh(['overview']);
      const quiz = detail.quiz;
      if (!quiz) {
        setNotice('This module has no quiz yet.');
        return;
      }
      ws.dispatch({
        type: 'startQuiz',
        target: toQuizTarget(quiz, detail.module.position, detail.module.title),
        returnTo: { name: 'module', moduleId, stage: 'quiz' },
      });
    } catch {
      setNotice(moduleActionErrorMessage({ code: 'NETWORK_UNAVAILABLE', message: '' }));
    } finally {
      setBusy(false);
    }
  }, [detail, bridge, moduleId, learning, ws, feedback]);

  const answer = useCallback(
    async (choiceId: string) => {
      if (!current || pendingEx) return;
      setNotice(undefined);
      setPendingEx(current.exerciseId);
      try {
        const res = await bridge.learning.answerExercise({
          moduleId,
          exerciseId: current.exerciseId,
          selectedIndex: Number(choiceId),
        });
        if (res.ok) setFeedback((f) => ({ ...f, [current.exerciseId]: res.data }));
        else setNotice(moduleActionErrorMessage(res.error));
      } catch {
        setNotice(moduleActionErrorMessage({ code: 'NETWORK_UNAVAILABLE', message: '' }));
      } finally {
        setPendingEx(null);
      }
    },
    [bridge, moduleId, current, pendingEx],
  );

  const exercise = useMemo<ModulePlayerExercise | undefined>(() => {
    if (!current) return undefined;
    const fb = currentFeedback;
    const selected = fb?.selectedIndex ?? currentRecorded?.selectedIndex ?? null;
    const last = exIndex === exercises.length - 1;
    return {
      scenarioNumber: exIndex + 1,
      totalScenarios: exercises.length,
      prompt: current.prompt,
      artifact: current.artifact ?? undefined,
      choices: current.options.map((text, i) => ({ id: String(i), text })),
      selectedChoiceId: selected === null ? null : String(selected),
      correctChoiceId: fb ? String(fb.correctIndex) : undefined,
      pending: pendingEx === current.exerciseId,
      feedback: fb
        ? {
            correct: fb.correct,
            title: fb.correct ? 'Correct' : 'Not quite',
            explanation: fb.explanation,
          }
        : undefined,
      nextLabel: last ? (passed ? 'Continue' : 'Continue to quiz') : 'Next scenario',
    };
  }, [current, currentFeedback, currentRecorded, exIndex, exercises.length, pendingEx, passed]);

  // ---- sidebar ---------------------------------------------------------------------------------
  const modules = overview?.modules ?? [];
  const sidebar = modules.map(toModuleListItem);
  const finalCard = toFinalCard(overview?.finalTest ?? null, overview?.totalModules ?? 0);
  const thisModule = modules.find((m) => m.id === moduleId);

  const state: ModulePlayerState = load.status;
  const quiz = detail?.quiz ?? null;

  return (
    <ModulePlayerScreen
      state={state}
      lockedReason={thisModule ? lockReasonFor(thisModule) : undefined}
      module={
        detail
          ? {
              id: detail.module.id,
              order: detail.module.position,
              title: detail.module.title,
              format: detail.module.format,
              durationMinutes: detail.module.durationMinutes,
            }
          : undefined
      }
      totalModules={overview?.totalModules ?? modules.length}
      modules={sidebar}
      finalAssessment={{
        status: finalCard.status,
        lockedReason: finalCard.lockedReason,
        onSelect: () => {
          ws.dispatch({ type: 'nav', navId: 'final' });
        },
      }}
      stage={stage}
      notice={notice ? { tone: 'caution', text: notice } : undefined}
      lessonBody={detail?.content.body}
      keyTakeaways={detail?.content.keyTakeaways}
      video={
        video
          ? {
              src: video.src ?? undefined,
              captionsSrc: video.captionsSrc ?? undefined,
              transcript: video.transcript.map((c) => ({
                id: String(c.id),
                startSeconds: c.startSeconds,
                text: c.text,
              })),
              state: unavailable ? 'error' : 'ready',
            }
          : undefined
      }
      exercise={exercise}
      lessonAction={
        detail
          ? {
              label: hasExercises ? 'Continue to practice' : 'Continue to quiz',
              enabled: canContinue,
              reason: canContinue ? undefined : WATCH_REASON,
              busy,
            }
          : undefined
      }
      quizSummary={
        quiz
          ? {
              passed: quiz.passed,
              bestScore: quiz.bestScore,
              attempts: quiz.attempts,
              blockedReason: quiz.passed ? undefined : startBlockedReason(quiz),
            }
          : undefined
      }
      onRetry={() => {
        setAttempt((a) => a + 1);
      }}
      onSelectModule={(id) => {
        ws.dispatch({ type: 'openModule', moduleId: id });
      }}
      onLessonAction={() => {
        if (hasExercises) {
          setExIndex(0);
          ws.dispatch({ type: 'setStage', stage: 'practice' });
        } else {
          void continueToQuiz();
        }
      }}
      onStartQuiz={() => {
        void continueToQuiz();
      }}
      onSelectStage={(s) => {
        ws.dispatch({ type: 'setStage', stage: s });
      }}
      onVideoProgress={(t, d) => {
        tracker.current.update(t, d);
        if (tracker.current.watched()) setWatched(true);
      }}
      onVideoEnded={() => {
        const v = document.querySelector('video');
        if (v) tracker.current.ended(v.duration);
        if (tracker.current.watched()) setWatched(true);
      }}
      onVideoError={() => {
        setVideoFailed(true);
      }}
      onTranscriptReachedEnd={() => {
        setTranscriptRead(true);
      }}
      onExerciseAnswer={(id) => {
        void answer(id);
      }}
      onExerciseNext={() => {
        if (exIndex < exercises.length - 1) setExIndex(exIndex + 1);
        else void continueToQuiz();
      }}
      onBackToDashboard={() => {
        ws.dispatch({ type: 'nav', navId: 'dashboard' });
      }}
    />
  );
}
