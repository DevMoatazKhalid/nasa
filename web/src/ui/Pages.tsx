import React, { useEffect, useRef, useState } from 'react';
import { useT, useLang, Badge, Row, Section } from './common';
import { DataStore } from '../engine/data';
import { Engine } from '../engine/query';
import { gcrDose, RAD_MODEL } from '../engine/radiation';
import { fmtCoord } from '../engine/geo';
import { Report, toMarkdown, toHTML } from '../engine/report';
import { STATUS_COLOR } from './colors';

/** Orthographic globe rendered from the MOLA basemap by inverse projection (no decoration: real topography). */
function Globe({ ds, onPick }: { ds: DataStore; onPick: (lat: number, lon: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null); const [lon0, setLon0] = useState(300);
  const src = useRef<ImageData | null>(null);
  useEffect(() => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = 1440; c.height = 720; const x = c.getContext('2d')!;
    x.drawImage(im, 0, 0, 1440, 720); src.current = x.getImageData(0, 0, 1440, 720); setLon0(l => l + 0.0001); }; im.src = ds.base + 'basemap_8ppd.jpg'; }, []);
  useEffect(() => { const red = matchMedia('(prefers-reduced-motion: reduce)').matches; if (red) return;
    const id = setInterval(() => setLon0(l => (l + 0.4) % 360), 60); return () => clearInterval(id); }, []);
  useEffect(() => { const cv = ref.current!, S = cv.width, ctx = cv.getContext('2d')!; const s = src.current; if (!s) return;
    const out = ctx.createImageData(S, S), R = S / 2 - 2, lat0 = 12 * Math.PI / 180, cl = Math.cos(lat0), sl = Math.sin(lat0);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const px = (x - S / 2) / R, py = (S / 2 - y) / R, rho = px * px + py * py; const o = (y * S + x) * 4;
      if (rho > 1) continue; const cz = Math.sqrt(1 - rho); const lat = Math.asin(cz * sl + py * cl); const lon = lon0 * Math.PI / 180 + Math.atan2(px, cz * cl - py * sl);
      const u = Math.floor((((lon * 180 / Math.PI) % 360 + 360) % 360) * 4), v = Math.min(719, Math.floor((90 - lat * 180 / Math.PI) * 4)); const i = (v * 1440 + u) * 4;
      const shade = 0.55 + 0.45 * cz; out.data[o] = s.data[i] * shade; out.data[o + 1] = s.data[i + 1] * shade; out.data[o + 2] = s.data[i + 2] * shade; out.data[o + 3] = 255; }
    ctx.putImageData(out, 0, 0); }, [lon0]);
  return <canvas ref={ref} width={420} height={420} className="globe" aria-label="Rotating Mars globe rendered from MOLA elevation" role="img"
    onClick={e => { const r = (e.target as HTMLCanvasElement).getBoundingClientRect(); const S = 420, R = S / 2 - 2; const px = ((e.clientX - r.left) * S / r.width - S / 2) / R, py = (S / 2 - (e.clientY - r.top) * S / r.height) / R;
      const rho = px * px + py * py; if (rho > 1) return; const lat0 = 12 * Math.PI / 180, cz = Math.sqrt(1 - rho); const lat = Math.asin(cz * Math.sin(lat0) + py * Math.cos(lat0));
      const lon = lon0 + Math.atan2(px, cz * Math.cos(lat0) - py * Math.sin(lat0)) * 180 / Math.PI; onPick(lat * 180 / Math.PI, lon); }} />;
}

const REGIONS = ['Jezero', 'Gale', 'Arcadia Planitia', 'Deuteronilus Mensae', 'Utopia Planitia', 'Hellas Planitia', 'Olympus Mons', 'Valles Marineris', 'Meridiani Planum', 'Mawrth Vallis', 'Nili Fossae', 'Phlegra Montes'];

