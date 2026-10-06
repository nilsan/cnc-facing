/**
 * Bun.serve. The form, a plan endpoint the form calls on every keystroke, the
 * download, and the checker for files this app did not write.
 *
 * Plan and download run the SAME buildJob(), so what the preview shows and what
 * the file contains cannot disagree -- the whole point of drawing a picture
 * before committing the machine is that it is a picture of the actual job.
 */

import { networkInterfaces } from "node:os";
import { buildJob, SOURCE, VERSION } from "./gcode.ts";
import { DEFAULT_PATTERN, PATTERNS } from "./facing.ts";
import { PATTERN_LABELS } from "./summary.ts";
import { DEFAULT_ALLOW, isPrivate, matches, parseAllow, reachableOn } from "./net.ts";
import { MATERIALS, MATERIAL_IDS, DEFAULT_STEPOVER, isMaterialId, isToolId, resolve } from "./materials.ts";
import { ENVELOPE_X, ENVELOPE_Y, type JobRequest } from "./validate.ts";
import { checkGcode } from "./check.ts";
import { CAT_MATERIALS, CAT_MATERIAL_LABELS, isCatMaterial } from "./catalogue.ts";
import { reportToSvg } from "./checksvg.ts";
import { reachWalk } from "./reach.ts";
import { RateLimiter, type LimitClass } from "./ratelimit.ts";

/**
 * Largest file /api/check reads. Makera Studio's 161,000-line sample is 3.2MB;
 * this leaves room for ten of those and stops short of reading anything absurd.
 */
const CHECK_MAX_BYTES = 32 * 1024 * 1024;

/** Largest JSON body the form routes read; a real job request is a few hundred bytes. */
const JSON_MAX_BYTES = 16 * 1024;

/**
 * Read a body as text, giving up once it passes `max` bytes. The content-length
 * header is only a claim -- a chunked upload has none -- so the count is of what
 * actually arrives.
 */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const PORT = Number(process.env.PORT ?? 3117);

/**
 * Listen on every interface by default, so the workshop LAN can reach it -- the
 * point of the app is that it runs on this box and is used from the laptop next
 * to the machine.
 */
const HOST = process.env.HOST ?? "0.0.0.0";

/**
 * ...but answer only the workshop subnet. This box is multi-homed (several
 * 10.x nets, a second 172.x, and Tailscale), so a wide listener without a
 * narrow allowlist would put a no-login G-code generator on all of them.
 * CNC_FACING_ALLOW=0.0.0.0/0,::/0 turns the filter off.
 */
const ALLOW = parseAllow(process.env.CNC_FACING_ALLOW ?? DEFAULT_ALLOW);

/**
 * A checkbox: FormData sends "on" when ticked and nothing when not. JSON
 * callers may send a boolean. Anything else is passed on for validate() to
 * refuse.
 */
function checkbox(v: unknown): boolean | undefined {
  if (v === undefined || v === false || v === "") return undefined;
  return v === true || v === "on" || v === "true" ? true : (v as never);
}

function parseRequest(body: unknown): JobRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (v === "" || v === null || v === undefined ? Number.NaN : Number(v));
  const material = isMaterialId(b.material) ? b.material : ("" as JobRequest["material"]);
  const tool = isToolId(b.tool) ? b.tool : undefined;
  // An omitted stepover means "whatever this bit wants", not a global constant.
  // With one bit those coincide; with two they would not, since a wider tool
  // needs a smaller FRACTION to keep the absolute step -- and so the ridge left
  // by any spindle tram -- where it is.
  const fallback = resolve(material, tool)?.stepover ?? DEFAULT_STEPOVER;
  return {
    width: num(b.width),
    height: num(b.height),
    overhang: checkbox(b.overhang),
    // Sent only when the chamfer box is ticked; blank means none.
    chamfer: b.chamfer === undefined || b.chamfer === "" ? undefined : num(b.chamfer),
    depth: num(b.depth),
    material,
    tool,
    // Anything that is not the finish strategy is the general one. An unknown
    // value must not quietly become "finish" and add a pass nobody asked for.
    mode: b.mode === "finish" ? "finish" : "general",
    // Passed through as given: an unknown pattern is refused by validate(),
    // not coerced into the default and cut as a test it was not.
    pattern: b.pattern === undefined || b.pattern === "" ? undefined : (String(b.pattern) as JobRequest["pattern"]),
    stepover: b.stepover === undefined || b.stepover === "" ? fallback : num(b.stepover),
  };
}

