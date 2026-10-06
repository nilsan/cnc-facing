/**
 * The file as a whole: line endings, the preamble and trailer order, the
 * one-line tool change, and the filename.
 */

import { describe, expect, test } from "bun:test";
import { buildJob, EOL, filenameFor, SOURCE, VERSION } from "../src/gcode.ts";
import { PATTERNS } from "../src/facing.ts";
import { MATERIAL_IDS } from "../src/materials.ts";

const REQ = { width: 80, height: 60, depth: 0.3, material: "mdf", stepover: 0.45 } as const;
const AT = new Date(2026, 8, 21, 14, 5);

function build(over: object = {}, opts: object = { thumbnail: false }) {
  const r = buildJob({ ...REQ, ...over }, { now: AT, ...opts });
  if (!r.ok) throw new Error(JSON.stringify(r.refusals));
  return r;
}

describe("line endings", () => {
  test("CRLF throughout, including the last line", () => {
    // Matches Makera Studio's output. Not the cause of the blank preview, which
    // it was once blamed for -- an LF file previews fine (load test 08); the
    // cause was the tool change written M6 T<n>. See writeGcode.
    const { gcode } = build();
    expect(gcode.endsWith(EOL)).toBe(true);
    expect(gcode.split("\n").length - 1).toBe(gcode.split("\r\n").length - 1);
    expect(/[^\r]\n/.test(gcode)).toBe(false);
  });

  test("the thumbnail trailer does not break it", () => {
    const { gcode } = build({}, {});
    expect(/[^\r]\n/.test(gcode)).toBe(false);
  });
});

describe("the preamble and trailer", () => {
  const lines = build().lines;
  const at = (s: string) => lines.indexOf(s);

  test("M331 comes BEFORE the tool change, M332 after M5", () => {
    // The proven order, from every file the machine has run. The one time this
    // looked wrong it was the air-assist hose, not the G-code, and a reordering
    // tried as a guess was reverted.
    expect(at("M331")).toBeGreaterThan(-1);
    expect(at("M331")).toBeLessThan(at("T1 M6"));
    expect(at("M332")).toBeGreaterThan(at("M5"));
  });

  test("T1 M6 is one line, in that word order", () => {
    // Split across two lines the controller aborts mid-job and loses its
    // levelling heightmap.
    expect(lines.filter((l) => /\bM6\b/.test(l))).toEqual(["T1 M6"]);
    expect(lines.some((l) => l.trim() === "T1" || l.trim() === "M6")).toBe(false);
  });

  test("no job ever writes M6 T<n>: every tool change is T<n> M6", () => {
    // M6 T1 blanks the controller's preview and stops the laser trace at the
    // work origin, silently (load tests 05 and 31, 2026-09-24). Every
    // material, bit, mode and pattern, with and without the chamfer's T2.
    let changes = 0;
    for (const material of MATERIAL_IDS) {
      for (const mode of ["general", "finish"] as const) {
        for (const pattern of mode === "finish" ? [undefined] : PATTERNS) {
          for (const chamfer of [undefined, 0.2]) {
            const r = buildJob(
              { width: 45, height: 45, depth: 0.3, material, stepover: 0.45, mode, pattern, overhang: !!chamfer, chamfer },
              { now: AT, thumbnail: false },
            );
            if (!r.ok) continue;
            const m6 = r.lines.filter((l) => /\bM0*6\b/.test(l));
            expect(m6.every((l) => /^T\d+ M6$/.test(l))).toBe(true);
            expect(r.lines.some((l) => /^M0*6\s*T/.test(l))).toBe(false);
            changes += m6.length;
          }
        }
      }
    }
    expect(changes).toBeGreaterThan(20);
  });

  test("the spindle dwells before the first cut", () => {
    expect(at("S10000 M3")).toBeLessThan(at("G4 P1"));
    expect(at("G4 P1")).toBeLessThan(lines.findIndex((l) => l.startsWith("G1 Z")));
  });

  test("it ends with G28 then M02, and no M30", () => {
    const tail = lines.filter((l) => /^M0?2$|^M30$|^G28$/.test(l));
    expect(tail).toEqual(["G28", "M02"]);
  });

  test("G90 G21 before any motion", () => {
    expect(at("G90 G21")).toBeGreaterThan(-1);
    expect(at("G90 G21")).toBeLessThan(lines.findIndex((l) => /^G[01] [XYZ]/.test(l)));
  });

  test("no G32: levelling is controller-side and persists across files", () => {
    expect(lines.some((l) => /\bG32\b/.test(l))).toBe(false);
  });

  test("no arcs: facing is all G1", () => {
    expect(lines.some((l) => /^G[23]\b/.test(l))).toBe(false);
  });

  test("it retracts to safe Z before stopping the spindle", () => {
    expect(at("M5")).toBeGreaterThan(lines.lastIndexOf("G0 Z5"));
  });
});

