/**
 * The materials table and the bits it offers: the hand-checked 3.175x12mm
 * default, then Makera's other flat ends from the Fusion library.
 */

import { describe, expect, test } from "bun:test";
import { MATERIALS, MATERIAL_IDS, MAX_FEEDRATE, resolve } from "../src/materials.ts";
import { buildJob, filenameFor } from "../src/gcode.ts";
import { validate, type JobRequest } from "../src/validate.ts";

const REQ = { width: 80, height: 60, depth: 0.3, material: "mdf", stepover: 0.45 } as const;
const AT = new Date(2026, 8, 21, 14, 5);

function build(over: Partial<JobRequest> = {}) {
  const r = buildJob({ ...REQ, ...over } as JobRequest, { now: AT, thumbnail: false });
  if (!r.ok) throw new Error(JSON.stringify(r.refusals));
  return r;
}

describe("the table itself", () => {
  test("the 3.175x12mm Metal-series flat end is every material's default", () => {
    for (const id of MATERIAL_IDS) {
      expect(MATERIALS[id].tools[0]!.id).toBe("3.175");
      const r = resolve(id)!;
      expect(r.tool.diameter).toBe(3.175);
      expect(r.tool.fluteLength).toBe(12);
    }
  });

  test("every material offers Makera's flat ends in all three collets", () => {
    for (const id of MATERIAL_IDS) {
      const tools = MATERIALS[id].tools;
      expect(new Set(tools.map((t) => t.id)).size).toBe(tools.length);
      expect([...new Set(tools.map((t) => t.tool.handleDiameter))].sort()).toEqual([3.175, 4, 6]);
      expect(tools.every((t) => t.tool.type === "Flat End")).toBe(true);
    }
  });

  test("the metals offer only the Metal series", () => {
    // The non-metal series has no aluminium or brass presets at all.
    for (const id of ["aluminium", "brass"] as const) {
      expect(MATERIALS[id].tools.slice(1).every((t) => t.tool.name.endsWith("(Metal)"))).toBe(true);
    }
    expect(MATERIALS.mdf.tools.some((t) => t.id === "3.175x42mm")).toBe(true);
  });

  test("a wider bit keeps the 3.175's absolute step", () => {
    // Ridges from spindle tram scale with the absolute step, not the fraction.
    const base = resolve("mdf")!;
    for (const id of MATERIAL_IDS) {
      for (const t of MATERIALS[id].tools) {
        expect(t.tool.diameter * t.stepover).toBeLessThanOrEqual(base.tool.diameter * base.stepover + 0.01);
        expect(t.tool.diameter * t.finishStepover).toBeLessThanOrEqual(base.tool.diameter * base.finishStepover + 0.01);
      }
    }
  });

  test("every row stays under the declared MAXFEEDRATE", () => {
    for (const id of MATERIAL_IDS) {
      for (const t of MATERIALS[id].tools) {
        expect(t.feed).toBeLessThanOrEqual(MAX_FEEDRATE);
        expect(t.plunge).toBeLessThanOrEqual(MAX_FEEDRATE);
      }
    }
  });

  test("every row is vendor-sourced and says where from", () => {
    // Nothing here is reasoned. If a row ever is, it sets derived and the UI
    // shouts about it — silently mixing reasoned numbers in with published ones
    // is the drift this project exists to avoid.
    for (const id of MATERIAL_IDS) {
      for (const t of MATERIALS[id].tools) {
        expect(t.derived).toBe(false);
        expect(t.source).toMatch(/speeds and feeds|Fusion 360 library/);
      }
    }
  });

  test("the published metal figures are what Makera lists", () => {
    // Transcription errors here are silent and expensive, so the two metal rows
    // are spelled out rather than trusted.
    const al = resolve("aluminium")!;
    expect([al.rpm, al.feed, al.plunge, al.maxDepthPerPass]).toEqual([12000, 500, 200, 0.2]);
    const br = resolve("brass")!;
    expect([br.rpm, br.feed, br.plunge, br.maxDepthPerPass]).toEqual([12000, 300, 100, 0.1]);
    const mdf = resolve("mdf")!;
    expect([mdf.rpm, mdf.feed, mdf.plunge, mdf.maxDepthPerPass]).toEqual([10000, 1000, 300, 1.0]);
  });

  test("the finishing stepover is finer than the roughing one everywhere", () => {
    for (const id of MATERIAL_IDS) {
      const t = resolve(id)!;
      expect(t.finishStepover).toBeLessThan(t.stepover);
    }
  });

  test("the finishing allowance fits inside one pass of every tool", () => {
    // Otherwise finish mode would ask for a cut deeper than the bit is rated
    // for, which validate.ts refuses but should never have to.
    for (const id of MATERIAL_IDS) {
      for (const t of MATERIALS[id].tools) {
        expect(t.maxDepthPerPass).toBeGreaterThanOrEqual(MATERIALS[id].finishAllowance);
      }
    }
  });
});

