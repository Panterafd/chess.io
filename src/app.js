import { Game, DEFAULT_SETTINGS, opposite } from './game.js';
import { pieceSvg, PIECE_NAMES } from './pieces.js';

const $ = (selector) => document.querySelector(selector);
const SAVE_KEY = 'chess.io.game.v1';
const PREFS_KEY = 'chess.io.preferences.v1';
const LEVEL_NAMES = { easy: 'Начальный', medium: 'Средний', hard: 'Продвинутый' };
const COLORS = { w: 'Белые', b: 'Чёрные' };
let game = new Game();
let preferences = { orientation: 'w', sound: false, coordinates: true };
let selected = null;
let focused = 'e2';
let hint = null;
let promotion = null;
let worker = null;
let requestId = 0;
let job = null;
let engineFailure = false;
let toastTimer;
let confirmAction;
let audio;
let storageAvailable = true;
let restoreMessage = '';
try {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) {
    game = Game.restore(raw);
    if (game.started) restoreMessage = 'Ваша партия восстановлена. Можно продолжать.';
  }
  const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
  if (saved)
    preferences = {
      orientation: ['w', 'b'].includes(saved.orientation) ? saved.orientation : 'w',
      sound: saved.sound === true,
      coordinates: saved.coordinates !== false,
    };
} catch {
  restoreMessage = 'Не удалось восстановить сохранение. Начата новая партия.';
}

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => {
    $('#toast').hidden = true;
  }, 4200);
}
function persist() {
  try {
    localStorage.setItem(SAVE_KEY, game.serialize());
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  $('#save-status').textContent = storageAvailable
    ? '✓ Партия сохраняется на этом устройстве'
    : 'Сохранение недоступно · скачайте PGN перед выходом';
}
function savePreferences() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
  } catch {
    /* Play still works without storage. */
  }
}
function isComputerTurn() {
  return game.settings.mode === 'computer' && game.chess.turn() !== game.settings.side;
}
function humanCanMove() {
  return !game.result && !isComputerTurn();
}
function cancelJob() {
  requestId++;
  worker?.terminate();
  worker = null;
  job = null;
  engineFailure = false;
}
function sound(move) {
  if (!preferences.sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    void audio.resume().catch(() => {});
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(
      move?.san.includes('+') || game.result ? 660 : move?.captured ? 300 : 460,
      audio.currentTime,
    );
    gain.gain.setValueAtTime(0.07, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.13);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.14);
  } catch {
    /* Audio is optional. */
  }
}

