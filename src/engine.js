import { Chess } from '../vendor/chess.js';

const VALUE = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };
const LEVELS = {
  easy: { depth: 1, ms: 200 },
  medium: { depth: 3, ms: 700 },
  hard: { depth: 4, ms: 1800 },
};
const MATE = 100000;
const TIMEOUT = Symbol('search deadline');

function evaluate(chess) {
  let score = 0;
  for (const piece of chess.board().flat()) {
    if (!piece) continue;
    const file = piece.square.charCodeAt(0) - 97;
    const rank = Number(piece.square[1]) - 1;
    const advance = piece.color === 'w' ? rank : 7 - rank;
    const center = 3.5 - (Math.abs(file - 3.5) + Math.abs(rank - 3.5)) / 2;
    let value = VALUE[piece.type];
    if (piece.type === 'p') value += advance * 9 + center * 5;
    if (piece.type === 'n' || piece.type === 'b') value += center * 18;
    if (piece.type === 'r') value += advance * 3;
    score += piece.color === 'w' ? value : -value;
  }
  return chess.turn() === 'w' ? score : -score;
}

function orderedMoves(chess) {
  return chess.moves({ verbose: true }).sort((a, b) => priority(b) - priority(a));
}
function priority(move) {
  return (
    (move.captured ? 10 * VALUE[move.captured] - VALUE[move.piece] : 0) +
    (move.promotion ? VALUE[move.promotion] : 0) +
    (move.san.includes('+') ? 40 : 0)
  );
}
export const moveInput = (move) => ({
  from: move.from,
  to: move.to,
  ...(move.promotion ? { promotion: move.promotion } : {}),
});

/** Iterative deepening with alpha-beta and bounded capture/check extensions. Runs in a Worker. */
export function findBestMove({
  fen,
  pgn,
  level = 'medium',
  timeLimit,
  now = () => performance.now(),
}) {
  const chess = new Chess(fen);
  if (pgn) chess.loadPgn(pgn);
  if (chess.isGameOver()) return null;
  const config = LEVELS[level] || LEVELS.medium;
  const deadline = now() + (timeLimit ?? config.ms);
  let nodes = 0;
  function search(depth, alpha, beta, ply, extension = 0) {
    nodes++;
    if (now() >= deadline) throw TIMEOUT;
    if (chess.isCheckmate()) return -MATE + ply;
    if (chess.isDraw()) return 0;
    const inCheck = chess.isCheck();
    let moves;
    if (depth <= 0) {
      const score = evaluate(chess);
      if (extension >= 4) return score;
      if (!inCheck) {
        if (score >= beta) return beta;
        alpha = Math.max(alpha, score);
      }
      moves = orderedMoves(chess).filter((m) => inCheck || m.captured || m.promotion);
    } else moves = orderedMoves(chess);
    for (const move of moves) {
      chess.move(moveInput(move));
      let score;
      try {
        score = -search(depth - 1, -beta, -alpha, ply + 1, depth <= 0 ? extension + 1 : 0);
      } finally {
        chess.undo();
      }
      if (score >= beta) return beta;
      alpha = Math.max(alpha, score);
    }
    return alpha;
  }
  let moves = orderedMoves(chess);
  let best = moves[0];
  let completedDepth = 0;
  for (let depth = 1; depth <= config.depth; depth++) {
    let candidate = best;
    let alpha = -Infinity;
    try {
      for (const move of moves) {
        if (now() >= deadline) throw TIMEOUT;
        chess.move(moveInput(move));
        let score;
        try {
          score = -search(depth - 1, -Infinity, -alpha, 1);
        } finally {
          chess.undo();
        }
        if (score > alpha) {
          alpha = score;
          candidate = move;
        }
      }
      best = candidate;
      completedDepth = depth;
      moves = [best, ...moves.filter((move) => move !== best)];
      if (alpha > MATE - 100) break;
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      break;
    }
  }
  return { ...moveInput(best), depth: completedDepth, nodes };
}
