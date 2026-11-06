# Shared互換性Fixture

`v1.1.0-serialized-human-cpu.json`は、Task 06基準Commit
`6cd0a84b10b1ff30729b2a14023bb875bc6efd3a`にある既存
`ReversiGame.serialize()`の実出力を固定したものです。

固定条件は`gameId = "game-contract"`、人対CPU、人＝白、黒CPU＝最強、
速度500msです。`generationId`、`cpuThinking`、探索診断、表示メッセージも
旧payloadの構成確認用に保持しますが、新しい共通永続状態の正本からは除外します。
