import { describe, expect, it } from 'vitest';
import legacyPlaying from './fixtures/v1.1.0-serialized-human-cpu.json';
import regression from '../../test/fixtures/v1.1.0-regression.json';
import {
  InvalidGameStateError,
  decodeGameStateV1,
  parseGameStateV1,
  serializeGameStateV1,
} from '@reversi/shared';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function boardFromRows(rows: ReadonlyArray<string>): number[] {
  const cells = { '.': 0, B: 1, W: 2 } as const;
  return rows.flatMap((row) => [...row].map((cell) => cells[cell as keyof typeof cells]));
}

describe('schemaVersion 1の旧serialize()互換', () => {
  it('v1.1.0の実出力を読み、実行時制御・表示情報を永続状態から分離する', () => {
    const decoded = decodeGameStateV1(legacyPlaying);
    expect(decoded).toEqual({
      schemaVersion: 1,
      gameId: 'game-contract',
      board: legacyPlaying.board,
      mode: 'human-cpu',
      turn: 1,
      humanColor: 2,
      cpuLevelBlack: 'expert',
      cpuLevelWhite: null,
      speed: 500,
      status: 'playing',
      moveCount: 0,
      lastMove: null,
      winner: null,
    });
    expect(decoded).not.toHaveProperty('generationId');
    expect(decoded).not.toHaveProperty('cpuThinking');
    expect(decoded).not.toHaveProperty('lastCpuSearch');
    expect(decoded).not.toHaveProperty('message');
    expect(decoded).not.toHaveProperty('messageKind');
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.board)).toBe(true);
  });

  it('共通永続状態をJSONで往復できる', () => {
    const decoded = decodeGameStateV1(legacyPlaying);
    expect(parseGameStateV1(serializeGameStateV1(decoded))).toEqual(decoded);
  });

  it('空きマスが残る正常な終局状態を受け入れる', () => {
    const entry = regression.ruleScenarios.find((candidate) => candidate.id === 'ended-with-empty');
    if (entry === undefined) throw new Error('missing ended-with-empty fixture');
    const state = {
      schemaVersion: 1,
      gameId: 'finished-game',
      board: boardFromRows(entry.board),
      mode: 'human-human',
      turn: 1,
      humanColor: null,
      cpuLevelBlack: null,
      cpuLevelWhite: null,
      speed: 1000,
      status: 'finished',
      moveCount: 59,
      lastMove: 63,
      winner: 1,
    };
    expect(decodeGameStateV1(state)).toEqual(state);
  });
});

describe('不正・矛盾した旧データの拒否', () => {
  it.each([
    ['unknown schema', { ...legacyPlaying, schemaVersion: 2 }],
    ['missing schema', { ...legacyPlaying, schemaVersion: undefined }],
    ['short board', { ...legacyPlaying, board: legacyPlaying.board.slice(0, 63) }],
    ['invalid cell', { ...legacyPlaying, board: [...legacyPlaying.board.slice(0, 63), 3] }],
    ['invalid turn', { ...legacyPlaying, turn: 0 }],
    ['invalid mode settings', { ...legacyPlaying, cpuLevelWhite: 'easy' }],
    ['invalid paused mode', { ...legacyPlaying, status: 'paused' }],
    ['inconsistent move count', { ...legacyPlaying, moveCount: 1, lastMove: 19 }],
    ['last move is empty', { ...legacyPlaying, moveCount: 1, board: [...legacyPlaying.board.slice(0, 4), 1, ...legacyPlaying.board.slice(5)], lastMove: 0 }],
    ['winner before finish', { ...legacyPlaying, winner: 1 }],
  ])('%sを拒否する', (_name, state) => {
    expect(() => decodeGameStateV1(state)).toThrow(InvalidGameStateError);
  });

  it('不正なJSONを拒否する', () => {
    expect(() => parseGameStateV1('{')).toThrow(InvalidGameStateError);
  });

  it('decoderが入力配列の参照を保持しない', () => {
    const input = clone(legacyPlaying);
    const decoded = decodeGameStateV1(input);
    input.board[0] = 1;
    expect(decoded.board[0]).toBe(0);
  });
});
