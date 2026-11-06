import { describe, expect, it } from 'vitest';
import {
  BLACK,
  createInitialBoard,
  getLegalMoves,
  migrationFoundation,
} from '@reversi/shared';

describe('@reversi/shared public API', () => {
  it('ESMの公開APIからTask 06の基盤情報を参照できる', () => {
    expect(migrationFoundation).toEqual({
      task: 'Task 06',
      message: 'React + TypeScript + Vite の開発基盤を構築しました。',
    });
  });

  it('Workspace package名の公開APIからゲームルールを参照できる', () => {
    expect(getLegalMoves(createInitialBoard(), BLACK).map(({ index }) => index)).toEqual([
      19,
      26,
      37,
      44,
    ]);
  });
});
