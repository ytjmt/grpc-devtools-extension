import { describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { SchemaIndex } from "../../extension/src/core/schema";
import { CallList } from "../../extension/src/panel/CallList";
import { decodeRow } from "../../extension/src/panel/useDecodedRows";
import { demoCalls, syntheticCalls } from "../fixtures/builders";

const rows = demoCalls.map((c) => decodeRow(c, SchemaIndex.empty));

describe("CallList", () => {
  it("shows one row per call with protocol, status, message counts and time", async () => {
    const screen = await render(<CallList rows={rows} onSelect={() => {}} empty={false} />);
    const trs = screen.container.querySelectorAll("tbody tr");
    expect(trs).toHaveLength(6);
    expect([...trs].map((tr) => (tr as HTMLElement).innerText.split("\t").slice(1))).toEqual([
      ["connect", "0 OK", "1 / 1", "13 ms"],
      ["connect (json)", "0 OK", "1 / 1", "10 ms"],
      ["grpc-web", "0 OK", "1 / 1", "8 ms"],
      ["grpc-web", "7 PERMISSION_DENIED", "1 / 0", "3 ms"],
      ["connect-stream", "0 OK", "1 / 5", "1511 ms"],
      ["grpc-web", "0 OK", "1 / 5", "1514 ms"],
    ]);
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

  it("shows decode errors and the empty state", async () => {
    const broken = { ...syntheticCalls.connectGet(), url: "http://x/a.B/C" };
    const bad = decodeRow({ ...broken, requestHeaders: [] }, SchemaIndex.empty);
    const screen = await render(<CallList rows={[bad]} onSelect={() => {}} empty={true} />);
    await expect.element(screen.getByText("decode error")).toBeVisible();
    await expect.element(screen.getByText("Waiting for gRPC / gRPC-Web / Connect requests…")).toBeVisible();
  });
});
