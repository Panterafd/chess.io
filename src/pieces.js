const paths = {
  p: '<circle cx="32" cy="18" r="8"/><path d="M26 26h12l-2 8 5 12H23l5-12z"/><path d="M22 46h20l3 6H19z"/>',
  r: '<path d="M18 11h7v7h5v-7h5v7h5v-7h7v14l-7 5v15H25V30l-7-5z"/><path d="M23 45h19l4 7H19z"/><path d="M25 25h15" fill="none"/>',
  n: '<path d="M21 45c0-8 6-14 13-20l-10 5-8-4 9-13 9-3 4-5 3 9c9 5 12 20 3 31z"/><path d="M21 45h23l4 7H17z"/><path d="M36 14c6 6 8 14 4 23" fill="none"/><circle cx="29" cy="19" r="1.8" fill="currentColor" stroke="none"/>',
  b: '<path d="M32 7c-3 6-13 11-13 19 0 7 6 11 13 11s13-4 13-11C45 18 35 13 32 7z"/><path d="m35 16-6 12" fill="none"/><path d="m27 37-4 9h18l-4-9z"/><path d="M22 46h20l5 6H17z"/>',
  q: '<path d="m17 21 8 9 7-15 7 15 8-9-6 22H23z"/><circle cx="15" cy="18" r="3.3"/><circle cx="32" cy="12" r="3.3"/><circle cx="49" cy="18" r="3.3"/><path d="M23 43h18v4H23zM22 47h20l5 5H17z"/>',
  k: '<path d="M32 6v13m-6-7h12" fill="none" stroke-width="3.6"/><path d="M32 25c-11-15-23 0-14 9l7 9h14l7-9c9-9-3-24-14-9z"/><path d="M25 43h14v4H25zM23 47h18l6 5H17z"/>',
};
export const PIECE_NAMES = {
  p: 'пешка',
  r: 'ладья',
  n: 'конь',
  b: 'слон',
  q: 'ферзь',
  k: 'король',
};
export function pieceSvg(type, color) {
  return `<svg class="piece piece-${color}" viewBox="0 0 64 64" aria-hidden="true"><g fill="${color === 'w' ? '#fffcf1' : '#26362f'}" stroke="${color === 'w' ? '#576354' : '#12251c'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[type]}</g></svg>`;
}
