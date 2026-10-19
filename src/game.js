import { Chess, DEFAULT_POSITION } from '../vendor/chess.js';

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'computer',
  side: 'w',
  level: 'medium',
  seconds: 600,
  increment: 0,
});
export const TIME_CONTROLS = ['0+0', '180+2', '300+0', '600+0', '900+10'];
export const opposite = (color) => (color === 'w' ? 'b' : 'w');

export function validateSettings(settings) {
  if (
    !settings ||
    !['local', 'computer'].includes(settings.mode) ||
    !['w', 'b'].includes(settings.side) ||
    !['easy', 'medium', 'hard'].includes(settings.level) ||
    !Number.isInteger(settings.seconds) ||
    !Number.isInteger(settings.increment) ||
    !TIME_CONTROLS.includes(`${settings.seconds}+${settings.increment}`)
  ) {
    throw new Error('Некорректные настройки партии');
  }
  return {
    mode: settings.mode,
    side: settings.side,
    level: settings.level,
    seconds: settings.seconds,
    increment: settings.increment,
  };
}

export function boardResult(chess) {
  if (chess.isCheckmate()) return { reason: 'checkmate', winner: opposite(chess.turn()) };
  if (chess.isStalemate()) return { reason: 'stalemate', winner: null };
  if (chess.isInsufficientMaterial()) return { reason: 'material', winner: null };
  if (chess.isThreefoldRepetition()) return { reason: 'repetition', winner: null };
  if (chess.isDrawByFiftyMoves()) return { reason: 'fifty', winner: null };
  return null;
}

// Obvious dead positions for the player whose opponent has run out of time.
export function canMate(chess, color) {
  const pieces = chess.board().flat().filter(Boolean);
  const own = pieces.filter((p) => p.color === color && p.type !== 'k');
  const other = pieces.filter((p) => p.color !== color && p.type !== 'k');
  if (!own.length) return false;
  if (own.some((p) => ['p', 'r', 'q'].includes(p.type))) return true;
  if (own.length === 1 && !other.length) return false;
  const minors = [...own, ...other];
  const squareColor = (p) => (p.square.charCodeAt(0) + Number(p.square[1])) % 2;
  if (minors.every((p) => p.type === 'b') && new Set(minors.map(squareColor)).size === 1)
    return false;
  return true;
}

export class Game {
  constructor(
    settings = DEFAULT_SETTINGS,
    { fen = DEFAULT_POSITION, now = () => Date.now() } = {},
  ) {
    this.settings = validateSettings(settings);
    this.chess = new Chess(fen);
    this.initialFen = fen;
    this.now = now;
    this.remaining = { w: settings.seconds * 1000, b: settings.seconds * 1000 };
    this.started = false;
    this.lastTick = now();
    this.timeline = [];
    this.result = boardResult(this.chess);
  }

  tick() {
    const timestamp = this.now();
    if (this.started && this.settings.seconds && !this.result) {
      const color = this.chess.turn();
      this.remaining[color] = Math.max(
        0,
        this.remaining[color] - Math.max(0, timestamp - this.lastTick),
      );
      if (this.remaining[color] === 0) {
        const winner = opposite(color);
        this.result = { reason: 'timeout', winner: canMate(this.chess, winner) ? winner : null };
      }
    }
    this.lastTick = timestamp;
    return this.result;
  }

  move(input) {
    this.tick();
    if (this.result) return null;
    const before = { remaining: { ...this.remaining }, started: this.started };
    let move;
    try {
      move = this.chess.move(input);
    } catch {
      return null;
    }
    if (!move) return null;
    this.timeline.push(before);
    if (this.settings.seconds) this.remaining[move.color] += this.settings.increment * 1000;
    this.started = true;
    this.lastTick = this.now();
    this.result = boardResult(this.chess);
    return move;
  }

