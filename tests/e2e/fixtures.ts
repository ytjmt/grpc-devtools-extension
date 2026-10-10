import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, test as base, type Browser, type BrowserContext, type Frame, type Page } from "@playwright/test";
import { DEMO_PORT } from "../../playwright.config";

const EXTENSION_DIR = new URL("../../dist", import.meta.url).pathname;
export const DEMO_ORIGIN = `http://localhost:${DEMO_PORT}`;

export interface DevTools {
  /** The DevTools frontend window, exposed as a normal Page via a second CDP connection. */
  window: Page;
  /** Shows our "gRPC" panel and returns its frame. */
  openPanel(): Promise<Frame>;
  /** The extension's devtools.html frame (holds the capture store). */
  devtoolsPage(): Frame;
}

type Fixtures = {
  context: BrowserContext;
  /** The inspected page (the demo app). */
  app: Page;
  devtools: DevTools;
};

function waitFor<T>(fn: () => T | undefined, what: string, timeout = 10_000): Promise<T> {
  return waitForAsync(async () => fn(), what, timeout);
}

async function readDevToolsPort(userDataDir: string): Promise<string> {
  const file = join(userDataDir, "DevToolsActivePort");
  return waitForAsync(async () => (await readFile(file, "utf8").catch(() => "")).split("\n")[0], "DevToolsActivePort");
}

async function waitForAsync<T>(fn: () => Promise<T | undefined>, what: string, timeout = 10_000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export const test = base.extend<Fixtures & { userDataDir: string; cdp: Browser }>({
  userDataDir: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), "grpc-devtools-e2e-"));
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },

  // Extensions need a persistent context. DevTools is auto-opened for every tab.
  context: async ({ userDataDir }, use) => {
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: !process.env.HEADFUL,
      viewport: null,
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        "--auto-open-devtools-for-tabs",
        "--window-size=1600,1000",
        // Playwright hides devtools:// pages on its own pipe; a second CDP connection exposes them.
        "--remote-debugging-port=0",
      ],
    });
    await use(context);
    await context.close();
  },

  cdp: async ({ context, userDataDir }, use) => {
    void context; // the browser must be running first
    const endpoint = `http://127.0.0.1:${await readDevToolsPort(userDataDir)}`;
    // connectOverCDP only picks up devtools:// pages that already exist, so wait for
    // the auto-opened DevTools window (and our extension frame in it) first.
    await waitForAsync(async () => {
      const targets: { url: string }[] = await (await fetch(`${endpoint}/json/list`)).json();
      return targets.some((t) => t.url.startsWith("chrome-extension://") && t.url.endsWith("/devtools.html"));
    }, "DevTools window");
    const browser = await chromium.connectOverCDP(endpoint);
    await use(browser);
    await browser.close();
  },

  app: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },

  devtools: async ({ cdp, app }, use) => {
    void app; // ensure the inspected tab (and so its DevTools) exists
    const window = await waitFor(
      () => cdp.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("devtools://")),
      "DevTools window",
    );
    const frameBy = (suffix: string) => window.frames().find((f) => f.url().endsWith(suffix));
    const devtoolsPage = await waitFor(() => frameBy("/devtools.html"), "extension devtools page");
    await devtoolsPage.waitForFunction(() => "__grpcDevtoolsStore" in window);

    await use({
      window,
      devtoolsPage: () => devtoolsPage,
      async openPanel() {
        await window.evaluate(async () => {
          // @ts-expect-error DevTools frontend module, resolved inside devtools://
          const UI = await import("./ui/legacy/legacy.js");
          const inspector = UI.InspectorView.InspectorView.instance();
          const id = inspector.tabbedPane.tabIds().find((t: string) => t.endsWith("gRPC"));
          if (!id) throw new Error("gRPC panel is not registered");
          await inspector.showPanel(id);
        });
        const panel = await waitFor(() => frameBy("/panel.html"), "gRPC panel");
        await panel.locator(".toolbar").waitFor();
        return panel;
      },
    });
  },
});

export const expect = test.expect;
