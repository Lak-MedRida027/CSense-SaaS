import { describe, expect, it } from 'vitest';
import { GateQuestion } from '../src/models/index.js';
import { SEED_GATE_QUESTIONS } from '../src/scripts/seed/gateContent.js';
import {
  gateAuthoringFindings,
  seedGateContent,
  validateGateContent,
} from '../src/scripts/seedGate.js';
import { SeedRefusedError } from '../src/scripts/seedLearning.js';

describe('gate seed', () => {
  it('SG1: ships 30 questions that all pass the shared authoring schema', () => {
    expect(SEED_GATE_QUESTIONS).toHaveLength(30);
    expect(validateGateContent()).toHaveLength(30);
  });

  it('SG2: passes the same authoring checks as the Phase 3 content', () => {
    expect(gateAuthoringFindings()).toEqual([]);
  });

  it('SG3: every question has 3 to 6 distinct options and a key inside them', () => {
    for (const q of validateGateContent()) {
      expect(q.options.length).toBeGreaterThanOrEqual(3);
      expect(q.options.length).toBeLessThanOrEqual(6);
      expect(new Set(q.options).size).toBe(q.options.length);
      expect(q.correctAnswer).toBeLessThan(q.options.length);
    }
    expect(new Set(SEED_GATE_QUESTIONS.map((q) => q.prompt)).size).toBe(30);
  });

  it('SG4: refuses outside development and test', async () => {
    await expect(seedGateContent({ nodeEnv: undefined })).rejects.toBeInstanceOf(SeedRefusedError);
    await expect(seedGateContent({ nodeEnv: 'production' })).rejects.toBeInstanceOf(
      SeedRefusedError,
    );
    expect(await GateQuestion.countDocuments()).toBe(0);
  });

  it('SG5: seeds once and keeps existing questions on a second run', async () => {
    expect(await seedGateContent({ nodeEnv: 'test' })).toEqual({ created: 30, kept: 0 });
    expect(await seedGateContent({ nodeEnv: 'test' })).toEqual({ created: 0, kept: 30 });
    expect(await GateQuestion.countDocuments({ isActive: true })).toBe(30);
  });

  it('SG6: the key and explanation are not selected by default', async () => {
    await seedGateContent({ nodeEnv: 'test' });
    const plain = await GateQuestion.findOne({}).lean();
    expect(plain).not.toHaveProperty('correctAnswer');
    expect(plain).not.toHaveProperty('explanation');
    const full = await GateQuestion.findOne({}).select('+correctAnswer +explanation').lean();
    expect(full?.explanation).toBeTruthy();
    expect(typeof full?.correctAnswer).toBe('number');
  });
});