function squareOrder() {
  const files = preferences.orientation === 'w' ? 'abcdefgh' : 'hgfedcba';
  const ranks = preferences.orientation === 'w' ? '87654321' : '12345678';
  return [...ranks].flatMap((rank) => [...files].map((file) => file + rank));
}
function renderBoard() {
  const activeSquare = document.activeElement?.closest('.square')?.dataset.square;
  const moves = selected ? game.chess.moves({ square: selected, verbose: true }) : [];
  const history = game.chess.history({ verbose: true });
  const last = history.at(-1);
  const check = game.chess.isCheck();
  const fragment = document.createDocumentFragment();
  squareOrder().forEach((square, index) => {
    const piece = game.chess.get(square);
    const legal = moves.find((move) => move.to === square);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'square';
    button.dataset.square = square;
    button.classList.toggle('dark', (square.charCodeAt(0) + Number(square[1])) % 2 === 0);
    button.classList.toggle('selected', square === selected);
    button.classList.toggle('legal', !!legal);
    button.classList.toggle('capture', !!legal?.captured);
    button.classList.toggle('last-move', square === last?.from || square === last?.to);
    button.classList.toggle(
      'in-check',
      check && piece?.type === 'k' && piece.color === game.chess.turn(),
    );
    button.classList.toggle('hint', square === hint?.from || square === hint?.to);
    button.setAttribute('aria-pressed', String(square === selected));
    button.setAttribute(
      'aria-label',
      `${square}${piece ? `, ${COLORS[piece.color]}, ${PIECE_NAMES[piece.type]}` : ', пусто'}${legal ? ', допустимый ход' : ''}`,
    );
    button.tabIndex = square === focused ? 0 : -1;
    if (piece) button.innerHTML = pieceSvg(piece.type, piece.color);
    if (preferences.coordinates) {
      if (index % 8 === 0) {
        const label = document.createElement('span');
        label.className = 'coordinate rank';
        label.textContent = square[1];
        label.setAttribute('aria-hidden', 'true');
        button.append(label);
      }
      if (index >= 56) {
        const label = document.createElement('span');
        label.className = 'coordinate file';
        label.textContent = square[0];
        label.setAttribute('aria-hidden', 'true');
        button.append(label);
      }
    }
    fragment.append(button);
  });
  $('#board').replaceChildren(fragment);
  if (activeSquare) $(`[data-square="${activeSquare}"]`)?.focus({ preventScroll: true });
}
function formatClock(ms) {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function renderClocks() {
  for (const id of ['top-player', 'bottom-player']) {
    const strip = $(`#${id}`);
    const color = strip.dataset.color;
    if (!color) continue;
    const clock = strip.querySelector('.clock');
    clock.textContent = game.settings.seconds ? formatClock(game.remaining[color]) : '∞';
    clock.classList.toggle('low', !!game.settings.seconds && game.remaining[color] < 30000);
    clock.setAttribute(
      'aria-label',
      `${COLORS[color]}, ${game.settings.seconds ? 'осталось ' + clock.textContent : 'без часов'}`,
    );
    strip.classList.toggle('active', !game.result && game.chess.turn() === color);
  }
}
function renderPlayers() {
  const history = game.chess.history({ verbose: true });
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const material = { w: 0, b: 0 };
  for (const piece of game.chess.board().flat().filter(Boolean))
    material[piece.color] += values[piece.type];
  ['top-player', 'bottom-player'].forEach((id, index) => {
    const color = index === 1 ? preferences.orientation : opposite(preferences.orientation);
    const strip = $(`#${id}`);
    strip.dataset.color = color;
    const computer = game.settings.mode === 'computer' && color !== game.settings.side;
    const avatar = strip.querySelector('.avatar');
    avatar.textContent = computer ? '♞' : color === 'w' ? '♔' : '♚';
    avatar.classList.toggle('black-avatar', color === 'b');
    strip.querySelector('.player-name').textContent = computer
      ? 'Компьютер'
      : game.settings.mode === 'computer'
        ? 'Вы'
        : COLORS[color];
    strip.querySelector('.player-subtitle').textContent = computer
      ? `${LEVEL_NAMES[game.settings.level]} · ${COLORS[color].toLowerCase()}`
      : COLORS[color] + ' фигуры';
    const captures = history
      .filter((move) => move.color === color && move.captured)
      .sort((a, b) => values[a.captured] - values[b.captured]);
    const captured = strip.querySelector('.captured');
    captured.innerHTML = captures.map((move) => pieceSvg(move.captured, opposite(color))).join('');
    if (material[color] > material[opposite(color)]) {
      const score = document.createElement('span');
      score.className = 'material-score';
      score.textContent = `+${material[color] - material[opposite(color)]}`;
      captured.append(score);
    }
    captured.setAttribute(
      'aria-label',
      captures.length
        ? 'Взятые фигуры: ' + captures.map((move) => PIECE_NAMES[move.captured]).join(', ')
        : 'Нет взятых фигур',
    );
  });
  renderClocks();
}
function renderHistory() {
  const list = $('#move-list');
  const history = game.chess.history({ verbose: true });
  const nearBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;
  const previousLength = Number(list.dataset.length || 0);
  list.replaceChildren();
  if (!history.length)
    list.innerHTML =
      '<div class="empty-history"><span aria-hidden="true">♙</span>Здесь начнётся история вашей партии</div>';
  let row;
  history.forEach((move, index) => {
    const number = move.before.split(' ')[5];
    if (move.color === 'w' || !row) {
      row = document.createElement('div');
      row.className = 'move-row';
      const marker = document.createElement('span');
      marker.className = 'move-number';
      marker.textContent = number + '.';
      row.append(marker, document.createElement('span'), document.createElement('span'));
      list.append(row);
    }
    const cell = row.children[move.color === 'w' ? 1 : 2];
    cell.textContent = move.san;
    if (index === history.length - 1) cell.className = 'latest';
  });
  list.dataset.length = history.length;
  if (nearBottom || previousLength !== history.length) list.scrollTop = list.scrollHeight;
  $('#move-count').textContent = `${history.length} полуходов`;
}
function statusText() {
  if (game.result) {
    const reasons = {
      checkmate: 'Мат. Отличная партия!',
      stalemate: 'Пат: у стороны нет допустимых ходов.',
      material: 'Недостаточно материала для мата.',
      repetition: 'Позиция повторилась три раза.',
      fifty: '50 ходов без взятия и движения пешек.',
      timeout: 'Время вышло.',
      resignation: 'Партия завершена сдачей.',
      agreement: 'Ничья по согласию игроков.',
    };
    return [
      game.result.winner ? `${COLORS[game.result.winner]} победили` : 'Ничья',
      reasons[game.result.reason],
    ];
  }
  if (engineFailure) return ['Нужна ещё попытка', 'Расчёт прервался. Нажмите «Повторить расчёт».'];
  if (job === 'computer')
    return ['Компьютер думает…', 'Ищет продолжение. Самое время подумать о своём.'];
  if (game.chess.isCheck()) return ['Шах!', `${COLORS[game.chess.turn()]} должны защитить короля.`];
  if (hint)
    return ['Есть идея', `Попробуйте ${hint.from} → ${hint.to}. Подсказка выделена на доске.`];
  if (job === 'hint') return ['Ищем хороший ход…', 'Подсказка появится на доске через мгновение.'];
  return [
    `Ход ${game.chess.turn() === 'w' ? 'белых' : 'чёрных'}`,
    game.chess.history().length
      ? 'Не спешите. Посмотрите, что задумал соперник.'
      : 'Выберите фигуру и сделайте первый ход.',
  ];
}
function renderStatus() {
  const [title, detail] = statusText();
  $('#status-title').textContent = title;
  $('#status-detail').textContent = detail;
  $('#mode-badge').textContent = game.settings.mode === 'computer' ? 'С компьютером' : 'С другом';
  const time = game.settings.seconds
    ? `${game.settings.seconds / 60} мин${game.settings.increment ? ' + ' + game.settings.increment + ' с' : ''}`
    : 'Без часов';
  $('#game-summary').replaceChildren(
    ...[
      time,
      game.settings.mode === 'computer' ? LEVEL_NAMES[game.settings.level] : 'На одном устройстве',
    ].map((text) => {
      const span = document.createElement('span');
      span.textContent = text;
      return span;
    }),
  );
  const history = game.chess.history();
  $('#undo-button').disabled =
    !history.length ||
    (game.settings.mode === 'computer' && game.settings.side === 'b' && history.length === 1);
  $('#hint-button').disabled = !humanCanMove() || !!job || !!promotion;
  $('#resign-button').disabled = !!game.result;
  $('#draw-button').disabled = !!game.result || game.settings.mode === 'computer';
  $('#draw-button').title =
    game.settings.mode === 'computer'
      ? 'Ничья по соглашению доступна в игре с другом'
      : 'Предложить ничью второму игроку';
  $('#retry-button').hidden = !engineFailure;
  $('#sound-button').setAttribute('aria-pressed', String(preferences.sound));
  $('#sound-button').setAttribute(
    'aria-label',
    preferences.sound ? 'Выключить звук' : 'Включить звук',
  );
  $('#sound-button').title = preferences.sound ? 'Выключить звук' : 'Включить звук';
  $('#coordinates-button').setAttribute('aria-pressed', String(preferences.coordinates));
  $('#board-caption').textContent = game.result
    ? 'Партия завершена · можно сохранить PGN'
    : selected
      ? `Выбрано ${selected} · нажмите на подсвеченное поле`
      : 'Кликните по фигуре, чтобы увидеть ходы';
}
function render() {
  renderBoard();
  renderPlayers();
  renderHistory();
  renderStatus();
}

function runEngine(kind) {
  if (game.result || (kind === 'computer' && !isComputerTurn())) return;
  cancelJob();
  job = kind;
  const id = requestId;
  const fen = game.chess.fen();
  const fail = () => {
    cancelJob();
    engineFailure = true;
    renderStatus();
    toast('Компьютер недоступен. Повторите расчёт или начните игру с другом.');
  };
  try {
    worker = new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
    worker.onerror = fail;
    worker.onmessage = ({ data }) => {
      if (data.id !== requestId || data.fen !== game.chess.fen()) return;
      if (data.error || !data.move) {
        fail();
        return;
      }
      const move = data.move;
      cancelJob();
      if (kind === 'computer') commitMove(move);
      else {
        hint = move;
        render();
        toast(`Подсказка: ${move.from} → ${move.to}`);
      }
    };
    worker.postMessage({
      id,
      fen,
      pgn: game.chess.pgn(),
      level: kind === 'hint' ? 'hard' : game.settings.level,
    });
    renderStatus();
  } catch {
    fail();
  }
}
function maybeComputer() {
  if (!game.result && isComputerTurn() && !job && !engineFailure) runEngine('computer');
}
function commitMove(input) {
  cancelJob();
  const move = game.move(input);
  selected = null;
  hint = null;
  promotion = null;
  if ($('#promotion-dialog').open) $('#promotion-dialog').close();
  if (move) sound(move);
  persist();
  render();
  maybeComputer();
}
function selectSquare(square) {
  if (!humanCanMove() || promotion) return;
  focused = square;
  if (selected) {
    const moves = game.chess
      .moves({ square: selected, verbose: true })
      .filter((move) => move.to === square);
    if (moves.length) {
      if (moves.some((move) => move.promotion)) {
        cancelJob();
        promotion = { from: selected, to: square };
        const choices = $('#promotion-choices');
        choices.replaceChildren();
        for (const type of ['q', 'r', 'b', 'n']) {
          const button = document.createElement('button');
          button.dataset.promotion = type;
          button.innerHTML = pieceSvg(type, game.chess.turn());
          const label = document.createElement('span');
          label.textContent = PIECE_NAMES[type];
          button.append(label);
          choices.append(button);
        }
        $('#promotion-dialog').showModal();
        renderStatus();
      } else commitMove({ from: selected, to: square });
      return;
    }
  }
  const piece = game.chess.get(square);
  selected = square !== selected && piece?.color === game.chess.turn() ? square : null;
  hint = null;
  renderBoard();
  renderStatus();
}
function undo() {
  if ($('#undo-button').disabled) return;
  cancelJob();
  const count =
    game.settings.mode === 'computer' && game.chess.turn() === game.settings.side ? 2 : 1;
  game.undo(count);
  selected = null;
  hint = null;
  promotion = null;
  $('#promotion-dialog').close();
  persist();
  render();
  maybeComputer();
}
function flip() {
  preferences.orientation = opposite(preferences.orientation);
  savePreferences();
  renderBoard();
  renderPlayers();
}
function openNewGame() {
  const form = $('#new-game-form');
  form.elements.mode.value = game.settings.mode;
  form.elements.side.value = game.settings.side;
  form.elements.level.value = game.settings.level;
  form.elements.time.value = `${game.settings.seconds}+${game.settings.increment}`;
  $('#computer-options').hidden = game.settings.mode !== 'computer';
  $('#new-game-dialog').showModal();
}
function confirm(title, detail, action) {
  $('#confirm-title').textContent = title;
  $('#confirm-detail').textContent = detail;
  confirmAction = action;
  $('#confirm-dialog').showModal();
}

$('#board').addEventListener('click', (event) => {
  const square = event.target.closest('.square');
  if (square) selectSquare(square.dataset.square);
});
$('#board').addEventListener('keydown', (event) => {
  const direction = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[event.key];
  if (direction) {
    event.preventDefault();
    const order = squareOrder();
    const index = order.indexOf(event.target.closest('.square')?.dataset.square || focused);
    const target = index + direction;
    if (
      target < 0 ||
      target > 63 ||
      (Math.abs(direction) === 1 && Math.floor(index / 8) !== Math.floor(target / 8))
    )
      return;
    focused = order[target];
    document.querySelectorAll('.square').forEach((button) => {
      button.tabIndex = button.dataset.square === focused ? 0 : -1;
    });
    $(`[data-square="${focused}"]`).focus();
  }
});
document.addEventListener('keydown', (event) => {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) ||
    $('dialog[open]')
  )
    return;
  if (event.key.toLowerCase() === 'f') {
    event.preventDefault();
    flip();
  }
  if (event.key.toLowerCase() === 'u') {
    event.preventDefault();
    undo();
  }
  if (event.key === 'Escape') {
    selected = null;
    hint = null;
    renderBoard();
    renderStatus();
  }
});
$('#new-game-button').onclick = openNewGame;
$('#new-game-form').addEventListener('change', () => {
  $('#computer-options').hidden = $('#new-game-form').elements.mode.value !== 'computer';
});
$('#new-game-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  const [seconds, increment] = values.get('time').split('+').map(Number);
  const side =
    values.get('side') === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : values.get('side');
  cancelJob();
  game = new Game({
    ...DEFAULT_SETTINGS,
    mode: values.get('mode'),
    side,
    level: values.get('level'),
    seconds,
    increment,
  });
  selected = null;
  hint = null;
  promotion = null;
  focused = side === 'w' ? 'e2' : 'e7';
  preferences.orientation = game.settings.mode === 'computer' ? side : 'w';
  savePreferences();
  $('#new-game-dialog').close();
  persist();
  render();
  maybeComputer();
});
document.querySelectorAll('.close-dialog').forEach((button) => {
  button.onclick = () => button.closest('dialog').close();
});
$('#promotion-dialog').addEventListener('close', () => {
  promotion = null;
  renderStatus();
});
$('#promotion-choices').onclick = (event) => {
  const button = event.target.closest('[data-promotion]');
  if (button && promotion) commitMove({ ...promotion, promotion: button.dataset.promotion });
};
$('#help-button').onclick = () => $('#help-dialog').showModal();
$('#flip-button').onclick = flip;
$('#undo-button').onclick = undo;
$('#hint-button').onclick = () => runEngine('hint');
$('#retry-button').onclick = () => runEngine(isComputerTurn() ? 'computer' : 'hint');
$('#sound-button').onclick = () => {
  preferences.sound = !preferences.sound;
  savePreferences();
  sound();
  renderStatus();
};
$('#coordinates-button').onclick = () => {
  preferences.coordinates = !preferences.coordinates;
  savePreferences();
  renderBoard();
  renderStatus();
};
$('#resign-button').onclick = () => {
  const color = game.settings.mode === 'computer' ? game.settings.side : game.chess.turn();
  confirm(
    'Завершить партию?',
    `${COLORS[color]} признают поражение. Партию можно будет скачать в PGN.`,
    () => {
      game.resign(color);
    },
  );
};
$('#draw-button').onclick = () =>
  confirm(
    'Согласны на ничью?',
    'Подтвердите, если оба игрока согласны завершить партию вничью.',
    () => {
      game.agreeDraw();
    },
  );
