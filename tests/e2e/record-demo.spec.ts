import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Locator, Page } from "@playwright/test";
import { DEMO_ORIGIN, expect, test } from "./fixtures";

/**
 * Records docs/demo.gif, the README demo, from the real DevTools window.
 * Opt-in: `vp run demo:record` (needs ffmpeg).
 */
// Skipped here rather than in the test body, so Chrome is not launched just to skip.
test.skip(!process.env.RECORD_DEMO, "set RECORD_DEMO=1 (vp run demo:record)");

const DESCRIPTOR = new URL("../../example/descriptor.binpb", import.meta.url).pathname;
const OUTPUT = new URL("../../docs/demo.gif", import.meta.url).pathname;
const WIDTH = 1000;
const FPS = 12;

test("record the README demo", async ({ app, devtools }) => {
  test.setTimeout(120_000);
  const { window } = devtools;
  await undock(window);
  // Chrome in another UI language offers to switch DevTools to it.
  await window
    .getByRole("button", { name: /show again/i })
    .click({ timeout: 3000 })
    .catch(() => {});
  const panel = await devtools.openPanel();
  // The panel takes DevTools' theme once, at startup, which follows the OS; match the light DevTools.
  await panel.evaluate(() => document.documentElement.classList.remove("dark"));
  const row = (method: string, transport: string) =>
    panel.locator(`.list tbody tr[data-method="${method}"][data-transport="${transport}"]`).first();

  // Off camera: register the schema so the recording starts from an empty, ready panel.
  await panel.getByRole("button", { name: /^Schemas/ }).click();
  await panel.locator('.dropzone input[type="file"]').setInputFiles(DESCRIPTOR);
  await expect(panel.locator(".schema")).toContainText("shop.v1.OrderService");
  await panel.getByRole("button", { name: "Schemas (1)" }).click();

  const cursor = await Cursor.create(window);
  const recording = await Recording.start(window);
  try {
    await pause(800);

    // Capture: calls show up as the shop scenario runs.
    await app.goto(`${DEMO_ORIGIN}/?auto=shop`);
    await expect(app).toHaveTitle("done", { timeout: 30_000 });
    await pause(1200);

    // Detail: a decoded response, its request, and a failed call with error details.
    await cursor.click(row("GetProduct", "grpc-web"));
    await pause(2000);
    await cursor.click(panel.locator(".tabs").getByRole("button", { name: "Request", exact: true }));
    await pause(1500);
    await cursor.click(row("CreateOrder", "grpc-web"));
    await cursor.click(panel.locator(".tabs").getByRole("button", { name: "Response", exact: true }));
    await expect(panel.locator(".status-box.failed")).toContainText("FAILED_PRECONDITION");
    await pause(2000);

    // Schema browser: jump from the response type to a field's type, then view it as .proto.
    await cursor.click(row("GetProduct", "grpc-web"));
    await cursor.click(panel.getByRole("link", { name: "shop.v1.GetProductResponse" }));
    await expect(panel.getByRole("heading", { name: "shop.v1.GetProductResponse" })).toBeVisible();
    await pause(1200);
    await cursor.click(panel.locator(".type-detail .type-link", { hasText: /(^|\.)Product$/ }).first());
    await expect(panel.getByRole("heading", { name: "shop.v1.Product" })).toBeVisible();
    await pause(2000);
    await cursor.click(panel.getByRole("group", { name: "View as" }).getByRole("button", { name: ".proto" }));
    await pause(2500);
  } finally {
    await recording.stop(OUTPUT);
  }
});

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Moves DevTools into its own window of a fixed size, so the recording is DevTools only. */
async function undock(page: Page) {
  await page.evaluate(async () => {
    // @ts-expect-error DevTools frontend module, resolved inside devtools://
    const UI = await import("./ui/legacy/legacy.js");
    UI.DockController.DockController.instance().setDockSide("undocked");
  });
  const session = await page.context().newCDPSession(page);
  const { windowId } = await session.send("Browser.getWindowForTarget");
  await session.send("Browser.setWindowBounds", { windowId, bounds: { width: 1200, height: 720 } });
  await session.detach();
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(1100);
  await page.emulateMedia({ colorScheme: "light" });
}

