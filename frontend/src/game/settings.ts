import {
  BLACK,
  CPU_LEVELS,
  GAME_MODES,
  GAME_SPEEDS,
  WHITE,
  type Color,
  type CpuLevel,
  type GameMode,
  type GameSpeed,
} from '@reversi/shared';
import type { GameSettings } from './types.ts';
import {
  CPU_ENGINES,
  DEFAULT_EGAROUCID_LEVEL,
  DEFAULT_EGAROUCID_USE_BOOK,
  isCpuEngineId,
  isEgaroucidLevel,
} from './cpu/cpuConfig.ts';

export const SETTINGS_KEY = 'reversi-board.settings.v1';

export const DEFAULT_SETTINGS: GameSettings = Object.freeze({
  mode: GAME_MODES.HUMAN_CPU,
  humanColor: BLACK,
  cpuEngineBlack: null,
  cpuEngineWhite: CPU_ENGINES.LEGACY,
  cpuLevelBlack: null,
  cpuLevelWhite: CPU_LEVELS.NORMAL,
  egaroucidLevelBlack: null,
  egaroucidLevelWhite: DEFAULT_EGAROUCID_LEVEL,
  egaroucidUseBookBlack: null,
  egaroucidUseBookWhite: DEFAULT_EGAROUCID_USE_BOOK,
  speed: GAME_SPEEDS.NORMAL,
});

const modes = new Set<string>(Object.values(GAME_MODES));
const levels = new Set<string>(Object.values(CPU_LEVELS));
const speeds = new Set<number>(Object.values(GAME_SPEEDS));

function isMode(value: unknown): value is GameMode {
  return typeof value === 'string' && modes.has(value);
}

function isLevel(value: unknown): value is CpuLevel {
  return typeof value === 'string' && levels.has(value);
}

function isSpeed(value: unknown): value is GameSpeed {
  return typeof value === 'number' && speeds.has(value);
}

export function normalizeSettings(value: unknown = {}): GameSettings {
  const candidate = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
  const mode = isMode(candidate.mode) ? candidate.mode : DEFAULT_SETTINGS.mode;
  const humanColor: Color = Number(candidate.humanColor) === WHITE ? WHITE : BLACK;
  const speedValue = Number(candidate.speed);
  const speed = isSpeed(speedValue) ? speedValue : GAME_SPEEDS.NORMAL;
  const black = isLevel(candidate.cpuLevelBlack) ? candidate.cpuLevelBlack : CPU_LEVELS.NORMAL;
  const white = isLevel(candidate.cpuLevelWhite) ? candidate.cpuLevelWhite : CPU_LEVELS.NORMAL;
  const blackEngine = isCpuEngineId(candidate.cpuEngineBlack) ? candidate.cpuEngineBlack : CPU_ENGINES.LEGACY;
  const whiteEngine = isCpuEngineId(candidate.cpuEngineWhite) ? candidate.cpuEngineWhite : CPU_ENGINES.LEGACY;
  const blackEgaroucidLevel = isEgaroucidLevel(candidate.egaroucidLevelBlack) ? candidate.egaroucidLevelBlack : DEFAULT_EGAROUCID_LEVEL;
  const whiteEgaroucidLevel = isEgaroucidLevel(candidate.egaroucidLevelWhite) ? candidate.egaroucidLevelWhite : DEFAULT_EGAROUCID_LEVEL;
  const blackUseBook = typeof candidate.egaroucidUseBookBlack === 'boolean' ? candidate.egaroucidUseBookBlack : DEFAULT_EGAROUCID_USE_BOOK;
  const whiteUseBook = typeof candidate.egaroucidUseBookWhite === 'boolean' ? candidate.egaroucidUseBookWhite : DEFAULT_EGAROUCID_USE_BOOK;

  if (mode === GAME_MODES.HUMAN_HUMAN) {
    return Object.freeze({
      mode, humanColor: null,
      cpuEngineBlack: null, cpuEngineWhite: null,
      cpuLevelBlack: null, cpuLevelWhite: null,
      egaroucidLevelBlack: null, egaroucidLevelWhite: null,
      egaroucidUseBookBlack: null, egaroucidUseBookWhite: null,
      speed,
    });
  }
  if (mode === GAME_MODES.CPU_CPU) {
    return Object.freeze({
      mode, humanColor: null,
      cpuEngineBlack: blackEngine, cpuEngineWhite: whiteEngine,
      cpuLevelBlack: black, cpuLevelWhite: white,
      egaroucidLevelBlack: blackEgaroucidLevel, egaroucidLevelWhite: whiteEgaroucidLevel,
      egaroucidUseBookBlack: blackUseBook, egaroucidUseBookWhite: whiteUseBook,
      speed,
    });
  }
  return Object.freeze({
    mode,
    humanColor,
    cpuEngineBlack: humanColor === WHITE ? blackEngine : null,
    cpuEngineWhite: humanColor === BLACK ? whiteEngine : null,
    cpuLevelBlack: humanColor === WHITE ? black : null,
    cpuLevelWhite: humanColor === BLACK ? white : null,
    egaroucidLevelBlack: humanColor === WHITE ? blackEgaroucidLevel : null,
    egaroucidLevelWhite: humanColor === BLACK ? whiteEgaroucidLevel : null,
    egaroucidUseBookBlack: humanColor === WHITE ? blackUseBook : null,
    egaroucidUseBookWhite: humanColor === BLACK ? whiteUseBook : null,
    speed,
  });
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): GameSettings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    return raw ? normalizeSettings(JSON.parse(raw) as unknown) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(
  settings: GameSettings,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage,
): boolean {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
    return true;
  } catch {
    return false;
  }
}
