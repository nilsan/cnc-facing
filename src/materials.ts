/**
 * Material x tool -> feeds, transcribed from
 * <https://wiki.makera.com/en/speeds-and-feeds> (re-read 2026-09-20,
 * and scraped in full 2026-09-21 -- the tables are in the served HTML, a plain
 * fetch renders only the title).
 *
 * Every row cites where it came from and says whether it is a VENDOR figure or a
 * DERIVED one. Makera's own preamble calls the published numbers ceilings, not
 * targets -- "start the test from the lower limit of the parameter" -- so treat
 * a change here as a machine decision, not a tweak. A derived row is a starting
 * point to test upward from, and the UI says so.
 *
 * TOOLS
 *
 * The 3.175x12mm single-flute Metal-series flat end is the default everywhere.
 * It is the bit the reference script declares and every faced board so far has
 * used. An early plan said metal facing had to drop to the 2x8mm bit because "the
 * 3.175mm flat end is a NON-METAL bit". The distinction is the SERIES, not the
 * diameter: the shelf has 3.175mm flat ends in both, all the same 3.175mm
 * cutting diameter. The 25mm and 42mm ones are the non-metal series, wood and
 * plastics only, with no aluminium or brass column at all. The 12mm one is the
 * Metal series and Makera does publish metal figures for it.
 *
 * Every other Makera flat end comes from makera.ts, with the checker's figures
 * for it (catalogue.ts), so a material offers only the bits Makera has figures
 * for: the non-metal series has no aluminium or brass column.
 */

import { CAT_MATERIAL_LABELS, matchBit, type CatMaterial } from "./catalogue.ts";
import { LIBRARY, nominalSize } from "./makera.ts";

export interface Tool {
  /** Makera's own naming, diameter*flutelength; goes verbatim into `;@MKR|TOOL|name=`. */
  readonly name: string;
  /** `;@MKR|TOOL|type=` -- one of Makera's tool-type words. */
  readonly type: string;
  readonly diameter: number;
  readonly handleDiameter: number;
  /** Hard ceiling on depth of cut: you cannot bury more bit than you have. */
  readonly fluteLength: number;
}

/** One material/tool pairing and the numbers that go with it. */
export interface ToolProfile {
  /** Short key used in the form and the filename. */
  readonly id: ToolId;
  /** What the form lists it as. */
  readonly label: string;
  readonly tool: Tool;
  readonly rpm: number;
  /** mm/min, lateral. Must stay under MAX_FEEDRATE. */
  readonly feed: number;
  /** mm/min, Z. */
  readonly plunge: number;
  readonly maxDepthPerPass: number;
  /** Default stepover as a fraction of tool diameter. See the note on each row. */
  readonly stepover: number;
  /**
   * Stepover fraction for the finishing pass in `finish` mode. Chosen, not
   * published: Makera gives feeds, not a finishing strategy. Every row lands at
   * roughly 0.7mm absolute, about half the roughing step.
   */
  readonly finishStepover: number;
  /** Where the numbers came from, printed in the UI. */
  readonly source: string;
  /** False = Makera publishes these. True = reasoned from chipload; start low. */
  readonly derived: boolean;
  readonly note: string;
}

/**
 * The chamfer pass: a lap round the block's top edge with the 90° chamfering
 * bit, after the facing, in the same file. Makera's published row for
 * `0.1mm*90° Chamfering` (Makera's speeds and feeds, "Chamfering"), per material.
 */
export interface ChamferProfile {
  readonly tool: ChamferTool;
  readonly rpm: number;
  readonly feed: number;
  readonly plunge: number;
  /** Depth per lap, mm: Makera's DOC column for the chamfer bit. */
  readonly maxDepthPerPass: number;
  readonly source: string;
}

export interface ChamferTool extends Tool {
  /** Diameter of the flat at the tip, mm. */
  readonly tipDiameter: number;
  /** Half the included angle, degrees: 45 for a 90° bit. */
  readonly halfAngle: number;
}

/**
 * Five on the shelf (the bits in Makera's Essential Milling Bit Set). `type=Engraving`
 * because that is the V-bit type word the controller has accepted in every PCB
 * header here, with halfAngle carrying the geometry. The cone runs from the
 * 0.1mm tip to the 3.175 shank at 45°, about 1.5mm tall.
 */
export const CHAMFER_90: ChamferTool = {
  name: "3.175*0.1mm*90deg Chamfer",
  type: "Engraving",
  diameter: 3.175,
  handleDiameter: 3.175,
  fluteLength: 1.5,
  tipDiameter: 0.1,
  halfAngle: 45,
};

const CHAMFER_SOURCE = "Makera's speeds and feeds, Chamfering, `0.1mm*90° Chamfering`";

/** Chamfer width offered by default, mm: takes the sharp edge off, no more. */
export const DEFAULT_CHAMFER = 0.2;
/** Largest chamfer offered, mm. Past this it is a feature, not an edge break. */
export const MAX_CHAMFER = 1.0;

