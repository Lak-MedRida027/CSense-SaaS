import type { ModuleFormat, ProgressStatus } from '@csense/shared';
import { useId } from 'react';
import {
  Award,
  CircleCheck,
  Clock,
  Lock,
  MousePointerClick,
  Play,
  Circle,
  CircleDot,
  type LucideIcon,
} from '../../icons';
import { cx } from '../../lib/cx';
import cardStyles from '../Card/Card.module.css';
import { ErrorState } from '../ErrorState';
import { Skeleton, SkeletonText } from '../Skeleton';
import styles from './ModuleCard.module.css';

export interface ModuleCardData {
  id: string;
  order: number;
  title: string;
  description: string;
  format: ModuleFormat;
  /** Minutes (ModuleDTO.duration). */
  durationMinutes: number;
  status: ProgressStatus;
  /** Best quiz score, percent; shown when completed. */
  scorePercent?: number | undefined;
  /** Badge name awarded on completion. */
  badgeName?: string | undefined;
}

export interface ModuleCardProps {
  module: ModuleCardData;
  totalModules: number;
  /** Explanation shown for locked modules, e.g. "Pass the Module 2 quiz to unlock". */
  lockedReason?: string | undefined;
  /** Seam: open/resume the module. Not called for locked modules. */
  onOpen?: ((id: string) => void) | undefined;
  state?: 'ready' | 'loading' | 'error' | undefined;
  onRetry?: (() => void) | undefined;
  headingLevel?: 2 | 3 | undefined;
  className?: string | undefined;
}

const STATUS: Record<ProgressStatus, { label: string; icon: LucideIcon; tone: string }> = {
  locked: { label: 'Locked', icon: Lock, tone: 'neutral' },
  unlocked: { label: 'Ready to start', icon: Circle, tone: 'info' },
  in_progress: { label: 'In progress', icon: CircleDot, tone: 'info' },
  completed: { label: 'Completed', icon: CircleCheck, tone: 'success' },
};

const FORMAT: Record<ModuleFormat, { label: string; icon: LucideIcon }> = {
  video: { label: 'Video', icon: Play },
  interactive: { label: 'Interactive', icon: MousePointerClick },
};

/**
 * Module tile. Locked modules stay visible and focusable (aria-disabled) with the unlock rule in
 * text, so the sequential path is always clear.
 */
export function ModuleCard({
  module,
  totalModules,
  lockedReason,
  onOpen,
  state = 'ready',
  onRetry,
  headingLevel = 3,
  className,
}: ModuleCardProps) {
  const reasonId = useId();
  const Heading = `h${headingLevel}` as const;

  if (state === 'loading') {
    return (
      <article className={cx(cardStyles.root, styles.root, className)} aria-busy="true">
        <Skeleton shape="text" width="40%" />
        <Skeleton shape="text" width="80%" height="1.25rem" />
        <SkeletonText lines={2} />
        <span className="sr-only">Loading module</span>
      </article>
    );
  }
  if (state === 'error') {
    return (
      <article className={cx(cardStyles.root, styles.root, className)}>
        <ErrorState description="This module could not be loaded." onRetry={onRetry} compact />
      </article>
    );
  }

  const locked = module.status === 'locked';
  const status = STATUS[module.status];
  const StatusIcon = status.icon;
  const format = FORMAT[module.format];
  const FormatIcon = format.icon;
  const actionVerb =
    module.status === 'in_progress' ? 'Resume' : module.status === 'completed' ? 'Review' : 'Start';

  return (
    <article
      className={cx(
        cardStyles.root,
        styles.root,
        locked ? styles.locked : cardStyles.interactive,
        module.status === 'completed' && styles.completed,
        className,
      )}
    >
      <p className={styles.eyebrow}>
        Module {module.order} of {totalModules}
      </p>
      <Heading className={styles.title}>
        {onOpen ? (
          <button
            type="button"
            className={cx(styles.titleButton, cardStyles.stretch)}
            aria-disabled={locked || undefined}
            aria-describedby={locked && lockedReason ? reasonId : undefined}
            onClick={() => {
              if (!locked) onOpen(module.id);
            }}
          >
            {module.title}
            <span className="sr-only">
              {locked ? ', locked' : `, ${actionVerb.toLowerCase()} module`}
            </span>
          </button>
        ) : (
          module.title
        )}
      </Heading>
      <p className={styles.description}>{module.description}</p>
      <ul className={styles.meta}>
        <li>
          <FormatIcon aria-hidden="true" size={14} />
          {format.label}
        </li>
        <li>
          <Clock aria-hidden="true" size={14} />
          About {module.durationMinutes} min
        </li>
      </ul>
      <div className={styles.footer}>
        <span className={styles.status} data-tone={status.tone}>
          <StatusIcon aria-hidden="true" size={16} />
          {status.label}
          {module.status === 'completed' && module.scorePercent !== undefined && (
            <span className={styles.score}> · {module.scorePercent}%</span>
          )}
        </span>
        {module.status === 'completed' && module.badgeName && (
          <span className={styles.badge}>
            <Award aria-hidden="true" size={14} />
            {module.badgeName}
          </span>
        )}
      </div>
      {locked && lockedReason && (
        <p id={reasonId} className={styles.reason}>
          <Lock aria-hidden="true" size={14} />
          {lockedReason}
        </p>
      )}
    </article>
  );
}
