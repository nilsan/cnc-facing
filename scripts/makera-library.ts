/**
 * Regenerates src/makera-bits.json from the Fusion 360 tool libraries Makera
 * publishes in MakeraInc/CarveraProfiles.
 *
 *   bun scripts/makera-library.ts [git ref, default main]
 *
 * The ref is pinned to its commit and recorded in the output. Lasers and holders
 * are skipped; every bit keeps the presets Makera ships.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

const REPO = "MakeraInc/CarveraProfiles";
const TOOLS_DIR = "CAM_Post_Processors/Fusion360-profiles/Tool Files";
const OUT = join(import.meta.dir, "../src/makera-bits.json");

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "user-agent": "cnc-facing" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res;
}

/** The first file in a zip; a .tools file holds only tools.json. */
function unzipFirst(zip: Buffer): string {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const entry = zip.readUInt32LE(end + 16);
  const method = zip.readUInt16LE(entry + 10);
  const size = zip.readUInt32LE(entry + 20);
  const local = zip.readUInt32LE(entry + 42);
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const data = zip.subarray(start, start + size);
  return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
}

/** Fusion preset names to catalogue.ts's material columns. */
const COLUMNS: Record<string, string> = {
  Aluminum: "aluminum", Brass: "brass", "Carbon Fiber": "carbonFiber", Copper: "copper",
  Hardwood: "hardwood", PCB: "pcb", Plastic: "plastic", Softwood: "softwood",
};

interface FusionTool {
  type: string;
  description: string;
  "product-link"?: string;
  geometry: Record<string, number | boolean | undefined>;
  "start-values"?: { presets?: Record<string, unknown>[] };
}

function kind(t: FusionTool): string | null {
  switch (t.type) {
    case "flat end mill": return /corn/i.test(t.description) ? "corn" : "flat";
    case "ball end mill": return "ball";
    case "drill": return "drill";
    case "chamfer mill": return /chamfer/i.test(t.description) ? "chamfer" : "engraving";
    case "thread mill": return "thread";
    default: return null;
  }
}

const slug = (s: string) => s.toLowerCase().replace(/(^|\D)\.(\d)/g, "$10.$2").replace(/\*/g, "x")
  .replace(/[^a-z0-9.]+/g, "-").replace(/\.(?!\d)/g, "").replace(/^-|-$/g, "");
const num = (v: unknown, places = 3) => (typeof v === "number" ? Number(v.toFixed(places)) : undefined);

const ref = process.argv[2] ?? "main";
const api = `https://api.github.com/repos/${REPO}`;
const sha = ((await (await get(`${api}/commits/${encodeURIComponent(ref)}`)).json()) as { sha: string }).sha;
const listing = (await (await get(`${api}/contents/${encodeURI(TOOLS_DIR)}?ref=${sha}`)).json()) as { name: string; path: string }[];
const files = listing.filter((f) => f.name.endsWith(".tools")).sort((a, b) => a.name.localeCompare(b.name));

const bits = new Map<string, unknown>();
for (const file of files) {
  const zip = Buffer.from(await (await get(`https://raw.githubusercontent.com/${REPO}/${sha}/${encodeURI(file.path)}`)).arrayBuffer());
  const tools = (JSON.parse(unzipFirst(zip)).data ?? []) as FusionTool[];
  for (const t of tools) {
    const k = kind(t);
    if (!k) continue;
    const g = t.geometry;
    const vbit = k === "engraving" || k === "chamfer";
    const presets = Object.fromEntries((t["start-values"]?.presets ?? []).flatMap((p) => {
      const column = COLUMNS[p.name as string];
      if (!column) return [];
      return [[column, {
        rpm: Math.round(p.n as number),
        // Drills have no lateral feed or stepdown.
        feed: num(p.v_f, 0),
        plunge: num(p.v_f_plunge, 0),
        doc: num(p.stepdown),
      }]];
    }));
    const id = slug(t.description);
    // The library lists a few bits twice.
    if (bits.has(id)) continue;
    bits.set(id, {
      id,
      name: t.description.replace(/\s+/g, " ").trim(),
      kind: k,
      metal: ["flat", "ball", "engraving"].includes(k) ? /metal/i.test(t.description) : undefined,
      diameter: num(vbit ? g["tip-diameter"] : g.DC),
      shank: num(g.SFDM),
      flute: num(g.LCF),
      flutes: g.NOF,
      angle: vbit && typeof g.TA === "number" ? g.TA * 2 : undefined,
      url: t["product-link"] || undefined,
      presets,
    });
  }
}

const source = `https://github.com/${REPO}/tree/${sha}/${encodeURI(TOOLS_DIR)}`;
const rows = [...bits.values()].map((b) => JSON.stringify(b)).join(",\n");
writeFileSync(OUT, `{"source":${JSON.stringify(source)},"bits":[\n${rows}\n]}\n`);
console.log(`${bits.size} bits from ${REPO}@${sha.slice(0, 7)} -> ${OUT}`);
