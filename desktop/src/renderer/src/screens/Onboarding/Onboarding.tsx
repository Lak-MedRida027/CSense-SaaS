import { useEffect, useId, useRef, useState } from 'react';
import { BadgeGrid } from '../../components/BadgeGrid';
import { Button } from '../../components/Button';
import { LevelLadder } from '../../components/LevelLadder';
import { RadioGroup } from '../../components/RadioGroup';
import { Switch } from '../../components/Switch';
import { DEFAULT_PREFERENCES, type DisplayPreferences } from '../../design/theme/ThemeContext';
import { useTheme } from '../../design/theme/useTheme';
import { ArrowLeft, ArrowRight, BookOpen, ClipboardCheck, ShieldCheck, Trophy } from '../../icons';
import { GateShell } from '../../layouts/GateShell';
import type { OnboardingScreenProps } from './Onboarding.types';
import styles from './Onboarding.module.css';

const STEP_COUNT = 4;

/**
 * First-run guided intro: four short steps, one idea each, skippable at any point. The last step
 * sets display preferences, previewed live through the ThemeProvider.
 */
export function OnboardingScreen({
  employeeName,
  moduleCount,
  passMarkPercent,
  levels,
  initialPreferences,
  onComplete,
  onSkip,
}: OnboardingScreenProps) {
  const { setPreferences, preferences: active } = useTheme();
  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState<DisplayPreferences>({
    ...DEFAULT_PREFERENCES,
    ...active,
    ...initialPreferences,
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const headingId = useId();

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const update = (next: Partial<DisplayPreferences>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    setPreferences(next);
  };

  const last = step === STEP_COUNT - 1;

  const steps = [
    {
      title: `Welcome to CSense, ${employeeName}`,
      body: (
        <>
          <p className={styles.lead}>
            Most security incidents start with a single click. CSense helps you spot the warning
            signs in a few short, practical modules.
          </p>
          <ul className={styles.points}>
            <li>
              <ShieldCheck aria-hidden="true" size={20} /> Learn to recognise phishing, scams and
              risky habits
            </li>
            <li>
              <ClipboardCheck aria-hidden="true" size={20} /> Practise with real-world scenarios
            </li>
          </ul>
        </>
      ),
    },
    {
      title: 'How your training works',
      body: (
        <ol className={styles.numbered}>
          <li>
            <BookOpen aria-hidden="true" size={20} />
            Watch or play through each of the {moduleCount} modules.
          </li>
          <li>
            <ClipboardCheck aria-hidden="true" size={20} />
            Pass its short quiz ({passMarkPercent}% to pass) to unlock the next one.
          </li>
          <li>
            <Trophy aria-hidden="true" size={20} />
            Earn XP, level up and collect a badge for every module.
          </li>
        </ol>
      ),
    },
    {
      title: 'Your progress',
      body: (
        <>
          <p className={styles.lead}>
            You start as an Apprentice. Every module you complete moves you up the ladder.
          </p>
          <LevelLadder currentLevel={levels[0] ?? 'Apprentice'} />
          <BadgeGrid
            label="Example badges"
            badges={[
              {
                id: 'ex1',
                name: 'First Steps',
                motif: 'welcome',
                moduleTitle: 'Module 1',
                earned: false,
              },
              {
                id: 'ex2',
                name: 'Key Keeper',
                motif: 'password',
                moduleTitle: 'Module 2',
                earned: false,
              },
              {
                id: 'ex3',
                name: 'Phish Spotter',
                motif: 'phishing',
                moduleTitle: 'Module 3',
                earned: false,
              },
            ]}
          />
        </>
      ),
    },
    {
      title: 'Make it comfortable',
      body: (
        <div className={styles.prefs}>
          <RadioGroup
            legend="Theme"
            orientation="horizontal"
            value={prefs.theme}
            onChange={(v) => {
              update({ theme: v as DisplayPreferences['theme'] });
            }}
            options={[
              { value: 'dark', label: 'Dark (default)' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'Match my computer' },
            ]}
          />
          <Switch
            label="Reduce motion"
            description="Turns off animations such as badge celebrations."
            checked={prefs.motion === 'reduced'}
            onChange={(on) => {
              update({ motion: on ? 'reduced' : 'system' });
            }}
          />
          <RadioGroup
            legend="Text size"
            orientation="horizontal"
            value={prefs.textSize}
            onChange={(v) => {
              update({ textSize: v as DisplayPreferences['textSize'] });
            }}
            options={[
              { value: 'default', label: 'Default' },
              { value: 'large', label: 'Large' },
              { value: 'larger', label: 'Larger' },
            ]}
          />
          <p className={styles.note}>You can change these later in Settings.</p>
        </div>
      ),
    },
  ];

  const current = steps[step] ?? steps[0];

  return (
    <GateShell statusText={`Step ${step + 1} of ${STEP_COUNT}`} statusIcon={BookOpen}>
      <section className={styles.panel} aria-labelledby={headingId}>
        <div className={styles.progress} aria-hidden="true">
          {Array.from({ length: STEP_COUNT }, (_, i) => (
            <span key={i} className={i <= step ? styles.dotOn : styles.dot} />
          ))}
        </div>
        <p className="sr-only" aria-live="polite">
          Step {step + 1} of {STEP_COUNT}
        </p>
        <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.heading}>
          {current?.title}
        </h1>
        <div className={styles.body}>{current?.body}</div>
        <div className={styles.actions}>
          {step > 0 ? (
            <Button
              variant="ghost"
              iconStart={ArrowLeft}
              onClick={() => {
                setStep((s) => s - 1);
              }}
            >
              Back
            </Button>
          ) : (
            <span />
          )}
          <div className={styles.right}>
            {!last && (
              <Button variant="secondary" onClick={onSkip}>
                Skip intro
              </Button>
            )}
            {last ? (
              <Button
                iconEnd={ArrowRight}
                onClick={() => {
                  onComplete(prefs);
                }}
              >
                Start Module 1
              </Button>
            ) : (
              <Button
                iconEnd={ArrowRight}
                onClick={() => {
                  setStep((s) => s + 1);
                }}
              >
                Next
              </Button>
            )}
          </div>
        </div>
      </section>
    </GateShell>
  );
}
