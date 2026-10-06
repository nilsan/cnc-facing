/**
 * Makera's official bits and the speeds and feeds Makera publishes for them,
 * for checking what an uploaded file actually does with each bit.
 *
 * Transcribed from
 * <https://wiki.makera.com/en/speeds-and-feeds> (re-read in full 2026-09-20).
 * Only the bits in the Essential Milling Bit Set (Extended) on the shelf, the
 * 0.5mm drills bought separately, and the 3.175*12mm drill Makera lists with the
 * same figures as the others. Every cell is a CEILING, not a target -- Makera:
 * "start the test from the lower limit of the parameter" -- so the checker
 * reports going over one, never being under.
 *
 * A `null` cell is Makera publishing nothing for that bit and material. That is
 * information in its own right: it usually means "this bit is not for that
 * material" (the long non-metal flat ends have no metal columns at all).
 *
 * materials.ts's facing rows cite the same 3.175*12mm row; a test holds the two
 * to the same numbers, so they cannot drift apart.
 *
 * The flat ends this table lacks come from makera.ts with their Fusion presets,
 * so every bit the facing form offers is one the checker knows.
 */

import { LIBRARY, nominalSize } from "./makera.ts";

export type CatMaterial =
  | "aluminum" | "brass" | "carbonFiber" | "copper" | "hardwood" | "pcb" | "plastic" | "softwood";

export const CAT_MATERIALS: readonly CatMaterial[] =
  ["aluminum", "brass", "carbonFiber", "copper", "hardwood", "pcb", "plastic", "softwood"];

/** Makera's column headings. */
export const CAT_MATERIAL_LABELS: Record<CatMaterial, string> = {
  aluminum: "Aluminum", brass: "Brass", carbonFiber: "Carbon Fiber", copper: "Copper",
  hardwood: "Hardwood", pcb: "PCB", plastic: "Plastic", softwood: "Softwood",
};

const METALS: ReadonlySet<CatMaterial> = new Set(["aluminum", "brass", "copper"]);
export const isMetal = (m: CatMaterial) => METALS.has(m);

export interface Row {
  readonly rpm: number;
  /** mm/min, lateral. */
  readonly feed: number;
  /** mm/min, Z. */
  readonly plunge: number;
  /** Depth of cut per pass, mm. For a drill, the peck. */
  readonly doc: number;
}

export type Kind = "flat" | "ball" | "engraving" | "corn" | "drill" | "chamfer";

export interface Bit {
  readonly id: string;
  /** Makera's own name for it, as the table prints it. */
  readonly name: string;
  readonly kind: Kind;
  /** Metal series or not. Corn bits, drills and the chamfer have no series. */
  readonly metal?: boolean;
  /** Cutting diameter; for a V-bit or chamfer, the tip. */
  readonly diameter: number;
  /** Included angle, V-bits and chamfer. */
  readonly angle?: number;
  /** Flute length when Makera's name states it. */
  readonly flute?: number;
  readonly rows: Record<CatMaterial, Row | null>;
}

const r = (rpm: number, feed: number, plunge: number, doc: number): Row => ({ rpm, feed, plunge, doc });

/** Columns in Makera's order: Al, Brass, CF, Cu, Hardwood, PCB, Plastic, Softwood. */
function cols(...v: (Row | null)[]): Record<CatMaterial, Row | null> {
  return Object.fromEntries(CAT_MATERIALS.map((m, i) => [m, v[i] ?? null])) as Record<CatMaterial, Row | null>;
}

const VBIT = cols(r(12000, 500, 200, 0.2), r(12000, 300, 100, 0.1), null, r(12000, 300, 100, 0.1),
  r(12000, 1000, 500, 1), r(12000, 500, 200, 0.1), r(12000, 1000, 500, 1), r(12000, 1000, 500, 2));
const CORN = cols(null, null, r(12000, 500, 300, 0.3), null, null, r(12000, 500, 300, 0.3), null, null);
const drill = (cf: number) => cols(r(10000, 1000, 100, 0.2), r(10000, 1000, 100, 0.2), r(10000, 1000, 200, cf),
  r(10000, 1000, 100, 0.2), r(10000, 1000, 300, 1), r(10000, 1000, 200, 1), r(10000, 1000, 300, 1), r(10000, 1000, 300, 1));
