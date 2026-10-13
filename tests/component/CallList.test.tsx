import { describe, expect, it, vi } from "vite-plus/test";
import { useState } from "react";
import { userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { SchemaIndex } from "../../extension/src/core/schema";
import { CallList } from "../../extension/src/panel/CallList";
import { formatClock } from "../../extension/src/panel/listColumns";
import { decodeRow } from "../../extension/src/panel/useDecodedRows";
import { demoCalls, syntheticCalls } from "../fixtures/builders";

const rows = demoCalls.map((c) => decodeRow(c, SchemaIndex.empty));

describe("CallList", () => {
  it("shows one row per call with protocol, status, message counts, size, time and start", async () => {
    const screen = await render(<CallList rows={rows} onSelect={() => {}} empty={false} />);
    const trs = screen.container.querySelectorAll("tbody tr");
    expect(trs).toHaveLength(6);
    // Start times are shown in local time, so the expectation goes through the same formatter.
    const started = (s: number) => formatClock(`2026-01-01T00:00:0${s}.000Z`);
    expect([...trs].map((tr) => (tr as HTMLElement).innerText.split("\t").slice(1))).toEqual([
      ["connect", "0 OK", "1 / 1", "98 B", "13 ms", started(0)],
      ["connect (json)", "0 OK", "1 / 1", "170 B", "10 ms", started(1)],
      ["grpc-web", "0 OK", "1 / 1", "124 B", "8 ms", started(2)],
      ["grpc-web", "7 PERMISSION_DENIED", "1 / 0", "64 B", "3 ms", started(3)],
      ["connect-stream", "0 OK", "1 / 5", "42 B", "1511 ms", started(4)],
      ["grpc-web", "0 OK", "1 / 5", "56 B", "1514 ms", started(5)],
    ]);
  });

  it("sorts by a column when its header is clicked, and reverses on a second click", async () => {
    const screen = await render(<CallList rows={rows} onSelect={() => {}} empty={false} />);
    const times = () => [...screen.container.querySelectorAll("tbody tr td:nth-child(6)")].map((td) => td.textContent);
    const header = screen.getByRole("button", { name: "Time" });

    await header.click();
    expect(times()).toEqual(["3 ms", "8 ms", "10 ms", "13 ms", "1511 ms", "1514 ms"]);
    expect(screen.container.querySelector("th[aria-sort]")?.getAttribute("aria-sort")).toBe("ascending");

    await header.click();
    expect(times()).toEqual(["1514 ms", "1511 ms", "13 ms", "10 ms", "8 ms", "3 ms"]);
    expect(screen.container.querySelector("th[aria-sort]")?.getAttribute("aria-sort")).toBe("descending");
  });

  it("marks failures and proto calls without a schema", async () => {
    const screen = await render(<CallList rows={rows} onSelect={() => {}} empty={false} />);
    expect(screen.container.querySelectorAll("tr.failed")).toHaveLength(1);
    // JSON calls are readable without a schema, so they get no badge.
    await expect.element(screen.getByText("no schema").first()).toBeVisible();
    expect(screen.container.querySelectorAll(".badge.warn")).toHaveLength(5);
  });

  it("collapses to the name column while a call is selected", async () => {
    const onSelect = vi.fn();
    const screen = await render(<CallList rows={rows} selectedId={rows[3].raw.id} onSelect={onSelect} empty={false} />);
    expect(screen.container.querySelectorAll("th")).toHaveLength(1);
    expect(screen.container.querySelector('tr[aria-selected="true"]')?.getAttribute("data-method")).toBe("Fail");

    await screen.getByText("Count").first().click();
    expect(onSelect).toHaveBeenCalledWith(rows[4].raw.id);
  });

  it("moves the selection with the arrow keys, Home, and End", async () => {
    function Selectable() {
      const [selectedId, setSelectedId] = useState<number>();
      return <CallList rows={rows} selectedId={selectedId} onSelect={setSelectedId} empty={false} />;
    }
    const screen = await render(<Selectable />);
    const selected = () =>
      [...screen.container.querySelectorAll("tbody tr")].findIndex((tr) => tr.getAttribute("aria-selected") === "true");

    (screen.container.querySelector(".list") as HTMLElement).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(selected()).toBe(0);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(selected()).toBe(2);
    await userEvent.keyboard("{ArrowUp}");
    expect(selected()).toBe(1);
    await userEvent.keyboard("{End}");
    expect(selected()).toBe(5);
    await userEvent.keyboard("{ArrowDown}"); // stays on the last row
    expect(selected()).toBe(5);
    await userEvent.keyboard("{Home}");
    expect(selected()).toBe(0);
  });

  it("shows decode errors and the empty state", async () => {
    const broken = { ...syntheticCalls.connectGet(), url: "http://x/a.B/C" };
    const bad = decodeRow({ ...broken, requestHeaders: [] }, SchemaIndex.empty);
    const screen = await render(<CallList rows={[bad]} onSelect={() => {}} empty={true} />);
    await expect.element(screen.getByText("decode error")).toBeVisible();
    await expect.element(screen.getByText("Waiting for gRPC / gRPC-Web / Connect requests…")).toBeVisible();
  });
});
