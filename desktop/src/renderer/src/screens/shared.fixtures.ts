/**
 * Placeholder data shared by several screen fixtures. Titles follow the assumed 7-module set
 * (CLAUDE.md open question) and are illustrative only; real content comes from the API.
 */
import type { AchievementBadgeData } from '../components/AchievementBadge';
import type { ModuleCardData } from '../components/ModuleCard';
import type { ModuleListItem } from '../components/ModuleList';

export const placeholder = (): void => undefined;

export const fixtureModules: readonly ModuleCardData[] = [
  {
    id: 'm1',
    order: 1,
    title: 'Welcome to CSense',
    description: 'What CSense is, why awareness matters, and how your training works.',
    format: 'video',
    durationMinutes: 6,
    status: 'completed',
    scorePercent: 100,
    badgeName: 'First Steps',
  },
  {
    id: 'm2',
    order: 2,
    title: 'Passwords and authentication',
    description: 'Strong passphrases, password managers and multi-factor authentication.',
    format: 'interactive',
    durationMinutes: 12,
    status: 'completed',
    scorePercent: 80,
    badgeName: 'Key Keeper',
  },
  {
    id: 'm3',
    order: 3,
    title: 'Phishing',
    description: 'Spot suspicious emails, links and attachments before you click.',
    format: 'video',
    durationMinutes: 12,
    status: 'completed',
    scorePercent: 80,
    badgeName: 'Phish Spotter',
  },
  {
    id: 'm4',
    order: 4,
    title: 'Social engineering',
    description: 'Pretexting, phone scams and manipulation tactics, and how to respond.',
    format: 'interactive',
    durationMinutes: 10,
    status: 'in_progress',
  },
  {
    id: 'm5',
    order: 5,
    title: 'Safe browsing and downloads',
    description: 'Recognise unsafe sites, fake updates and risky downloads.',
    format: 'video',
    durationMinutes: 9,
    status: 'locked',
  },
  {
    id: 'm6',
    order: 6,
    title: 'Protecting devices and data',
    description: 'Locking screens, removable media, public Wi-Fi and data handling.',
    format: 'interactive',
    durationMinutes: 11,
    status: 'locked',
  },
  {
    id: 'm7',
    order: 7,
    title: 'Reporting incidents',
    description: 'What to report, how to report it, and why speed matters.',
    format: 'video',
    durationMinutes: 7,
    status: 'locked',
  },
];

export function lockedReasonFor(order: number): string {
  return `Pass the Module ${order - 1} quiz to unlock`;
}

export const fixtureModuleList: readonly ModuleListItem[] = fixtureModules.map((m) => ({
  id: m.id,
  order: m.order,
  title: m.title,
  status: m.status,
  lockedReason: m.status === 'locked' ? lockedReasonFor(m.order) : undefined,
}));

const BADGE_MOTIF: Record<string, string> = {
  m1: 'welcome',
  m2: 'password',
  m3: 'phishing',
  m4: 'social-engineering',
  m5: 'click',
  m6: 'device',
  m7: 'shield-check',
};

const BADGE_NAMES: Record<string, string> = {
  m1: 'First Steps',
  m2: 'Key Keeper',
  m3: 'Phish Spotter',
  m4: 'Smooth-Talk Shield',
  m5: 'Safe Surfer',
  m6: 'Device Defender',
  m7: 'First Responder',
};

export const fixtureBadges: readonly AchievementBadgeData[] = fixtureModules.map((m, i) => ({
  id: `b${m.order}`,
  name: BADGE_NAMES[m.id] ?? `Module ${m.order} badge`,
  motif: BADGE_MOTIF[m.id] ?? 'shield',
  moduleTitle: m.title,
  earned: m.status === 'completed',
  earnedAt: m.status === 'completed' ? `2026-10-${String(10 + i * 3).padStart(2, '0')}` : undefined,
}));
