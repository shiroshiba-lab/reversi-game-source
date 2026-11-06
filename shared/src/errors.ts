export class InvalidReversiInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReversiInputError';
  }
}

export class IllegalMoveError extends Error {
  constructor(message = 'この場所には石を置けません。') {
    super(message);
    this.name = 'IllegalMoveError';
  }
}

export class InvalidGameStateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvalidGameStateError';
  }
}
