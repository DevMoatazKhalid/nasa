// Mission-specific suitability analysis over a global 1° candidate grid.
// Every criterion maps real layer values to a 0..1 score with a documented transfer function;
// missing data yields null (excluded from the weighted mean and lowers confidence).
import { DataStore, Grid } from './data';
import { distKm, wrapLon } from './geo';
import { gcrDose } from './radiation';
import { Engine } from './query';

export type MissionId = 'water_ice' | 'mineral' | 'science' | 'agriculture' | 'habitat' | 'exploration' | 'infrastructure';
export type Criterion = 'ice' | 'terrain' | 'landing_elev' | 'radiation' | 'thermal_lat' | 'dust' | 'minerals' |
  'hydrated' | 'diversity' | 'ancient' | 'firm_ground' | 'rocks' | 'access' | 'ice_lat_window';

/** Weights per mission (sum to 1). Rationale strings are shown in the UI and the report. */
export const MISSIONS: Record<MissionId, { weights: Partial<Record<Criterion, number>>; rationale: string }> = {
  water_ice: { weights: { ice: 0.45, terrain: 0.15, ice_lat_window: 0.15, landing_elev: 0.1, firm_ground: 0.05, rocks: 0.05, access: 0.05 },
    rationale: 'Ice evidence dominates (SWIM consistency, GRS hydrogen, neutron suppression); mid-latitude window favoured because human-class landing studies require |lat| ≲ 50° while ice is shallowest poleward.' },
  mineral: { weights: { minerals: 0.3, hydrated: 0.2, diversity: 0.15, terrain: 0.15, dust: 0.1, landing_elev: 0.05, access: 0.05 },
    rationale: 'Spectral mineral abundances (TES) lead; dust-free surfaces expose bedrock; geologic diversity adds context.' },
  science: { weights: { diversity: 0.25, ancient: 0.15, hydrated: 0.2, minerals: 0.1, ice: 0.05, terrain: 0.15, landing_elev: 0.05, access: 0.05 },
    rationale: 'Geologic diversity, Noachian/Hesperian age and aqueous-alteration indicators drive scientific value.' },
  agriculture: { weights: { radiation: 0.2, landing_elev: 0.15, thermal_lat: 0.2, ice: 0.2, dust: 0.1, terrain: 0.1, access: 0.05 },
    rationale: 'Controlled-habitat agriculture needs water access, low radiation (thicker atmosphere), sunlight/warmth (low latitude) and low dust. Regolith is never assumed fertile.' },
  habitat: { weights: { terrain: 0.25, rocks: 0.1, firm_ground: 0.1, radiation: 0.15, thermal_lat: 0.1, ice: 0.15, dust: 0.05, landing_elev: 0.1 },
    rationale: 'Flat, rock-poor, thermally-firm ground; low elevation for radiation shielding and landing; nearby water.' },
  exploration: { weights: { diversity: 0.25, terrain: 0.2, access: 0.25, radiation: 0.1, ancient: 0.1, landing_elev: 0.1 },
    rationale: 'Balances scientific interest against travel difficulty and distance from the start point.' },
  infrastructure: { weights: { terrain: 0.3, landing_elev: 0.15, thermal_lat: 0.15, ice: 0.15, dust: 0.1, firm_ground: 0.15 },
    rationale: 'Broad flat terrain, solar resource (latitude, dust), water and firm ground for bases and power.' },
};

export interface MissionConfig {
  mission: MissionId; start?: { lat: number; lon: number } | null; maxDistKm?: number | null;
  risk: 'low' | 'medium' | 'high'; region?: { lat: number; lon: number; radiusKm: number } | null; count?: number;
}
export interface Candidate {
  lat: number; lon: number; score: number; confidence: number; parts: Partial<Record<Criterion, number | null>>;
  raw: Record<string, number | null>; name: string; distFromStart: number | null; hazards: string[]; evidence: string;
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const MAX_SLOPE: Record<MissionConfig['risk'], number> = { low: 4, medium: 7, high: 12 }; // mean 1° slope (deg, 3.7 km baseline)

export class MissionAnalyzer {
  agg = new Map<string, Float32Array>();
  units!: Uint16Array[]; // per 1° cell: unit index sets packed
  constructor(public ds: DataStore, public eng: Engine) {}