/**
 * A drawn mouse pointer: screencast frames have none, so clicks would otherwise look
 * like the UI changing by itself. Moves in steps so the motion shows up in the GIF.
 */
class Cursor {
  private x = 400;
  private y = 300;

  private constructor(private readonly page: Page) {}

  static async create(page: Page) {
    await page.evaluate(() => {
      const el = document.createElement("div");
      el.id = "demo-cursor";
      Object.assign(el.style, {
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        width: "18px",
        height: "18px",
        margin: "-9px 0 0 -9px",
        borderRadius: "50%",
        background: "rgb(26 115 232 / 45%)",
        border: "2px solid rgb(26 115 232)",
        transition: "transform 120ms",
      });
      document.body.append(el);
    });
    const cursor = new Cursor(page);
    await cursor.moveTo(cursor.x, cursor.y, 1);
    return cursor;
  }

  async click(target: Locator) {
    await target.waitFor();
    const box = (await target.boundingBox())!;
    await this.moveTo(box.x + Math.min(box.width / 2, 60), box.y + box.height / 2, 12);
    await pause(150);
    await this.press(true);
    await this.page.mouse.click(this.x, this.y);
    await pause(120);
    await this.press(false);
    await pause(300);
  }

  private async moveTo(x: number, y: number, steps: number) {
    const [fromX, fromY] = [this.x, this.y];
    for (let i = 1; i <= steps; i++) {
      // Ease in and out.
      const t = i / steps;
      const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.x = fromX + (x - fromX) * k;
      this.y = fromY + (y - fromY) * k;
      await this.page.mouse.move(this.x, this.y);
      await this.page.evaluate(
        ([x, y]) => {
          const el = document.getElementById("demo-cursor")!;
          el.style.left = `${x}px`;
          el.style.top = `${y}px`;
        },
        [this.x, this.y],
      );
      await pause(16);
    }
  }

  private press(down: boolean) {
    return this.page.evaluate((down) => {
      document.getElementById("demo-cursor")!.style.transform = down ? "scale(0.7)" : "";
    }, down);
  }
}

/** Collects screencast frames with their timestamps and encodes them with ffmpeg. */
class Recording {
  private readonly frames: { file: string; time: number }[] = [];

  private constructor(
    private readonly dir: string,
    private readonly stopCapture: () => Promise<void>,
  ) {}

  static async start(page: Page) {
    const dir = await mkdtemp(join(tmpdir(), "grpc-devtools-demo-"));
    const session = await page.context().newCDPSession(page);
    let recording: Recording | undefined = undefined;
    const writes: Promise<void>[] = [];
    session.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      const file = join(dir, `${String(recording!.frames.length).padStart(5, "0")}.png`);
      recording!.frames.push({ file, time: metadata.timestamp! });
      writes.push(writeFile(file, data, "base64"));
      void session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    recording = new Recording(dir, async () => {
      await session.send("Page.stopScreencast");
      await Promise.all(writes);
      await session.detach();
    });
    await session.send("Page.startScreencast", { format: "png" });
    return recording;
  }

  async stop(output: string) {
    // Frames only arrive when something changes, so hold the last one until now.
    const end = Date.now() / 1000;
    await this.stopCapture();
    try {
      const list = this.frames.map(({ file, time }, i) => {
        const next = this.frames[i + 1]?.time ?? end;
        return `file '${file}'\nduration ${Math.max(next - time, 0.001).toFixed(3)}`;
      });
      // The concat demuxer ignores the last entry's duration unless the file is repeated.
      list.push(`file '${this.frames.at(-1)!.file}'`);
      const concat = join(this.dir, "frames.txt");
      await writeFile(concat, list.join("\n") + "\n");
      const filters =
        `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,split[a][b];` +
        "[a]palettegen=stats_mode=diff[p];" +
        "[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle";
      await promisify(execFile)("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concat,
        "-vf",
        filters,
        "-loop",
        "0",
        output,
      ]);
    } finally {
      await rm(this.dir, { recursive: true, force: true });
    }
  }
}
