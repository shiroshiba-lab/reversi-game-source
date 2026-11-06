export const EMPTY = 0 as const;
export const BLACK = 1 as const;
export const WHITE = 2 as const;

export const BOARD_SIZE = 8 as const;
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
export const SCHEMA_VERSION = 1 as const;

export const GAME_MODES = Object.freeze({
  HUMAN_HUMAN: 'human-human',
  HUMAN_CPU: 'human-cpu',
  CPU_CPU: 'cpu-cpu',
} as const);

export const CPU_LEVELS = Object.freeze({
  EASY: 'easy',
  NORMAL: 'normal',
  ADVANCED: 'advanced',
  EXPERT: 'expert',
} as const);

export const GAME_STATUSES = Object.freeze({
  SETUP: 'setup',
  PLAYING: 'playing',
  PAUSED: 'paused',
  FINISHED: 'finished',
  ERROR: 'error',
} as const);

export const GAME_SPEEDS = Object.freeze({
  SLOW: 2000,
  NORMAL: 1000,
  FAST: 500,
} as const);

export type Cell = typeof EMPTY | typeof BLACK | typeof WHITE;
export type Color = typeof BLACK | typeof WHITE;
export type Winner = Color | 'draw';
export type Board = ReadonlyArray<Cell>;
export type GameMode = (typeof GAME_MODES)[keyof typeof GAME_MODES];
export type CpuLevel = (typeof CPU_LEVELS)[keyof typeof CPU_LEVELS];
export type GameStatus = (typeof GAME_STATUSES)[keyof typeof GAME_STATUSES];
export type GameSpeed = (typeof GAME_SPEEDS)[keyof typeof GAME_SPEEDS];

export type Position = Readonly<{
  index: number;
  row: number;
  col: number;
}>;

export type MoveInput =
  | Position
  | Readonly<{ index: number; row?: number; col?: number }>
  | Readonly<{ index?: number; row: number; col: number }>;

export type LegalMove = Position & Readonly<{
  flips: ReadonlyArray<number>;
}>;

export type StoneCounts = Readonly<{
  black: number;
  white: number;
  empty: number;
}>;

export type TurnResolution =
  | Readonly<{
      nextTurn: Color;
      passes: ReadonlyArray<Color>;
      finished: false;
      winner: null;
    }>
  | Readonly<{
      nextTurn: null;
      passes: ReadonlyArray<Color>;
      finished: true;
      winner: Winner;
    }>;
