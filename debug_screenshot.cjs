// Debug-QA screenshot helper — loads the running dev server with
// ?galleryCreature=<kind> (see main.ts) and saves a PNG of the isolated,
// posed, camera-framed creature to /tmp for visual comparison against a
// reference image. Not part of the app bundle; run manually with
// `node debug_screenshot.cjs <kind> [distance] [outPath]`.
const { chromium } = require('playwright');

async function main() {
  const kind = process.argv[2] || 'unicorn';
  const distance = process.argv[3] || '';
  const outPath = process.argv[4] || `/tmp/debug_${kind}.png`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });

  const url = `http://localhost:5175/?galleryCreature=${kind}${distance ? `&galleryDistance=${distance}` : ''}`;
  await page.goto(url);

  // Wait until poseDebugCreatureIfReady has run (sets window.__debugPosed).
  await page.waitForFunction(() => (window).__debugPosed === true, { timeout: 10000 });
  // Let a couple more animation frames settle (camera update, first render).
  await page.waitForTimeout(400);

  await page.screenshot({ path: outPath });
  console.log('Saved', outPath);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
