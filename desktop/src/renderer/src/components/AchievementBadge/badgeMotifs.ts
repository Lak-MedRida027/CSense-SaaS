import {
  Award,
  BookOpen,
  KeyRound,
  Lock,
  Mail,
  Monitor,
  MousePointerClick,
  Shield,
  ShieldCheck,
  Star,
  Target,
  Trophy,
  Users,
  type LucideIcon,
} from '../../icons';

/**
 * Maps `BadgeDTO.iconMotif` strings to icons. Unknown motifs fall back to Award, so admins can
 * author badges before a matching icon exists.
 */
export const BADGE_MOTIFS: Readonly<Record<string, LucideIcon>> = {
  welcome: BookOpen,
  password: KeyRound,
  key: KeyRound,
  phishing: Mail,
  mail: Mail,
  'social-engineering': Users,
  users: Users,
  device: Monitor,
  lock: Lock,
  click: MousePointerClick,
  shield: Shield,
  'shield-check': ShieldCheck,
  target: Target,
  trophy: Trophy,
  star: Star,
};

export function badgeIcon(motif: string): LucideIcon {
  return BADGE_MOTIFS[motif] ?? Award;
}
