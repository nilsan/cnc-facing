# cnc-facing

A facing-job generator for the **Makera Z1**. Pick X, Y, depth and material; get
a `.nc` the controller will preview, boundary-trace and run. Also checks any
`.nc` (Makera Studio, EasyTrace5000, FlatCAM, hand-edited) against what this
machine has taught.

Live at <https://facing.nottseter.no>.

![The facing form with toolpath preview](docs/facing.png)

```sh
bun install
bun run dev          # http://localhost:3117
bun test
bun run typecheck
```

## What it does

- **Facing jobs**: general mode (one pass per depth level) or fine finish
  (rough to an allowance, then a final pass at 90° with about half the
  stepover). Four patterns: serpentine X, serpentine Y (default), one-way Y,
  spiral. Serpentine Y is the default because Y is more rigid than X on this
  machine (tested), so cutting along Y gives the flatter surface.
- **Header and preview**: Makera's `;@MKR|` header, a toolpath thumbnail, and an
  MDI corner walk (the "reach" check) so the laser can be used to confirm the
  stock position before cutting.
- **Bits**: pick a collet (1/8" by default), then any Makera flat end that fits
  it and has figures for the material. The 3.175 × 12mm single flute (Metal
  series) is the default. Wider bits get a smaller stepover fraction, so the
  step stays about 1.4mm. Chamfer and fly-cutter options exist; the checker
  also knows Makera's table for other bits.
- **Check a file** (`/#check`): reports Fail / Silent / Warning / Note findings
  for an uploaded `.nc` and draws its toolpath. Nothing is stored. It checks
  that a file is valid Z1 code *within the parameters this project has tested*,
  which were mainly PCB milling. "No findings" is not a promise that a job is
  safe, and a Warning means "differs from what is known to work", not "wrong".

  A few of its rules (variables and expressions, `G92`, `G10`, `G38.x`, `M498`)
  come from firmware notes in
  [blackveilprecision/z1-macros](https://github.com/blackveilprecision/z1-macros)
  and have not been tested on this machine; each finding says so.

![The check tab with a toolpath and findings](docs/check.png)

The machine knowledge lives in `src/facing.ts`, `src/mkr.ts`, `src/materials.ts`
and `src/check.ts`, with each rule commenting where it was learned.

The full Makera bit list, with Makera's presets per material, is
`src/makera-bits.json`, read through `src/makera.ts`. It is generated from the
Fusion 360 tool libraries in Makera's
[CarveraProfiles](https://github.com/MakeraInc/CarveraProfiles) repository, and
records the commit it came from:

```sh
bun scripts/makera-library.ts [git ref, default main]
```

## Docker

```sh
docker run --rm -p 3117:3117 ghcr.io/nilsan/cnc-facing:latest   # http://localhost:3117
docker build -t cnc-facing .                                     # or build locally
```

The image has no volumes and stores nothing. Set options with `-e`, e.g.
`-e PORT=8080` (then publish that port too).

## Configuration

Settings are environment variables, read at startup in `src/server.ts`. Locally,
set them inline (`PORT=8080 bun run dev`). In Docker, pass `-e VAR=value` to
`docker run`, or put them under `environment:` in the service in
`deploy/docker-compose.yml`. The image's defaults are set with `ENV` in the
`Dockerfile`.

| Variable | Default | |
|---|---|---|
| `PORT` | `3117` | |
| `HOST` | `0.0.0.0` | `127.0.0.1` for localhost only |
| `CNC_FACING_ALLOW` | `127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` | comma-separated CIDRs that may connect (loopback and private LAN ranges); `0.0.0.0/0,::/0` turns the filter off |

The image overrides the `HOST`/`CNC_FACING_ALLOW` defaults above: it listens on
`0.0.0.0` and has the filter off. The allow-list is a blunt "do not answer strangers" filter, not authentication.
The filter is off in the image because behind the reverse proxy every request
comes from the proxy; to use it without a proxy, set `CNC_FACING_ALLOW` yourself.

Requests are rate-limited per client (a generous bucket for the form, a small one
for `/api/check`, which parses whole files) and request bodies are size-capped.
Behind a proxy the client is taken from `X-Forwarded-For`. `CNC_FACING_RATE_LIMIT=off`
disables the limits, e.g. for load tests. The screenshots in `docs/` are made by
`scripts/screenshots.py`.

## Deployment

Pushes to `main` run `.github/workflows/build.yml` (typecheck, tests, then push
`ghcr.io/nilsan/cnc-facing`). The image runs as the `cnc-facing` stack in Komodo
on bf.nottseter.no, using `deploy/docker-compose.yml`, behind Caddy.

## License

[Mozilla Public License 2.0](LICENSE).
