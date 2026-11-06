# Screens

Skeletons live in `desktop/src/renderer/src/screens/<Screen>/` with `*.types.ts` (props and
callback seams) and `*.fixtures.ts` (placeholder data). Preview each at `#/preview/<id>/<variant>`
in a dev build. Engineers replace fixtures with real data and wire the `on*` callbacks.

Decisions applied: D1 7 modules (count comes from data), D3/D4 gate = sign-in + one check question
with 3 attempts, D5 leaving a quiz counts as an attempt, D6 quiz feedback at review only, D7 quiz
unlock rule decided outside the UI (`canStartQuiz`), D13 dark default, D16 phishing behind a flag,
D17 employees do not see their own risk, D18 password reset via administrator.

## 1. Pre-access security gate (`SecurityGateScreen`, `security-gate`)
```
[logo] CSense                                            [lock] Workstation locked
          (✓) Sign in ── (2) Security check ── (3) Access granted
          +-----------------------------------------------------+
          | Security check                                      |
          | Before you continue, answer today's awareness check.|
          | <question as fieldset legend>                       |
          | (A) ...   (B) ...   (C) ...                         |
          | [x Not quite: explanation]          (after a miss)  |
          | ●○○ ⚠ Last attempt: 1 of 3 remaining  [Submit answer]|
          +-----------------------------------------------------+
Restricted: ⬣ Access restricted · security team notified · Reference GATE-... · no retry.
Granted:    🛡 Access granted · [Continue now] · optional auto-continue (never required).
```
Seams: `onSubmitGateAnswer(optionId)`, `onContinue()`, `restricted.onContactSecurityTeam()`.
Props: `state`, `attemptsRemaining`, `maxAttempts`, `feedback`, `autoContinueMs`.
Focus moves to each state's heading; attempts changes are announced politely.

## 2. Login (`LoginScreen`, `login`)
```
[logo]                                                   [lock] Workstation locked
          (1) Sign in ── (2) Security check ── (3) Access granted
          Sign in
          [⬣ Email or password is incorrect.]   (generic, focus moves here)
          Work email  [ name@company.com      ]
          Password    [ ••••••••        ] [eye]   ⚠ Caps Lock is on
          [            Sign in             ]
          Forgot your password? Contact your administrator.
Footer: Accounts are created by <org>'s security team.
```
No registration and no self-service reset anywhere. Seam: `onSubmitCredentials({email, password})`.

## 3. Onboarding (`OnboardingScreen`, `onboarding`)
Four steps, one idea each, Skip always available: Welcome, How it works (modules, pass mark from
props, XP/badges), Your progress (ladder + example badges), Make it comfortable (theme, reduce motion,
text size; previewed live). Last step: `[Start Module 1]` -> `onComplete(preferences)`. `onSkip()`.

## 4. Module player (`ModulePlayerScreen`, `module-player`)
```
+--------------+--------------------------------------------------------------+
| ← Dashboard  | Module 3 of 7                                [▶ Video · ~12 min] |
| MODULES      | Phishing                                                     |
| ✓ 1 Welcome  | (1) Lesson ── (2) Practice ── (3) Quiz                       |
| ✓ 2 Passwords| +----------------------------------------------------------+ |
| ▶ 3 Phishing | |                     video 16:9                           | |
| 🔒 4 ...     | | [▶] 0:00 / 8:40 [======-----] [vol] [CC] [transcript]     | |
| 🔒 ...       | +----------------------------------------------------------+ |
| 🔒 Final     | ▸ Key takeaways                     [Continue to practice →] |
+--------------+--------------------------------------------------------------+
```
Interactive variant: scenario artefact (mock SMS/email), choices as QuizOptions, immediate
FeedbackPanel, choices lock, `[Next scenario]` soft-disabled until answered.
Locked modules stay visible and focusable with "Pass the Module N quiz to unlock".
Seams: `onSelectModule`, `onStartQuiz`, `onContinueToPractice`, `onVideoProgress`, `onVideoEnded`,
`onExerciseAnswer`, `onExerciseNext`, `onBackToDashboard`. Gate for the quiz: `canStartQuiz` +
`quizLockedReason`.

