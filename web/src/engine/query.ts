// Location Intelligence: queries every compatible dataset at an arbitrary coordinate.
// Missing data is reported as missing; nothing is substituted from other locations.
import { DataStore, Status } from './data';
import { distKm, wrapLon, sig, bearing } from './geo';
import { gcrDose } from './radiation';

export interface Val {
  key: string; value: number | null; text: string; units: string; status: Status; layer?: string;
  note?: string; sigma?: number;
}
export interface Crater { lat: number; lon: number; d: number; conf: number; deg: number; fl: number; dist?: number; }
export interface Place { name: string; lat: number; lon: number; diameter: number; type: string; origin: string; dist?: number; }

const MINERALS = ['hematite', 'olivine', 'sulfate', 'glassclay', 'carbonate', 'feldspar', 'cpx'];

export class Engine {
  craters!: Crater[];
  craterBins = new Map<number, number[]>();
  places!: Place[];
  rovers: any; units: any;
  constructor(public ds: DataStore) {}

  async init() {
    const buf = await this.ds.bin('craters.bin');
    const dv = new DataView(buf), n = buf.byteLength / 16;
    this.craters = new Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      const c = { lat: dv.getFloat32(o, true), lon: dv.getFloat32(o + 4, true), d: dv.getFloat32(o + 8, true),
                  conf: dv.getUint8(o + 12), deg: dv.getUint8(o + 13), fl: dv.getUint8(o + 14) };
      this.craters[i] = c;
      const k = this.binKey(c.lat, c.lon);
      (this.craterBins.get(k) || this.craterBins.set(k, []).get(k)!).push(i);
    }
    const nm = await this.ds.getJSON('names.json');
    this.places = nm.features.map((f: any[]) => ({ name: f[0], lat: f[1], lon: f[2], diameter: f[3], type: f[4], origin: f[5] }));
    this.rovers = await this.ds.getJSON('rovers.json');
    this.units = await this.ds.getJSON('geology_units.json');
    return this;
  }
  private binKey(lat: number, lon: number) { return Math.floor(lat + 90) * 360 + Math.floor(wrapLon(lon)); }

  /** Craters whose centre lies within radiusKm (distance to centre; rims not available). */
  cratersNear(lat: number, lon: number, radiusKm: number, minD = 1): Crater[] {
    const out: Crater[] = [];
    const dLat = Math.ceil(radiusKm / 59.16) + 1, cosl = Math.max(0.02, Math.cos(lat * Math.PI / 180));
    const dLon = Math.min(180, Math.ceil(radiusKm / 59.16 / cosl) + 1);
    for (let a = Math.floor(lat) - dLat; a <= Math.floor(lat) + dLat; a++) {
      if (a < -90 || a > 89) continue;
      for (let b = Math.floor(lon) - dLon; b <= Math.floor(lon) + dLon; b++) {
        const idx = this.craterBins.get((a + 90) * 360 + wrapLon(b)); if (!idx) continue;
        for (const i of idx) { const c = this.craters[i]; if (c.d < minD) continue;
          const d = distKm(lat, lon, c.lat, c.lon); if (d <= radiusKm) out.push({ ...c, dist: d }); }
      }
    }
    return out.sort((x, y) => x.dist! - y.dist!);
  }
  /** Is the point inside a catalogued crater rim (centre distance < radius)? */
  insideCrater(lat: number, lon: number) {
    return this.cratersNear(lat, lon, 600, 5).filter(c => c.dist! < c.d / 2).sort((a, b) => a.d - b.d)[0] || null;
  }
  placesNear(lat: number, lon: number, k = 6, maxKm = 2500): Place[] {
    return this.places.map(p => ({ ...p, dist: distKm(lat, lon, p.lat, p.lon) })).filter(p => p.dist! < maxKm)
      .sort((a, b) => (a.dist! - Math.max(0, a.diameter / 2)) - (b.dist! - Math.max(0, b.diameter / 2))).slice(0, k);
  }
  /** Name of the region: smallest named feature whose radius contains the point, else nearest. */
  regionName(lat: number, lon: number): { name: string; type: string; within: boolean; dist: number } | null {
    let best: any = null;
    for (const p of this.places) {
      const d = distKm(lat, lon, p.lat, p.lon);
      if (p.diameter > 0 && d < p.diameter / 2 && (!best || !best.within || p.diameter < best.diameter)) best = { ...p, dist: d, within: true };
      else if (!best || (!best.within && d < best.dist)) best = { ...p, dist: d, within: false };
    }
    return best && { name: best.name, type: best.type, within: best.within, dist: best.dist };
  }
  find(q: string): Place[] {
    const s = q.trim().toLowerCase(); if (!s) return [];
    return this.places.filter(p => p.name.toLowerCase().includes(s))
      .sort((a, b) => (a.name.toLowerCase().startsWith(s) ? 0 : 1) - (b.name.toLowerCase().startsWith(s) ? 0 : 1) || b.diameter - a.diameter).slice(0, 8);
  }

  async val(id: string, lat: number, lon: number, fmt: (v: number) => string, key = id): Promise<Val> {
    const L = this.ds.layer(id)!;
    const g = await this.ds.grid(id);
    const v = g.at(lat, lon);
    if (Number.isNaN(v)) return { key, value: null, text: 'unavailable', units: L.units, status: 'unavailable', layer: id };
    const s = await this.ds.sigma(id);
    const sg = s ? s.at(lat, lon) : NaN;
    return { key, value: v, text: fmt(v), units: L.units, status: L.status, layer: id, sigma: Number.isNaN(sg) || sg < 0 ? undefined : sg };
  }

  /** Full location intelligence for any coordinate. */
  async query(lat: number, lon: number) {
    lon = wrapLon(lon);
    const elev = await this.val('dem', lat, lon, v => `${Math.round(v)}`);
    const slope = await this.val('slope', lat, lon, v => sig(v, 2));
    const rough = await this.val('rough', lat, lon, v => `${Math.round(v)}`);
    const cd = await this.val('crater_density', lat, lon, v => sig(v, 2));
    const dem = await this.ds.grid('dem');
    const relief = dem.stats(lat, lon, 25);
    // aspect from DEM neighbourhood (derived)
    const [r, c] = dem.rc(lat, lon);
    const dzdx = (dem.cell(r, c + 1) - dem.cell(r, c - 1)), dzdy = (dem.cell(r - 1, c) - dem.cell(r + 1, c));
    const aspect = (Math.atan2(-dzdx, -dzdy) * 180 / Math.PI + 360) % 360;
    const ti = await this.val('ti', lat, lon, v => `${Math.round(v)}`);
    const alb = await this.val('albedo', lat, lon, v => v.toFixed(2));
    const dci = await this.val('dci', lat, lon, v => v.toFixed(3));
    const rock = await this.val('rock', lat, lon, v => `${Math.round(v)}`);
    const s01 = await this.val('swim01', lat, lon, v => v.toFixed(2));
    const s15 = await this.val('swim15', lat, lon, v => v.toFixed(2));
    const s5 = await this.val('swim5', lat, lon, v => v.toFixed(2));
    const h2o = await this.val('grs_h2o', lat, lon, v => v.toFixed(1));
    const ns = await this.val('ns_epi', lat, lon, v => v.toFixed(1));
    const minerals: Val[] = [];
    for (const m of MINERALS) minerals.push(await this.val(m, lat, lon, v => v.toFixed(2)));
    const geoG = await this.ds.grid('geology');
    const gi = geoG.at(lat, lon);
    const unit = Number.isNaN(gi) ? null : this.units.units[gi];
    const rad = elev.value === null ? null : gcrDose(elev.value);
    const near = this.cratersNear(lat, lon, 50, 1);
    const big = this.cratersNear(lat, lon, 300, 20).slice(0, 5);
    const inside = this.insideCrater(lat, lon);
    const places = this.placesNear(lat, lon);
    const region = this.regionName(lat, lon);
    const hist = this.history(lat, lon);
    const all = [elev, slope, rough, cd, ti, alb, dci, rock, s01, s15, s5, h2o, ns, ...minerals];
    const covered = all.filter(v => v.value !== null).length;
    const iceEvidence = classifyIce(s01.value, s15.value, h2o.value, ns.value, lat, unit?.unit);
    const mobility = classifyMobility(slope.value, rough.value, rock.value, near.length);
    return { lat, lon, region, elev, slope, rough, aspect: Number.isNaN(aspect) ? null : aspect, relief, cd, ti, alb, dci, rock,
             rad, s01, s15, s5, h2o, ns, minerals, unit, near, big, inside, places, hist, iceEvidence, mobility,
             coverage: { covered, total: all.length, fraction: covered / all.length } };
  }

  history(lat: number, lon: number) {
    const out: any[] = [];
    for (const [name, rv] of Object.entries<any>(this.rovers)) {
      if (name === 'images') continue;
      let best: any = null;
      for (const w of rv.waypoints) { const d = distKm(lat, lon, w.lat, w.lon); if (!best || d < best.d) best = { d, w }; }
      out.push({ rover: name, nearestKm: best.d, waypoint: best.w, last: rv.last, sols: rv.sol_range });
    }
    const imgs = (this.rovers.images || []).map((im: any) => ({ ...im, dist: distKm(lat, lon, im.rover_lat, im.rover_lon),
      bearing: bearing(lat, lon, im.rover_lat, im.rover_lon) })).filter((im: any) => im.dist < 50).sort((a: any, b: any) => a.dist - b.dist);
    return { rovers: out.sort((a, b) => a.nearestKm - b.nearestKm), images: imgs };
  }
}

