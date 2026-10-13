// Usage: bun shoot.ts stills t1 t2 ...  |  bun shoot.ts video out.mp4
import { chromium } from "playwright-core";
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: exe, args: ["--allow-file-access-from-files", "--font-render-hinting=none"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto("file://" + import.meta.dir + "/index.html");
await page.evaluate(() => (window as any).ready);
const [mode, ...rest] = process.argv.slice(2);
if (mode === "stills") {
  await Bun.$`mkdir -p stills`;
  for (const t of rest) {
    await page.evaluate((t) => (window as any).render(t), Number(t));
    await page.screenshot({ path: `stills/t${t}.png` });
  }
} else {
  const fps = 30, dur = 24, out = rest[0] ?? "silent.mp4";
  const ff = Bun.spawn(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow", "-r", String(fps), out], { stdin: "pipe" });
  for (let f = 0; f < fps * dur; f++) {
    await page.evaluate((t) => (window as any).render(t), f / fps);
    ff.stdin.write(await page.screenshot({ type: "png" }));
    if (f % 60 === 0) console.log("frame", f);
  }
  ff.stdin.end(); await ff.exited;
}
await browser.close();
