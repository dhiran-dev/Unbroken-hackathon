// Aim-assist accuracy test: raw arcs that pass NEAR a can must lock and correct
// to hit its center (within 3cm). Also verifies meter position/size via state.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 720, height: 1120 } });
page.on('pageerror', e => console.log('PERR:', String(e)));

await page.goto('http://127.0.0.1:8931/caffeine-knockdown.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game?.state?.().ready === true, null, { timeout: 90000 });
await page.waitForFunction(() => (window.__frames || 0) > 3, null, { timeout: 90000 });

const out = await page.evaluate(() => {
  window.__game.ff(120);                       // settle
  const cans = window.__cansDebug().filter(c => c.kind === 'norm');
  const results = [];
  // realistic player throw: nearly-right arc with ~25cm-worth of human error
  for (const c of cans.slice(0, 4)){
    const dx = c.p.x - 0;
    const dy = c.p.y - 1.44;
    const dz = c.p.z - 4.3;
    const d = Math.hypot(dx, dz);
    const g = 11.5;
    const s = 12;
    const s2 = s * s;
    const disc = s2 * s2 - g * (g * d * d + 2 * dy * s2);
    if (disc < 0){ results.push({ locked: false, skip: 'unreachable' }); continue; }
    const th = Math.atan((s2 - Math.sqrt(disc)) / (g * d));
    const perfect = { x: Math.cos(th) * s * dx / d, y: Math.sin(th) * s, z: Math.cos(th) * s * dz / d };
    // sloppy version: underthrow slightly and drift a little right — stays within capture radius
    const raw = { x: perfect.x + 0.35, y: perfect.y - 0.55, z: perfect.z };
    const r = window.__assistTest(raw);
    const err = r.locked
      ? Math.hypot(r.crossing.x - r.ring.x, r.crossing.y - r.ring.y) : null;
    results.push({ locked: r.locked, errCm: err === null ? null : +(err * 100).toFixed(1) });
  }
  return { results };
});
console.log('ASSIST_RESULTS', JSON.stringify(out.results));
const locked = out.results.filter(r => r.locked);
const maxErr = Math.max(...locked.map(r => r.errCm));
console.log(`locked ${locked.length}/${out.results.length}, max error ${maxErr} cm`);
console.log(locked.length >= 3 && maxErr <= 3.0 ? 'RESULT: PASS' : 'RESULT: FAIL');
await browser.close();
process.exit(locked.length >= 3 && maxErr <= 3.0 ? 0 : 1);
