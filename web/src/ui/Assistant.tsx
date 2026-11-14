// Data-grounded AI assistant. Claude may only learn facts through these tools, which call the same
// engine the UI uses. It explains results; it never computes or invents measurements itself.
import React, { useEffect, useRef, useState } from 'react';
import { useT, useLang } from './common';
import { Engine } from '../engine/query';
import { MissionAnalyzer, MISSIONS, MissionId } from '../engine/missions';
import { Router, Profile, Mobility } from '../engine/route';
import { DataStore } from '../engine/data';

const SYSTEM = `You are the MESIS  for Mars exploration planning. Rules:
- Every number or fact about a location, dataset or route MUST come from a tool result in this conversation. If no tool can support an answer, say so plainly.
- Always state the data status of values you cite (measured, published, derived, modeled, inferred, unavailable). Never call hydrogen or ice-consistency evidence "confirmed ice".
- All data are archival, not live. Routes are strategic corridors on 7.4 km cells, never guaranteed safe.
- When the user describes a mission, translate it into: mission type (one of ${Object.keys(MISSIONS).join(', ')}), objectives, required resources, constraints, relevant layers, then call rank_sites.
- Be concise; use short paragraphs or bullets. Answer in the user's language (English or Arabic).`;

export function Assistant(p: { ds: DataStore; eng: Engine; ma: MissionAnalyzer; router: Router; context: string;
  onSites: (cands: any[], mission: MissionId) => void; onFocus: (lat: number, lon: number) => void; prompt: { text: string; t: number } | null }) {
  const t = useT(); const lang = useLang();
  const [sample, setSample] = useState<any>(undefined); const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]); const [busy, setBusy] = useState(false); const [inp, setInp] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { const c = (window as any).claude; if (!c?.use) { setSample(null); return; } c.use('sample').then((s: any) => setSample(s || null)).catch(() => setSample(null)); }, []);
  useEffect(() => { if (p.prompt) { setOpen(true); if (sample) send(p.prompt.text); } }, [p.prompt?.t]);

  const tools = [
    { name: 'find_place', description: 'Look up IAU-named Mars features by (partial) name. Returns name, lat, lon (east 0-360), diameter_km, type.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      execute: async ({ name }: any) => p.eng.find(name).map(x => ({ name: x.name, lat: x.lat, lon: x.lon, diameter_km: x.diameter, type: x.type })) },
    { name: 'query_location', description: 'Location intelligence for a coordinate: terrain, thermophysics, ice evidence, minerals, geology, craters, rover proximity, with data status.',
      inputSchema: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' } }, required: ['lat', 'lon'] },
      execute: async ({ lat, lon }: any) => { const q = await p.eng.query(lat, lon); p.onFocus(lat, lon); const v = (x: any) => ({ value: x.value, units: x.units, status: x.status, sigma: x.sigma });
        return { region: q.region, elevation: v(q.elev), slope_deg_3_7km: v(q.slope), roughness: v(q.rough), crater_density: v(q.cd), craters_1km_within_50km: q.near.length,
          thermal_inertia: v(q.ti), albedo: v(q.alb), dust_cover_index: v(q.dci), rock_abundance: v(q.rock),
          gcr_dose_mGy_day: q.rad ? { value: q.rad.dose, range: [q.rad.lo, q.rad.hi], status: 'modeled' } : null, pressure_Pa: q.rad ? { value: q.rad.pressure, status: 'modeled' } : null,
          swim_ice_consistency_0_1m: v(q.s01), swim_1_5m: v(q.s15), grs_h2o_wt_pct: v(q.h2o), epithermal_neutrons: v(q.ns), ice_evidence_level: q.iceEvidence.level,
          minerals: Object.fromEntries(q.minerals.map((m: any) => [m.key, v(m)])), geologic_unit: q.unit, mobility: q.mobility.level,
          nearest_rovers: q.hist.rovers.map((r: any) => ({ rover: r.rover, km: Math.round(r.nearestKm) })), rover_images_within_50km: q.hist.images.length,
          coverage: q.coverage, temperature: 'unavailable (no gridded product)', atmospheric_dust: 'unavailable' }; } },
    { name: 'rank_sites', description: 'Rank candidate destinations for a mission type using the platform scoring model. Shows them on the map.',
      inputSchema: { type: 'object', properties: { mission: { type: 'string', enum: Object.keys(MISSIONS) }, start_lat: { type: 'number' }, start_lon: { type: 'number' },
        max_distance_km: { type: 'number' }, risk: { type: 'string', enum: ['low', 'medium', 'high'] } }, required: ['mission'] },
      execute: async (a: any) => { const res = await p.ma.rank({ mission: a.mission, risk: a.risk || 'medium', start: a.start_lat !== undefined ? { lat: a.start_lat, lon: a.start_lon } : null, maxDistKm: a.max_distance_km || null, count: 6 });
        p.onSites(res.candidates, a.mission); return { weights: MISSIONS[a.mission as MissionId].weights, rationale: MISSIONS[a.mission as MissionId].rationale,
          candidates: res.candidates.map(c => ({ name: c.name, lat: c.lat, lon: c.lon, score: +c.score.toFixed(3), confidence: +c.confidence.toFixed(2), criteria: c.parts, raw: c.raw, hazards: c.hazards })) }; } },
    { name: 'plan_route', description: 'Plan an A* corridor between two coordinates. profile: safest|shortest|science|resource; mobility: rover|crew_rover|eva.',
      inputSchema: { type: 'object', properties: { from_lat: { type: 'number' }, from_lon: { type: 'number' }, to_lat: { type: 'number' }, to_lon: { type: 'number' },
        profile: { type: 'string' }, mobility: { type: 'string' } }, required: ['from_lat', 'from_lon', 'to_lat', 'to_lon'] },
      execute: async (a: any) => { const r = await p.router.plan({ lat: a.from_lat, lon: a.from_lon }, { lat: a.to_lat, lon: a.to_lon }, (a.profile || 'safest') as Profile, (a.mobility || 'rover') as Mobility);
        return r.ok ? { distance_km: Math.round(r.distanceKm), est_sols: r.sols, climb_m: Math.round(r.climbM), max_slope_deg: +r.maxSlope.toFixed(1), hazards: r.hazards.length, science_waypoints: r.waypointsSci.length, modeled_gcr_dose_mGy: r.doseTotal?.toFixed(1), caveat: 'strategic 7.4 km corridor; not rover-grade' } : { error: r.reason }; } },
    { name: 'layer_info', description: 'Registry metadata for a dataset id (source, DOI, resolution, coverage, limitations, status). Use id "list" to list ids.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      execute: async ({ id }: any) => id === 'list' ? p.ds.manifest.layers.map(l => [l.id, l.name, l.status]).concat(p.ds.manifest.unavailable.map(u => [u.id, u.name, 'unavailable'])) :
        (p.ds.layer(id) || p.ds.manifest.unavailable.find(u => u.id === id) || { error: 'unknown id' }) },
  ];

  async function send(text: string) {
    if (!text.trim() || !sample || busy) return;
    const next = [...msgs, { role: 'user' as const, content: text }]; setMsgs([...next, { role: 'assistant', content: '…' }]); setInp(''); setBusy(true);
    abort.current = new AbortController();
    const convo = next.map((m, i) => (i === 0 ? { ...m, content: `${SYSTEM}\n\nCurrent UI context: ${p.context}\nInterface language: ${lang}\n\nUser: ${m.content}` } : m));
    try {
      const r = await sample(convo, { tools, signal: abort.current.signal, modelTier: 'default', cache: false,
        onText: ({ text }: any) => setMsgs([...next, { role: 'assistant', content: text }]) });
      setMsgs([...next, { role: 'assistant', content: r.text }]);
    } catch (e: any) {
      setMsgs([...next, { role: 'assistant', content: e?.code === 'not_granted' ? t('ai_off') : e?.code === 'rate_limited' ? 'Rate limited — try again shortly.' : `Error: ${e?.message || e}` }]);
      if (e?.code === 'not_granted') setSample(null);
    } finally { setBusy(false); }
  }

  return;
}
