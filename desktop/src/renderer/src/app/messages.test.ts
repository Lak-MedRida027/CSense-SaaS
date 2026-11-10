import { describe, expect, it } from 'vitest';
import {
  abandonedResult,
  endedMessage,
  loginErrorMessage,
  quizStartErrorMessage,
  toQuizResult,
  violationMessage,
} from './messages';
import { attemptDto } from './testing/fakeBridge';

describe('messages', () => {
  it('login errors never distinguish unknown accounts from wrong passwords', () => {
    const a = loginErrorMessage({ code: 'INVALID_CREDENTIALS', message: 'x' });
    const b = loginErrorMessage({ code: 'INVALID_INPUT', message: 'x' });
    expect(a).toBe(b);
    expect(a).not.toMatch(/account|exist|unknown|deactivated/i);
  });

  it('violation copy', () => {
    expect(violationMessage(null)).toBeUndefined();
    expect(violationMessage({ kind: 'focus_lost', remaining: 1 })).toBe(
      'You left secure mode. Leaving 1 more time ends this attempt.',
    );
    expect(violationMessage({ kind: 'devtools', remaining: 3 })).toMatch(/Developer tools/);
    expect(violationMessage({ kind: 'blocked_shortcut', remaining: 3 })).toMatch(/shortcut/);
  });

  it('ended copy names the focus policy', () => {
    expect(endedMessage('focus_lost')).toBe('This attempt ended because CSense lost focus.');
  });

  it('maps an AttemptResultDTO to the quiz result (xp, badge)', () => {
    expect(
      toQuizResult(
        attemptDto({
          score: 80,
          correctCount: 4,
          totalCount: 5,
          effects: { xpEarned: 150, badge: { id: 'b1', name: 'Phish Spotter', iconMotif: 'hook' } },
        }),
        'Module 1',
      ),
    ).toEqual({
      scorePercent: 80,
      passed: true,
      correctCount: 4,
      totalCount: 5,
      xpEarned: 150,
      badge: {
        id: 'b1',
        name: 'Phish Spotter',
        motif: 'hook',
        moduleTitle: 'Module 1',
        earned: true,
      },
    });
    expect(toQuizResult(attemptDto({ effects: {} }), 'M').xpEarned).toBeUndefined();
    expect(abandonedResult(5)).toEqual({
      scorePercent: 0,
      passed: false,
      correctCount: 0,
      totalCount: 5,
    });
  });

  it('quiz start errors', () => {
    expect(quizStartErrorMessage({ code: 'ALREADY_PASSED', message: '' })).toMatch(
      /already passed/,
    );
    expect(quizStartErrorMessage({ code: 'RATE_LIMITED', message: '' })).toMatch(/Too many/);
  });
});
