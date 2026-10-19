import { findBestMove } from './engine.js';

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, fen: data.fen, move: findBestMove(data) });
  } catch {
    self.postMessage({ id: data.id, fen: data.fen, error: 'Не удалось рассчитать ход' });
  }
};
