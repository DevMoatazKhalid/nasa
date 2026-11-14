// Mission Intelligence Report: assembled only from engine outputs + registry metadata.
import { Manifest } from './data';
import { fmtCoord, sig } from './geo';
import { MISSIONS, MissionId, Candidate } from './missions';
import { MOBILITY, Mobility, RouteResult } from './route';
import { RAD_MODEL } from './radiation';

export interface Report {
  id: string; created: string; title: string; mission: MissionId | null; objective: string;
  start: { lat: number; lon: number } | null; dest: { lat: number; lon: number; name: string } | null;
  candidate: Candidate | null; alternatives: Candidate[]; routes: RouteResult[]; mobility: Mobility | null; loc: any | null;
  sources: { name: string; status: string; org: string; doi?: string; url?: string }[];
}

const STATUS_WORD: Record<string, string> = { measured: 'Measured', published: 'Published', derived: 'Derived', modeled: 'Modeled', inferred: 'Inferred', unavailable: 'Unavailable' };

export function buildReport(m: Manifest, o: Partial<Report> & { mission: MissionId | null }): Report {
  const used = ['dem', 'slope', 'rough', 'crater_density', 'ti', 'albedo', 'dci', 'rock', 'rad', 'swim01', 'swim15', 'grs_h2o', 'ns_epi', 'geology', 'glassclay', 'sulfate', 'hematite'];
  const sources: Report['sources'] = m.layers.filter(l => used.includes(l.id)).map(l => ({ name: l.name, status: l.status, org: l.source.org, doi: l.source.doi, url: l.source.url }));
  sources.push({ name: 'Crater catalogue', status: 'published', org: 'Robbins & Hynek 2012 (2020 release)', doi: '10.1029/2011JE003966', url: '' });
  sources.push({ name: 'Rover localisation & raw images', status: 'measured', org: 'NASA/JPL MMGIS, NASA raw image API', url: 'https://mars.nasa.gov/mars2020/multimedia/raw-images/' });
  return { id: 'R' + Date.now().toString(36), created: new Date().toISOString(), title: o.title || 'Mission intelligence report',
    objective: o.mission ? MISSIONS[o.mission].rationale : (o.objective || ''), start: null, dest: null, candidate: null,
    alternatives: [], routes: [], mobility: null, loc: null, sources, ...o } as Report;
}

const v = (x: any, d = 0, u = '') => (x === null || x === undefined || Number.isNaN(x) ? 'data unavailable' : `${typeof x === 'number' ? x.toFixed(d) : x}${u}`);

