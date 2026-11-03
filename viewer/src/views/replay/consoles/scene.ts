/**
 * Procedural camera scene (DESIGN.md 9.3). A simple drawn horizon keyed to the vehicle's
 * position, direction and crater state, so both consoles show the same world at the same
 * moment. Nothing here is footage: it is a perspective sketch of the scenario's zones.
 *
 * - The world is built once per variant from SIM_SCENARIO.variants[v].zones (towers, the
 *   ridge fade, tree cover, crater, contested zone, inspection site), placed at their km.
 * - Each feature is projected with a pinhole camera 1.6 m above the track, so it grows as
 *   the vehicle approaches. The rear camera looks behind (the scene mirrored).
 * - Far hills pan horizontally with distance travelled; ground marks stream past.
 * - Drawing is deterministic: the same (km, direction, crater, camera) gives the same image.
 *
 * The outdoor palette is fixed and theme-independent (DESIGN.md 9.3 and 12 allow these hex
 * values here only, because this is a picture of the outdoors).
 */
import type { CamName, Zone } from "../../../data/types";

// ------------------------------------------------------------------ palette (DESIGN.md 9.3)
const SKY = "#9FB3BF";
const HILLS = "#6E7F73";
const GROUND = "#8A8468";
const TREES = "#3F5A43";
const BUILDINGS = "#B9B2A3";
const RIM = "#5E5444";

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const css = (c: RGB) => `rgb(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0})`;
const mix = (a: string, b: string, t: number): string => {
  const x = hex(a);
  const y = hex(b);
  return css([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
};
/** Shades derived only from the six palette colours. */
const C = {
  sky: SKY,
  skyLow: mix(SKY, BUILDINGS, 0.35),
  hillsFar: mix(HILLS, SKY, 0.45),
  hills: HILLS,
  ridge: mix(HILLS, TREES, 0.45),
  ground: GROUND,
  groundFar: mix(GROUND, HILLS, 0.35),
  groundDark: mix(GROUND, RIM, 0.55),
  rut: mix(GROUND, RIM, 0.35),
  tuft: mix(GROUND, TREES, 0.5),
  trees: TREES,
  treesLight: mix(TREES, HILLS, 0.45),
  trunk: mix(RIM, TREES, 0.3),
  bush: mix(TREES, GROUND, 0.35),
  wall: BUILDINGS,
  wallShade: mix(BUILDINGS, RIM, 0.35),
  roof: mix(RIM, BUILDINGS, 0.25),
  mast: mix(RIM, TREES, 0.2),
  rim: RIM,
  rimLight: mix(RIM, GROUND, 0.45),
  craterFloor: mix(GROUND, RIM, 0.3),
  lip: mix(BUILDINGS, GROUND, 0.4),
  strata: mix(RIM, TREES, 0.45),
};

// ------------------------------------------------------------------ deterministic noise
function hash(n: number, salt: number): number {
  let x = Math.imul((n | 0) ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function noise(x: number, salt: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i, salt) * (1 - u) + hash(i + 1, salt) * u;
}

// ------------------------------------------------------------------ world
type Kind = "shed" | "house" | "mast" | "tree" | "bush" | "ridge" | "rim" | "site";
interface Thing {
  kind: Kind;
  /** Route position, km. */
  km: number;
  /** Lateral offset, m (positive = right of the outbound direction). */
  lat: number;
  /** Width, m. */
  w: number;
  /** Height, m. */
  h: number;
  /** Per-thing random value 0-1 for shading variety. */
  r: number;
}

export interface World {
  things: Thing[];
  /** Crater span, km (null when the variant has none). */
  crater: [number, number] | null;
}

const worldCache = new Map<string, World>();

/** Build (and cache) the drawable world for a variant's zones. */
export function buildWorld(key: string, zones: Zone[] | undefined): World {
  const hit = worldCache.get(key);
  if (hit) return hit;
  const things: Thing[] = [];
  const zs = zones ?? [];
  let salt = 1;

  // Base at km 0 (the route origin is the base): sheds either side of the start.
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    things.push({ kind: "shed", km: 0.005 + 0.012 * i, lat: side * (16 + 30 * hash(i, 11)), w: 14 + 12 * hash(i, 12), h: 5 + 3 * hash(i, 13), r: hash(i, 14) });
  }

  for (const z of zs) {
    salt += 7;
    if (z.kind === "tower") {
      things.push({ kind: "mast", km: z.from_km, lat: z.from_km < 0.05 ? 22 : -34, w: 2.4, h: 28, r: 0.5 });
      if (z.from_km > 0.05) {
        // Village roofs around a tower away from the base.
        for (let i = 0; i < 14; i++) {
          const side = hash(i, salt) < 0.5 ? -1 : 1;
          things.push({
            kind: "house", km: z.from_km - 0.06 + 0.12 * hash(i, salt + 1), lat: side * (22 + 70 * hash(i, salt + 2)),
            w: 7 + 6 * hash(i, salt + 3), h: 3.2 + 1.6 * hash(i, salt + 4), r: hash(i, salt + 5),
          });
        }
      }
    } else if (z.kind === "fade") {
      // The ridge the radio fades behind: a long rise across the route's middle.
      things.push({ kind: "ridge", km: (z.from_km + z.to_km) / 2, lat: 0, w: 1400, h: 42, r: 0.5 });
    } else if (z.kind === "obstruction") {
      const n = Math.max(8, Math.round((z.to_km - z.from_km) * 1000 / 1.2));
      for (let i = 0; i < n * 2; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const km = z.from_km + (z.to_km - z.from_km) * ((i >> 1) + hash(i, salt)) / n;
        things.push({ kind: "tree", km, lat: side * (3.2 + 9 * hash(i, salt + 1)), w: 3 + 2 * hash(i, salt + 2), h: 8 + 6 * hash(i, salt + 3), r: hash(i, salt + 4) });
      }
    } else if (z.kind === "crater") {
      things.push({ kind: "rim", km: z.from_km, lat: 0, w: 160, h: 2.6, r: 0.3 });
      things.push({ kind: "rim", km: z.to_km, lat: 0, w: 160, h: 2.2, r: 0.7 });
    } else if (z.kind === "jamming") {
      // Open scrub: the jamming itself is invisible.
      const n = Math.round((z.to_km - z.from_km) * 1000 / 5);
      for (let i = 0; i < n; i++) {
        if (hash(i, salt) < 0.35) continue;
        const side = hash(i, salt + 1) < 0.5 ? -1 : 1;
        things.push({ kind: "bush", km: z.from_km + (i + hash(i, salt + 2)) * 0.005, lat: side * (3 + 38 * hash(i, salt + 3)), w: 1.2 + 1.4 * hash(i, salt + 4), h: 0.6 + 0.8 * hash(i, salt + 5), r: hash(i, salt + 6) });
      }
    } else if (z.kind === "site") {
      things.push({ kind: "site", km: z.from_km, lat: 5, w: 1.2, h: 6, r: 0.5 });
    }
  }

  // Sparse scrub everywhere else so open country is not empty.
  for (let i = 0; i < 3050 / 9; i++) {
    if (hash(i, 991) < 0.55) continue;
    const km = (i * 9 + 9 * hash(i, 992)) / 1000;
    const side = hash(i, 993) < 0.5 ? -1 : 1;
    things.push({ kind: "bush", km, lat: side * (6 + 60 * hash(i, 994)), w: 1 + 1.6 * hash(i, 995), h: 0.5 + 0.9 * hash(i, 996), r: hash(i, 997) });
  }

  things.sort((a, b) => a.km - b.km);
  const cz = zs.find((z) => z.kind === "crater");
  const world: World = { things, crater: cz ? [cz.from_km, cz.to_km] : null };
  worldCache.set(key, world);
  return world;
}

// ------------------------------------------------------------------ frame
export interface SceneFrame {
  /** Vehicle position at capture time, km. */
  d: number;
  /** +1 outbound, -1 return leg. */
  dir: 1 | -1;
  /** Vehicle in a crater state at capture time. */
  crater: boolean;
  /** True manoeuvre at capture time is reversing (the rear camera then faces the rim). */
  reversing: boolean;
  cam: CamName;
}

/**
 * Draw one camera frame into `ctx` at w x h pixels. Call with image smoothing as you like:
 * the caller renders small and upscales without smoothing for genuine pixelation.
 */
export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, world: World, fr: SceneFrame): void {
  const s = fr.dir * (fr.cam === "front" ? 1 : -1); // facing sign along the route
  const dm = fr.d * 1000;
  const f = w * 0.9;
  const cx = w / 2;
  const camH = 1.6;
  const hy = Math.round(h * 0.47);
  const inCrater = fr.crater;

  const proj = (km: number, lat: number) => {
    const z = (km * 1000 - dm) * s;
    return { z, x: cx + (f * lat * s) / z };
  };
  const groundY = (z: number) => hy + (f * camH) / z;

  // Sky: two flat bands.
  ctx.fillStyle = C.sky;
  ctx.fillRect(0, 0, w, hy);
  ctx.fillStyle = C.skyLow;
  ctx.fillRect(0, hy - h * 0.09, w, h * 0.09);

  // Far hills: two silhouettes that pan with distance travelled.
  const pan = (dm * 0.004) * s;
  const hills = (color: string, amp: number, base: number, freq: number, salt: number, panK: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, hy + 1);
    const step = Math.max(1, w / 80);
    for (let x = 0; x <= w + step; x += step) {
      const u = (x / w) * freq + pan * panK;
      const y = hy - base * h - amp * h * (0.65 * noise(u, salt) + 0.35 * noise(u * 2.7, salt + 1));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, hy + 1);
    ctx.closePath();
    ctx.fill();
  };
  hills(C.hillsFar, 0.11, 0.02, 3, 21, 0.6);
  hills(C.hills, 0.07, 0.0, 5, 31, 1);

  // Ground.
  ctx.fillStyle = C.groundFar;
  ctx.fillRect(0, hy, w, h - hy);
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, groundY(60), w, h - groundY(60));

  // Visible things, far to near.
  const near = 2.5;
  const far = inCrater ? 30 : 2400;
  const vis: { t: Thing; z: number; x: number }[] = [];
  // world.things is sorted by km: start at the first one in reach instead of scanning all.
  const things = world.things;
  const reachKm = (far + 800) / 1000 + 1e-6;
  let lo = 0;
  let hi = things.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (things[mid].km < fr.d - reachKm) lo = mid + 1; else hi = mid;
  }
  for (let ti = lo; ti < things.length; ti++) {
    const t = things[ti];
    if (t.km > fr.d + reachKm) break;
    if (Math.abs(t.km - fr.d) * 1000 > far + 800) continue;
    const p = proj(t.km, t.lat);
    if (p.z < near || p.z > far) continue;
    if (t.kind !== "ridge" && t.kind !== "rim" && p.z > 900) continue;
    vis.push({ t, z: p.z, x: p.x });
  }
  vis.sort((a, b) => b.z - a.z);

  // Track ruts converge at the vanishing point.
  ctx.fillStyle = C.rut;
  for (const off of [-0.9, 0.9]) {
    ctx.beginPath();
    ctx.moveTo(cx + (f * (off - 0.18)) / 1.6, h);
    ctx.lineTo(cx + (f * (off + 0.18)) / 1.6, h);
    ctx.lineTo(cx, hy);
    ctx.closePath();
    ctx.fill();
  }

  // Ground marks: stones and tufts every 4 m, streaming toward the camera.
  const m0 = Math.floor(dm / 4);
  for (let j = 70; j >= -2; j--) {
    const m = m0 + j * s;
    const km = (m * 4) / 1000;
    for (let q = 0; q < 2; q++) {
      const lat = (hash(m, 51 + q) - 0.5) * 30;
      if (Math.abs(lat) < 1.4) continue;
      const p = proj(km, lat);
      if (p.z < 1.5 || p.z > 120) continue;
      const y = groundY(p.z);
      const sz = Math.max(0.6, (f * (0.25 + 0.3 * hash(m, 61 + q))) / p.z);
      ctx.fillStyle = hash(m, 71 + q) < 0.5 ? C.groundDark : C.tuft;
      if (hash(m, 81 + q) < 0.5) {
        ctx.fillRect(p.x - sz, y - sz * 0.5, sz * 2, sz * 0.7);
      } else {
        ctx.fillRect(p.x - sz * 0.25, y - sz * 1.6, Math.max(0.6, sz * 0.5), sz * 1.6);
      }
    }
  }

  for (const v of vis) drawThing(ctx, v.t, v.z, v.x, f, groundY, s, w);

  // Inside the crater: the bowl closes in around the vehicle. The far wall carries strata
  // and a pale lip where it meets the sky; the floor is strewn with rocks that stream past
  // as the vehicle moves. Reversing, the rear camera looks straight at the near rim, which
  // fills most of the frame (DESIGN.md 9.3: "rear shows the rim when reversing").
  if (inCrater) {
    const close = fr.cam === "rear" && fr.reversing;
    const floorY = hy + h * (close ? 0.12 : 0.06);
    const pan = dm * 0.02 * s; // walls slide sideways as the vehicle moves
    const edge = (top: number, salt: number) => (x: number) => {
      const u = x / w;
      const bowl = 0.35 * Math.pow(Math.abs(u - 0.5) * 2, 2);
      return hy - h * (top + bowl * top) - h * 0.03 * noise(u * 9 + pan, salt) - h * 0.012 * noise(u * 31 + pan * 3, salt + 2);
    };
    const band = (top: (x: number) => number, bottom: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, bottom);
      const step = Math.max(1, w / 72);
      for (let x = 0; x <= w + step; x += step) ctx.lineTo(x, top(x));
      ctx.lineTo(w, bottom);
      ctx.closePath();
      ctx.fill();
    };
    const farTop = edge(close ? 0.34 : 0.14, 41);
    const nearTop = edge(close ? 0.2 : 0.075, 43);
    band(farTop, floorY, C.rimLight);
    // Pale lip along the top of the far wall.
    ctx.fillStyle = C.lip;
    const step = Math.max(1, w / 72);
    const lip = Math.max(1, h * 0.012);
    for (let x = 0; x <= w; x += step) ctx.fillRect(x, farTop(x), step + 0.5, lip);
    // Strata: thin darker streaks that follow the wall's shape.
    ctx.fillStyle = C.strata;
    for (const [frac, salt] of [[0.35, 47], [0.62, 53]] as const) {
      for (let x = 0; x <= w; x += step) {
        if (noise(x / w * 6 + pan, salt) < 0.42) continue;
        const y0 = farTop(x);
        ctx.fillRect(x, y0 + (floorY - y0) * frac, step + 0.5, Math.max(1, h * 0.012));
      }
    }
    band(nearTop, floorY, C.rim);
    ctx.fillStyle = C.craterFloor;
    ctx.fillRect(0, floorY, w, h - floorY);
    // Fallen boulders along the foot of the wall (bigger when the wall is close).
    const nb = 14;
    for (let i = 0; i < nb; i++) {
      const slot = Math.floor(i + pan * 0.5);
      if (hash(slot, 181) < 0.45) continue;
      const x = ((i + hash(slot, 182) - (pan * 0.5 - Math.floor(pan * 0.5))) / nb) * w;
      const r = h * (close ? 0.03 + 0.04 * hash(slot, 183) : 0.012 + 0.016 * hash(slot, 183));
      ctx.fillStyle = hash(slot, 184) < 0.5 ? C.rim : C.strata;
      ctx.beginPath();
      ctx.ellipse(x, floorY - r * 0.2, r * 1.3, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.lip;
      ctx.fillRect(x - r * 0.7, floorY - r * 0.9, r * 0.8, Math.max(0.6, r * 0.2));
    }
    // Rocks on the floor, every 2 m along the route, projected like the ground marks.
    const fy = (z: number) => floorY + (f * camH * (close ? 0.8 : 1)) / z;
    const r0 = Math.floor(dm / 2);
    for (let j = 14; j >= -1; j--) {
      const m = r0 + j * s;
      for (let q = 0; q < 3; q++) {
        const lat = (hash(m, 151 + q) - 0.5) * 9;
        if (Math.abs(lat) < 1.2 && hash(m, 157 + q) < 0.7) continue;
        const z = ((m * 2) - dm) * s + hash(m, 163 + q) * 2;
        if (z < 1.2 || z > (close ? 7 : 26)) continue;
        const x = cx + (f * lat) / z;
        const y = fy(z);
        const r = Math.max(0.8, (f * (0.12 + 0.28 * hash(m, 167 + q))) / z);
        ctx.fillStyle = hash(m, 173 + q) < 0.5 ? C.rim : C.rimLight;
        ctx.beginPath();
        ctx.ellipse(x, y - r * 0.4, r, r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.lip;
        ctx.fillRect(x - r * 0.5, y - r * 0.85, r * 0.6, Math.max(0.6, r * 0.18));
      }
    }
    ctx.fillStyle = C.rut;
    for (const off of [-0.9, 0.9]) {
      ctx.beginPath();
      ctx.moveTo(cx + (f * (off - 0.18)) / 1.6, h);
      ctx.lineTo(cx + (f * (off + 0.18)) / 1.6, h);
      ctx.lineTo(cx + (f * off) / 12, floorY);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawThing(
  ctx: CanvasRenderingContext2D, t: Thing, z: number, x: number, f: number,
  groundY: (z: number) => number, s: number, w: number,
): void {
  const y = groundY(z);
  const px = (m: number) => (f * m) / z;
  const hh = px(t.h);
  const ww = px(t.w);
  const line = Math.max(0.8, px(0.25));
  switch (t.kind) {
    case "ridge": {
      // A long rise: a smooth hump across lateral -w/2 .. w/2.
      ctx.fillStyle = C.ridge;
      ctx.beginPath();
      const n = 40;
      ctx.moveTo(x - (f * (t.w / 2)) / z, y + 1);
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const lat = (u - 0.5) * t.w;
        const bell = Math.pow(Math.sin(Math.PI * u), 1.6) * (0.85 + 0.15 * noise(u * 7, 5));
        ctx.lineTo(x + (f * lat * s) / z, y - hh * bell);
      }
      ctx.lineTo(x + (f * (t.w / 2)) / z, y + 1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "rim": {
      ctx.fillStyle = C.rim;
      ctx.beginPath();
      const n = 24;
      ctx.moveTo(x - ww / 2, y + 1);
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        ctx.lineTo(x - ww / 2 + ww * u, y - hh * (0.75 + 0.25 * noise(u * 8 + t.r * 10, 9)));
      }
      ctx.lineTo(x + ww / 2, y + 1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "shed": {
      ctx.fillStyle = C.wall;
      ctx.fillRect(x - ww / 2, y - hh, ww, hh);
      ctx.fillStyle = C.wallShade;
      ctx.fillRect(x + ww / 2 - ww * 0.22, y - hh, ww * 0.22, hh);
      ctx.fillStyle = C.roof;
      ctx.fillRect(x - ww / 2, y - hh - Math.max(0.8, hh * 0.08), ww, Math.max(0.8, hh * 0.1));
      if (ww > 6) {
        ctx.fillStyle = C.wallShade;
        ctx.fillRect(x - ww * 0.3, y - hh * 0.55, ww * 0.18, hh * 0.55);
      }
      break;
    }
    case "house": {
      ctx.fillStyle = t.r < 0.5 ? C.wall : C.wallShade;
      ctx.fillRect(x - ww / 2, y - hh, ww, hh);
      ctx.fillStyle = C.roof;
      ctx.beginPath();
      ctx.moveTo(x - ww * 0.58, y - hh);
      ctx.lineTo(x, y - hh - ww * 0.32);
      ctx.lineTo(x + ww * 0.58, y - hh);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "mast": {
      ctx.strokeStyle = C.mast;
      ctx.lineWidth = line;
      const half = ww / 2;
      ctx.beginPath();
      ctx.moveTo(x - half, y);
      ctx.lineTo(x - half * 0.25, y - hh);
      ctx.moveTo(x + half, y);
      ctx.lineTo(x + half * 0.25, y - hh);
      const n = 6;
      for (let i = 0; i < n; i++) {
        const a = i / n;
        const b = (i + 1) / n;
        const wa = half * (1 - 0.75 * a);
        const wb = half * (1 - 0.75 * b);
        ctx.moveTo(x - wa, y - hh * a);
        ctx.lineTo(x + wb, y - hh * b);
      }
      ctx.stroke();
      ctx.fillStyle = C.mast;
      const pw = Math.max(1.2, px(0.7));
      ctx.fillRect(x - half * 0.25 - pw, y - hh * 0.95, pw, px(2.2));
      ctx.fillRect(x + half * 0.25, y - hh * 0.9, pw, px(2.2));
      break;
    }
    case "tree": {
      const trunkW = Math.max(0.8, px(0.35));
      ctx.fillStyle = C.trunk;
      ctx.fillRect(x - trunkW / 2, y - hh * 0.45, trunkW, hh * 0.45);
      ctx.fillStyle = t.r < 0.5 ? C.trees : C.treesLight;
      ctx.beginPath();
      ctx.ellipse(x, y - hh * 0.62, Math.max(0.8, ww / 2 + px(0.6)), Math.max(0.8, hh * 0.4), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + ww * 0.15, y - hh * 0.86, Math.max(0.6, ww * 0.35), Math.max(0.6, hh * 0.22), 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "bush": {
      ctx.fillStyle = t.r < 0.5 ? C.bush : C.treesLight;
      ctx.beginPath();
      ctx.ellipse(x, y - hh * 0.45, Math.max(0.6, ww / 2), Math.max(0.6, hh * 0.55), 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "site": {
      ctx.fillStyle = C.groundDark;
      ctx.fillRect(x - px(2.5), y - px(0.15), px(5), Math.max(0.8, px(0.3)));
      ctx.fillStyle = C.mast;
      const pole = Math.max(1, px(0.18));
      ctx.fillRect(x - pole / 2, y - hh, pole, hh);
      ctx.fillStyle = C.wall;
      const bw = px(t.w);
      ctx.fillRect(x - bw / 2, y - hh * 0.8 - bw, bw, bw);
      ctx.fillStyle = C.wallShade;
      ctx.fillRect(x + bw * 0.15, y - hh * 0.8 - bw, bw * 0.35, bw);
      break;
    }
  }
  void w;
}

/**
 * MJPEG-like degradation at low JPEG quality (DESIGN.md 9.3: "quantise colours to 8 levels
 * per channel at quality below 55").
 * DESIGN-GAP: quantising R, G and B independently turns these earthy, low-saturation colours
 * into reds and cyans (the rim became a red band), and red means "not usable" in this
 * product. JPEG itself works in YCbCr, so this quantises luma to `levels` steps and averages
 * chroma over 4×4 blocks (the colour smear of chroma subsampling) instead. Hue is kept;
 * banding and blockiness are what the operator would see.
 */
export function quantise(ctx: CanvasRenderingContext2D, w: number, h: number, levels = 8): void {
  if (w <= 0 || h <= 0) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const step = 255 / (levels - 1);
  const B = 4;
  const row = w * 4;
  for (let by = 0; by < h; by += B) {
    const y1 = Math.min(h, by + B);
    for (let bx = 0; bx < w; bx += B) {
      const x1 = Math.min(w, bx + B);
      let cb = 0;
      let cr = 0;
      let n = 0;
      for (let y = by; y < y1; y++) {
        for (let i = y * row + bx * 4, e = y * row + x1 * 4; i < e; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          cb += -0.168736 * r - 0.331264 * g + 0.5 * b;
          cr += 0.5 * r - 0.418688 * g - 0.081312 * b;
          n++;
        }
      }
      cb /= n;
      cr /= n;
      // Per-block chroma offsets (constant over the block).
      const dr = 1.402 * cr;
      const dg = -0.344136 * cb - 0.714136 * cr;
      const db = 1.772 * cb;
      for (let y = by; y < y1; y++) {
        for (let i = y * row + bx * 4, e = y * row + x1 * 4; i < e; i += 4) {
          // Luma is >= 0, so (x + 0.5) | 0 is Math.round(x).
          const yy = (((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / step + 0.5) | 0) * step;
          d[i] = yy + dr;
          d[i + 1] = yy + dg;
          d[i + 2] = yy + db;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}
