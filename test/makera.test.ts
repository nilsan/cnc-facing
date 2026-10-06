/**
 * The Makera library generated from Fusion 360, and holding the hand-checked
 * facing rows to its metal presets.
 */

import { describe, expect, test } from "bun:test";
import { LIBRARY, LIBRARY_SOURCE, libraryBit } from "../src/makera.ts";
import { resolve } from "../src/materials.ts";

describe("the library", () => {
  test("records the CarveraProfiles commit it came from", () => {
    expect(LIBRARY_SOURCE).toMatch(/^https:\/\/github\.com\/MakeraInc\/CarveraProfiles\/tree\/[0-9a-f]{40}\//);
  });

  test("ids are unique and every bit says which collet it needs", () => {
    expect(new Set(LIBRARY.map((b) => b.id)).size).toBe(LIBRARY.length);
    for (const b of LIBRARY) {
      expect([3.175, 4, 6]).toContain(b.shank);
      expect(b.diameter).toBeGreaterThan(0);
      expect(Object.keys(b.presets).length).toBeGreaterThan(0);
    }
  });

  test("has every kind of bit Makera sells", () => {
    expect([...new Set(LIBRARY.map((b) => b.kind))].sort())
      .toEqual(["ball", "chamfer", "corn", "drill", "engraving", "flat", "thread"]);
  });

  test("the hand-checked 3.175x12mm metal rows match Makera's presets", () => {
    const presets = libraryBit("spiral-o-metal-3.175x12mm")!.presets;
    for (const [material, column] of [["aluminium", "aluminum"], ["brass", "brass"]] as const) {
      const r = resolve(material)!;
      const p = presets[column]!;
      expect([r.rpm, r.feed, r.plunge, r.maxDepthPerPass]).toEqual([p.rpm, p.feed!, p.plunge!, p.doc!]);
    }
  });
});
