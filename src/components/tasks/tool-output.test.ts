import { describe, expect, it } from "vitest";
import { toolOutput } from "./tool-output";

describe("tool output images", () => {
  const image = { type: "image", mimeType: "image/png", data: "aGVsbG8=" };
  it("renders MCP and ACP image content alongside text", () => {
    expect(
      toolOutput({ output: { content: [{ type: "text", text: "Screenshot" }, image] } }),
    ).toEqual({
      text: "Screenshot",
      images: ["data:image/png;base64,aGVsbG8="],
    });
    expect(
      toolOutput({ output: { result: { content: [image] }, error: null } }).images,
    ).toHaveLength(1);
    expect(toolOutput({ output: [{ type: "content", content: image }] }).images).toHaveLength(1);
  });
  it("keeps executable image formats out of rendered images", () => {
    expect(toolOutput({ output: { ...image, mimeType: "image/svg+xml" } }).images).toEqual([]);
  });
});