export function Overview({ ds, eng, go, pick, recent }: { ds: DataStore; eng: Engine; go: (r: string) => void; pick: (lat: number, lon: number, name?: string) => void; recent: any[] }) {
  const t = useT(); const m = ds.manifest;
  const counts: Record<string, number> = {}; m.layers.forEach(l => (counts[l.status] = (counts[l.status] || 0) + 1));
  counts.unavailable = m.unavailable.length;
  const regions = REGIONS.map(n => eng.places.find(p => p.name === n)).filter(Boolean) as any[];
  return <div className="page">
    <section className="hero">
      <div className="hero-t"><h1>{t('app')}</h1>
        <p className="lede">{t('overview_lede')}</p>
        <div className="actions"><button className="btn primary" onClick={() => go('missions')}>{t('start_mission')}</button><button className="btn" onClick={() => go('explorer')}>{t('exploring')}</button></div>
        <div className="stat-row">{Object.entries(counts).map(([s, n]) => <div key={s} className="stat" style={{ borderColor: STATUS_COLOR[s] }}><span className="num big">{n}</span><Badge s={s as any} /></div>)}
          <div className="stat"><span className="num big">{eng.craters.length.toLocaleString()}</span><span className="muted small">craters</span></div>
          <div className="stat"><span className="num big">{eng.places.length.toLocaleString()}</span><span className="muted small">named features</span></div></div>
        <p className="muted small">{t('synthetic_none')}</p>
      </div>
      <div className="hero-p"><Globe ds={ds} onPick={(la, lo) => pick(la, lo)} /><p className="muted small center">MOLA topography · click the globe to analyse a point</p></div>
    </section>
    <section className="band two-col">
      <div><h2>{t('regions')}</h2><div className="reg-grid">{regions.map(p => <button key={p.name} className="reg" onClick={() => pick(p.lat, p.lon, p.name)}>
        <b>{p.name}</b><span className="muted num small">{fmtCoord(p.lat, p.lon)}</span><span className="muted small">{p.type}</span></button>)}</div></div>
      <div><h2>{t('recent')}</h2>{recent.length ? <ul className="plain">{recent.map((r, i) => <li key={i}><button className="link" onClick={() => pick(r.lat, r.lon, r.name)}>{r.name || fmtCoord(r.lat, r.lon)}</button></li>)}</ul>
        : <p className="muted">—</p>}
        <h2>{t('key_takeaways')}</h2>
        <ul className="plain small">
          <li>✔ Any coordinate: terrain, thermophysics, ice evidence, mineral abundances, geology, craters, rover proximity.</li>
          <li>✔ Mission-specific ranking with transparent weights and confidence; A* corridors on MOLA slope.</li>
          <li>✘ Not live: all data are archival. ✘ Not rover-grade: 7.4 km terrain cells. ✘ No current dust storms or temperatures.</li>
        </ul></div>
    </section>
  </div>;
}

