import type { RiskLevel } from '../constants/risk.js';

/** Per-employee risk profile (Class UML `RiskProfile`). Sub-scores are integers 0-100. */
export interface RiskProfileDTO {
  id: string;
  userId: string;
  knowledgeScore: number;
  behaviouralScore: number;
  simulationScore: number;
  engagementScore: number;
  riskLevel: RiskLevel;
}
