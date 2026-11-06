import type { ProgressStatus } from '@csense/shared';
import { useId } from 'react';
import {
  CircleCheck,
  CircleDot,
  Circle,
  GraduationCap,
  Lock,
  Play,
  type LucideIcon,
} from '../../icons';
import { cx } from '../../lib/cx';
import { SkeletonText } from '../Skeleton';
import { Tooltip } from '../Tooltip';
import styles from './ModuleList.module.css';

export interface ModuleListItem {
  id: string;
  order: number;
  title: string;
  status: ProgressStatus;
  /** Shown for locked items, e.g. "Pass the Module 3 quiz to unlock". */
  lockedReason?: string | undefined;
}

export interface ModuleListProps {
  modules: readonly ModuleListItem[];
  /** Module currently open in the player. */
  currentId?: string | undefined;
  /** Seam: navigate to a module (never called for locked items). */
  onSelect: (id: string) => void;
  /** Final assessment entry at the end of the list. */
  finalAssessment?:
    | {
        status: ProgressStatus;
        lockedReason?: string | undefined;
        onSelect?: (() => void) | undefined;
      }
    | undefined;
  loading?: boolean | undefined;
  className?: string | undefined;
}

const ICON: Record<ProgressStatus, LucideIcon> = {
  locked: Lock,
  unlocked: Circle,
  in_progress: CircleDot,
  completed: CircleCheck,
};

const STATUS_TEXT: Record<ProgressStatus, string> = {
  locked: 'locked',
  unlocked: 'not started',
  in_progress: 'in progress',
  completed: 'completed',
};

/**
 * Sidebar list for the module player. Locked modules are visible and focusable with the
 * unlock rule as their description, never hidden.
 */
export function ModuleList({
  modules,
  currentId,
  onSelect,
  finalAssessment,
  loading = false,
  className,
}: ModuleListProps) {
  const baseId = useId();
  if (loading) {
    return (
      <nav aria-label="Modules" aria-busy="true" className={cx(styles.nav, className)}>
        <SkeletonText lines={7} />
        <span className="sr-only">Loading modules</span>
      </nav>
    );
  }

  const renderItem = (
    key: string,
    label: string,
    status: ProgressStatus,
    current: boolean,
    lockedReason: string | undefined,
    onClick: (() => void) | undefined,
    Icon: LucideIcon,
  ) => {
    const locked = status === 'locked';
    const reasonId = `${baseId}-${key}-reason`;
    const button = (
      <button
        type="button"
        className={cx(styles.item, styles[status], current && styles.current)}
        aria-current={current ? 'page' : undefined}
        aria-disabled={locked || undefined}
        aria-describedby={locked && lockedReason ? reasonId : undefined}
        onClick={() => {
          if (!locked) onClick?.();
        }}
      >
        <Icon aria-hidden="true" size={16} className={styles.icon} />
        <span className={styles.label}>{label}</span>
        <span className="sr-only">, {STATUS_TEXT[status]}</span>
      </button>
    );
    return (
      <li key={key}>
        {locked && lockedReason ? (
          <Tooltip
            content={lockedReason}
            mode="visual"
            placement="bottom"
            className={styles.tipWrap}
          >
            {button}
          </Tooltip>
        ) : (
          button
        )}
        {locked && lockedReason && (
          <span id={reasonId} className="sr-only">
            {lockedReason}
          </span>
        )}
      </li>
    );
  };

  return (
    <nav aria-label="Modules" className={cx(styles.nav, className)}>
      <ol className={styles.list}>
        {modules.map((m) =>
          renderItem(
            m.id,
            `${m.order} ${m.title}`,
            m.status,
            m.id === currentId,
            m.lockedReason,
            () => {
              onSelect(m.id);
            },
            m.id === currentId && m.status !== 'completed' ? Play : ICON[m.status],
          ),
        )}
        {finalAssessment &&
          renderItem(
            'final',
            'Final assessment',
            finalAssessment.status,
            false,
            finalAssessment.lockedReason,
            finalAssessment.onSelect,
            finalAssessment.status === 'locked' ? Lock : GraduationCap,
          )}
      </ol>
    </nav>
  );
}
