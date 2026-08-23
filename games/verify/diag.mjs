// Diagnostic run: what happened after the throw?
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
page.on('console', m => { if (m.type() === 'error') console.log('CERR:', m.text()); });
page.on('pageerror', e => console.log('PERR:', String(e)));

await page.goto('http://127.0.0.1:8931/caffeine-knockdown.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game?.state?.().ready === true, null, { timeout: 60000 });
await page.waitForTimeout(800);

await page.evaluate(() => window.__game.throw({ x: 0, y: 4.05, z: -11.5 }));
for (let t = 0; t < 10; t++){
  await page.waitForTimeout(500);
  const d = await page.evaluate(() => {
    const s = window.__game.state();
    return { ...s, frames: window.__frames || 0, simError: window.__simError || null };
  });
  console.log(`t=${((t + 1) * 0.5).toFixed(1)}s`, JSON.stringify(d));
}
await page.screenshot({ path: '/home/dhiran/Dhiran/brightdata_hackathon/games/verify/diag.png' });
await browser.close();
