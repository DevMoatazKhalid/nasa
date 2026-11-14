import React, { useState } from 'react';
import { useT, useLang, Row, Section, Badge, LayerInfo } from './common';
import { DataStore } from '../engine/data';
import { fmtCoord, sig } from '../engine/geo';
import { Key } from '../i18n';

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function LocationPanel({ q, ds, busy, onAI, onReport, aiOn }: { q: any; ds: DataStore; busy: boolean; onAI: () => void; onReport: () => void; aiOn: boolean }) {
  const t = useT(); const lang = useLang();
  const [info, setInfo] = useState<string | null>(null);
  if (busy && !q) return <div className="pad muted">{t('loading')}…</div>;
  if (!q) return <div className="pad empty"><p>{t('click_map')}</p></div>;
  const I = (id: string) => () => setInfo(id);
  const V = (x: any, label: string, id: string, fmtUnits = true) =>
    <Row label={label} value={x.value === null ? t('unavailable_here') : x.text} units={x.value === null || !fmtUnits ? undefined : x.units}
      status={x.status} onInfo={I(id)} note={x.sigma !== undefined ? `±${sig(x.sigma, 2)} (1σ)` : undefined} />;
  const L = info ? ds.layer(info) : null;
  return <div className="panel-scroll">
    <div className="loc-head">
      <div><div className="loc-name">{q.region ? (q.region.within ? q.region.name : `${Math.round(q.region.dist)} ${t('km_from')} ${q.region.name}`) : '—'}</div>
        <div className="muted num">{fmtCoord(q.lat, q.lon)}</div></div>
      <div className="cov"><span className="num">{q.coverage.covered}/{q.coverage.total}</span><span className="muted"> {t('datasets_ok')}</span></div>
    </div>
    <div className="actions">{aiOn && <button className="btn" onClick={onAI}>{t('explain_ai')}</button>}<button className="btn ghost" onClick={onReport}>{t('make_report')}</button></div>
    <Section title={t('overview_sec')}>
      {V(q.elev, t('elevation'), 'dem')}
      <Row label={t('unit')} value={q.unit ? `${q.unit.unit} — ${q.unit.desc}` : t('unavailable_here')} status={q.unit ? 'derived' : 'unavailable'} onInfo={I('geology')} />
      <Row label={t('ice_evidence')} value={t(('ice_' + q.iceEvidence.level) as Key)} status="inferred" />
    </Section>
    <Section title={t('terrain_sec')}>
      {V(q.slope, t('slope'), 'slope')}
      {V(q.rough, t('roughness'), 'rough')}
      <Row label={t('aspect')} value={q.aspect === null ? '—' : `${DIRS[Math.round(q.aspect / 45) % 8]} (${Math.round(q.aspect)}°)`} status="derived" />
      <Row label={t('relief25')} value={q.relief ? Math.round(q.relief.max - q.relief.min) : '—'} units="m" status="derived" />
      {V(q.cd, 'Crater density', 'crater_density')}
      <Row label={t('craters50')} value={q.near.length} status="published" note={q.near.slice(0, 3).map((c: any) => `D ${c.d.toFixed(1)} km @ ${c.dist.toFixed(0)} km`).join(' · ')} />
      {q.inside && <Row label={t('inside_crater')} value={`D ${q.inside.d.toFixed(0)} km`} status="published" note="Centre-distance test against catalogued diameter (rims not mapped)." />}
      <Row label={t('big_craters')} value={q.big.length ? q.big.map((c: any) => `${c.d.toFixed(0)} km`).join(', ') : t('none')} status="published" />
      <Row label={t('mobility')} value={t(('mob_' + q.mobility.level) as Key)} status="derived" note="Index of slope, roughness, rocks and crater count at 7.4 km scale." />
      <Row label={t('construction')} value={q.ti.value === null ? t('unavailable_here') : q.ti.value < 100 ? 'Fine/dusty surface — low bearing confidence' : q.ti.value > 350 ? 'Indurated / rocky surface' : 'Mixed surface'} status="inferred"
        note="Inferred from thermal inertia + rocks; no measured soil engineering data exists for this location." />
    </Section>
    <Section title={t('env_sec')}>
      {V(q.ti, t('ti'), 'ti')}
      {V(q.alb, t('albedo'), 'albedo', false)}
      {V(q.dci, t('dci'), 'dci', false)}
      {V(q.rock, t('rock'), 'rock')}
      <Row label={t('pressure')} value={q.rad ? Math.round(q.rad.pressure) : '—'} units="Pa" status="modeled" onInfo={I('rad')} note="Annual-mean scale-height model; seasonal swing ~±12%." />
      <Row label={t('dose')} value={q.rad ? `${q.rad.dose.toFixed(3)} (${q.rad.lo.toFixed(2)}–${q.rad.hi.toFixed(2)})` : '—'} units="mGy/day" status="modeled" onInfo={I('rad')} note="GCR only; excludes solar particle events. Range = model + solar-cycle uncertainty." />
      <Row label="Surface temperature" value={t('unavailable_here')} status="unavailable" note="No gridded temperature product integrated (see Data & Sources)." />
      <Row label="Dust opacity / storms" value={t('unavailable_here')} status="unavailable" note="Atmospheric dust is time-variable; MCS profiles not gridded in this build." />
    </Section>
    <Section title={t('geo_sec')}>
      <Row label={t('unit')} value={q.unit ? q.unit.unit : '—'} status={q.unit ? 'derived' : 'unavailable'} onInfo={I('geology')} />
      {q.unit && <><Row label="Description" value={q.unit.desc} /><Row label={t('age')} value={q.unit.age} /><Row label={t('group')} value={q.unit.group} /></>}
      <div className="near">{q.places.map((p: any) => <span key={p.name} className="chip">{p.name} <span className="muted num">{Math.round(p.dist)} km</span></span>)}</div>
    </Section>
    <Section title={t('res_sec')}>
      {V(q.s01, t('swim01'), 'swim01', false)}
      {V(q.s15, t('swim15'), 'swim15', false)}
      {V(q.s5, t('swim5'), 'swim5', false)}
      {V(q.h2o, t('grs'), 'grs_h2o')}
      {V(q.ns, t('ns'), 'ns_epi')}
      <p className="note">Hydrogen and ice-consistency values are indirect evidence. Only polar neutron suppression is classed as strong; nothing here is labelled “confirmed ice”.</p>
      <div className="sub">{t('minerals')}</div>
      {q.minerals.map((m: any) => <Row key={m.key} label={(lang === 'ar' ? ds.layer(m.layer)!.name_ar : ds.layer(m.layer)!.name).replace(' abundance (TES)', '')}
        value={m.value === null ? '—' : m.text} status={m.status} onInfo={I(m.layer)} note={m.value !== null && m.value < 0.1 ? 'below typical TES detection limit (~0.10)' : undefined} />)}
    </Section>
    <Section title={t('hist_sec')}>
      {q.hist.rovers.map((r: any) => <Row key={r.rover} label={r.rover === 'perseverance' ? 'Perseverance (Mars 2020)' : 'Curiosity (MSL)'}
        value={`${r.nearestKm < 1 ? r.nearestKm.toFixed(2) : Math.round(r.nearestKm)} km`} status="measured" note={`Nearest waypoint sol ${r.waypoint.sol}; last known position sol ${r.last.sol} (archived track, not live).`} />)}
      <div className="sub">{t('images')}</div>
      {q.hist.images.length ? <div className="imgs">{q.hist.images.slice(0, 6).map((im: any) =>
        <figure key={im.file}><img src={ds.base + 'img/' + im.file} alt={im.title} loading="lazy" />
          <figcaption><b>{im.title}</b><br />{im.date_taken_utc.slice(0, 10)} · {im.instrument} · {im.dist.toFixed(2)} km<br />
            <span className="muted">{t('rover_pos')} · mast az {im.mastAz.toFixed(0)}° · {t('target_nc')}</span><br /><a href={im.link} target="_blank" rel="noreferrer">NASA/JPL</a></figcaption></figure>)}</div>
        : <p className="muted">{t('no_images')}</p>}
    </Section>
    <Section title={t('evid_sec')} open={false}>
      <p className="muted">{q.coverage.covered} / {q.coverage.total} {t('datasets_ok')}. Values marked <Badge s="unavailable" /> are absent from the source data at this coordinate and are not filled from neighbouring locations. All observations are archival (1997–2026), not live conditions.</p>
    </Section>
    {L && <LayerInfo L={L} onClose={() => setInfo(null)} />}
  </div>;
}