describe("choosing a bit", () => {
  test("an unknown tool is refused rather than silently defaulted", () => {
    // Falling back would run the job at the wrong feeds for whatever is in the
    // collet, and nothing downstream could notice.
    const r = validate({ ...REQ, tool: "6" as never });
    expect(r[0]!.field).toBe("tool");
    expect(r[0]!.message).toContain('"6"');
  });

  test("a bit with no figures for the material is refused", () => {
    const r = validate({ ...REQ, material: "aluminium", depth: 0.1, tool: "3.175x42mm" });
    expect(r[0]!.field).toBe("tool");
  });

  test("omitting the tool gives the material's default profile", () => {
    expect(build().summary.toolId).toBe("3.175");
    expect(build({ tool: "3.175" }).summary.toolId).toBe("3.175");
  });

  test("the bit reaches the header, so M6 names the right one", () => {
    expect(build().lines.some((l) =>
      l.startsWith(";@MKR|TOOL|") && l.includes("name=3.175*12mm Flat End - FACING") &&
      l.includes("diameter=3.175") && l.includes("flutelength=12"))).toBe(true);
  });

  test("a library bit brings its own geometry and Makera's preset", () => {
    const r = build({ material: "aluminium", depth: 0.2, tool: "6x17mm-metal", stepover: 0.238 });
    expect(r.summary.toolId).toBe("6x17mm-metal");
    expect(r.lines.some((l) =>
      l.startsWith(";@MKR|TOOL|") && l.includes("name=6*17mm Flat End(Metal) - FACING") &&
      l.includes("handlediameter=6") && l.includes("diameter=6") && l.includes("flutelength=17"))).toBe(true);
    expect(r.lines).toContain("S12000 M3");
  });

  test("and the spindle speed follows the material", () => {
    expect(build({ material: "aluminium", depth: 0.1 }).lines).toContain("S12000 M3");
    expect(build({ material: "mdf" }).lines).toContain("S10000 M3");
  });
});

describe("the filename", () => {
  test("keeps the one-bit pattern, with one bit in play", () => {
    // The plain name is serpentine-x, as it was for every job before 0.9.0;
    // the default since then is named like any other pattern.
    const x = { ...REQ, pattern: "serpentine-x" } as const;
    expect(filenameFor(x, AT)).toBe("facing-mdf-80x60-0.3mm-20260921.nc");
    expect(filenameFor({ ...x, material: "brass", depth: 0.1 }, AT))
      .toBe("facing-brass-80x60-0.1mm-20260921.nc");
    expect(filenameFor({ ...x, mode: "general" }, AT)).toBe("facing-mdf-80x60-0.3mm-20260921.nc");
    expect(filenameFor(REQ, AT)).toBe("facing-mdf-80x60-0.3mm-serpentine-y-20260921.nc");
  });

  test("names a non-default bit by its id", () => {
    expect(filenameFor({ ...REQ, tool: "4x22mm-metal" }, AT))
      .toBe("facing-mdf-4x22mm-metal-80x60-0.3mm-serpentine-y-20260921.nc");
  });

  test("names finish mode, so the two coupons of a comparison cannot collide", () => {
    // A 40x30x0.1 brass coupon in each mode differs ONLY by the mode. Without
    // this the second download replaces the first and the comparison is gone.
    const coupon = { ...REQ, material: "brass", width: 40, height: 30, depth: 0.1 } as const;
    const a = filenameFor({ ...coupon, mode: "general" }, AT);
    const b = filenameFor({ ...coupon, mode: "finish" }, AT);
    expect(a).toBe("facing-brass-40x30-0.1mm-serpentine-y-20260921.nc");
    expect(b).toBe("facing-brass-40x30-0.1mm-finish-20260921.nc");
    expect(a).not.toBe(b);
  });
});

describe("nothing is derived", () => {
  test("so no row warns about it", () => {
    expect(build().summary.derived).toBe(false);
    expect(build().summary.warnings.some((x) => x.text.includes("derived, not published")))
      .toBe(false);
  });
});
