/**
 * Makera's bits and published figures: identifying a bit from a header, the
 * material from a header, and holding materials.ts to the same numbers.
 */

import { describe, expect, test } from "bun:test";
import { bitById, BITS, CAT_MATERIALS, detectMaterial, matchBit, parseBitName } from "../src/catalogue.ts";
import { MATERIALS } from "../src/materials.ts";

const id = (name: string, extra: object = {}) => {
  const m = matchBit({ name, ...extra });
  return m.ok ? m.bit.id : `none: ${m.reason}`;
};

describe("identifying a bit from its header name", () => {
  test("Makera Studio's names", () => {
    expect(id("3.175*12mm Flat End(Metal)")).toBe("flat-3.175-12");
    expect(id("3.175*2*8mm Flat End(Metal)")).toBe("flat-2-8");
    expect(id("3.175*1*3mm Flat End(Metal)")).toBe("flat-1-3");
    expect(id("3.175*2*12mm Drill")).toBe("drill-2");
  });

  test("post-processed names, label suffix and all", () => {
    expect(id("3.175*0.3mm*30deg Engraving - ISOLATION")).toBe("engr-0.3-30");
    expect(id("3.175*1*10mm Drill - 42 HOLES")).toBe("drill-1");
    expect(id("3.175*2*10.5mm Corn - 3.0+3.2mm HOLES")).toBe("corn-2");
    expect(id("3.175*3*12mm Drill TiN - PILOT")).toBe("drill-3");
  });

  test("this app's own", () => {
    expect(id("3.175*12mm Flat End - FACING")).toBe("flat-3.175-12");
  });

  test("the flute length tells the metal 3.175 from the long non-metal ones", () => {
    expect(id("3.175*25mm Flat End")).toBe("flat-3.175-25");
    expect(id("3.175*42mm Flat End")).toBe("flat-3.175-42");
    // With only the header's geometry to go on.
    expect(id("3.175mm Flat End", { fluteLength: 25 })).toBe("flat-3.175-25");
  });

  test("the library's flat ends, by size and series", () => {
    expect(id("6*17mm Flat End(Metal)")).toBe("spiral-o-metal-6x17mm-dlc");
    expect(id("6*30mm Flat End(Metal)")).toBe("spiral-o-metal-6x30mm-dlc");
    expect(id("4*22mm Flat End(Metal)")).toBe("spiral-o-metal-4x22m");
    expect(id("4*22mm Flat End")).toBe("spiral-o-4x22m");
    expect(id("1*3mm Flat End")).toBe("spiral-o-1x3mm");
    expect(id("3.175*17mm Flat End")).toBe("spiral-o-3.175x17mm");
  });

  test("a bit Makera does not sell is not identified", () => {
    expect(id("7*17mm Flat End(Metal)")).toMatch(/^none/);
    expect(id("Mystery cutter")).toMatch(/^none/);
  });

  test("the name parser", () => {
    expect(parseBitName("0.1mm*60° Engraving(Metal)")).toEqual({ kind: "engraving", diameter: 0.1, angle: 60, metal: true });
    expect(parseBitName("2mm Corn")).toEqual({ kind: "corn", diameter: 2, metal: undefined });
  });
});

describe("the material from a header", () => {
  test.each([
    [["Aluminum Alloys", "6061 Aluminum"], "aluminum"],
    [[undefined, "FR4 copper-clad"], "pcb"],
    [[undefined, "MDF spoilboard"], "hardwood"],
    [[undefined, "Brass"], "brass"],
    [[undefined, "Copper"], "copper"],
    [[undefined, "Acrylic"], "plastic"],
    [[undefined, "Pine"], "softwood"],
    [[undefined, "Unobtainium"], null],
  ] as const)("%p -> %p", (names, want) => {
    expect(detectMaterial(...names)).toBe(want);
  });
});

describe("the table", () => {
  test("every bit has a cell for every material, even if it is empty", () => {
    for (const b of BITS) expect(Object.keys(b.rows).sort()).toEqual([...CAT_MATERIALS].sort());
  });

  test("the long non-metal flat ends have no metal figures at all", () => {
    for (const idOf of ["flat-3.175-25", "flat-3.175-42"]) {
      const b = bitById(idOf)!;
      expect([b.rows.aluminum, b.rows.brass, b.rows.copper]).toEqual([null, null, null]);
    }
  });

  test("materials.ts's facing rows are the same numbers as the catalogue's", () => {
    // Both cite the same speeds-and-feeds row; this is what stops them drifting.
    const row = bitById("flat-3.175-12")!.rows;
    const column = { mdf: row.hardwood, aluminium: row.aluminum, brass: row.brass } as const;
    for (const [m, want] of Object.entries(column)) {
      const t = MATERIALS[m as keyof typeof MATERIALS].tools[0]!;
      expect({ m, rpm: t.rpm, feed: t.feed, plunge: t.plunge, doc: t.maxDepthPerPass })
        .toEqual({ m, rpm: want!.rpm, feed: want!.feed, plunge: want!.plunge, doc: want!.doc });
    }
  });
});