/** Evidence ladder for water ice (never upgrades indirect evidence to "confirmed"). */
// Polar cap (lApc) and polar layered deposits (Ap) are mapped water-ice-rich units (Tanaka et al. 2014; SHARAD sounding).
export const POLAR_ICE_UNITS = ['lApc', 'Ap'];
export function classifyIce(s01: number | null, s15: number | null, h2o: number | null, ns: number | null, lat: number, unit?: string) {
  const items: string[] = [];
  let level: 'strong' | 'moderate' | 'indicator' | 'weak' | 'unknown' = 'unknown';
  const sw = Math.max(s01 ?? -9, s15 ?? -9);
  if (unit && POLAR_ICE_UNITS.includes(unit)) { level = 'strong'; items.push('polar_unit'); }
  else if (Math.abs(lat) >= 55 && ns !== null && ns < 3) { level = 'strong'; items.push('polar_ns'); }
  else if (sw >= 0.5) { level = 'moderate'; items.push('swim_high'); }
  else if (sw >= 0.25 || (h2o !== null && h2o >= 6)) { level = 'indicator'; items.push(sw >= 0.25 ? 'swim_mid' : 'h2o_high'); }
  else if (sw > -9 || h2o !== null) { level = 'weak'; }
  return { level, items };
}

export function classifyMobility(slope: number | null, rough: number | null, rock: number | null, nCr: number) {
  if (slope === null) return { level: 'unknown', score: null as number | null };
  const s = Math.min(1, slope / 12) * 0.55 + Math.min(1, (rough ?? 0) / 300) * 0.25 + Math.min(1, (rock ?? 0) / 25) * 0.1 + Math.min(1, nCr / 40) * 0.1;
  const level = s < 0.2 ? 'good' : s < 0.4 ? 'moderate' : s < 0.6 ? 'difficult' : 'severe';
  return { level, score: 1 - s };
}
