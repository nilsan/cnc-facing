/**
 * The derived numbers, and the warnings that do not refuse.
 *
 * Everything except size, depth and material is derived, and the whole value of
 * this app is encoding knowledge the user would otherwise re-derive -- so every
 * derived number is shown with the reason it has that value. A number the user
 * cannot check is a number they have to trust, and this project exists because
 * trusting a generated file cost seven trips to the machine.
 */

import type { ChamferPlan } from "./chamfer.ts";
import type { FacingPath, Pattern } from "./facing.ts";
import type { StockDeclaration } from "./mkr.ts";

export interface Warning {
  readonly level: "note" | "warn";
  readonly text: string;
}

/** What the form and the summary call each pattern. */
export const PATTERN_LABELS: Record<Pattern, string> = {
  "serpentine-x": "Serpentine along X",
  "serpentine-y": "Serpentine along Y",
  "oneway-y": "One-way along Y, climb",
  spiral: "Spiral inward, climb",
};

/**
 * Which way the tool meets the material, per pattern. One line each: the
 * reasoning (a floor is cut by the end face, so this governs only the ridge at
 * each overlap) is in the README, not on the page.
 */
const DIRECTION_NOTES: Record<Pattern, string> = {
  "serpentine-x": "Alternates: +X passes climb, −X conventional.",
  "serpentine-y": "Alternates: +Y passes climb, −Y conventional.",
  "oneway-y": "Every pass climb, front to back; a small plunge mark on the front edge per pass.",
  spiral: "Climb throughout, clockwise inward; top and bottom triangles are X-cut, left and right Y-cut.",
};

export interface Summary {
  readonly mode: "general" | "finish";
  readonly pattern: Pattern;
  readonly patternLabel: string;
  /** "rings" for the spiral, "passes" for the rest. */
  readonly passUnit: string;
  /** Set in finish mode: what the last pass takes off, and how it runs. */
  readonly finish: {
    readonly allowance: number;
    readonly stepoverMm: number;
    readonly passes: number;
    readonly rotated: boolean;
  } | null;
  readonly tool: string;
  readonly toolId: string;
  /** True when the feeds are reasoned rather than published. The UI says so. */
  readonly derived: boolean;
  readonly rpm: number;
  readonly feed: number;
  readonly plunge: number;
  readonly source: string;
  readonly materialNote: string;
  readonly stepoverMm: number;
  readonly stepoverPct: number;
  readonly maxDepthPerPass: number;
  readonly levels: number;
  readonly passesPerLevel: number;
  readonly totalPasses: number;
  readonly passDepths: number[];
  readonly cutLengthMm: number;
  readonly minutes: number;
  readonly stock: StockDeclaration;
  readonly overhang: number;
  /** How far inside the block the laser trace sits: the tool-centre inset. */
  readonly laserInset: number;
  readonly sweptArea: { x: [number, number]; y: [number, number] };
  /** The T2 chamfer pass, when there is one. */
  readonly chamfer: {
    readonly width: number;
    readonly laps: number;
    readonly tool: string;
    readonly rpm: number;
    readonly feed: number;
    readonly plunge: number;
    readonly source: string;
  } | null;
  readonly warnings: Warning[];
}

/** Above this, say how long it will take before the user finds out at the machine. */
const LONG_JOB_MINUTES = 30;
const VERY_LONG_JOB_MINUTES = 120;

