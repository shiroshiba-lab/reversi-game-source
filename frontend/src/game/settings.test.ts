import { BLACK, CPU_LEVELS, GAME_MODES, GAME_SPEEDS } from '@reversi/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, normalizeSettings, saveSettings } from './settings.ts';

describe('設定保存', () => {
  it('破損値と不正値を安全な初期値へ戻す', () => {
    const storage = { getItem: () => '{broken' };
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ mode: 'bad', speed: 12, humanColor: 99 })).toEqual(DEFAULT_SETTINGS);
  });

  it('v1互換キーへ設定だけを保存する', () => {
    const values = new Map<string, string>();
    const settings = normalizeSettings({ mode: GAME_MODES.CPU_CPU, cpuLevelBlack: CPU_LEVELS.EASY, cpuLevelWhite: CPU_LEVELS.EXPERT, speed: GAME_SPEEDS.FAST, humanColor: BLACK });
    expect(saveSettings(settings, { setItem: (key, value) => { values.set(key, value); } })).toBe(true);
    expect(JSON.parse(values.get(SETTINGS_KEY) ?? '{}')).toEqual(settings);
    expect(values.get(SETTINGS_KEY)).not.toContain('board');
  });

  it('旧保存値は既存CPUとして読み込み、Egaroucidへ無断変換しない', () => {
    const legacyPayload = JSON.stringify({
      mode: GAME_MODES.CPU_CPU,
      humanColor: null,
      cpuLevelBlack: CPU_LEVELS.ADVANCED,
      cpuLevelWhite: CPU_LEVELS.EXPERT,
      speed: GAME_SPEEDS.SLOW,
    });
    const loaded = loadSettings({ getItem: () => legacyPayload });
    expect(loaded).toMatchObject({
      cpuEngineBlack: 'legacy',
      cpuEngineWhite: 'legacy',
      cpuLevelBlack: CPU_LEVELS.ADVANCED,
      cpuLevelWhite: CPU_LEVELS.EXPERT,
    });
  });

  it('Egaroucidの黒白別LevelとBook設定を保存し、不正値は安全な既定値へ戻す', () => {
    const configured = normalizeSettings({
      mode: GAME_MODES.CPU_CPU,
      cpuEngineBlack: 'egaroucid',
      cpuEngineWhite: 'egaroucid',
      egaroucidLevelBlack: 0,
      egaroucidLevelWhite: 15,
      egaroucidUseBookBlack: false,
      egaroucidUseBookWhite: true,
    });
    expect(configured).toMatchObject({ egaroucidLevelBlack: 0, egaroucidLevelWhite: 15, egaroucidUseBookBlack: false, egaroucidUseBookWhite: true });
    expect(normalizeSettings({ mode: GAME_MODES.CPU_CPU, cpuEngineBlack: 'bad', egaroucidLevelBlack: 99 })).toMatchObject({ cpuEngineBlack: 'legacy', egaroucidLevelBlack: 4 });
  });
});