describe("the filename", () => {
  test("facing-<material>-<X>x<Y>-<depth>mm-<YYYYMMDD>.nc", () => {
    const x = { ...REQ, pattern: "serpentine-x" } as const;
    expect(filenameFor(x, AT)).toBe("facing-mdf-80x60-0.3mm-20260921.nc");
    expect(filenameFor({ ...x, material: "brass", width: 40.5, depth: 1 }, AT))
      .toBe("facing-brass-40.5x60-1mm-20260921.nc");
  });
});

describe("the human-readable comments", () => {
  test("say the size, the depth, the material, the pattern and the pass count", () => {
    const c = build({ depth: 2.5 }).lines.filter((l) => l.startsWith("("));
    expect(c[0]).toBe("(Facing 80 x 60 mm, 2.5 mm deep, MDF)");
    expect(c[1]).toBe("(Serpentine along Y)");
    expect(c[2]).toMatch(/^\(3 passes at 1.429 mm stepover, ~\d+\.\d min\)$/);
    expect(c[3]).toBe(`(Generated 2026-09-21 14:05 by cnc-facing ${VERSION})`);
  });

  test("name the pattern, since coupons differ by nothing else", () => {
    const c = build({ pattern: "spiral" }).lines.filter((l) => l.startsWith("("));
    expect(c[1]).toBe("(Spiral inward, climb)");
    // A comment is closed by the first ")", so none of these may carry one.
    for (const l of c) expect(l.slice(1, -1)).not.toMatch(/[()]/);
  });
});

describe("the bytes of the file", () => {
  test("are pure ASCII, comments included", () => {
    // The controller is a byte parser on an embedded board reading off a USB
    // stick. Comments are skipped, but there is nothing to gain from putting
    // multi-byte punctuation in front of it, and an em-dash is easy to type by
    // accident in a comment block.
    for (const withThumb of [{ thumbnail: false }, {}]) {
      const { gcode } = build({}, withThumb);
      const bad = [...gcode].filter((ch) => ch.charCodeAt(0) > 0x7e || ch.charCodeAt(0) < 0x09);
      expect(bad).toEqual([]);
    }
  });

  test("and no line carries trailing whitespace", () => {
    for (const l of build().lines) expect(l).toBe(l.trimEnd());
  });
});

describe("the declared stock", () => {
  test("is the faced area at the fixed 12mm the proven file declares", () => {
    const lines = build().lines;
    expect(lines).toContain(";@MKR|STOCK|id=cuboid|length=80|width=60|height=12|diameter=50");
    expect(lines).toContain(";@MKR|ORIGIN|id=0|type_name=topFrontLeft|x=-40|y=30|z=6");
  });

  test("and no longer depends on anything the form sends", () => {
    const withExtra = buildJob({ ...REQ, stockHeight: 3 } as never, { thumbnail: false });
    expect(withExtra.ok && withExtra.lines.find((l) => l.startsWith(";@MKR|STOCK"))).toContain("height=12");
  });
});

describe("the source link", () => {
  test("is package.json's repository as a web page", () => {
    expect(SOURCE).toBe("https://github.com/nilsan/cnc-facing");
  });
});
