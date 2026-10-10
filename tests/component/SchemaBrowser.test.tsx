import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useState } from "react";
import { loadDescriptorSet } from "../../extension/src/core/schema";
import { SchemaBrowser, type BrowseSelection } from "../../extension/src/panel/SchemaBrowser";
import { loadDescriptor } from "../support/fakeSchemaBackend";
import { descriptorUrl } from "../support/renderPanel";

const { registry } = loadDescriptorSet(new Uint8Array(await loadDescriptor(descriptorUrl)));
const schemas = [{ id: "demo", name: "descriptor.binpb", registry }];

function Harness({ initial }: { initial?: BrowseSelection }) {
  const [selection, setSelection] = useState(initial);
  return (
    <div style={{ height: 600, display: "flex" }}>
      <SchemaBrowser schemas={schemas} selection={selection} onSelect={setSelection} />
    </div>
  );
}
const treeItem = (name: string) => page.getByRole("treeitem", { name, exact: true });
const detail = () => document.querySelector(".type-detail") as HTMLElement;

describe("SchemaBrowser", () => {
  it("opens on the first service with methods and comments", async () => {
    await render(<Harness />);
    await expect.element(page.getByRole("heading", { name: "demo.v1.DemoService" })).toBeVisible();
    await expect.element(page.getByText("Demo service used by the example app and the tests.")).toBeVisible();
    const count = [...detail().querySelectorAll(".method-item")].find((m) => m.querySelector(".method-name")?.textContent === "Count");
    expect(count?.querySelector(".method-kind")?.textContent).toBe("server streaming");
    expect([...count!.querySelectorAll(".type-link")].map((a) => a.textContent)).toEqual([
      "demo.v1.CountRequest",
      "demo.v1.CountResponse",
    ]);
    await expect.element(page.getByText("Streams 1..up_to, waiting delay_ms between messages.")).toBeVisible();
  });

  it("shows message fields with types, oneofs, JSON names and deprecation", async () => {
    await render(<Harness />);
    await treeItem("GreetRequest").click();
    await expect.element(page.getByRole("heading", { name: "demo.v1.GreetRequest" })).toBeVisible();
    const text = detail().innerText;
    expect(text).toContain("2\tbig_number (bigNumber)\tint64\tAbove 2^53, to check that int64 stays exact in JSON.");
    expect(text).toContain("repeated string");
    expect(text).toContain("map<string, int32>");
    expect(text).toContain("oneof contact\tHow to reach the person being greeted.");
    expect(detail().querySelector(".deprecated")?.textContent).toBe("nickname");
  });

  it("follows type links and back through Used by", async () => {
    await render(<Harness />);
    await page.getByRole("link", { name: "demo.v1.GreetResponse" }).first().click();
    await expect.element(page.getByRole("heading", { name: "demo.v1.GreetResponse" })).toBeVisible();

    await page.getByRole("link", { name: "demo.v1.Mood" }).click();
    await expect.element(page.getByRole("heading", { name: "demo.v1.Mood" })).toBeVisible();
    expect(detail().innerText).toContain("2\tMOOD_SLEEPY\tNeeds coffee.");

    await page.getByRole("link", { name: "GreetResponse.mood" }).click();
    await expect.element(page.getByRole("heading", { name: "demo.v1.GreetResponse" })).toBeVisible();
    await page.getByRole("link", { name: "DemoService.Greet (response)" }).click();
    await expect.element(page.getByRole("heading", { name: "demo.v1.DemoService" })).toBeVisible();
  });

  it("selects a method from the tree and highlights it", async () => {
    await render(<Harness />);
    await treeItem("Fail").click();
    await expect.element(treeItem("Fail")).toHaveAttribute("aria-selected", "true");
    expect(detail().querySelector(".method-item.highlight .method-name")?.textContent).toBe("Fail");
  });

  it("searches type, method and field names", async () => {
    await render(<Harness />);
    const search = page.getByRole("searchbox", { name: "Search types, methods, and fields" });

    await search.fill("count");
    await expect.element(treeItem("Count")).toBeVisible();
    await expect.element(treeItem("CountRequest")).toBeVisible();

    await search.fill("big_num");
    await expect.element(page.getByText("· big_number")).toBeVisible();

    await search.fill("zzz");
    await expect.element(page.getByText("No matches")).toBeVisible();
  });

  it("keeps well-known types collapsed until opened", async () => {
    await render(<Harness />);
    expect(document.body.innerText).not.toContain("Timestamp");
    await treeItem("google.protobuf").click();
    await expect.element(treeItem("Timestamp")).toBeVisible();
  });
});