## 5. Quiz and final assessment (`QuizScreen`, `quiz`)
```
Intro (no lockdown yet):  Ready for the quiz? 5 questions · 70% to pass
                          [lock] The quiz runs in secure mode: no copy/paste, app switching or
                          shortcuts until you submit or choose Exit quiz.   [Start secure quiz]
Active:
+==========================================================================+
| [lock] SECURE QUIZ MODE IS ON · Shortcuts, clipboard and other apps are   |
|        restricted until you submit.                          [Exit quiz]  |
+==========================================================================+
  Module 3 quiz: Phishing      [====------] 2 of 5 answered
  QUESTION 2 OF 5
  <stem>
  (A) ...  (B) ...  (●C) ...
  [← Back]                                            [Next question →]
```
- Questions render only when `lockdownState === 'active'`; entering/exiting/failed show a
  status view. A persistent info-blue frame and banner make secure mode obvious.
- Exit: Esc is blocked during lockdown, so `[Exit quiz]` is always visible and keyboard-reachable.
  It opens an alertdialog ("Leave the quiz? ... counts as an attempt", Keep going focused).
- Review and submit lists answered/unanswered (caution alert for gaps), then `[Submit answers]`.
- Result: ScoreSummary (score, Passed/Not passed, pass mark from props, XP, badge), then
  `[Review answers]` and `[Continue]` or `[Retry quiz]`. Answer review shows "Your answer" /
  "Correct answer" tags and explanations.
- Final assessment: same flow, 15 questions, QuestionNavigator grid.
Seams: `onRequestStartLockdown`, `onAnswer`, `onNavigate`, `onRequestSubmitReview`,
`onBackToQuestions`, `onSubmit`, `onConfirmExit`, `onReviewAnswers`, `onBackToResult`, `onRetry`,
`onContinue`, `onBackToModule`.

## 6. Employee dashboard (`EmployeeDashboardScreen`, `employee-dashboard`)
```
| sidebar | Good to see you, Amina                                           |
|         | [Your level: (XP ring) L3 Practitioner · 760 XP to Guardian]     |
|         | [Up next: Module 4 · Social engineering        [Resume module →]] |
|         | Your modules                         [=====---] 3 of 7 complete  |
|         | [✓ 1][✓ 2][✓ 3][◉ 4][🔒 5][🔒 6][🔒 7]                           |
|         | Badges (3 of 7)  [🏅][🏅][🏅][○][○][○][○]                          |
|         | Level ladder  L1 ✓ · L2 ✓ · L3 current · L4 locked · L5 locked    |
|         | Final assessment  🔒 Unlocks after all 7 modules                   |
```
One primary action (Resume). First-run variant greets and points at Module 1. No risk shown (D17).
Seams: `onOpenModule`, `onOpenBadge`, `onStartFinalAssessment`, `onNavigate`, `onOpenSettings`,
`onSignOut`.

## 7. Admin dashboard (`AdminDashboardScreen`, `admin-dashboard`)
```
| ADMIN sidebar (Overview, Employees, Modules, Final assessment, Risk and governance (3),
|   Phishing simulations*, Reports, User accounts)        * only with featureFlags.phishing
| Overview                                                    [Generate report]
| [Training completion 62% ↑+4%] [Avg quiz 78%] [⬣ High-risk 9 people] [⚠ Open escalations 3]
| Completion by module (bars + values, View as table)
| [Search] [All departments ▾] [All risk bands ▾] [Clear filters]
| Employee progress (128): Name | Department | Modules | Level | Last active | Risk  (sortable)
|                                                                  ‹ 1 2 3 … 22 ›
| Risk scoreboard (expand row -> 4 weighted dimensions) | Escalations (Critical: ... [Review])
```
Seams: `onSortChange`, `onFilterChange`, `onPageChange`, `onOpenEmployee`, `onReviewEscalation`,
`onGenerateReport(kindId)` (dialog with report types), `onOpenKpi`, `onNavigate`, `onRetry(section)`.