  undo(plies = 1) {
    let undone = 0;
    while (undone < plies && this.timeline.length) {
      this.chess.undo();
      const previous = this.timeline.pop();
      this.remaining = { ...previous.remaining };
      this.started = previous.started;
      undone++;
    }
    if (undone) {
      this.result = boardResult(this.chess);
      this.lastTick = this.now();
    }
    return undone;
  }

  resign(color = this.chess.turn()) {
    this.tick();
    if (!this.result) this.result = { reason: 'resignation', winner: opposite(color) };
  }

  agreeDraw() {
    this.tick();
    if (!this.result && this.settings.mode === 'local')
      this.result = { reason: 'agreement', winner: null };
  }

  exportPgn() {
    const result = !this.result
      ? '*'
      : this.result.winner === 'w'
        ? '1-0'
        : this.result.winner === 'b'
          ? '0-1'
          : '1/2-1/2';
    const pgn = new Chess(this.initialFen);
    for (const move of this.chess.history()) pgn.move(move);
    pgn.header(
      'Event',
      'Chess.io casual game',
      'Site',
      'Chess.io',
      'White',
      this.playerName('w'),
      'Black',
      this.playerName('b'),
      'Result',
      result,
    );
    return pgn.pgn({ maxWidth: 80 });
  }

  playerName(color) {
    return this.settings.mode === 'computer' && color !== this.settings.side
      ? `Computer (${this.settings.level})`
      : color === 'w'
        ? 'White'
        : 'Black';
  }

  serialize() {
    this.tick();
    return JSON.stringify({
      version: 1,
      settings: this.settings,
      initialFen: this.initialFen,
      moves: this.chess.history(),
      remaining: this.remaining,
      started: this.started,
      timeline: this.timeline,
      result: this.result,
      savedAt: this.lastTick,
    });
  }

  static restore(raw, now = () => Date.now()) {
    const data = JSON.parse(raw);
    if (
      !data ||
      data.version !== 1 ||
      !Array.isArray(data.moves) ||
      data.moves.length > 5000 ||
      typeof data.initialFen !== 'string' ||
      typeof data.started !== 'boolean' ||
      !Array.isArray(data.timeline) ||
      data.timeline.length !== data.moves.length ||
      data.started !== data.moves.length > 0 ||
      !Number.isFinite(data.savedAt) ||
      data.savedAt < 0 ||
      data.savedAt > now() + 60000
    )
      throw new Error('Повреждённое сохранение');
    const game = new Game(data.settings, { fen: data.initialFen, now });
    const validClocks = (clocks) =>
      clocks &&
      ['w', 'b'].every((c) => Number.isFinite(clocks[c]) && clocks[c] >= 0 && clocks[c] <= 1e9);
    if (
      !validClocks(data.remaining) ||
      !data.timeline.every((t) => t && validClocks(t.remaining) && typeof t.started === 'boolean')
    )
      throw new Error('Повреждённые часы');
    for (const move of data.moves) {
      if (boardResult(game.chess) || typeof move !== 'string')
        throw new Error('Некорректная история');
      game.chess.move(move);
    }
    const legalReasons = [
      'checkmate',
      'stalemate',
      'material',
      'repetition',
      'fifty',
      'timeout',
      'resignation',
      'agreement',
    ];
    if (
      data.result &&
      (!legalReasons.includes(data.result.reason) || !['w', 'b', null].includes(data.result.winner))
    )
      throw new Error('Некорректный результат');
    const automatic = boardResult(game.chess);
    if (
      data.result &&
      !['timeout', 'resignation', 'agreement'].includes(data.result.reason) &&
      JSON.stringify(automatic) !== JSON.stringify(data.result)
    )
      throw new Error('Результат не соответствует позиции');
    game.remaining = { ...data.remaining };
    game.started = data.started;
    game.timeline = data.timeline;
    game.result = automatic || data.result || null;
    game.lastTick = data.savedAt;
    game.tick(); // A reload or a background tab must not pause a running clock.
    return game;
  }
}