export function Survival({ ds, sel }: { ds: DataStore; sel: any }) {
  const t = useT(); const here = sel?.elev?.value ?? null; const r = here !== null ? gcrDose(here) : null;
  const insol = sel ? Math.max(0, 586 * Math.cos(sel.lat * Math.PI / 180)) : null;
  return <div className="page narrow">
    <h1>{t('survival_title')}</h1>
    <p className="lede">{t('survival_lede')} {sel ? <>Site values below are for <b>{fmtCoord(sel.lat, sel.lon)}</b>{sel.region ? ` (${sel.region.name})` : ''}.</> : 'Select a location to see site-specific values.'}</p>
    <div className="cards">
      <Section title="Atmosphere"><Row label="Composition (Curiosity SAM)" value="CO₂ 95.1%, N₂ 2.59%, Ar 1.94%, O₂ 0.16%, CO 0.06%" status="measured" note="Franz et al. 2017, Planet. Space Sci. 138 (Gale crater, seasonal mean)." />
        <Row label="Surface pressure here (model)" value={r ? Math.round(r.pressure) : '—'} units="Pa" status="modeled" note={`P = ${RAD_MODEL.P0_Pa} Pa·exp(−z/${RAD_MODEL.H_km} km) from MOLA elevation. Earth sea level ≈ 101,325 Pa; the Armstrong limit (~6,300 Pa) is never reached, so pressure suits are mandatory everywhere.`} />
        <Row label="Column mass here (model)" value={r ? r.column.toFixed(1) : '—'} units="g/cm²" status="modeled" /></Section>
      <Section title="Radiation"><Row label="Measured at Gale (RAD, 2012-13)" value="0.21 ± 0.04 mGy/day · 0.64 ± 0.12 mSv/day" status="measured" note="Hassler et al. 2014, Science 343 — absorbed dose and dose equivalent, GCR-dominated." />
        <Row label="GCR dose here (model)" value={r ? `${r.dose.toFixed(3)} (${r.lo.toFixed(2)}–${r.hi.toFixed(2)})` : '—'} units="mGy/day" status="modeled" />
        <Row label="Dose equivalent per Mars year here (model)" value={r ? Math.round(r.annual_mSv) : '—'} units="mSv" status="modeled" note="Surface only, no shielding, GCR only. For comparison, NASA's astronaut career limit is 600 mSv effective dose (NASA-STD-3001, 2022); transit to and from Mars adds substantially more." />
        <p className="note">Solar particle events add short, intense doses. Zhang et al. (supplied paper) show even the thinnest Martian atmosphere attenuates SEP dose, and that low-elevation sites and subsurface shelter reduce it further. Shielding opportunities: regolith berms (~1–3 m), lava tubes/cave skylights (not mapped here), low-elevation basins.</p></Section>
      <Section title="Temperature & thermal behaviour"><Row label="Gridded surface temperature" value={t('unavailable_here')} status="unavailable" />
        <Row label="Thermal inertia here" value={sel?.ti?.value != null ? Math.round(sel.ti.value) : '—'} units="tiu" status={sel?.ti?.value != null ? 'published' : 'unavailable'}
          note="Low thermal inertia (<~100) means loose dust with large day-night surface temperature swings; high (>~350) indicates rock/indurated ground that buffers temperature." />
        <Row label="Noon insolation, top of atmosphere, equinox (model)" value={insol !== null ? Math.round(insol) : '—'} units="W/m²" status="modeled" note="586 W/m² = solar constant 1361 W/m² ÷ 1.524² (mean distance) × cos(latitude); excludes orbital eccentricity (±~19%) and dust attenuation." /></Section>
      <Section title="Water"><Row label="Ice evidence level here" value={sel ? t(('ice_' + sel.iceEvidence.level) as any) : '—'} status="inferred" />
        <Row label="SWIM ice consistency 0–1 m" value={sel?.s01?.value != null ? sel.s01.value.toFixed(2) : '—'} status={sel?.s01?.value != null ? 'published' : 'unavailable'} />
        <p className="note">The NASA ice-mining assessment (Hoffman et al. 2016, supplied) evaluates drilling/Rodwell approaches for buried ice; mid-latitude debris-covered glaciers (radar-confirmed by SHARAD, Holt et al. 2008) are the most accessible thick ice outside the poles.</p></Section>
      <Section title="Dust"><Row label="Surface dust cover index here" value={sel?.dci?.value != null ? sel.dci.value.toFixed(3) : '—'} status={sel?.dci?.value != null ? 'published' : 'unavailable'} note="< ~0.94: dust-mantled; ~0.97+: dust-poor." />
        <Row label="2018 (MY34) global dust event" value="First MCS signature 2 June 2018 (Ls 186.2°); global by late June (Ls ~198°); decayed by ~October 2018" status="measured" note="Kass et al. 2019, GRL (supplied). Global events do not occur every Mars year; they are a major risk to solar power." /></Section>
      <Section title="Shelter & energy"><Row label="Geologic unit here" value={sel?.unit ? `${sel.unit.unit} (${sel.unit.age})` : '—'} status={sel?.unit ? 'derived' : 'unavailable'} />
        <Row label="Soil bearing capacity / cohesion" value={t('unavailable_here')} status="unavailable" note="No measured global soil-engineering dataset exists; rover-site estimates do not transfer to arbitrary locations." />
        <p className="note">Solar power scales with insolation and atmospheric dust; global dust events can cut surface irradiance for weeks. Nuclear fission power is insensitive to latitude and dust.</p></Section>
    </div>
    <p className="muted small">This module provides environmental and planning intelligence only — not a complete human survival engineering solution.</p>
  </div>;
}

