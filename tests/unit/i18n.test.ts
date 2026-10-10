import { describe, expect, it } from "vitest";
import { errorText, LocalizedError, msg, renderText, t } from "../../extension/src/i18n";

describe("i18n", () => {
  it("formats params", () => {
    expect(t("toolbar.schemas", { count: 2 })).toBe("Schemas (2)");
  });

  it("passes literal text through and looks up keyed text", () => {
    expect(renderText("from server")).toBe("from server");
    expect(renderText(msg("warn.compressedFrame"))).toBe("Compressed frames are not supported yet");
  });

  it("renders LocalizedError via the catalog", () => {
    const e = new LocalizedError({ key: "error.importNotFound", params: { name: "a.proto" } });
    expect(e.message).toBe('Import "a.proto" not found');
    expect(errorText(e)).toBe('Import "a.proto" not found');
  });
});