const flatMetal = (al: number, cu: number, wood: number, soft: number) => cols(r(12000, 500, 200, al),
  r(12000, 300, 100, cu), null, r(12000, 300, 100, cu), r(10000, 1000, 300, wood), null, r(10000, 1000, 300, wood),
  r(10000, 1000, 300, soft));
const FLAT_NONMETAL = cols(null, null, null, null, r(10000, 1000, 300, 1), null, r(10000, 1000, 300, 1), r(10000, 1000, 300, 2));
const BALL_METAL = cols(r(12000, 500, 200, 0.2), r(12000, 500, 200, 0.1), null, r(12000, 500, 200, 0.1),
  r(12000, 500, 200, 1), null, r(12000, 500, 200, 1), r(12000, 500, 200, 2));
const BALL_NONMETAL = cols(null, null, null, null, r(12000, 500, 200, 1), null, r(12000, 500, 200, 1), r(12000, 500, 200, 2));

const TRANSCRIBED: readonly Bit[] = [
  { id: "engr-0.1-60", name: "0.1mm*60° Engraving(Metal)", kind: "engraving", metal: true, diameter: 0.1, angle: 60, rows: VBIT },
  { id: "engr-0.2-30", name: "0.2mm*30° Engraving(Metal)", kind: "engraving", metal: true, diameter: 0.2, angle: 30, rows: VBIT },
  { id: "engr-0.3-30", name: "0.3mm*30° Engraving(Metal)", kind: "engraving", metal: true, diameter: 0.3, angle: 30, rows: VBIT },
  ...[0.6, 1, 2, 3].map((d): Bit => ({ id: `corn-${d}`, name: `${d}mm Corn`, kind: "corn", diameter: d, rows: CORN })),
  { id: "drill-0.5", name: "0.5*8.5mm Drill", kind: "drill", diameter: 0.5, flute: 8.5, rows: drill(0.5) },
  { id: "drill-1", name: "1*10mm Drill", kind: "drill", diameter: 1, flute: 10, rows: drill(1) },
  { id: "drill-2", name: "2*12mm Drill", kind: "drill", diameter: 2, flute: 12, rows: drill(1) },
  { id: "drill-2.5", name: "2.5*12mm Drill", kind: "drill", diameter: 2.5, flute: 12, rows: drill(1) },
  { id: "drill-3", name: "3*12mm Drill", kind: "drill", diameter: 3, flute: 12, rows: drill(1) },
  { id: "drill-3.175", name: "3.175*12mm Drill", kind: "drill", diameter: 3.175, flute: 12, rows: drill(1) },
  { id: "flat-1-3", name: "1*3mm Flat End(Metal)", kind: "flat", metal: true, diameter: 1, flute: 3, rows: flatMetal(0.1, 0.05, 0.5, 1) },
  { id: "flat-2-8", name: "2*8mm Flat End(Metal)", kind: "flat", metal: true, diameter: 2, flute: 8, rows: flatMetal(0.15, 0.1, 0.5, 1) },
  { id: "flat-3.175-12", name: "3.175*12mm Flat End(Metal)", kind: "flat", metal: true, diameter: 3.175, flute: 12, rows: flatMetal(0.2, 0.1, 1, 2) },
  { id: "flat-3.175-25", name: "3.175*25mm Flat End", kind: "flat", metal: false, diameter: 3.175, flute: 25, rows: FLAT_NONMETAL },
  { id: "flat-3.175-42", name: "3.175*42mm Flat End", kind: "flat", metal: false, diameter: 3.175, flute: 42, rows: FLAT_NONMETAL },
  { id: "ball-1-3", name: "1*3mm ball nose(Metal)", kind: "ball", metal: true, diameter: 1, flute: 3, rows: BALL_METAL },
  { id: "ball-2-6", name: "2*6mm ball nose(Metal)", kind: "ball", metal: true, diameter: 2, flute: 6, rows: BALL_METAL },
  { id: "ball-3.175-10", name: "3.175*10mm ball nose(Metal)", kind: "ball", metal: true, diameter: 3.175, flute: 10, rows: BALL_METAL },
  { id: "ball-1-4", name: "1*4mm ball nose", kind: "ball", metal: false, diameter: 1, flute: 4, rows: BALL_NONMETAL },
  { id: "ball-2-12", name: "2*12mm ball nose", kind: "ball", metal: false, diameter: 2, flute: 12, rows: BALL_NONMETAL },
  { id: "ball-3.175-22", name: "3.175*22mm ball nose", kind: "ball", metal: false, diameter: 3.175, flute: 22, rows: BALL_NONMETAL },
  {
    id: "chamfer-0.1-90", name: "0.1mm*90° Chamfering", kind: "chamfer", diameter: 0.1, angle: 90,
    rows: cols(r(12000, 600, 200, 0.2), r(12000, 500, 200, 0.1), r(12000, 500, 200, 0.1), r(12000, 500, 200, 0.1),
      r(12000, 1000, 500, 1), r(12000, 500, 200, 0.1), r(12000, 1000, 500, 1), r(12000, 1200, 500, 2)),
  },
];

