import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

(async () => {
  const base = import.meta.dirname;
  const shotsDirectory = path.join(base, 'shots');
  const shots = [
    ['components.html', 'components.png', 1440, 900, true],
    ['styleguide.html', 'styleguide.png', 1440, 900, false],
    ['explore-a.html', 'explore-a.png', 1440, 900, true],
    ['leaderboard-b.html', 'leaderboard-b.png', 1440, 900, true],
    ['passport-c.html', 'passport-c.png', 1440, 900, true],
    ['explore-a.html', 'explore-a-mobile.png', 390, 844, true],
  ];
  await mkdir(shotsDirectory, { recursive: true });
  const browser = await chromium.launch();
  for (const [file, out, w, h, full] of shots) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(pathToFileURL(path.join(base, file)).href, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);
    await page.screenshot({ path: path.join(shotsDirectory, out), fullPage: full });
    await page.close();
  }
  await browser.close();
  console.log('done');
})().catch(e => { console.error(e.message); process.exit(1); });