/** Off for load tests; anything else keeps the limits on. */
const RATE_LIMIT_ON = process.env.CNC_FACING_RATE_LIMIT !== "off";
const limiter = new RateLimiter();

/**
 * Who is asking. Behind the reverse proxy every peer is the proxy, so a peer on a
 * private address (the proxy, or a LAN user) is taken at its word about the
 * client in X-Forwarded-For -- the last entry, which is the one the proxy added.
 * A public peer's header is ignored, since there it is whatever the caller sent.
 */
function clientOf(req: Request, peer: string): string {
  if (!isPrivate(peer)) return peer;
  const fwd = req.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  return fwd || peer;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

/** The JSON body of a form request, or the response to refuse it with. */
async function jsonBody(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const text = await readCapped(req, JSON_MAX_BYTES);
  if (text === null) {
    return { ok: false, response: json({ ok: false, refusals: ["That request is too large."] }, 413) };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: json({ ok: false, refusals: ["That request is not valid JSON."] }, 400) };
  }
}

/**
 * Wraps a handler in the allowlist check.
 *
 * Bun matches `routes` BEFORE the `fetch` fallback, so `fetch` cannot act as
 * middleware in front of them -- every route has to be wrapped, and the wrapper
 * is applied at the one place each route is defined so a new route cannot
 * quietly skip it. The test asserts that every route is wrapped.
 *
 * The peer address from `requestIP` is the only thing worth trusting here: there
 * is no proxy in front, so an X-Forwarded-For header would be whatever the
 * caller felt like sending.
 */