const FROM_LIBRARY: readonly Bit[] = LIBRARY.filter((b) => b.kind === "flat").flatMap((b): Bit[] => {
  const { diameter, flute } = nominalSize(b);
  const known = TRANSCRIBED.some((t) =>
    t.kind === "flat" && t.diameter === diameter && t.flute === flute && t.metal === b.metal);
  if (known) return [];
  const rows = cols(...CAT_MATERIALS.map((m) => {
    const p = b.presets[m];
    return p?.feed && p.plunge && p.doc ? r(p.rpm, p.feed, p.plunge, p.doc) : null;
  }));
  return [{ id: b.id, name: b.name, kind: "flat", metal: b.metal, diameter, flute, rows }];
});

export const BITS: readonly Bit[] = [...TRANSCRIBED, ...FROM_LIBRARY];

export const bitById = (id: string) => BITS.find((b) => b.id === id);

/**
 * Departures from the table that this workshop made on purpose and recorded,
 * so the checker reports them as known rather than as a surprise.
 */
export interface Deviation {
  readonly bit: string;
  readonly material: CatMaterial;
  readonly field: keyof Row;
  readonly value: number;
  readonly why: string;
}

export const DEVIATIONS: readonly Deviation[] = [
  {
    bit: "engr-0.3-30", material: "pcb", field: "doc", value: 0.12,
    why: "Isolation at -0.12 rather than 0.1: on a V-bit depth sets cut width, and 0.364mm wide is what clears the 0.84mm header-pad gap in two passes (from PCB isolation tests).",
  },
];

/** What a tool's name says about it. */
export interface Parsed {
  readonly kind: Kind;
  readonly diameter?: number;
  readonly flute?: number;
  readonly angle?: number;
  readonly metal?: boolean;
}

/**
 * Read a bit from its name, in any of the three styles seen here:
 *
 *   Makera Studio   `3.175*12mm Flat End(Metal)`, `3.175*2*12mm Drill`
 *   post-processed     `3.175*0.3mm*30deg Engraving - ISOLATION`, `3.175*2*10.5mm Corn - ...`
 *   this app        `3.175*12mm Flat End - FACING`
 *
 * Makera prefixes a 3.175 shank when the cutter is smaller (`3.175*2*8mm`), and
 * anything after " - " is a label, not part of the name.
 */
