import type { AchievementBadgeData } from '../../components/AchievementBadge';
import type { EmployeePageProps } from '../employeeNav';

export interface BadgesScreenProps extends EmployeePageProps {
  badges: readonly AchievementBadgeData[];
}