  /** Mean of a layer over each 1° cell (NaN where no valid data). */
  async agg1(id: string): Promise<Float32Array> {
    if (this.agg.has(id)) return this.agg.get(id)!;
    const g = await this.ds.grid(id);
    const out = new Float32Array(180 * 360).fill(NaN);
    const p = g.meta.ppd;
    if (p < 1) { // coarser than 1°: nearest
      for (let r = 0; r < 180; r++) for (let c = 0; c < 360; c++) out[r * 360 + c] = g.at(89.5 - r, c + 0.5);
    } else {
      const s = new Float64Array(180 * 360), n = new Uint32Array(180 * 360);
      for (let r = 0; r < g.h; r++) { const R = Math.floor(r / p);
        for (let c = 0; c < g.w; c++) { const v = g.cell(r, c); if (!Number.isNaN(v)) { const k = R * 360 + Math.floor(c / p); s[k] += v; n[k]++; } } }
      for (let k = 0; k < s.length; k++) if (n[k]) out[k] = s[k] / n[k];
    }
    this.agg.set(id, out); return out;
  }
  async diversity(): Promise<{ count: Uint8Array; oldest: Float32Array }> {
    if ((this as any)._div) return (this as any)._div;
    const g = await this.ds.grid('geology'); const p = g.meta.ppd;
    const sets: Set<number>[] = Array.from({ length: 180 * 360 }, () => new Set<number>());
    for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) { const v = g.cell(r, c); if (!Number.isNaN(v)) sets[Math.floor(r / p) * 360 + Math.floor(c / p)].add(v); }
    const count = new Uint8Array(180 * 360), oldest = new Float32Array(180 * 360).fill(NaN);
    const ageRank = (a: string) => a.includes('Noachian') ? 1 : a.includes('Hesperian') ? 0.6 : a.includes('Amazonian') ? 0.2 : NaN;
    for (let r = 0; r < 180; r++) for (let c = 0; c < 360; c++) {
      const u = new Set<number>();
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr; if (rr < 0 || rr > 179) continue; sets[rr * 360 + ((c + dc + 360) % 360)].forEach(x => u.add(x)); }
      count[r * 360 + c] = u.size;
      let best = NaN; sets[r * 360 + c].forEach(x => { const a = ageRank(this.eng.units.units[x]?.age || ''); if (!Number.isNaN(a)) best = Number.isNaN(best) ? a : Math.max(best, a); });
      oldest[r * 360 + c] = best;
    }
    (this as any)._div = { count, oldest }; return (this as any)._div;
  }

  async rank(cfg: MissionConfig): Promise<{ candidates: Candidate[]; scanned: number; excluded: Record<string, number> }> {
    const W = MISSIONS[cfg.mission].weights;
    const [dem, slope, rough, rock, ti, dci, s01, s15, h2o, ns] = await Promise.all(
      ['dem', 'slope', 'rough', 'rock', 'ti', 'dci', 'swim01', 'swim15', 'grs_h2o', 'ns_epi'].map(id => this.agg1(id)));
    const mins = await Promise.all(['hematite', 'olivine', 'cpx', 'feldspar'].map(id => this.agg1(id)));
    const hyd = await Promise.all(['sulfate', 'glassclay', 'carbonate'].map(id => this.agg1(id)));
    const div = await this.diversity();
    const maxS = MAX_SLOPE[cfg.risk];
    const excluded: Record<string, number> = { slope: 0, distance: 0, region: 0, polar: 0 };
    const cands: Candidate[] = [];
    for (let r = 2; r < 178; r++) for (let c = 0; c < 360; c++) {
      const k = r * 360 + c, lat = 89.5 - r, lon = c + 0.5;
      const nz = (a: Float32Array) => (Number.isNaN(a[k]) ? null : a[k]);
      const sl = nz(slope);
      if (sl === null || sl > maxS) { excluded.slope++; continue; }
      if (Math.abs(lat) > (cfg.risk === 'high' ? 80 : 70)) { excluded.polar++; continue; }
      let dStart: number | null = null;
      if (cfg.start) { dStart = distKm(cfg.start.lat, cfg.start.lon, lat, lon); if (cfg.maxDistKm && dStart > cfg.maxDistKm) { excluded.distance++; continue; } }
      if (cfg.region && distKm(cfg.region.lat, cfg.region.lon, lat, lon) > cfg.region.radiusKm) { excluded.region++; continue; }
      const e = nz(dem), ro = nz(rough), rk = nz(rock), t = nz(ti), d = nz(dci);
      const sw = [nz(s01), nz(s15)].filter(v => v !== null) as number[];
      const g = nz(h2o), n = nz(ns);
      const parts: Partial<Record<Criterion, number | null>> = {};
      const set = (key: Criterion, v: number | null) => { if (W[key] !== undefined) parts[key] = v; };
      set('terrain', clamp(1 - sl / maxS) * 0.7 + (ro === null ? 0.3 * 0.5 : 0.3 * clamp(1 - ro / 250)));
      set('landing_elev', e === null ? null : clamp((2000 - e) / 8000));
      set('radiation', e === null ? null : clamp((0.30 - gcrDose(e).dose) / 0.13));
      set('thermal_lat', clamp(Math.cos((lat * Math.PI) / 180) ** 2));
      set('dust', d === null ? null : clamp((d - 0.93) / 0.05));
      set('rocks', rk === null ? null : clamp(1 - rk / 25));
      set('firm_ground', t === null ? null : clamp((t - 80) / 300));
      // Ice: SWIM (−1..1) is primary where mapped; GRS/NS supplement elsewhere. Never exceeds evidence.
      let ice: number | null = null;
      if (sw.length) ice = clamp((Math.max(...sw) + 0.2) / 1.0);
      if (g !== null) ice = Math.max(ice ?? 0, clamp((g - 3) / 6) * 0.8);
      if (n !== null && Math.abs(lat) > 55) ice = Math.max(ice ?? 0, clamp((6 - n) / 4) * 0.9);
      set('ice', ice);
      set('ice_lat_window', clamp(1 - Math.abs(Math.abs(lat) - 42) / 25));
      const mv = mins.map(a => nz(a)).filter(v => v !== null) as number[];
      set('minerals', mv.length ? clamp(Math.max(...mv) / 0.12) : null);
      const hv = hyd.map(a => nz(a)).filter(v => v !== null) as number[];
      set('hydrated', hv.length ? clamp((Math.max(...hv) - 0.03) / 0.12) : null);
      set('diversity', clamp((div.count[k] - 1) / 5));
      set('ancient', Number.isNaN(div.oldest[k]) ? null : div.oldest[k]);
      set('access', dStart === null ? null : clamp(1 - dStart / (cfg.maxDistKm || 3000)));
      let sw_ = 0, ws = 0, wAll = 0;
      for (const [key, w] of Object.entries(W) as [Criterion, number][]) { wAll += w; const v = parts[key]; if (v !== null && v !== undefined) { sw_ += v * w; ws += w; } }
      if (ws < 0.5 * wAll) continue; // less than half the evidence weight available: not ranked
      const conf = ws / wAll;
      cands.push({ lat, lon, score: sw_ / ws, confidence: conf, parts, distFromStart: dStart, name: '', hazards: [], evidence: '',
        raw: { elev: e, slope: sl, rough: ro, rock: rk, ti: t, dci: d, swim: sw.length ? Math.max(...sw) : null, h2o: g, ns: n,
               diversity: div.count[k], dose: e === null ? null : gcrDose(e).dose } });
    }
    // rank by score tempered by confidence, then non-maximum suppression (min 350 km separation)
    cands.sort((a, b) => b.score * (0.7 + 0.3 * b.confidence) - a.score * (0.7 + 0.3 * a.confidence));
    const picked: Candidate[] = [];
    for (const c of cands) {
      if (picked.length >= (cfg.count || 8)) break;
      if (picked.some(p => distKm(p.lat, p.lon, c.lat, c.lon) < 350)) continue;
      const reg = this.eng.regionName(c.lat, c.lon);
      const local = this.eng.places.filter(p => p.diameter > 0 && p.diameter < 400)
        .map(p => ({ p, d: distKm(c.lat, c.lon, p.lat, p.lon) })).sort((a, b) => a.d - b.d)[0];
      const big = reg && reg.within ? reg.name : null;
      c.name = big && local && local.d < 300 && local.p.name !== big ? `${big} · ${local.p.name}` : big ? big
        : local && local.d < 300 ? `near ${local.p.name}` : reg ? `near ${reg.name}` : `${c.lat.toFixed(1)}, ${c.lon.toFixed(1)}`;
      if (picked.some(p => p.name === c.name)) c.name += ` (${Math.abs(c.lat).toFixed(1)}°${c.lat >= 0 ? 'N' : 'S'} ${c.lon.toFixed(1)}°E)`;
      if ((c.raw.slope ?? 0) > maxS * 0.6) c.hazards.push('slope');
      if ((c.raw.rough ?? 0) > 150) c.hazards.push('rough');
      if ((c.raw.rock ?? 0) > 15) c.hazards.push('rocks');
      if ((c.raw.dci ?? 1) < 0.94) c.hazards.push('dust');
      if ((c.raw.dose ?? 0) > 0.23) c.hazards.push('radiation');
      if (Math.abs(c.lat) > 50) c.hazards.push('cold');
      c.evidence = c.confidence > 0.85 ? 'good' : c.confidence > 0.65 ? 'partial' : 'limited';
      picked.push(c);
    }
    return { candidates: picked, scanned: 176 * 360, excluded };
  }
}