export function parseBitName(raw: string): Parsed | null {
  const name = raw.split(" - ")[0]!.toLowerCase();
  const kind: Kind | null =
    /corn/.test(name) ? "corn"
    : /drill/.test(name) ? "drill"
    : /chamfer/.test(name) ? "chamfer"
    : /engrav|v-?bit/.test(name) ? "engraving"
    : /ball/.test(name) ? "ball"
    : /flat/.test(name) ? "flat"
    : null;
  if (!kind) return null;
  const angleM = /(\d+(?:\.\d+)?)\s*(?:deg|°)/.exec(name);
  const angle = angleM ? Number(angleM[1]) : undefined;
  const dims = name.replace(/(\d+(?:\.\d+)?)\s*(?:deg|°)/g, "").split(/[a-z(]/)[0]!;
  const nums = [...dims.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const metal = /\(metal\)/.test(name) ? true : undefined;
  if (kind === "engraving" || kind === "chamfer") {
    // `3.175*0.3mm*30deg`: the tip is the small one, the shank the other.
    return { kind, diameter: nums.length ? Math.min(...nums) : undefined, angle, metal };
  }
  if (nums.length >= 3) return { kind, diameter: nums[1], flute: nums[2], metal };
  if (nums.length === 2) return { kind, diameter: nums[0], flute: nums[1], metal };
  return { kind, diameter: nums[0], metal };
}

const near = (a: number | undefined, b: number | undefined, tol: number) =>
  a === undefined || b === undefined || Math.abs(a - b) <= tol;

export type Match =
  | { readonly ok: true; readonly bit: Bit }
  | { readonly ok: false; readonly reason: string; readonly candidates: Bit[] };

/**
 * Which official bit a header TOOL entry is. The name decides; the header's
 * own geometry fields fill in what the name leaves out.
 */
export function matchBit(tool: { name: string; diameter?: number; tipDiameter?: number; fluteLength?: number }): Match {
  const p = parseBitName(tool.name);
  if (!p) return { ok: false, reason: "its name does not say what kind of bit it is", candidates: [] };
  const diameter = p.diameter ?? ((p.kind === "engraving" || p.kind === "chamfer") ? tool.tipDiameter : tool.diameter);
  const flute = p.flute ?? tool.fluteLength;
  let c = BITS.filter((b) => b.kind === p.kind && near(b.diameter, diameter, 0.01) && near(b.angle, p.angle, 0.5));
  if (p.metal !== undefined) c = c.filter((b) => b.metal === undefined || b.metal === p.metal);
  // Flute length separates the 3.175 flat ends (12 metal, 25 and 42 non-metal).
  if (c.length > 1) {
    const byFlute = c.filter((b) => b.flute !== undefined && near(b.flute, flute, 0.5));
    if (byFlute.length) c = byFlute;
  }
  // Makera's names tag the Metal series, so an untagged name that fits both is the other one.
  if (c.length > 1 && p.metal === undefined) {
    const plain = c.filter((b) => b.metal === false);
    if (plain.length) c = plain;
  }
  if (c.length === 1) return { ok: true, bit: c[0]! };
  if (c.length === 0) {
    return { ok: false, reason: `no official ${p.kind} bit is ${diameter ?? "?"}mm${p.angle ? ` × ${p.angle}°` : ""}`, candidates: [] };
  }
  return { ok: false, reason: "it could be more than one official bit", candidates: c };
}

/**
 * The material column for a header's `;@MKR|MATERIAL` names. MDF reads as
 * Hardwood, which is the conservative wood column and what materials.ts uses.
 * FR4 is checked before copper: "FR4 copper-clad" is a PCB, not copper.
 */
export function detectMaterial(...names: (string | undefined)[]): CatMaterial | null {
  const s = names.filter(Boolean).join(" ").toLowerCase();
  if (!s.trim()) return null;
  if (/fr-?4|pcb|copper[- ]clad/.test(s)) return "pcb";
  if (/alumin/.test(s)) return "aluminum";
  if (/brass/.test(s)) return "brass";
  if (/copper/.test(s)) return "copper";
  if (/carbon/.test(s)) return "carbonFiber";
  if (/soft ?wood|pine|spruce/.test(s)) return "softwood";
  if (/mdf|hard ?wood|wood|plywood|oak|beech|birch/.test(s)) return "hardwood";
  if (/plastic|acrylic|pmma|pom|delrin|hdpe|abs|nylon|pvc/.test(s)) return "plastic";
  return null;
}

export const isCatMaterial = (v: unknown): v is CatMaterial =>
  typeof v === "string" && (CAT_MATERIALS as readonly string[]).includes(v);
