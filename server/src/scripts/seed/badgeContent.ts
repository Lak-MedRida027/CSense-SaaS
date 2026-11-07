/**
 * Development badge seed (Phase 4, ADR 0009): one badge per module, keyed by the module `order`.
 * Names avoid the level names (Apprentice ... Defender). Kept apart from the module content so the
 * two seeds change independently.
 */
export const SEED_BADGES: Readonly<Record<number, { name: string; iconMotif: string }>> = {
  1: { name: 'First Steps', iconMotif: 'welcome' },
  2: { name: 'Key Keeper', iconMotif: 'password' },
  3: { name: 'Phish Spotter', iconMotif: 'phishing' },
  4: { name: 'Pretext Proof', iconMotif: 'social-engineering' },
  5: { name: 'Safe Clicker', iconMotif: 'click' },
  6: { name: 'Device Protector', iconMotif: 'device' },
  7: { name: 'First Responder', iconMotif: 'shield-check' },
};