$('#confirm-action').onclick = () => {
  cancelJob();
  confirmAction?.();
  selected = null;
  hint = null;
  $('#confirm-dialog').close();
  persist();
  render();
};
$('#export-button').onclick = () => {
  const url = URL.createObjectURL(
    new Blob([game.exportPgn()], { type: 'application/x-chess-pgn;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `chess-io-${new Date().toISOString().slice(0, 10)}.pgn`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Запись партии скачана в формате PGN.');
};
$('#copy-fen-button').onclick = async () => {
  try {
    await navigator.clipboard.writeText(game.chess.fen());
    toast('Позиция FEN скопирована.');
  } catch {
    toast('Браузер не разрешил копирование. Сохраните партию в PGN.');
  }
};
let lastPersist = Date.now();
setInterval(() => {
  const previousResult = game.result;
  game.tick();
  if (!previousResult && game.result) {
    cancelJob();
    selected = null;
    hint = null;
    promotion = null;
    $('#promotion-dialog').close();
    persist();
    render();
  } else renderClocks();
  if (game.started && !game.result && Date.now() - lastPersist >= 1000) {
    persist();
    lastPersist = Date.now();
  }
}, 100);
document.addEventListener('visibilitychange', () => {
  persist();
  if (game.result) {
    cancelJob();
    render();
  }
});
window.addEventListener('pagehide', persist);
render();
persist();
maybeComputer();
if (restoreMessage) toast(restoreMessage);