export type ToolId = string;
export type MaterialId = "mdf" | "aluminium" | "brass";

export interface Material {
  readonly id: MaterialId;
  readonly label: string;
  /** `;@MKR|MATERIAL|name2=` -- free text the controller shows. */
  readonly stockName: string;
  /** First entry is the default. */
  readonly tools: ToolProfile[];
  /**
   * How much depth `finish` mode leaves for the last pass, mm.
   *
   * Chosen, not published. A finishing pass wants a thin, even chip: too little
   * and the tool rubs and burnishes instead of cutting, which in aluminium is
   * how you get a smeared surface rather than a bright one. Must not exceed the
   * tool's depth per pass, which validate.ts checks.
   */
  readonly finishAllowance: number;
  /**
   * What the depth field is set to when this material is picked, mm: one
   * facing pass at Makera's depth of cut, 0.3 for MDF as it always was.
   */
  readonly defaultDepth: number;
  readonly chamfer: ChamferProfile;
}

/** `;@MKR|MAXFEEDRATE|value=` -- declared in the header AND enforced in validate.ts. */
export const MAX_FEEDRATE = 1200;

/**
 * The 3.175x12mm single-flute Metal series. Two on the shelf.
 * Field values match what the reference script declares, so the controller sees
 * the same tool it has seen on every faced job so far.
 */
const FLAT_3175: Tool = {
  name: "3.175*12mm Flat End",
  type: "Flat End",
  diameter: 3.175,
  handleDiameter: 3.175,
  fluteLength: 12,
};

/** The library's entry for FLAT_3175, which the hand-checked rows below stand in for. */
const FLAT_3175_LIBRARY_ID = "spiral-o-metal-3.175x12mm";
const FLAT_3175_LABEL = "Spiral O Metal 3.175*12mm";

/**
 * 0.45 of tool diameter is the reference script's figure, picked conservatively
 * for MDF's ragged fibres, and it is what every faced board on this machine was
 * cut with.
 *
 * A wider bit would want a SMALLER fraction, not the same one. On a facing job
 * the finish is dominated by spindle tram, and the ridge left at each overlap
 * scales with the ABSOLUTE stepover, not the fraction -- so carrying 0.45 onto a
 * 6mm tool would step 2.7mm instead of 1.43mm and leave ridges nearly twice as
 * tall: a worse surface from a better tool. Noted for whoever adds the next bit.
 */
export const DEFAULT_STEPOVER = 0.45;

/** The 3.175 rows' absolute steps, mm, roughing and finishing. */
const ROUGH_STEP = FLAT_3175.diameter * DEFAULT_STEPOVER;
const FINISH_STEP = FLAT_3175.diameter * 0.22;

/**
 * The library's other flat ends with figures for this column, by collet then
 * size. The figures are the checker's row for the bit, so a file from here is
 * checked against its own numbers. Stepover is scaled so a wider bit keeps the
 * 3.175's absolute step, per the note above; a narrower one keeps the 3.175's
 * fractions.
 */
function libraryTools(column: CatMaterial): ToolProfile[] {
  const bits = LIBRARY.filter((b) => b.kind === "flat" && b.id !== FLAT_3175_LIBRARY_ID);
  return bits.flatMap((b): ToolProfile[] => {
    const { diameter: d, flute: l } = nominalSize(b);
    const name = `${d}*${l}mm Flat End${b.metal ? "(Metal)" : ""}`;
    const m = matchBit({ name });
    const p = m.ok ? m.bit.rows[column] : null;
    if (!m.ok || !p) return [];
    const stepover = Math.min(DEFAULT_STEPOVER, Number((ROUGH_STEP / b.diameter).toFixed(3)));
    return [{
      id: `${d}x${l}mm${b.metal ? "-metal" : ""}`,
      label: b.name,
      tool: {
        name,
        type: "Flat End",
        diameter: b.diameter,
        handleDiameter: b.shank,
        fluteLength: b.flute,
      },
      rpm: p.rpm,
      feed: p.feed,
      plunge: p.plunge,
      maxDepthPerPass: p.doc,
      stepover,
      finishStepover: Math.min(0.22, Number((FINISH_STEP / b.diameter).toFixed(3))),
      source: m.bit.id === b.id
        ? `Makera's Fusion 360 library, \`${b.name}\`, ${CAT_MATERIAL_LABELS[column]} preset`
        : `Makera's speeds and feeds, \`${m.bit.name}\`, ${CAT_MATERIAL_LABELS[column]} column`,
      derived: false,
      note: stepover < DEFAULT_STEPOVER
        ? `Makera's preset. Stepover ${stepover} keeps the 3.175 bit's ${ROUGH_STEP.toFixed(2)}mm step.`
        : "Makera's preset.",
    }];
  }).sort((a, b) => a.tool.handleDiameter - b.tool.handleDiameter ||
    a.tool.diameter - b.tool.diameter || a.tool.fluteLength - b.tool.fluteLength || a.id.localeCompare(b.id));
}

