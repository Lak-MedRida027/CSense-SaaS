import { LEVELS, RISK_LEVELS } from '@csense/shared';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { LevelChip } from '../../components/LevelChip';
import { RiskChip } from '../../components/RiskChip';
import { useTheme } from '../../design/theme/useTheme';
import { theme, STATUS_TONES } from '../../design/tokens';
import { AA_NON_TEXT, AA_TEXT, contrastRatio } from '../../design/tokens/contrast';
import { cssVar } from '../../design/tokens/toCss';
import { statusIcon } from '../../icons';
import { cx } from '../../lib/cx';
import { ComponentGallery } from './ComponentGallery';
import { SCREENS } from './screenRegistry';
import { StyleguideToolbar } from './StyleguideToolbar';
import styles from './Styleguide.module.css';

const SECTIONS = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'components', label: 'Components' },
  { id: 'screens', label: 'Screens' },
] as const;

function Ratio({ fg, bg, min }: { fg: string; bg: string; min: number }) {
  const r = contrastRatio(fg, bg);
  const pass = r >= min;
  return (
    <span className={cx(styles.ratio, pass ? styles.pass : styles.fail)}>
      {r.toFixed(2)}:1 {pass ? 'AA pass' : 'AA fail'}
    </span>
  );
}

function Swatch({
  name,
  value,
  bg,
  min,
}: {
  name: string;
  value: string;
  bg?: string;
  min?: number;
}) {
  return (
    <li className={styles.swatch}>
      <span className={styles.chip} style={{ background: value }} aria-hidden="true" />
      <span className={styles.swatchName}>{name}</span>
      <code className={styles.swatchValue}>{value}</code>
      {bg && min !== undefined && value.startsWith('#') && <Ratio fg={value} bg={bg} min={min} />}
    </li>
  );
}

