// One-off: capture the PUBLIC signed-out landing page for the Help centre.
// Usage: node scripts/capture-landing.mjs [baseUrl]
// Only the public "/" is captured here — the product surfaces (/agent-network,
// /builder, /lifecycle) sit behind Anypoint auth and must be shot while logged in.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] || "http://localhost:3300";
const OUT_DIR = "public/images/help";
const OUT = `${OUT_DIR}/landing-three-tools.png`;

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newContext({
  viewport: { width: 1440, height: 900 }, // 16:10, matches the <Shot> default ratio
  deviceScaleFactor: 2, // retina-crisp
}).then((ctx) => ctx.newPage());

console.log(`[capture] loading ${BASE}/ …`);
await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 });
// Let fonts + any entrance animation settle before the shot.
await page.waitForTimeout(1500);

await page.screenshot({ path: OUT }); // viewport-only (not fullPage) to keep 16:10
console.log(`[capture] wrote ${OUT}`);

await browser.close();
