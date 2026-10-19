import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { Game, DEFAULT_SETTINGS, canMate } from '../src/game.js';

const local = { ...DEFAULT_SETTINGS, mode: 'local', seconds: 0 };
const make = (fen) => new Game(local, { fen });
const play = (game, moves) =>
  moves.forEach((move) => assert.ok(game.move(move), `Legal move: ${move}`));

test('starting position has the standard perft counts through depth 3', () => {
  const chess = new Chess();
  assert.equal(chess.perft(1), 20);
  assert.equal(chess.perft(2), 400);
  assert.equal(chess.perft(3), 8902);
});
test('castling/pins position has standard perft counts', () => {
  const chess = new Chess('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.equal(chess.perft(1), 48);
  assert.equal(chess.perft(2), 2039);
});
test('illegal moves and moving the wrong color leave board and history untouched', () => {
  const game = make();
  const fen = game.chess.fen();
  assert.equal(game.move({ from: 'e2', to: 'e5' }), null);
  assert.equal(game.move({ from: 'e7', to: 'e5' }), null);
  assert.equal(game.chess.fen(), fen);
  assert.equal(game.timeline.length, 0);
});
test('a pinned piece cannot expose its king', () => {
  const game = make('4r1k1/8/8/8/8/8/4R3/4K3 w - - 0 1');
  assert.equal(game.move({ from: 'e2', to: 'd2' }), null);
  assert.ok(game.move({ from: 'e2', to: 'e8' }));
});
test('castling moves both king and rook, and undo restores castling rights', () => {
  const game = make('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const initial = game.chess.fen();
  assert.equal(game.move('O-O').san, 'O-O');
  assert.equal(game.chess.get('f1').type, 'r');
  assert.equal(game.chess.get('g1').type, 'k');
  game.undo();
  assert.equal(game.chess.fen(), initial);
});
test('castling through check is forbidden', () => {
  const game = make('r3kr1r/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  assert.equal(game.move('O-O'), null);
  assert.ok(game.move('O-O-O'));
});
test('en passant removes the right pawn; undo restores it', () => {
  const game = make();
  play(game, ['e4', 'a6', 'e5', 'd5']);
  const fen = game.chess.fen();
  assert.equal(game.move('exd6').captured, 'p');
  assert.equal(game.chess.get('d5'), undefined);
  assert.equal(game.chess.get('d6').color, 'w');
  game.undo();
  assert.equal(game.chess.fen(), fen);
});
test('en passant expires and cannot expose the king to a rook', () => {
  const game = make();
  play(game, ['e4', 'a6', 'e5', 'd5', 'Nf3', 'a5']);
  assert.equal(game.move('exd6'), null);
  const pinned = make('k7/8/8/4KPpr/8/8/8/8 w - g6 0 1');
  assert.equal(pinned.move({ from: 'f5', to: 'g6' }), null);
});
test('all four promotions are supported and an explicit choice is required', () => {
  for (const promotion of ['q', 'r', 'b', 'n']) {
    const game = make('7k/P7/8/8/8/8/8/7K w - - 0 1');
    assert.equal(game.move({ from: 'a7', to: 'a8' }), null);
    assert.ok(game.move({ from: 'a7', to: 'a8', promotion }));
    assert.equal(game.chess.get('a8').type, promotion);
  }
});
test('checkmate ends the game and undo permits play again', () => {
  const game = make();
  play(game, ['f3', 'e5', 'g4', 'Qh4#']);
  assert.deepEqual(game.result, { reason: 'checkmate', winner: 'b' });
  assert.equal(game.move('e4'), null);
  game.undo();
  assert.equal(game.result, null);
  assert.ok(game.move('Nc6'));
});
test('stalemate and insufficient material are distinct draws', () => {
  assert.equal(make('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').result.reason, 'stalemate');
  assert.equal(make('7k/8/8/8/8/8/8/K7 w - - 0 1').result.reason, 'material');
});
test('threefold repetition survives save and restore', () => {
  const game = make();
  play(game, ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6']);
  const restored = Game.restore(game.serialize());
  play(restored, ['Ng1', 'Ng8']);
  assert.equal(restored.result.reason, 'repetition');
});
test('fifty-move rule is automatic for this casual game', () => {
  const game = make('7k/8/8/8/8/8/8/KR6 w - - 99 60');
  assert.ok(game.move('Rb2'));
  assert.equal(game.result.reason, 'fifty');
});
test('clocks use elapsed time, start after first move, and add increments', () => {
  let time = 1000;
  const game = new Game({ ...local, seconds: 180, increment: 2 }, { now: () => time });
  time += 20000;
  game.tick();
  assert.equal(game.remaining.w, 180000);
  game.move('e4');
  assert.equal(game.remaining.w, 182000);
  time += 5500;
  game.tick();
  assert.equal(game.remaining.b, 174500);
  game.move('e5');
  assert.equal(game.remaining.b, 176500);
  time += 1000;
  game.tick();
  assert.equal(game.remaining.w, 181000);
  game.undo();
  assert.equal(game.chess.turn(), 'b');
  assert.equal(game.remaining.b, 174500);
});
test('reload charges time spent away and cannot resurrect a timed-out game', () => {
  let time = 1000;
  const now = () => time;
  const game = new Game({ ...local, seconds: 300 }, { now });
  game.move('e4');
  const raw = game.serialize();
  time += 25000;
  const restored = Game.restore(raw, now);
  assert.equal(restored.remaining.b, 275000);
  time += 300000;
  restored.tick();
  assert.deepEqual(restored.result, { reason: 'timeout', winner: 'w' });
  assert.equal(restored.move('e5'), null);
});
test('a flag fall is a draw when the other side only has a king', () => {
  let time = 0;
  const game = new Game(
    { ...local, seconds: 300 },
    { fen: '7k/7r/8/8/8/8/8/K7 w - - 0 1', now: () => time },
  );
  game.move('Kb1');
  time += 300001;
  game.tick();
  assert.deepEqual(game.result, { reason: 'timeout', winner: null });
  assert.equal(canMate(new Chess('7k/8/8/8/8/8/8/KN6 w - - 0 1'), 'w'), false);
});
test('undo restores initial position, timers and repetition history', () => {
  const game = make();
  play(game, ['e4', 'e5']);
  assert.equal(game.undo(2), 2);
  assert.equal(game.started, false);
  assert.equal(game.chess.fen(), new Chess().fen());
  assert.equal(game.undo(), 0);
});
test('resign and agreed draw export correct PGN results', () => {
  const game = make();
  play(game, ['e4', 'e5']);
  game.resign('w');
  const pgn = game.exportPgn();
  const chess = new Chess();
  chess.loadPgn(pgn);
  assert.equal(chess.getHeaders().Result, '0-1');
  assert.deepEqual(chess.history(), ['e4', 'e5']);
  const draw = make();
  draw.agreeDraw();
  assert.match(draw.exportPgn(), /1\/2-1\/2$/);
});
test('bad saves are rejected instead of applying arbitrary positions or clocks', () => {
  const data = JSON.parse(make().serialize());
  for (const patch of [
    { version: 99 },
    { moves: ['e5'] },
    { remaining: { w: -10, b: 0 } },
    { savedAt: 1e20 },
    { timeline: [null] },
    { settings: { ...local, level: 'impossible' } },
    { result: { reason: 'checkmate', winner: 'w' } },
  ]) {
    assert.throws(() => Game.restore(JSON.stringify({ ...data, ...patch })));
  }
});