export function DataSources({ ds }: { ds: DataStore }) {
  const t = useT(); const lang = useLang(); const [audit, setAudit] = useState<any>(null);
  useEffect(() => { ds.getJSON('audit.json').then(setAudit); }, []);
  const m = ds.manifest;
  return <div className="page">
    <h1>{t('nav_data')}</h1>
    <p className="lede">{t('data_lede')} Status: <Badge s="measured" /> direct observation · <Badge s="published" /> processed product from a science team · <Badge s="derived" /> computed here from a published product · <Badge s="modeled" /> documented model · <Badge s="inferred" /> interpretation · <Badge s="unavailable" /> no suitable data. {m.note}</p>
    <div className="scroll"><table className="reg stack"><thead><tr><th>Layer</th><th>{t('status')}</th><th>{t('source')}</th><th>{t('resolution')}</th><th>{t('coverage')}</th><th>{t('temporal')}</th><th>{t('processing')} · {t('limitations')}</th></tr></thead>
      <tbody>{m.layers.map(l => <tr key={l.id}><td data-l="Layer"><b>{lang === 'ar' ? l.name_ar : l.name}</b><br /><span className="muted small">{l.units}</span></td><td data-l={t('status')}><Badge s={l.status} /></td>
        <td data-l={t('source')} className="small">{l.source.org}{l.source.product ? <><br /><span className="muted">{l.source.product}</span></> : null}{l.source.doi ? <><br />doi:{l.source.doi}</> : null}{l.source.url ? <><br /><a href={l.source.url} target="_blank" rel="noreferrer">link</a></> : null}</td>
        <td data-l={t('resolution')} className="num">~{l.resolution_km} km</td><td data-l={t('coverage')} className="small">{l.coverage}</td><td data-l={t('temporal')} className="small">{l.temporal}</td>
        <td data-l={t('processing')} className="small">{l.processing}<br /><span className="muted">{l.limitations}</span></td></tr>)}</tbody></table></div>
    <h2>Vector & point datasets</h2>
    <ul className="plain small">
      <li><Badge s="published" /> Crater catalogue — {m.vectors.craters.meta.records.toLocaleString()} craters ≥1 km, Robbins & Hynek (2012), 2020 release (your file). Centres + diameters; rims not mapped.</li>
      <li><Badge s="published" /> IAU feature names — {m.vectors.names.count.toLocaleString()} features, USGS Gazetteer of Planetary Nomenclature.</li>
      <li><Badge s="measured" /> Rover waypoints & traverses — Perseverance (sols 13–2022) and Curiosity (sols 3–5073), NASA/JPL MMGIS localisations; {m.vectors.rovers.images} real Perseverance raw images positioned by site/drive.</li>
    </ul>
    <h2>{t('not_integrated')}</h2>
    <ul className="plain small">{m.unavailable.map(u => <li key={u.id}><Badge s="unavailable" /> <b>{u.name}</b> — {u.reason} {u.url && <a href={u.url} target="_blank" rel="noreferrer">source</a>}</li>)}</ul>
    {audit && <><h2>{t('user_files')}</h2><p className="small">{audit.drive_folder}</p>
      <div className="scroll"><table className="reg stack"><thead><tr><th>File</th><th>Content</th><th>Use</th></tr></thead><tbody>
        {audit.files.map((f: string[]) => <tr key={f[0]}><td data-l="File" className="small"><b>{f[0]}</b></td><td data-l="Content" className="small">{f[1]}</td><td data-l="Use" className="small">{f[2]}</td></tr>)}</tbody></table></div></>}
    <h2>Credits</h2><p className="small muted">NASA, JPL-Caltech, GSFC (MOLA), Arizona State University (TES, MSFF), University of Arizona & LANL (Odyssey GRS/NS), Planetary Science Institute (SWIM), USGS Astrogeology (SIM 3292, Gazetteer), IAU WGPSN, Robbins & Hynek, PDS Geosciences Node. Data acquired 1997–2026; nothing is live.</p>
  </div>;
}

export function Reports({ reports, sel, setSel, save }: { reports: Report[]; sel: number; setSel: (i: number) => void; save: (name: string, data: string, mime: string) => Promise<boolean> }) {
  const t = useT(); const r = reports[sel]; const [msg, setMsg] = useState('');
  if (!reports.length) return <div className="page narrow"><h1>{t('nav_reports')}</h1><p className="muted">{t('no_reports')}</p></div>;
  const md = r ? toMarkdown(r) : '';
  return <div className="page narrow">
    <h1>{t('nav_reports')}</h1>
    <div className="rep-list">{reports.map((x, i) => <button key={x.id} className={i === sel ? 'on' : ''} onClick={() => setSel(i)}>{x.title}<br /><span className="muted small">{x.created.slice(0, 16).replace('T', ' ')}</span></button>)}</div>
    {r && <>
      <div className="actions">
        <button className="btn" onClick={async () => setMsg((await save(`${r.id}.html`, toHTML(r, md), 'text/html')) ? '✓' : 'Download not available here — use Copy')}>{t('export_html')}</button>
        <button className="btn" onClick={async () => setMsg((await save(`${r.id}.json`, JSON.stringify(r, null, 1), 'application/json')) ? '✓' : 'Download not available here — use Copy')}>{t('export_json')}</button>
        <button className="btn ghost" onClick={async () => { try { await navigator.clipboard.writeText(md); setMsg(t('copied')); } catch { setMsg('Clipboard blocked'); } }}>{t('copy_md')}</button>
        <span className="muted small">{msg}</span></div>
      <p className="muted small">The HTML export is print-ready: open it and print to PDF for a PDF copy.</p>
      <article className="report" dangerouslySetInnerHTML={{ __html: toHTML(r, md).replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, '') }} />
    </>}
  </div>;
}
