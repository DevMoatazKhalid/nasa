import React, { useState } from 'react';
import { useT, useLang, Badge, LayerInfo } from './common';
import { DataStore } from '../engine/data';
import { Overlay } from './MapView';
import { cssGradient } from './colors';
import { sig } from '../engine/geo';
import { Key } from '../i18n';

const GROUPS: [string, Key][] = [['terrain', 'terrain'], ['environment', 'environment'], ['resources', 'resources'], ['geology', 'geology']];

export function LayerPanel(p: { ds: DataStore; overlays: Overlay[]; setOverlays: (o: Overlay[]) => void;
  toggles: Record<string, boolean>; setToggle: (k: string, v: boolean) => void }) {
  const t = useT(); const lang = useLang(); const [info, setInfo] = useState<string | null>(null);
  const on = (id: string) => p.overlays.find(o => o.id === id);
  const flip = (id: string) => p.setOverlays(on(id) ? p.overlays.filter(o => o.id !== id) : [...p.overlays, { id, opacity: 0.7 }]);
  const setOp = (id: string, v: number) => p.setOverlays(p.overlays.map(o => (o.id === id ? { ...o, opacity: v } : o)));
  const L = info ? p.ds.layer(info) : null;
  const vec: [string, string, string][] = [['names', 'IAU feature names', 'published'], ['craters', 'Impact craters ≥1 km (Robbins 2020)', 'published'],
    ['rovers', 'Rover landing sites, tracks & last positions', 'measured'], ['images', 'Geolocated Perseverance images', 'measured']];
  return <div className="panel-scroll">
    <div className="grp"><h4>{t('base')}</h4>
      <div className="lyr"><label><input type="checkbox" checked readOnly disabled /> MOLA colourised shaded relief (from MEGDR 16 ppd)</label><Badge s="derived" /></div>
      <p className="note">Basemap rendered in this platform from the MOLA elevation grid (visualisation only). THEMIS day/night mosaics and Viking imagery were not integrated: the hosting environment cannot load remote map tiles.</p></div>
    {GROUPS.map(([g, k]) => <div className="grp" key={g}><h4>{t(k)}</h4>
      {p.ds.manifest.layers.filter(l => l.group === g && l.grid).map(l => { const o = on(l.id); return <div className="lyr" key={l.id}>
        <label><input type="checkbox" checked={!!o} onChange={() => flip(l.id)} /> {lang === 'ar' ? l.name_ar : l.name}</label>
        <span className="lyr-r"><Badge s={l.status} /><button className="info" onClick={() => setInfo(l.id)} aria-label="Source and method">i</button></span>
        {o && <div className="lyr-x">
          {l.legend.ramp !== 'cat' && <div className="legend"><div className="bar" style={{ background: cssGradient(l.legend.ramp) }} />
            <div className="lg-t"><span>{sig(l.legend.min!, 3)}</span><span>{l.units}</span><span>{sig(l.legend.max!, 3)}</span></div></div>}
          {l.legend.ramp === 'cat' && <p className="note">Colours are categorical; click the map to identify the unit.</p>}
          <label className="op">{t('opacity')} <input type="range" min={0.1} max={1} step={0.05} value={o.opacity} onChange={e => setOp(l.id, +e.target.value)} /></label>
          <div className="muted small">{t('coverage')}: {l.coverage} · ~{l.resolution_km} km</div></div>}
      </div>; })}
      {g === 'environment' && <div className="lyr"><label><input type="checkbox" disabled /> GCR dose rate (model)</label><span className="lyr-r"><Badge s="modeled" /><button className="info" onClick={() => setInfo('rad')}>i</button></span>
        <div className="muted small">Computed per clicked location from elevation; see Location Intelligence.</div></div>}
    </div>)}
    <div className="grp"><h4>{t('missions')} · {t('geology')}</h4>
      {vec.map(([k, label, s]) => <div className="lyr" key={k}><label><input type="checkbox" checked={!!p.toggles[k]} onChange={e => p.setToggle(k, e.target.checked)} /> {label}</label><Badge s={s as any} /></div>)}</div>
    <div className="grp"><h4>{t('not_integrated')}</h4>
      {p.ds.manifest.unavailable.map(u => <div className="lyr dim" key={u.id}><span>{u.name}</span><Badge s="unavailable" /><div className="muted small">{u.reason}</div></div>)}</div>
    {L && <LayerInfo L={L} onClose={() => setInfo(null)} />}
  </div>;
}