export function summarise(path: FacingPath, stock: StockDeclaration, chamfer: ChamferPlan | null = null): Summary {
  const { spec } = path;
  const m = spec.material;
  const minutes = path.seconds / 60;
  const warnings: Warning[] = [];
  const r = m.tool.diameter / 2;

  // Short on purpose: the page is read at the machine. The reasons behind each
  // line are in the README; only what changes what you do is said here.
  if (m.derived) {
    warnings.push({ level: "warn", text: "Feeds derived, not published. Test shallow first." });
  }

  if (minutes >= VERY_LONG_JOB_MINUTES) {
    warnings.push({ level: "warn", text: `${formatDuration(minutes)} job. Reconsider size or depth.` });
  } else if (minutes >= LONG_JOB_MINUTES) {
    warnings.push({ level: "warn", text: `${formatDuration(minutes)} job.` });
  }

  if (path.mode === "finish") {
    // The depth entered is the TOTAL: that was asked at the machine, so it
    // gets a line of its own, with this job's numbers.
    const rough = path.levels.filter((l) => !l.isFinish);
    const roughTo = rough.at(-1)?.z ?? 0;
    const fin = path.levels.at(-1)!;
    warnings.push({
      level: "note",
      text: `${g3(spec.depth)}mm is the total depth. ` +
        (rough.length ? `Roughing along X to ${g3(roughTo)}mm, then ` : "") +
        `finishing along Y takes the last ${g3(fin.z - roughTo)}mm at ${(m.tool.diameter * m.finishStepover).toFixed(2)}mm step.`,
    });
  } else {
    warnings.push({ level: "note", text: DIRECTION_NOTES[path.pattern] });
  }

  // The laser boundary trace follows the tool CENTRE, not the edge of the cut
  // (a first trace: X1.587 Y158.412 for 120 x 160; confirmed on a
  // 45.2mm block 2026-09-23). Saying where to expect it is what stops the size
  // being inflated to make the laser reach the edge.
  warnings.push({
    level: "note",
    text: path.inset > 1e-9
      ? `Laser box ${path.inset.toFixed(2)}mm inside the block on every side. That is correct; uneven means X0 Y0 is off.`
      : "Laser traces the block's outline. Off on one side means X0 Y0 is off.",
  });

  if (path.inset > 1e-9) {
    warnings.push({
      level: "note",
      text: `No overhang: a whole block gets burred edges and ${r.toFixed(2)}mm corners. Tick Overhang for that.`,
    });
  }

  if (chamfer) {
    warnings.push({
      level: "note",
      text: `Stops after facing for T2, the 90° chamfer bit. It re-probes Z.`,
    });
  }

  // A 160mm facing job found its soft endstop mid-trace.
  warnings.push({
    level: "note",
    text: `Needs +${spec.width}mm X, −${spec.height}mm Y from X0 Y0. Run the reach check below.`,
  });

  warnings.push({ level: "note", text: "Run the levelling probe (G32) first." });

  const last = path.levels.at(-1);
  return {
    mode: path.mode,
    pattern: path.pattern,
    patternLabel: PATTERN_LABELS[path.pattern],
    passUnit: path.pattern === "spiral" ? "rings" : "passes",
    finish: last?.isFinish
      ? {
          allowance: m.finishAllowance,
          stepoverMm: m.tool.diameter * m.finishStepover,
          passes: last.passes,
          rotated: last.raster?.axis === "y",
        }
      : null,
    tool: m.tool.name,
    toolId: m.id,
    derived: m.derived,
    rpm: m.rpm,
    feed: m.feed,
    plunge: m.plunge,
    source: m.source,
    materialNote: m.note,
    stepoverMm: path.step,
    stepoverPct: Number((spec.stepover * 100).toFixed(1)),
    maxDepthPerPass: m.maxDepthPerPass,
    levels: path.levels.length,
    passesPerLevel: path.passesPerLevel,
    totalPasses: path.totalPasses,
    passDepths: path.passDepths,
    cutLengthMm: path.cutLength,
    minutes: minutes + (chamfer ? chamfer.seconds / 60 : 0),
    stock,
    overhang: path.overhang,
    laserInset: path.inset,
    sweptArea: { x: [0 - path.overhang, spec.width + path.overhang], y: [-(spec.height + path.overhang), path.overhang] },
    chamfer: chamfer
      ? {
          width: chamfer.width,
          laps: chamfer.laps.length,
          tool: chamfer.profile.tool.name,
          rpm: chamfer.profile.rpm,
          feed: chamfer.profile.feed,
          plunge: chamfer.profile.plunge,
          source: chamfer.profile.source,
        }
      : null,
    warnings,
  };
}

/** Up to three decimals, trailing zeros dropped: 0.15, not 0.150. */
const g3 = (v: number) => Number(v.toFixed(3)).toString();

export function formatDuration(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${minutes.toFixed(1)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}
