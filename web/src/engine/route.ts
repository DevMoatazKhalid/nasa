// Terrain-aware route planning: A* over the 8 ppd (~7.4 km) MOLA-derived cost surface.
// This is a strategic corridor planner for mission studies — NOT rover-grade navigation:
// 7.4 km cells cannot see boulders, scarps or dunes that decide real traverses.
import { DataStore, Grid } from './data';
import { distKm, wrapLon } from './geo';
import { gcrDose } from './radiation';

export type Profile = 'safest' | 'shortest' | 'science' | 'resource';
export type Mobility = 'rover' | 'crew_rover' | 'eva';

/** Mobility assumptions (explicit, shown to the user). */
export const MOBILITY: Record<Mobility, { maxSlope: number; kmPerSol: number; label: string; basis: string }> = {
  rover: { maxSlope: 12, kmPerSol: 0.2, label: 'Robotic rover (Perseverance-class)',
           basis: 'Assumed 0.2 km/sol sustained average incl. planning overhead; 12° max slope at 3.7 km baseline as a proxy for ~25-30° local limits.' },
  crew_rover: { maxSlope: 10, kmPerSol: 60, label: 'Pressurised crew rover (concept)',
           basis: 'Assumed 10 km/h × 6 h driving per sol (NASA SEV-class concept); 10° regional slope proxy.' },
  eva: { maxSlope: 8, kmPerSol: 8, label: 'EVA on foot',
           basis: 'Assumed 2 km/h × 4 h per sol; EVA radius limits apply in practice.' },
};

/** Cost weights per route profile. 'bonus' lowers cost near targets (floored at 0.6 to keep the heuristic admissible). */
export const PROFILES: Record<Profile, { slope: number; rough: number; crater: number; rad: number; dust: number; bonus: 'none' | 'science' | 'ice' }> = {
  safest: { slope: 6, rough: 2, crater: 1.0, rad: 1.0, dust: 0.5, bonus: 'none' },
  shortest: { slope: 0.3, rough: 0, crater: 0, rad: 0, dust: 0, bonus: 'none' },
  science: { slope: 2, rough: 0.6, crater: 0.2, rad: 0.3, dust: 0, bonus: 'science' },
  resource: { slope: 2, rough: 0.6, crater: 0.3, rad: 0.3, dust: 0, bonus: 'ice' },
};

export interface RouteResult {
  profile: Profile; ok: boolean; reason?: string; path: [number, number][]; distanceKm: number; cost: number;
  elev: number[]; slope: number[]; cum: number[]; maxSlope: number; meanSlope: number; climbM: number; descentM: number;
  hazards: { km: number; lat: number; lon: number; kind: string; value: number }[]; sols: number | null;
  waypointsSci: { km: number; lat: number; lon: number; what: string }[]; doseTotal: number | null; explanation: string[];
}

class Heap { a: number[] = []; f: Float64Array; constructor(f: Float64Array) { this.f = f; }
  push(i: number) { const a = this.a; a.push(i); let k = a.length - 1; while (k) { const p = (k - 1) >> 1; if (this.f[a[p]] <= this.f[a[k]]) break; [a[p], a[k]] = [a[k], a[p]]; k = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop()!; if (a.length) { a[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k;
    if (l < a.length && this.f[a[l]] < this.f[a[m]]) m = l; if (r < a.length && this.f[a[r]] < this.f[a[m]]) m = r; if (m === k) break; [a[m], a[k]] = [a[k], a[m]]; k = m; } } return top; }
  get size() { return this.a.length; } }

export class Router {
  constructor(public ds: DataStore) {}

