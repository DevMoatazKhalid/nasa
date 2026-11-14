"""Crater catalogue preprocessing.

Source: Robbins & Hynek (2012) Mars crater database, 2020 release, craters >= 1 km
("Catalog_Mars_Release_2020_1kmPlus_FullMorphData.csv", supplied by the user).

Outputs (data/processed/):
  craters.bin     little-endian packed records, sorted by diameter descending:
                  float32 lat (planetocentric deg N), float32 lon (deg E, 0-360),
                  float32 diameter (km), uint8 confidence*100, uint8 degradation rim (0-4, 255=n/a),
                  uint8 morph flags, uint8 pad
  craters_meta.json  field description, counts, provenance
  crater_density_1deg.bin  float32 grid 180x360, craters >=1 km per 10^4 km^2 (derived)

Nothing in the source CSV is modified.
"""
import csv, json, math, struct, sys, os
import numpy as np

MARS_R_KM = 3389.5

def main(src, outdir):
    os.makedirs(outdir, exist_ok=True)
    lat, lon, d, conf, deg, flags = [], [], [], [], [], []
    bad = 0
    with open(src, newline='', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            try:
                la = float(row['LAT_CIRC_IMG']); lo = float(row['LON_CIRC_IMG']); di = float(row['DIAM_CIRC_IMG'])
            except (ValueError, KeyError):
                bad += 1; continue
            if not (-90 <= la <= 90 and -360 <= lo <= 360 and di > 0):
                bad += 1; continue
            lo = lo % 360.0
            c = row.get('CONF') or ''
            try: cf = float(c)
            except ValueError: cf = -1
            r = row.get('DEG_RIM') or ''
            try: dg = int(float(r))
            except ValueError: dg = 255
            fl = 0
            if row.get('LAY_NUMBER'): fl |= 1          # layered ejecta present
            im = (row.get('INT_MORPH1') or '') + (row.get('INT_MORPH2') or '') + (row.get('INT_MORPH3') or '')
            if 'Cpx' in im: fl |= 2                    # complex crater morphology
            if 'Floor' in im or 'Floor' in (row.get('INT_MORPH3') or ''): fl |= 4
            lat.append(la); lon.append(lo); d.append(di); conf.append(cf); deg.append(dg); flags.append(fl)
    lat = np.array(lat, np.float32); lon = np.array(lon, np.float32); d = np.array(d, np.float32)
    conf = np.array(conf); deg = np.array(deg, np.uint8); flags = np.array(flags, np.uint8)
    order = np.argsort(-d)
    rec = np.zeros(len(d), dtype=[('lat', '<f4'), ('lon', '<f4'), ('d', '<f4'), ('conf', 'u1'), ('deg', 'u1'), ('fl', 'u1'), ('pad', 'u1')])
    rec['lat'] = lat[order]; rec['lon'] = lon[order]; rec['d'] = d[order]
    rec['conf'] = np.where(conf[order] < 0, 255, np.clip(np.round(conf[order] * 100), 0, 100)).astype(np.uint8)
    rec['deg'] = deg[order]; rec['fl'] = flags[order]
    rec.tofile(os.path.join(outdir, 'craters.bin'))

    # crater density per 1-degree cell, normalised by true cell area (derived product)
    H, W = 180, 360
    cnt = np.zeros((H, W), np.float64)
    iy = np.clip(((90 - lat) // 1).astype(int), 0, H - 1)
    ix = np.clip((lon // 1).astype(int), 0, W - 1)
    np.add.at(cnt, (iy, ix), 1)
    lats_c = 90 - (np.arange(H) + 0.5)
    cell_area = (math.radians(1) * MARS_R_KM) ** 2 * np.cos(np.radians(lats_c))  # km^2
    dens = cnt / cell_area[:, None] * 1e4
    dens.astype('<f4').tofile(os.path.join(outdir, 'crater_density_1deg.bin'))

    meta = {
        'id': 'craters_robbins2020',
        'records': int(len(d)), 'rejected_rows': bad,
        'record_bytes': 16,
        'fields': ['lat float32 deg N planetocentric', 'lon float32 deg E 0-360', 'diameter_km float32 (circle fit)',
                   'confidence uint8 (0-100, 255 unknown)', 'rim_degradation uint8 (1 fresh..4 degraded, 255 n/a)',
                   'flags uint8 (1 layered ejecta, 2 complex interior, 4 floor deposits)', 'pad'],
        'sorted_by': 'diameter desc',
        'diameter_km_range': [float(d.min()), float(d.max())],
        'density_grid': {'file': 'crater_density_1deg.bin', 'shape': [H, W], 'units': 'craters >=1 km per 10^4 km^2',
                         'origin': 'row 0 = 89.5N, col 0 = 0.5E', 'max': float(dens.max()), 'mean': float(dens.mean())},
    }
    json.dump(meta, open(os.path.join(outdir, 'craters_meta.json'), 'w'), indent=1)
    print(json.dumps(meta, indent=1))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