function TokensSection() {
  const { resolvedTheme } = useTheme();
  const c = theme.color[resolvedTheme];
  const [motionKey, setMotionKey] = useState(0);
  return (
    <div className={styles.sections}>
      <section aria-labelledby="sg-surfaces">
        <h2 id="sg-surfaces" className={styles.h2}>
          Surfaces, text and borders ({resolvedTheme})
        </h2>
        <p className={styles.note}>Contrast ratios are measured against surface-1 (cards).</p>
        <ul className={styles.swatches}>
          {Object.entries(c.surface).map(([k, v]) => (
            <Swatch key={k} name={`surface-${k}`} value={v} />
          ))}
          {(['primary', 'secondary', 'muted'] as const).map((k) => (
            <Swatch key={k} name={`text-${k}`} value={c.text[k]} bg={c.surface.s1} min={AA_TEXT} />
          ))}
          <Swatch
            name="border-strong"
            value={c.border.strong}
            bg={c.surface.s1}
            min={AA_NON_TEXT}
          />
          <Swatch name="focus-ring" value={c.focusRing} bg={c.surface.s1} min={AA_NON_TEXT} />
        </ul>
      </section>

      <section aria-labelledby="sg-status">
        <h2 id="sg-status" className={styles.h2}>
          Status (blue info, green success, amber caution, red critical)
        </h2>
        <ul className={styles.statusGrid}>
          {STATUS_TONES.map((tone) => {
            const Icon = statusIcon[tone];
            const st = c.status[tone];
            return (
              <li key={tone} className={styles.statusCard} data-tone={tone}>
                <span className={styles.statusLabel}>
                  <Icon aria-hidden="true" size={18} /> {tone}
                </span>
                <span>
                  fg <Ratio fg={st.fg} bg={c.surface.s1} min={AA_TEXT} />
                </span>
                <span>
                  chip <Ratio fg={st.subtleFg} bg={st.subtleBg} min={AA_TEXT} />
                </span>
                <span>
                  solid <Ratio fg={st.onSolid} bg={st.solid} min={AA_TEXT} />
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="sg-risk">
        <h2 id="sg-risk" className={styles.h2}>
          Risk bands and levels
        </h2>
        <div className={styles.row}>
          {RISK_LEVELS.map((r) => (
            <RiskChip key={r} level={r} showGovernance />
          ))}
          <RiskChip level={null} />
        </div>
        <div className={styles.row}>
          {LEVELS.map((l) => (
            <LevelChip key={l} level={l} />
          ))}
        </div>
        <ul className={styles.swatches}>
          {LEVELS.map((l) => (
            <Swatch
              key={l}
              name={l}
              value={theme.level[resolvedTheme][l].fg}
              bg={c.surface.s1}
              min={AA_TEXT}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="sg-type">
        <h2 id="sg-type" className={styles.h2}>
          Type scale (Inter, JetBrains Mono)
        </h2>
        <ul className={styles.typeList}>
          {Object.entries(theme.font.scale).map(([k, v]) => (
            <li
              key={k}
              style={{
                fontSize: cssVar('font', 'size', k),
                lineHeight: cssVar('line', 'height', k),
              }}
            >
              <code className={styles.typeMeta}>
                {k} {v.size}/{v.lineHeight}
              </code>{' '}
              Spot the phish before it spots you
            </li>
          ))}
        </ul>
        <p>
          <code>monospace: dhl-redelivery.co/track?id=8812</code>
        </p>
      </section>

      <section aria-labelledby="sg-space">
        <h2 id="sg-space" className={styles.h2}>
          Spacing, radius and elevation
        </h2>
        <ul className={styles.spaceList}>
          {Object.entries(theme.space).map(([k, v]) => (
            <li key={k}>
              <code className={styles.typeMeta}>
                space-{k} {v}
              </code>
              <span
                className={styles.spaceBar}
                style={{ width: cssVar('space', k) }}
                aria-hidden="true"
              />
            </li>
          ))}
        </ul>
        <div className={styles.row}>
          {Object.keys(theme.radius).map((k) => (
            <span
              key={k}
              className={styles.radiusBox}
              style={{ borderRadius: cssVar('radius', k) }}
            >
              radius-{k}
            </span>
          ))}
        </div>
        <div className={styles.row}>
          {(['e0', 'e1', 'e2', 'e3', 'e4'] as const).map((k) => (
            <span key={k} className={styles.radiusBox} style={{ boxShadow: cssVar('shadow', k) }}>
              {k}
            </span>
          ))}
        </div>
      </section>

      <section aria-labelledby="sg-motion">
        <h2 id="sg-motion" className={styles.h2}>
          Motion
        </h2>
        <p className={styles.note}>
          Durations collapse under reduced motion (OS setting or the toolbar toggle); colour and
          opacity fades keep the 120ms fast duration.
        </p>
        <ul className={styles.motionList}>
          {Object.entries(theme.motion.duration).map(([k, v]) => (
            <li key={k}>
              <code className={styles.typeMeta}>
                {k} {v}
              </code>
              <span
                key={motionKey}
                className={styles.motionDot}
                style={{ animationDuration: cssVar('duration', k) }}
                aria-hidden="true"
              />
            </li>
          ))}
        </ul>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setMotionKey((n) => n + 1);
          }}
        >
          Replay motion
        </Button>
      </section>
    </div>
  );
}

function ScreensSection() {
  return (
    <ul className={styles.screenList}>
      {SCREENS.map((s) => (
        <li key={s.id} className={styles.screenCard}>
          <h2 className={styles.h3}>{s.label}</h2>
          <ul className={styles.variantList}>
            {s.variants.map((v) => (
              <li key={v.id}>
                <a href={`#/preview/${s.id}/${v.id}`}>{v.label}</a>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export interface StyleguidePageProps {
  section: string;
}

/** Dev-only design system preview: tokens, every component state, and screen fixtures. */
export function StyleguidePage({ section }: StyleguidePageProps) {
  const current = SECTIONS.find((s) => s.id === section)?.id ?? 'tokens';
  return (
    <>
      <StyleguideToolbar>
        <span className={styles.toolbarTitle}>CSense design system</span>
        <nav aria-label="Styleguide sections" className={styles.variants}>
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#/styleguide/${s.id}`}
              aria-current={s.id === current ? 'page' : undefined}
              className={styles.variantLink}
            >
              {s.label}
            </a>
          ))}
        </nav>
      </StyleguideToolbar>
      <main className={styles.page}>
        <h1 className={styles.h1}>{SECTIONS.find((s) => s.id === current)?.label}</h1>
        {current === 'tokens' && <TokensSection />}
        {current === 'components' && <ComponentGallery />}
        {current === 'screens' && <ScreensSection />}
      </main>
    </>
  );
}
