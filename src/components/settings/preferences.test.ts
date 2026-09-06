import { describe, expect, it } from "vitest";
import { parsePreferences } from "./preferences-store";

describe("saved preference validation", () => {
  it.each([null, "broken-json", "null", "[]", "42", '"dark"'])(
    "uses safe defaults for malformed saved settings: %s",
    (raw) => {
      expect(parsePreferences(raw)).toEqual({ theme: "system", analytics: false, replay: false });
    },
  );

  it("retains valid settings", () => {
    expect(parsePreferences('{"theme":"dark","analytics":true,"replay":true}')).toEqual({
      theme: "dark",
      analytics: true,
      replay: true,
    });
  });

  it("defaults invalid fields without discarding valid settings", () => {
    expect(parsePreferences('{"theme":"light","analytics":"true","replay":1}')).toEqual({
      theme: "light",
      analytics: false,
      replay: false,
    });
  });

  it("respects explicit analytics opt-out even when replay is enabled", () => {
    expect(parsePreferences('{"theme":"dark","analytics":false,"replay":true}')).toEqual({
      theme: "dark",
      analytics: false,
      replay: false,
    });
  });
});
