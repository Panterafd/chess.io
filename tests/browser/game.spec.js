import { test, expect } from '@playwright/test';

const square = (page, name) => page.locator(`[data-square="${name}"]`);
const move = async (page, from, to) => {
  await square(page, from).click();
  await square(page, to).click();
};
async function newGame(page, { mode = 'local', side = 'w', level = 'easy', time = '0+0' } = {}) {
  await page.getByRole('button', { name: 'Новая партия' }).click();
  await page.locator(`input[name="mode"][value="${mode}"]`).check();
  if (mode === 'computer') {
    await page.locator('select[name="side"]').selectOption(side);
    await page.locator('select[name="level"]').selectOption(level);
  }
  await page.locator('select[name="time"]').selectOption(time);
  await page.getByRole('button', { name: 'Начать игру' }).click();
}
async function loadPosition(page, fen, settings = {}) {
  const raw = await page.evaluate(
    async ({ fen, settings }) => {
      const { Game, DEFAULT_SETTINGS } = await import('/src/game.js');
      const game = new Game(
        { ...DEFAULT_SETTINGS, mode: 'local', seconds: 0, ...settings },
        { fen },
      );
      return game.serialize();
    },
    { fen, settings },
  );
  // Leave the running app before replacing its save; pagehide deliberately persists it.
  await page.goto('/favicon.svg');
  await page.evaluate((raw) => localStorage.setItem('chess.io.game.v1', raw), raw);
  await page.goto('/');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.square')).toHaveCount(64);
});
test('legal selection, move history, reload and undo', async ({ page }) => {
  await newGame(page);
  await square(page, 'e2').click();
  await expect(page.locator('.legal')).toHaveCount(2);
  await square(page, 'e4').click();
  await expect(square(page, 'e4')).toHaveAttribute('aria-label', /Белые, пешка/);
  await expect(page.locator('#move-list')).toContainText('e4');
  await move(page, 'e7', 'e5');
  await page.reload();
  await expect(page.locator('#move-list')).toContainText('e5');
  await page.locator('#undo-button').click();
  await expect(square(page, 'e7')).toHaveAttribute('aria-label', /Чёрные, пешка/);
  await expect(square(page, 'e5')).toHaveAttribute('aria-label', /пусто/);
});
test('local fool’s mate, game over and PGN download', async ({ page }) => {
  await newGame(page);
  for (const [from, to] of [
    ['f2', 'f3'],
    ['e7', 'e5'],
    ['g2', 'g4'],
    ['d8', 'h4'],
  ])
    await move(page, from, to);
  await expect(page.locator('#status-title')).toHaveText('Чёрные победили');
  await expect(page.locator('#hint-button')).toBeDisabled();
  await expect(page.locator('.in-check')).toHaveAttribute('data-square', 'e1');
  const download = page.waitForEvent('download');
  await page.locator('#export-button').click();
  expect((await download).suggestedFilename()).toMatch(/chess-io-.*\.pgn/);
  await page.locator('#undo-button').click();
  await expect(page.locator('#status-title')).toHaveText('Ход чёрных');
});
test('computer answers and undo removes both plies', async ({ page }) => {
  await newGame(page, { mode: 'computer' });
  await move(page, 'e2', 'e4');
  await expect(page.locator('#move-count')).toHaveText('2 полуходов', { timeout: 10000 });
  await page.locator('#undo-button').click();
  await expect(page.locator('#move-count')).toHaveText('0 полуходов');
  await expect(square(page, 'e2')).toHaveAttribute('aria-label', /Белые, пешка/);
});
test('playing black rotates the board and computer opens', async ({ page }) => {
  await newGame(page, { mode: 'computer', side: 'b' });
  await expect(page.locator('.square').first()).toHaveAttribute('data-square', 'h1');
  await expect(page.locator('#move-count')).toHaveText('1 полуходов', { timeout: 10000 });
  await expect(page.locator('#status-title')).toHaveText('Ход чёрных');
  await expect(page.locator('#undo-button')).toBeDisabled();
});
test('a new game cancels an old worker reply', async ({ page }) => {
  await newGame(page, { mode: 'computer', level: 'hard' });
  await move(page, 'e2', 'e4');
  await newGame(page);
  await page.waitForTimeout(2200); // Must outlast the old worker's maximum search budget.
  await expect(page.locator('#move-count')).toHaveText('0 полуходов');
  await expect(square(page, 'e2')).toHaveAttribute('aria-label', /Белые, пешка/);
});
test('promotion requires a choice and supports a knight', async ({ page }) => {
  await loadPosition(page, '7k/P7/8/8/8/8/8/7K w - - 0 1');
  await move(page, 'a7', 'a8');
  await expect(page.locator('#promotion-dialog')).toBeVisible();
  await page.locator('[data-promotion="n"]').click();
  await expect(square(page, 'a8')).toHaveAttribute('aria-label', /Белые, конь/);
  await expect(page.locator('#status-title')).toHaveText('Ничья');
});
test('castling and en passant are reflected on the board', async ({ page }) => {
  await loadPosition(page, 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  await move(page, 'e1', 'g1');
  await expect(square(page, 'f1')).toHaveAttribute('aria-label', /Белые, ладья/);
  await loadPosition(page, 'rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
  await move(page, 'e5', 'd6');
  await expect(square(page, 'd5')).toHaveAttribute('aria-label', /пусто/);
  await expect(square(page, 'd6')).toHaveAttribute('aria-label', /Белые, пешка/);
});
test('keyboard play, board flip and coordinates', async ({ page }) => {
  await newGame(page);
  await square(page, 'e2').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.locator('#move-list')).toContainText('e4');
  await page.locator('#flip-button').click();
  await expect(page.locator('.square').first()).toHaveAttribute('data-square', 'h1');
  await page.locator('#coordinates-button').click();
  await expect(page.locator('.coordinate')).toHaveCount(0);
});
test('hint highlights a legal move without changing the position', async ({ page }) => {
  await newGame(page);
  await page.locator('#hint-button').click();
  await expect(page.locator('.hint')).toHaveCount(2, { timeout: 10000 });
  await expect(page.locator('#move-count')).toHaveText('0 полуходов');
});
test('resignation needs confirmation and ends the game', async ({ page }) => {
  await newGame(page);
  await page.locator('#resign-button').click();
  await page.getByRole('button', { name: 'Продолжить игру' }).click();
  await expect(page.locator('#status-title')).toHaveText('Ход белых');
  await page.locator('#resign-button').click();
  await page.locator('#confirm-action').click();
  await expect(page.locator('#status-title')).toHaveText('Чёрные победили');
});
test('unavailable storage does not break play', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('Storage unavailable');
    };
  });
  await page.reload();
  await newGame(page);
  await move(page, 'd2', 'd4');
  await expect(page.locator('#move-list')).toContainText('d4');
  await expect(page.locator('#save-status')).toContainText('Сохранение недоступно');
});
test('worker failures are visible and can be retried', async ({ page }) => {
  await page.route('**/src/engine-worker.js', (route) => route.abort());
  await newGame(page, { mode: 'computer' });
  await move(page, 'd2', 'd4');
  await expect(page.locator('#retry-button')).toBeVisible();
  await page.unroute('**/src/engine-worker.js');
  await page.locator('#retry-button').click();
  await expect(page.locator('#move-count')).toHaveText('2 полуходов', { timeout: 10000 });
});
test('clock expiry on reload locks moves', async ({ page }) => {
  await newGame(page, { time: '300+0' });
  await move(page, 'e2', 'e4');
  const raw = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('chess.io.game.v1'));
    data.savedAt -= 301000;
    return JSON.stringify(data);
  });
  await page.goto('/favicon.svg');
  await page.evaluate((raw) => localStorage.setItem('chess.io.game.v1', raw), raw);
  await page.goto('/');
  await expect(page.locator('#status-title')).toHaveText('Белые победили');
  await expect(page.locator('#status-detail')).toContainText('Время вышло');
});
test('layout fits viewport and makes no external requests', async ({ page }, testInfo) => {
  const errors = [];
  const external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4173')) external.push(request.url());
  });
  await page.reload();
  await expect(page.locator('.square')).toHaveCount(64);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const box = await page.locator('#board').boundingBox();
  expect(Math.abs(box.width - box.height)).toBeLessThan(2);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  await page.screenshot({ path: `artifacts/${testInfo.project.name}.png`, fullPage: true });
});
