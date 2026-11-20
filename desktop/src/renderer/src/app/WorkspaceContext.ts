import { createContext, useContext } from 'react';
import type { StatusTone } from '../design/tokens';
import type { Achievements } from './learning/achievements';
import type { NavAction } from './navigation';

/** What containers may ask of the workspace shell, so nothing is prop-drilled (plan 7.1). */
export interface WorkspaceActions {
  dispatch: (action: NavAction) => void;
  openSettings: () => void;
  signOut: () => void;
  /** Shown on the dashboard in one dialog when the user returns there (plan 7.5). */
  queueAchievements: (a: Achievements) => void;
  toast: (tone: StatusTone, message: string) => void;
}

export const WorkspaceContext = createContext<WorkspaceActions | null>(null);

export function useWorkspace(): WorkspaceActions {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('Workspace is missing');
  return ctx;
}
