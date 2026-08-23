// Phase 2 verification — fully synchronous now: sim-tick timers + ff()
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8931/caffeine-knockdown.html';
const SHOT_DIR = '/home/dhiran/Dhiran/brightdata_hackathon/games/verify';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 720, height: 1120 } });

const consoleErrors = [], pageErrors = [], failedReqs = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('requestfailed', r => failedReqs.push(r.url() + ' :: ' + (r.failure()?.errorText || '?')));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('STAGE: goto');
await page.waitForFunction(() => window.__game?.state?.().ready === true, null, { timeout: 90000 });
await page.waitForFunction(() => (window.__frames || 0) > 3, null, { timeout: 90000 });
console.log('STAGE: ready');
async function shot(name){
  try { await page.screenshot({ path: `${SHOT_DIR}/${name}`, timeout: 20000 }); }
  catch { console.log(`STAGE: screenshot ${name} skipped (headless GL stall)`); }
}
await shot('01-loaded.png');

const report = await page.evaluate(() => {
  const st = () => window.__game.state();
  const ff = window.__game.ff;
  const log = [];

  // 1) rack stable at rest
  ff(150);
  const s0 = st();
  log.push(['LOAD', s0.score === 0 && s0.cansLeft === s0.cansTotal ? 'OK' : 'FAIL', JSON.stringify(s0)]);

  // 2) three throws; everything settles synchronously
  // aims computed for the reference-wall rack (base pyramid y≈1.1 z≈−1.37, top row y≈2.27 z≈−1.99)
  const AIM = [
    { x: 0, y: 2.1, z: -12 },      // into the bottom-shelf stack
    { x: 0, y: 4.59, z: -12 },     // onto the top-shelf row
    { x: -1.2, y: 3.6, z: -11.2 }, // deliberate wide miss
  ];
  const ends = [];
  for (let i = 0; i < 3; i++){
    const before = st();
    window.__game.throw(AIM[i]);
    for (let k = 0; k < 1200 && !st().ballReady && st().level <= before.level; k++) ff(10);
    ff(140);                                  // respawn / rack-over grace
    const after = st();
    ends.push(after);
    log.push([`THROW${i + 1}`, `score=${after.score} left=${after.cansLeft} balls=${after.ballsLeft} lvl=${after.level}`]);
  }

  // 3) rack transition after the third ball
  for (let k = 0; k < 400 && st().level <= 1; k++) ff(10);
  const sEnd = st();
  log.push(['TRANSITION', sEnd.level >= 2 ? 'OK' : 'FAIL', `level=${sEnd.level} balls=${sEnd.ballsLeft}`]);

  // 4) restart
  document.getElementById('restart').click();
  ff(150);
  const s3 = st();
  log.push(['RESTART', (s3.level === 1 && s3.score === 0 && s3.ballsLeft === 3 && s3.ballReady) ? 'OK' : 'FAIL',
    JSON.stringify(s3)]);

  return { log, s0, ends, sEnd, simError: window.__simError || null };
});

report.log.forEach(l => console.log(l.join(' ')));
console.log('SIM_ERROR', JSON.stringify(report.simError));
console.log('CONSOLE_ERRORS', JSON.stringify(consoleErrors));
console.log('PAGE_ERRORS', JSON.stringify(pageErrors));
console.log('FAILED_REQS', JSON.stringify(failedReqs));

const get = n => report.log.find(l => l[0] === n);
const knocked = report.ends.some((e, i) => i < 2 && e.cansLeft < report.s0.cansTotal);
const pass =
  report.simError === null && consoleErrors.length === 0 && pageErrors.length === 0 && failedReqs.length === 0 &&
  get('LOAD')[1] === 'OK' &&
  report.ends.length === 3 &&
  knocked &&                                            // shots connect with cans (score + or −)
  get('TRANSITION')[1] === 'OK' &&
  get('RESTART')[1] === 'OK';
console.log(pass ? 'RESULT: PASS' : 'RESULT: FAIL');
await shot('02-end.png');
await browser.close();
process.exit(pass ? 0 : 1);
