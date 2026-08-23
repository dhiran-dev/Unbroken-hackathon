// Throw 2 hangs — where is the ball? Track it after each throw.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 720, height: 1120 } });
page.on('pageerror', e => console.log('PERR:', String(e)));

await page.goto('http://127.0.0.1:8931/caffeine-knockdown.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game?.state?.().ready === true, null, { timeout: 60000 });

const dump = () => page.evaluate(() => {
  const s = window.__game.state();
  return { ...s, ballDebug: window.__ballDebug ? window.__ballDebug() : null };
});

// throw 1 (verified good)
await page.evaluate(() => window.__game.throw({ x: 0, y: 4.05, z: -11.5 }));
for (let t = 0; t < 12; t++){
  await page.waitForTimeout(600);
  const d = await dump();
  if (d.ballReady) { console.log('T1_READY', JSON.stringify(d)); break; }
}

// throw 2 (the hang case)
await page.evaluate(() => window.__game.throw({ x: -1.2, y: 3.6, z: -11.2 }));
for (let t = 0; t < 16; t++){
  await page.waitForTimeout(600);
  const d = await dump();
  console.log(`T2 ${(t * 0.6).toFixed(1)}s`, JSON.stringify(d));
  if (d.ballReady || d.level > 1) break;
}
await browser.close();
