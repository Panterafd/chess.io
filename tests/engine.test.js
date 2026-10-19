import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { findBestMove } from '../src/engine.js';

test('engine finds mate in one', () => {
  const chess = new Chess();
  for (const move of ['f3', 'e5', 'g4']) chess.move(move);
  const move = findBestMove({ fen: chess.fen(), level: 'easy', timeLimit: 5000 });
  chess.move(move);
  assert.equal(chess.isCheckmate(), true);
});
test('engine makes legal moves at every difficulty', () => {
  for (const level of ['easy', 'medium', 'hard']) {
    const chess = new Chess();
    chess.move('e4');
    const move = findBestMove({ fen: chess.fen(), level, timeLimit: 300 });
    assert.ok(chess.move(move));
  }
});
test('engine takes a hanging queen', () => {
  const chess = new Chess('6k1/8/8/8/3q4/8/3R4/6K1 w - - 0 1');
  const move = findBestMove({ fen: chess.fen(), level: 'medium', timeLimit: 5000 });
  assert.equal(chess.move(move).san, 'Rxd4');
});
test('deadline fallback is always a legal move', () => {
  const chess = new Chess();
  let time = 0;
  const move = findBestMove({ fen: chess.fen(), level: 'hard', timeLimit: 1, now: () => time++ });
  assert.ok(chess.move(move));
  assert.equal(move.depth, 0);
});
test('engine respects terminal positions and repetition in PGN', () => {
  assert.equal(findBestMove({ fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' }), null);
  const chess = new Chess();
  for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) chess.move(move);
  assert.equal(findBestMove({ fen: chess.fen(), pgn: chess.pgn() }), null);
});