  async plan(a: { lat: number; lon: number }, b: { lat: number; lon: number }, profile: Profile, mob: Mobility): Promise<RouteResult> {
    const [dem, slope, rough] = await Promise.all([this.ds.grid('dem'), this.ds.grid('slope'), this.ds.grid('rough')]);
    const cd = await this.ds.grid('crater_density'); const dci = await this.ds.grid('dci');
    const sw = await this.ds.grid('swim01'); const div = await this.ds.grid('glassclay');
    const P = PROFILES[profile], M = MOBILITY[mob], ppd = dem.meta.ppd;
    // unwrap longitudes so the window follows the shorter way around
    let lonA = wrapLon(a.lon), lonB = wrapLon(b.lon);
    if (lonB - lonA > 180) lonB -= 360; else if (lonA - lonB > 180) lonB += 360;
    const span = distKm(a.lat, a.lon, b.lat, b.lon);
    if (span > 4000) return this.fail(profile, 'Route longer than 4,000 km: split it with intermediate waypoints.');
    const marg = Math.max(1.5, (span / 59.16) * 0.35);
    const latMax = Math.min(88, Math.max(a.lat, b.lat) + marg), latMin = Math.max(-88, Math.min(a.lat, b.lat) - marg);
    const cosl = Math.max(0.15, Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180));
    const lonMin = Math.min(lonA, lonB) - marg / cosl, lonMax = Math.max(lonA, lonB) + marg / cosl;
    const r0 = Math.floor((90 - latMax) * ppd), r1 = Math.ceil((90 - latMin) * ppd);
    const c0 = Math.floor(lonMin * ppd), c1 = Math.ceil(lonMax * ppd);
    const H = r1 - r0 + 1, W = c1 - c0 + 1, N = H * W;
    if (N > 1_500_000) return this.fail(profile, 'Search window too large; add an intermediate waypoint.');
    const latOf = (r: number) => 90 - (r0 + r + 0.5) / ppd, lonOf = (c: number) => (c0 + c + 0.5) / ppd;
    // per-cell multiplier (>= floor) and passability
    const mult = new Float32Array(N), pass = new Uint8Array(N);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const R = r0 + r, C = c0 + c, i = r * W + c;
      const s = slope.cell(R, C), z = dem.cell(R, C);
      if (Number.isNaN(s) || Number.isNaN(z) || s > M.maxSlope) { pass[i] = 0; continue; }
      pass[i] = 1;
      const lat = latOf(r), lon = lonOf(c);
      let m = 1 + P.slope * (s / M.maxSlope) ** 2;
      const ro = rough.cell(R, C); if (!Number.isNaN(ro)) m += P.rough * Math.min(1, ro / 300);
      const k = cd.at(lat, lon); if (!Number.isNaN(k)) m += P.crater * Math.min(1, k / 80);
      if (P.rad) m += P.rad * Math.max(0, (gcrDose(z).dose - 0.18) / 0.1);
      if (P.dust) { const d = dci.at(lat, lon); if (!Number.isNaN(d)) m += P.dust * Math.max(0, (0.95 - d) / 0.03); }
      if (P.bonus === 'ice') { const v = sw.at(lat, lon); if (!Number.isNaN(v) && v > 0.3) m *= 0.6 + 0.4 * (1 - Math.min(1, (v - 0.3) / 0.5)); }
      if (P.bonus === 'science') { const v = div.at(lat, lon); if (!Number.isNaN(v) && v > 0.08) m *= 0.75; }
      mult[i] = Math.max(0.6, m);
    }
    const idx = (lat: number, lon: number) => { const r = Math.floor((90 - lat) * ppd) - r0, c = Math.floor(lon * ppd) - c0; return r * W + c; };
    const s0 = idx(a.lat, lonA), g0 = idx(b.lat, lonB);
    if (!pass[s0]) return this.fail(profile, `Start cell exceeds the ${M.maxSlope}° slope limit for ${M.label}.`);
    if (!pass[g0]) return this.fail(profile, `Destination cell exceeds the ${M.maxSlope}° slope limit for ${M.label}.`);
    const gR = Math.floor(g0 / W), gC = g0 % W, gLat = latOf(gR), gLon = lonOf(gC);
    const gs = new Float64Array(N).fill(Infinity), f = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N); const h = (i: number) => 0.6 * distKm(latOf(Math.floor(i / W)), lonOf(i % W), gLat, gLon);
    gs[s0] = 0; f[s0] = h(s0); const heap = new Heap(f); heap.push(s0);
    const dyKm = 3389.5 * Math.PI / 180 / ppd;
    while (heap.size) {
      const i = heap.pop(); if (closed[i]) continue; closed[i] = 1; if (i === g0) break;
      const r = Math.floor(i / W), c = i % W, dxKm = dyKm * Math.max(0.02, Math.cos(latOf(r) * Math.PI / 180));
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue; const rr = r + dr, cc = c + dc; if (rr < 0 || rr >= H || cc < 0 || cc >= W) continue;
        const j = rr * W + cc; if (!pass[j] || closed[j]) continue;
        const step = Math.hypot(dr * dyKm, dc * dxKm);
        const ng = gs[i] + step * 0.5 * (mult[i] + mult[j]);
        if (ng < gs[j]) { gs[j] = ng; prev[j] = i; f[j] = ng + h(j); heap.push(j); }
      }
    }
    if (prev[g0] === -1 && s0 !== g0) return this.fail(profile, 'No passable corridor found inside the search window with the current slope limit.');
    const cells: number[] = []; for (let i = g0; i !== -1; i = prev[i]) cells.push(i); cells.reverse();
    // String-pulling: replace zig-zags of the 8-connected grid by straight segments when every cell the
    // segment crosses is passable and the segment's cost does not exceed the grid path it replaces.
    const segCost = (i: number, j: number) => { const ri = Math.floor(i / W), ci = i % W, rj = Math.floor(j / W), cj = j % W;
      const n = Math.max(Math.abs(rj - ri), Math.abs(cj - ci)) * 2; let m = 0;
      for (let k = 0; k <= n; k++) { const x = Math.round(ri + (rj - ri) * k / n) * W + Math.round(ci + (cj - ci) * k / n); if (!pass[x]) return Infinity; m += mult[x]; }
      return distKm(latOf(ri), lonOf(ci), latOf(rj), lonOf(cj)) * m / (n + 1); };
    const smooth: number[] = [cells[0]]; let a0 = 0;
    while (a0 < cells.length - 1) { let best = a0 + 1;
      for (let j = Math.min(cells.length - 1, a0 + 300); j > a0 + 1; j--) { if (segCost(cells[a0], cells[j]) <= (gs[cells[j]] - gs[cells[a0]]) * 1.001) { best = j; break; } }
      smooth.push(cells[best]); a0 = best; }
    return this.describe(profile, mob, smooth.map(i => [latOf(Math.floor(i / W)), wrapLon(lonOf(i % W))] as [number, number]), gs[g0], dem, slope);
  }

  private fail(profile: Profile, reason: string): RouteResult {
    return { profile, ok: false, reason, path: [], distanceKm: 0, cost: 0, elev: [], slope: [], cum: [], maxSlope: 0, meanSlope: 0,
             climbM: 0, descentM: 0, hazards: [], sols: null, waypointsSci: [], doseTotal: null, explanation: [] };
  }

  async describe(profile: Profile, mob: Mobility, verts: [number, number][], cost: number, dem: Grid, slope: Grid): Promise<RouteResult> {
    // densify to ~4 km so profiles and hazard scans see every crossed cell
    const path: [number, number][] = [];
    for (let k = 0; k < verts.length; k++) {
      if (k === 0) { path.push(verts[0]); continue; }
      const [la0, lo0] = verts[k - 1], [la1, lo1] = verts[k]; let dlo = lo1 - lo0; if (dlo > 180) dlo -= 360; if (dlo < -180) dlo += 360;
      const n = Math.max(1, Math.ceil(distKm(la0, lo0, la1, lo1) / 4));
      for (let i = 1; i <= n; i++) path.push([la0 + (la1 - la0) * i / n, wrapLon(lo0 + dlo * i / n)]);
    }
    const elev: number[] = [], sl: number[] = [], cum: number[] = []; let d = 0, climb = 0, desc = 0;
    const M = MOBILITY[mob]; const hazards: RouteResult['hazards'] = []; const sci: RouteResult['waypointsSci'] = [];
    const sw = await this.ds.grid('swim01'); const hyd = await this.ds.grid('glassclay'); const rock = await this.ds.grid('rock');
    let lastSci = -1e9, sols = 0, dose = 0;
    for (let k = 0; k < path.length; k++) {
      const [la, lo] = path[k];
      if (k) { const step = distKm(path[k - 1][0], path[k - 1][1], la, lo); d += step; }
      const z = dem.at(la, lo), s = slope.at(la, lo);
      if (k) { const dz = z - elev[k - 1]; if (dz > 0) climb += dz; else desc -= dz;
        const stepKm = d - cum[k - 1]; const v = M.kmPerSol * Math.max(0.25, 1 - s / M.maxSlope); sols += stepKm / v; dose += (stepKm / v) * gcrDose(z).dose; }
      elev.push(z); sl.push(s); cum.push(d);
      if (s > M.maxSlope * 0.7) hazards.push({ km: d, lat: la, lon: lo, kind: 'steep', value: s });
      const rk = rock.at(la, lo); if (rk > 20) hazards.push({ km: d, lat: la, lon: lo, kind: 'rocky', value: rk });
      if (d - lastSci > 40) {
        const v = sw.at(la, lo), hy = hyd.at(la, lo);
        if (v > 0.4) { sci.push({ km: d, lat: la, lon: lo, what: 'ice' }); lastSci = d; }
        else if (hy > 0.15) { sci.push({ km: d, lat: la, lon: lo, what: 'hydrated' }); lastSci = d; }
      }
    }
    // collapse consecutive hazards into the worst per 25 km
    const hz: typeof hazards = []; for (const x of hazards) { const p = hz[hz.length - 1]; if (p && p.kind === x.kind && x.km - p.km < 25) { if (x.value > p.value) Object.assign(p, x); } else hz.push({ ...x }); }
    const maxSlope = Math.max(...sl), meanSlope = sl.reduce((a, b) => a + b, 0) / sl.length;
    const exp = [`profile:${profile}`, `cells:${path.length}`, `maxslope:${maxSlope.toFixed(1)}`];
    return { profile, ok: true, path, distanceKm: d, cost, elev, slope: sl, cum, maxSlope, meanSlope, climbM: climb, descentM: desc,
             hazards: hz.slice(0, 40), sols: Math.ceil(sols), waypointsSci: sci.slice(0, 20), doseTotal: dose, explanation: exp };
  }

  /** Route through a sequence of points (start, waypoints..., end). */
  async multi(points: { lat: number; lon: number }[], profile: Profile, mob: Mobility): Promise<RouteResult> {
    const legs: RouteResult[] = [];
    for (let i = 0; i + 1 < points.length; i++) { const r = await this.plan(points[i], points[i + 1], profile, mob); if (!r.ok) return { ...r, reason: `Leg ${i + 1}: ${r.reason}` }; legs.push(r); }
    const path = legs.flatMap((l, i) => (i ? l.path.slice(1) : l.path));
    const dem = await this.ds.grid('dem'), slope = await this.ds.grid('slope');
    const res = await this.describe(profile, mob, path, legs.reduce((a, l) => a + l.cost, 0), dem, slope);
    return res;
  }
}
