// Visual check via in-page framebuffer grab (bypasses headless compositor stalls)
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = 'http://127.0.0.1:8931/caffeine-knockdown.html';
const SHOT_DIR = '/home/dhiran/Dhiran/brightdata_hackathon/games/verify';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 720, height: 1120 } });
page.on('pageerror', e => console.log('PERR:', String(e)));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game?.state?.().ready === true, null, { timeout: 90000 });
await page.waitForFunction(() => (window.__frames || 0) > 3, null, { timeout: 90000 });

const dataUrl = await page.evaluate(() => window.__snap());
fs.writeFileSync(`${SHOT_DIR}/snap-loaded.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('SNAP1 saved,', Math.round(dataUrl.length / 1024), 'KB');

// throw at the stack, fast-forward, grab again (meter should be brighter/fuller)
await page.evaluate(() => window.__game.throw({ x: 0, y: 2.1, z: -12 }));
for (let i = 0; i < 60; i++){
  await page.evaluate(() => window.__game.ff(20));
  const rdy = await page.evaluate(() => window.__game.state().ballReady);
  if (rdy) break;
}
const s = await page.evaluate(() => window.__game.state());
console.log('AFTER_THROW', JSON.stringify(s));
const dataUrl2 = await page.evaluate(() => window.__snap());
fs.writeFileSync(`${SHOT_DIR}/snap-after.png`, Buffer.from(dataUrl2.split(',')[1], 'base64'));
console.log('SNAP2 saved,', Math.round(dataUrl2.length / 1024), 'KB');
await browser.close();
