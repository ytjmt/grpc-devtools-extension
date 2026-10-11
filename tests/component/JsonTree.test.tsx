import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { JsonTree } from "../../extension/src/panel/JsonTree";

describe("JsonTree", () => {
  const value = {
    name: "ytjmt",
    count: 3,
    ok: true,
    none: null,
    nested: { deep: { deeper: "x" }, sibling: 1 },
    list: [1, 2],
  };

  it("renders primitives with their types", async () => {
    await render(<JsonTree value={value} />);
    await expect.element(page.getByText('"ytjmt"')).toHaveClass("jt-string");
    await expect.element(page.getByText("3", { exact: true })).toHaveClass("jt-number");
    await expect.element(page.getByText("true")).toHaveClass("jt-bool");
    await expect.element(page.getByText("null")).toHaveClass("jt-null");
    await expect.element(page.getByText("Array(2)")).toBeVisible();
  });

  it("opens two levels by default and toggles on click", async () => {
    const screen = await render(<JsonTree value={value} />);
    await expect.element(screen.getByText("deep:")).toBeVisible();
    expect(screen.container.textContent).not.toContain("deeper");

    await screen.getByText("deep:").click();
    await expect.element(screen.getByText('"x"')).toBeVisible();

    await screen.getByText("nested:").click();
    expect(screen.container.textContent).not.toContain("deep:");
  });

  it("does not count single-key wrappers toward the auto-expanded depth", async () => {
    const screen = await render(
      <JsonTree value={{ product: { title: "Tee", metadata: { season: "SS26", deep: { x: 1 } } } }} />,
    );
    await expect.element(screen.getByText('"SS26"')).toBeVisible();
    expect(screen.container.textContent).not.toContain("x: ");
  });
});
