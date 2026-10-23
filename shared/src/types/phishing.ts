import type { PhishingStatus } from '../constants/enums.js';

/** Phishing campaign (Class UML `PhishingSimulation`, behind FEATURE_PHISHING). */
export interface PhishingSimulationDTO {
  id: string;
  campaignName: string;
  emailTemplate: string;
  status: PhishingStatus;
  deployedAt?: string;
  /** Not in diagram: derived from the Administrator "configures" association. */
  configuredBy: string;
}
