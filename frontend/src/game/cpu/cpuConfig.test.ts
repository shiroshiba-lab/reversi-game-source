import { describe, expect, it } from 'vitest';
import {
  CPU_ENGINES,
  EGAROUCID_HIGH_LOAD_GAME_BUDGET_MS,
  EGAROUCID_HIGH_LOAD_SEARCH_TIMEOUT_MS,
  EGAROUCID_LEVELS,
  EGAROUCID_NORMAL_GAME_BUDGET_MS,
  EGAROUCID_NORMAL_SEARCH_TIMEOUT_MS,
  egaroucidSearchTimeoutMs,
  cpuConfigLabel,
} from './cpuConfig.ts';

describe('Task 13で確定したEgaroucid timeout', () => {
  it('全16 Levelを維持し、0〜11は3秒、12〜15は15秒に分ける', () => {
    expect(EGAROUCID_LEVELS).toEqual(Array.from({ length: 16 }, (_, level) => level));
    for (const level of EGAROUCID_LEVELS) {
      expect(egaroucidSearchTimeoutMs(level)).toBe(level < 12 ? 3_000 : 15_000);
    }
    expect(EGAROUCID_NORMAL_SEARCH_TIMEOUT_MS).toBe(3_000);
    expect(EGAROUCID_HIGH_LOAD_SEARCH_TIMEOUT_MS).toBe(15_000);
  });

  it('一局guardは4分／12分を維持する', () => {
    expect(EGAROUCID_NORMAL_GAME_BUDGET_MS).toBe(4 * 60_000);
    expect(EGAROUCID_HIGH_LOAD_GAME_BUDGET_MS).toBe(12 * 60_000);
  });
});

describe('Task UI-01の利用者向けCPU表示名', () => {
  it('内部engine IDを保ったまま表示名だけを統一する', () => {
    expect(cpuConfigLabel({ engine: CPU_ENGINES.LEGACY, level: 'easy' })).toBe('オリジナルCPU 初級');
    expect(cpuConfigLabel({ engine: CPU_ENGINES.EGAROUCID, level: 15, useBook: true })).toBe('高性能AI Level 15');
  });
});