export const MATERIALS: Record<MaterialId, Material> = {
  mdf: {
    id: "mdf",
    label: "MDF",
    stockName: "MDF spoilboard",
    finishAllowance: 0.2,
    defaultDepth: 0.3,
    chamfer: { tool: CHAMFER_90, rpm: 12000, feed: 1000, plunge: 500, maxDepthPerPass: 1, source: `${CHAMFER_SOURCE}, Hardwood column` },
    tools: [
      {
        id: "3.175",
        label: FLAT_3175_LABEL,
        tool: FLAT_3175,
        rpm: 10000,
        feed: 1000,
        plunge: 300,
        // Hardwood, not softwood (2.0): MDF's binder is harder on an edge than
        // its density suggests, and this is what every faced board has used.
        maxDepthPerPass: 1.0,
        stepover: 0.45,
        finishStepover: 0.22,
        source: "Makera's speeds and feeds, Single Flute Metal, `3.175*12mm Flat End(Metal)`, Hardwood column",
        derived: false,
        note: "Makera publishes no MDF column for milling. Hardwood is the conservative read of the two wood columns (softwood allows 2.0mm/pass) and is what every faced board on this machine has been cut with.",
      },
      ...libraryTools("hardwood"),
    ],
  },

  aluminium: {
    id: "aluminium",
    label: "Aluminium",
    stockName: "Aluminium",
    finishAllowance: 0.05,
    defaultDepth: 0.2,
    chamfer: { tool: CHAMFER_90, rpm: 12000, feed: 600, plunge: 200, maxDepthPerPass: 0.2, source: `${CHAMFER_SOURCE}, Aluminum column` },
    tools: [
      {
        id: "3.175",
        label: FLAT_3175_LABEL,
        tool: FLAT_3175,
        rpm: 12000,
        feed: 500,
        plunge: 200,
        maxDepthPerPass: 0.2,
        stepover: 0.45,
        finishStepover: 0.22,
        source: "Makera's speeds and feeds, Single Flute Metal, `3.175*12mm Flat End(Metal)`, Aluminum column",
        derived: false,
        note: "Vendor figures. Note the surface speed is only 120 m/min, which is low for carbide in aluminium and is where built-up edge comes from — so if a test coupon comes out cloudy grey rather than bright, suspect that before the feeds, and go shallower rather than faster.",
      },
      ...libraryTools("aluminum"),
    ],
  },

  brass: {
    id: "brass",
    label: "Brass",
    stockName: "Brass",
    finishAllowance: 0.05,
    defaultDepth: 0.1,
    chamfer: { tool: CHAMFER_90, rpm: 12000, feed: 500, plunge: 200, maxDepthPerPass: 0.1, source: `${CHAMFER_SOURCE}, Brass column` },
    tools: [
      {
        id: "3.175",
        label: FLAT_3175_LABEL,
        tool: FLAT_3175,
        rpm: 12000,
        feed: 300,
        plunge: 100,
        maxDepthPerPass: 0.1,
        stepover: 0.45,
        finishStepover: 0.22,
        source: "Makera's speeds and feeds, Single Flute Metal, `3.175*12mm Flat End(Metal)`, Brass column",
        derived: false,
        note: "The slowest combination here: 0.1mm per pass at 300mm/min. Check the time estimate before committing the machine; a shallower total depth is usually the fix.",
      },
      ...libraryTools("brass"),
    ],
  },
};

export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];

/**
 * A material and a chosen tool, flattened.
 *
 * Everything downstream (facing.ts, mkr.ts, summary.ts) works with one of these
 * rather than reaching through a material to a tool, so adding a tool never
 * changes the shape those modules see.
 */
export interface Recipe extends ToolProfile {
  readonly materialId: MaterialId;
  readonly label: string;
  readonly stockName: string;
  readonly finishAllowance: number;
  readonly defaultDepth: number;
  readonly chamfer: ChamferProfile;
}

/** Resolve a material id and optional tool id. Unknown tool -> the default. */
export function resolve(materialId: MaterialId, toolId?: string): Recipe | null {
  const m = MATERIALS[materialId];
  if (!m) return null;
  const profile = (toolId && m.tools.find((t) => t.id === toolId)) || m.tools[0]!;
  return {
    ...profile,
    materialId: m.id,
    label: m.label,
    stockName: m.stockName,
    finishAllowance: m.finishAllowance,
    defaultDepth: m.defaultDepth,
    chamfer: m.chamfer,
  };
}

export function isMaterialId(v: unknown): v is MaterialId {
  return typeof v === "string" && v in MATERIALS;
}

export function isToolId(v: unknown): v is ToolId {
  return MATERIAL_IDS.some((m) => MATERIALS[m].tools.some((t) => t.id === v));
}
