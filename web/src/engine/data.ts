// Data access layer: loads the manifest (central data registry) and gzip grids on demand.
// No scientific values live in UI code: everything is read from these files.
import { wrapLon } from './geo';

export type Status = 'measured' | 'published' | 'derived' | 'modeled' | 'inferred' | 'synthetic' | 'unavailable';

export interface GridMeta {
  file: string; dtype: 'int16' | 'uint16' | 'uint8' | 'float32'; width: number; height: number; ppd: number;
  lon0: number; lat0: number; scale: number; offset: number; nodata: number | null; units: string; sigma_file?: string;
}
export interface LayerMeta {
  id: string; group: string; status: Status; name: string; name_ar: string; source: Record<string, string>;
  grid: GridMeta | null; derived_from?: string; resolution_km: number; coverage: string; temporal: string; units: string;
  processing: string; limitations: string; confidence: string; crs: string;
  legend: { ramp: string; min?: number; max?: number };
}
export interface Manifest {
  version: string; built: string; layers: LayerMeta[]; unavailable: { id: string; name: string; reason: string; url: string }[];
  vectors: any; synthetic: any[]; note: string; overview_dem: GridMeta;
}

export class Grid {
  constructor(public meta: GridMeta, public raw: ArrayLike<number>) {}
  get w() { return this.meta.width; }
  get h() { return this.meta.height; }
  /** Physical value at cell (r,c), NaN when nodata. */
  cell(r: number, c: number): number {
    if (r < 0 || r >= this.h) return NaN;
    c = ((c % this.w) + this.w) % this.w;
    const v = this.raw[r * this.w + c];
    if (this.meta.nodata !== null && v === this.meta.nodata) return NaN;
    if (Number.isNaN(v)) return NaN;
    return v * this.meta.scale + this.meta.offset;
  }
  rc(lat: number, lon: number): [number, number] {
    const ppd = this.meta.ppd;
    return [Math.floor((90 - lat) * ppd), Math.floor(wrapLon(lon) * ppd)];
  }
  /** Nearest-cell value (no interpolation across nodata). */
  at(lat: number, lon: number): number { const [r, c] = this.rc(lat, lon); return this.cell(Math.min(this.h - 1, r), c); }
  /** Bilinear interpolation; falls back to nearest if any neighbour is nodata. */
  bilinear(lat: number, lon: number): number {
    const ppd = this.meta.ppd;
    const y = (90 - lat) * ppd - 0.5, x = wrapLon(lon) * ppd - 0.5;
    const r0 = Math.floor(y), c0 = Math.floor(x), fy = y - r0, fx = x - c0;
    const a = this.cell(r0, c0), b = this.cell(r0, c0 + 1), c = this.cell(r0 + 1, c0), d = this.cell(r0 + 1, c0 + 1);
    if ([a, b, c, d].some(Number.isNaN)) return this.at(lat, lon);
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  }
  /** Statistics in a radius (km) around a point; returns null if no valid cells. */
  stats(lat: number, lon: number, radiusKm: number) {
    const ppd = this.meta.ppd, dLat = radiusKm / 59.16;
    const r0 = Math.floor((90 - lat - dLat) * ppd), r1 = Math.floor((90 - lat + dLat) * ppd);
    const cosl = Math.max(0.05, Math.cos((lat * Math.PI) / 180)), dLon = dLat / cosl;
    const c0 = Math.floor((wrapLon(lon) - dLon) * ppd), c1 = Math.floor((wrapLon(lon) + dLon) * ppd);
    let n = 0, s = 0, mn = Infinity, mx = -Infinity;
    for (let r = Math.max(0, r0); r <= Math.min(this.h - 1, r1); r++)
      for (let c = c0; c <= c1; c++) { const v = this.cell(r, c); if (!Number.isNaN(v)) { n++; s += v; mn = Math.min(mn, v); mx = Math.max(mx, v); } }
    return n ? { mean: s / n, min: mn, max: mx, n } : null;
  }
}

// Binary grids ship as <file>.gz (local/API) or <file>.gz.json (base64 text, for hosts that only serve text/images).
export const BIN_SUFFIX = ((globalThis as any).MESIS_BIN_SUFFIX as string) || '.gz.json';
async function inflate(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  let buf: ArrayBuffer;
  if (url.endsWith('.json')) { const s: string = await res.json(); const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); buf = u.buffer; }
  else buf = await res.arrayBuffer();
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  // Only inflate if the bytes are still gzip (a server may already have decoded Content-Encoding: gzip).
  if (b[0] === 0x1f && b[1] === 0x8b) {
    const ds = new (globalThis as any).DecompressionStream('gzip');
    return await new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer();
  }
  return buf;
}

function typed(buf: ArrayBuffer, dtype: GridMeta['dtype']): ArrayLike<number> {
  switch (dtype) {
    case 'int16': return new Int16Array(buf);
    case 'uint16': return new Uint16Array(buf);
    case 'uint8': return new Uint8Array(buf);
    case 'float32': return new Float32Array(buf);
  }
}

export class DataStore {
  manifest!: Manifest;
  private grids = new Map<string, Promise<Grid>>();
  json = new Map<string, any>();
  constructor(public base = 'data/') {}
  async init() { this.manifest = await (await fetch(this.base + 'manifest.json')).json(); return this.manifest; }
  layer(id: string) { return this.manifest.layers.find(l => l.id === id); }
  gridMeta(meta: GridMeta): Promise<Grid> {
    const key = meta.file;
    if (!this.grids.has(key)) this.grids.set(key, inflate(this.base + meta.file + BIN_SUFFIX).then(b => new Grid(meta, typed(b, meta.dtype))));
    return this.grids.get(key)!;
  }
  grid(id: string): Promise<Grid> {
    const l = this.layer(id);
    if (!l || !l.grid) return Promise.reject(new Error('no grid for ' + id));
    return this.gridMeta(l.grid);
  }
  sigma(id: string): Promise<Grid | null> {
    const l = this.layer(id);
    if (!l?.grid?.sigma_file) return Promise.resolve(null);
    return this.gridMeta({ ...l.grid, file: l.grid.sigma_file });
  }
  async getJSON(file: string) {
    if (!this.json.has(file)) this.json.set(file, await (await fetch(this.base + file)).json());
    return this.json.get(file);
  }
  async bin(file: string): Promise<ArrayBuffer> { return inflate(this.base + file + BIN_SUFFIX); }
}