function guard(
  handler: (req: Request, srv: Bun.Server<undefined>) => Response | Promise<Response>,
  cost?: LimitClass,
) {
  return async (req: Request, srv: Bun.Server<undefined>): Promise<Response> => {
    const ip = srv.requestIP(req)?.address;
    if (!ip || !matches(ip, ALLOW)) {
      console.warn(`refused ${ip ?? "unknown"} ${new URL(req.url).pathname}`);
      return new Response("Not available from this network.\n", { status: 403 });
    }
    if (cost && RATE_LIMIT_ON) {
      const wait = limiter.take(clientOf(req, ip), cost);
      if (wait) {
        const error = `Too many requests. Try again in ${wait} s.`;
        return new Response(JSON.stringify({ ok: false, error, refusals: [error] }), {
          status: 429,
          headers: { "content-type": "application/json; charset=utf-8", "retry-after": String(wait) },
        });
      }
    }
    return handler(req, srv);
  };
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  // The socket-level backstop for the per-route caps above.
  maxRequestBodySize: CHECK_MAX_BYTES + 1024 * 1024,

  routes: {
    "/": guard(() =>
      new Response(Bun.file(new URL("./index.html", import.meta.url)), {
        headers: { "content-type": "text/html; charset=utf-8" },
      })),

    /** Everything the form needs to know about a job, minus the G-code itself. */
    "/api/plan": {
      POST: guard(async (req) => {
        const body = await jsonBody(req);
        if (!body.ok) return body.response;
        const built = buildJob(parseRequest(body.value), { thumbnail: false });
        if (!built.ok) return json({ ok: false, refusals: built.refusals }, 422);
        return json({
          ok: true,
          filename: built.filename,
          svg: built.svg,
          summary: built.summary,
          reach: built.reach,
          lineCount: built.lines.length,
        });
      }, "form"),
    },

    /** The real thing, thumbnail and all. */
    "/api/download": {
      POST: guard(async (req) => {
        const body = await jsonBody(req);
        if (!body.ok) return body.response;
        const built = buildJob(parseRequest(body.value));
        if (!built.ok) return json({ ok: false, refusals: built.refusals }, 422);
        return new Response(built.gcode, {
          headers: {
            // text/plain, not a made-up type: the Windows laptop this lands on
            // should open it in an editor without argument.
            "content-type": "text/plain; charset=utf-8",
            "content-disposition": `attachment; filename="${built.filename}"`,
          },
        });
      }, "form"),
    },

    /**
     * Check an uploaded file. The body is the file itself, as text; the name
     * comes in the query because the extension is one of the things checked.
     * Nothing is written to disk: the file is read, reported on and dropped.
     */
    "/api/check": {
      POST: guard(async (req) => {
        const size = Number(req.headers.get("content-length") ?? 0);
        if (size > CHECK_MAX_BYTES) {
          return json({ ok: false, error: `The file is ${(size / 1048576).toFixed(1)} MB; the checker reads up to ${CHECK_MAX_BYTES / 1048576} MB.` }, 413);
        }
        const text = await readCapped(req, CHECK_MAX_BYTES);
        if (text === null) {
          return json({ ok: false, error: `The checker reads up to ${CHECK_MAX_BYTES / 1048576} MB.` }, 413);
        }
        const q = new URL(req.url).searchParams;
        const name = q.get("name") || "upload.nc";
        // The material column to check the bits against; omitted, the header's.
        const material = q.get("material");
        const report = checkGcode(text, name, isCatMaterial(material) ? { material } : {});
        const { strokes: _strokes, ...rest } = report;
        return json({
          ok: true,
          ...rest,
          svg: reportToSvg(report),
          reach: report.reachBox ? reachWalk(report.reachBox) : [],
          materials: CAT_MATERIALS.map((id) => ({ id, label: CAT_MATERIAL_LABELS[id] })),
        });
      }, "check"),
    },

    /** The materials table, so the form does not restate what materials.ts knows. */
    "/api/materials": guard(() => json({
      version: VERSION,
      source: SOURCE,
      defaultStepover: DEFAULT_STEPOVER,
      envelope: { x: ENVELOPE_X, y: ENVELOPE_Y },
      defaultPattern: DEFAULT_PATTERN,
      patterns: PATTERNS.map((id) => ({ id, label: PATTERN_LABELS[id] })),
      materials: MATERIAL_IDS.map((id) => ({
        id,
        label: MATERIALS[id].label,
        finishAllowance: MATERIALS[id].finishAllowance,
        defaultDepth: MATERIALS[id].defaultDepth,
        tools: MATERIALS[id].tools.map((t) => ({
          id: t.id,
          // "3.175mm" -- what the form shows, and what goes in the collet.
          label: `${t.tool.diameter}mm`,
          tool: t.tool.name,
          rpm: t.rpm,
          feed: t.feed,
          plunge: t.plunge,
          maxDepthPerPass: t.maxDepthPerPass,
          fluteLength: t.tool.fluteLength,
          diameter: t.tool.diameter,
          stepover: t.stepover,
          finishStepover: t.finishStepover,
          derived: t.derived,
          source: t.source,
          note: t.note,
        })),
      })),
    })),
  },

  fetch: guard(() => new Response("Not found", { status: 404 })),
});

const urls = reachableOn(ALLOW, networkInterfaces()).map((a) => `http://${a}:${server.port}`);
console.log(`cnc-facing ${VERSION} listening on ${HOST}:${server.port}`);
console.log(`  reachable from: ${ALLOW.map((c) => c.text).join(", ")}`);
for (const u of urls) console.log(`  ${u}`);
if (!urls.length) {
  console.log("  (no local IPv4 address is inside the allowlist — check CNC_FACING_ALLOW)");
}
