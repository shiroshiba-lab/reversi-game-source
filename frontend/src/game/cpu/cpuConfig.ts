import { CPU_LEVELS, type Color, type CpuLevel } from '@reversi/shared';

export const CPU_ENGINES = Object.freeze({
  LEGACY: 'legacy',
  EGAROUCID: 'egaroucid',
} as const);

export type CpuEngineId = (typeof CPU_ENGINES)[keyof typeof CPU_ENGINES];
export type EgaroucidLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export type LegacyCpuConfig = Readonly<{
  engine: typeof CPU_ENGINES.LEGACY;
  level: CpuLevel;
}>;

export type EgaroucidCpuConfig = Readonly<{
  engine: typeof CPU_ENGINES.EGAROUCID;
  level: EgaroucidLevel;
  useBook: boolean;
}>;

export type CpuConfig = LegacyCpuConfig | EgaroucidCpuConfig;

export type CpuEngineAvailability = Readonly<{
  available: boolean;
  reason?: string;
}>;

export type CpuEngineAvailabilityMap = Readonly<Record<CpuEngineId, CpuEngineAvailability>>;

export const DEFAULT_EGAROUCID_LEVEL: EgaroucidLevel = 4;
export const DEFAULT_EGAROUCID_USE_BOOK = true;
export const EGAROUCID_INIT_TIMEOUT_MS = 12_000;
export const EGAROUCID_NORMAL_SEARCH_TIMEOUT_MS = 3_000;
export const EGAROUCID_HIGH_LOAD_SEARCH_TIMEOUT_MS = 15_000;
export const EGAROUCID_NORMAL_GAME_BUDGET_MS = 4 * 60_000;
export const EGAROUCID_HIGH_LOAD_GAME_BUDGET_MS = 12 * 60_000;

export const EGAROUCID_LEVELS = Object.freeze(
  Array.from({ length: 16 }, (_, level) => level as EgaroucidLevel),
);

export function isCpuEngineId(value: unknown): value is CpuEngineId {
  return value === CPU_ENGINES.LEGACY || value === CPU_ENGINES.EGAROUCID;
}

export function isEgaroucidLevel(value: unknown): value is EgaroucidLevel {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 15;
}

export function isLegacyCpuLevel(value: unknown): value is CpuLevel {
  return typeof value === 'string' && Object.values(CPU_LEVELS).some((level) => level === value);
}

export function isHighLoadEgaroucidLevel(level: EgaroucidLevel): boolean {
  return level >= 12;
}

export function egaroucidSearchTimeoutMs(level: EgaroucidLevel): number {
  return isHighLoadEgaroucidLevel(level)
    ? EGAROUCID_HIGH_LOAD_SEARCH_TIMEOUT_MS
    : EGAROUCID_NORMAL_SEARCH_TIMEOUT_MS;
}

export function cpuConfigLabel(config: CpuConfig): string {
  if (config.engine === CPU_ENGINES.EGAROUCID) return `高性能AI Level ${config.level}`;
  const labels: Record<CpuLevel, string> = {
    [CPU_LEVELS.EASY]: '初級',
    [CPU_LEVELS.NORMAL]: '標準',
    [CPU_LEVELS.ADVANCED]: '上級',
    [CPU_LEVELS.EXPERT]: '最強',
  };
  return `オリジナルCPU ${labels[config.level]}`;
}

export type CpuSideFields = Readonly<{
  cpuEngineBlack: CpuEngineId | null;
  cpuEngineWhite: CpuEngineId | null;
  cpuLevelBlack: CpuLevel | null;
  cpuLevelWhite: CpuLevel | null;
  egaroucidLevelBlack: EgaroucidLevel | null;
  egaroucidLevelWhite: EgaroucidLevel | null;
  egaroucidUseBookBlack: boolean | null;
  egaroucidUseBookWhite: boolean | null;
}>;

export function cpuConfigForColor(settings: CpuSideFields, color: Color): CpuConfig {
  const black = color === 1;
  const engine = (black ? settings.cpuEngineBlack : settings.cpuEngineWhite) ?? CPU_ENGINES.LEGACY;
  if (engine === CPU_ENGINES.EGAROUCID) {
    return Object.freeze({
      engine,
      level: (black ? settings.egaroucidLevelBlack : settings.egaroucidLevelWhite) ?? DEFAULT_EGAROUCID_LEVEL,
      useBook: (black ? settings.egaroucidUseBookBlack : settings.egaroucidUseBookWhite) ?? DEFAULT_EGAROUCID_USE_BOOK,
    });
  }
  return Object.freeze({
    engine,
    level: (black ? settings.cpuLevelBlack : settings.cpuLevelWhite) ?? CPU_LEVELS.NORMAL,
  });
}
