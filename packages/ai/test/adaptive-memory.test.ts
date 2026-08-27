import { describe, expect, it } from 'vitest';
import { evaluateDurationMemory } from '../src/index.js';

describe('adaptive duration memory promotion', () => {
  it('promotes only when held-out completions confirm a material improvement', () => {
    const observations = Array.from({ length: 8 }, (_, index) => ({
      estimatedMinutes: 20 + index * 5,
      actualMinutes: (20 + index * 5) * 2,
    }));
    const result = evaluateDurationMemory(observations);

    expect(result.status).toBe('promoted');
    expect(result.factor).toBe(2);
    expect(result.validationCount).toBe(2);
    expect(result.relativeImprovement).toBe(1);
  });

  it('rejects a pattern that disappears in the held-out observations', () => {
    const training = Array.from({ length: 6 }, (_, index) => ({
      estimatedMinutes: 30 + index * 5,
      actualMinutes: (30 + index * 5) * 2,
    }));
    const result = evaluateDurationMemory([
      ...training,
      { estimatedMinutes: 60, actualMinutes: 60 },
      { estimatedMinutes: 90, actualMinutes: 90 },
    ]);

    expect(result.status).toBe('rejected');
    expect(result.factor).toBe(1);
    expect(result.relativeImprovement).toBeLessThan(0);
  });

  it('keeps sparse evidence as a candidate instead of changing behavior', () => {
    const result = evaluateDurationMemory([
      { estimatedMinutes: 30, actualMinutes: 60 },
      { estimatedMinutes: 30, actualMinutes: 60 },
    ]);

    expect(result.status).toBe('candidate');
    expect(result.factor).toBe(1);
    expect(result.baselineMae).toBeNull();
  });
});