export function toMarkdown(r: Report): string {
  const L: string[] = [];
  L.push(`# ${r.title}`, '', `Generated ${r.created} by MESIS. Decision-support output from archived orbital data — not live conditions and not a safety certification.`, '');
  L.push('## 1. Mission overview', `- Mission type: ${r.mission ?? 'location study'}`, `- Objective & weighting rationale: ${r.objective}`);
  if (r.start) L.push(`- Starting point: ${fmtCoord(r.start.lat, r.start.lon)}`);
  if (r.dest) L.push(`- Destination: ${r.dest.name} — ${fmtCoord(r.dest.lat, r.dest.lon)}`);
  const c = r.candidate;
  if (c) {
    L.push('', '## 2. Destination analysis', `- Suitability score: ${Math.round(c.score * 100)}/100 (confidence ${Math.round(c.confidence * 100)}%, evidence ${c.evidence})`);
    L.push(`- Criterion scores: ${Object.entries(c.parts).map(([k, x]) => `${k} ${x === null ? 'n/a' : Math.round((x as number) * 100)}`).join(', ')}`);
    L.push(`- Terrain (Derived, MOLA): mean slope ${v(c.raw.slope, 1, '°')} at 3.7 km baseline; roughness ${v(c.raw.rough, 0, ' m')}; elevation ${v(c.raw.elev, 0, ' m')}`);
    L.push(`- Rocks (Published, TES): ${v(c.raw.rock, 0, ' %')}; thermal inertia ${v(c.raw.ti, 0, ' tiu')}; dust cover index ${v(c.raw.dci, 3)}`);
    L.push(`- Ice (Published, SWIM consistency): ${v(c.raw.swim, 2)}; GRS hydrogen ${v(c.raw.h2o, 1, ' wt%')} (hydrogen ≠ confirmed ice)`);
    L.push(`- Radiation (Modeled, GCR only): ${v(c.raw.dose, 3, ' mGy/day')} — anchored to RAD ${RAD_MODEL.anchorDose} ± ${RAD_MODEL.anchorDoseErr} mGy/day at Gale`);
    L.push(`- Hazards flagged: ${c.hazards.length ? c.hazards.join(', ') : 'none flagged at 1° scale'}`);
  }
  if (r.loc) {
    const q = r.loc; L.push('', '## 3. Location intelligence', `- Region: ${q.region?.name ?? '—'}; geologic unit ${q.unit ? `${q.unit.unit} — ${q.unit.desc} (${q.unit.age})` : 'data unavailable'}`,
      `- Elevation ${v(q.elev.value, 0, ' m')}; slope ${v(q.slope.value, 1, '°')}; craters ≥1 km within 50 km: ${q.near.length}`,
      `- Ice evidence level: ${q.iceEvidence.level}; mobility: ${q.mobility.level}`);
  }
  if (r.routes.length) {
    L.push('', '## 4. Routes', `Mobility assumption: ${r.mobility ? MOBILITY[r.mobility].label + ' — ' + MOBILITY[r.mobility].basis : '—'}`);
    for (const x of r.routes) {
      if (!x.ok) { L.push(`- ${x.profile}: not found — ${x.reason}`); continue; }
      L.push(`- **${x.profile}**: ${x.distanceKm.toFixed(0)} km, est. ${x.sols} sols (estimate), climb ${x.climbM.toFixed(0)} m, max slope ${x.maxSlope.toFixed(1)}°, hazards ${x.hazards.length}, science/resource waypoints ${x.waypointsSci.length}, modeled GCR dose en route ${x.doseTotal?.toFixed(1)} mGy`);
    }
  }
  if (r.alternatives.length) { L.push('', '## 5. Alternative destinations'); r.alternatives.forEach(a => L.push(`- ${a.name} — ${fmtCoord(a.lat, a.lon)} — ${Math.round(a.score * 100)}/100 (conf. ${Math.round(a.confidence * 100)}%)`)); }
  L.push('', '## 6. Data quality, confidence & limitations',
    '- Terrain cells are ~7.4 km; mission candidates are scored on 1° (~59 km) cells. Metre-scale hazards are invisible at these scales.',
    '- Mineral abundances (TES) have detection limits of ~0.10-0.15 areal fraction; hydrated-phase signals are indicators, not ore grades.',
    '- Ice: SWIM consistency, GRS hydrogen and neutron data are indirect; none is labelled as confirmed ice except polar neutron suppression.',
    '- Radiation is a GCR model (excludes solar particle events); dust cover index describes the surface, not current storms.',
    '- No synthetic data are used. All values are archival (1997-2026 acquisitions), not live conditions.');
  L.push('', '## 7. Sources'); r.sources.forEach(s => L.push(`- ${s.name} [${STATUS_WORD[s.status] || s.status}] — ${s.org}${s.doi ? ` — doi:${s.doi}` : ''}${s.url ? ` — ${s.url}` : ''}`));
  return L.join('\n');
}

export function toHTML(r: Report, md = toMarkdown(r)): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = md.split('\n').map(l => l.startsWith('# ') ? `<h1>${esc(l.slice(2))}</h1>` : l.startsWith('## ') ? `<h2>${esc(l.slice(3))}</h2>` :
    l.startsWith('- ') ? `<li>${esc(l.slice(2)).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</li>` : l ? `<p>${esc(l)}</p>` : '').join('\n');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>body{font:15px/1.55 system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;color:#1b1b1b}h1{font-size:28px}h2{font-size:18px;border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:28px}li{margin:4px 0}</style></head><body>${body}</body></html>`;
}
