"""SWIM ice consistency, IAU nomenclature and rover tracks/images.

SWIM  : SWIM4MIM_Ci_{0_1,1_5,5}.tif  (Mars Subsurface Water Ice Mapping, PSI; Morgan et al. 2021,
        2025). 20 ppd equicylindrical, lon -180..180, lat 60N..60S, value = ice consistency -1..+1.
        Re-gridded by block-mean to 4 ppd (5x5) and embedded in a global 0..360 grid (nodata outside).
Names : MARS_nomenclature_center_pts.dbf (IAU/USGS Gazetteer of Planetary Nomenclature).
Rovers: MMGIS waypoints/traverses for Mars 2020 (Perseverance) and MSL (Curiosity), NASA/JPL.
Images: real Perseverance raw images (NASA/JPL-Caltech/ASU), positioned at the rover waypoint
        whose site/drive (RMC) matches the image metadata. The rover position is known; the
        imaged target location is NOT computed (no range data), only the mast azimuth.
"""
import json, os, struct, sys, shutil, glob
import numpy as np
from common import write_grid, save_json, block_reduce


def swim(srcdir, outdir):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    meta = {}
    for tag in ('0_1', '1_5', '5'):
        p = os.path.join(srcdir, f'SWIM4MIM_Ci_{tag}.tif')
        if not os.path.exists(p):
            continue
        a = np.array(Image.open(p), dtype=np.float32)
        a[(a <= -29) | ~np.isfinite(a)] = np.nan
        assert a.shape == (2400, 7200)
        r = block_reduce(a, 5, 'mean')            # 480 x 1440, 4 ppd, lat 60..-60, lon -180..180
        r = np.roll(r, -r.shape[1] // 2, axis=1)    # -> lon 0..360
        full = np.full((720, 1440), np.nan, np.float32)
        full[120:600] = r                           # rows for lat 60N..60S at 4 ppd
        q = np.where(np.isnan(full), -32768, np.round(full * 10000)).astype(np.int16)
        meta[tag] = write_grid(outdir, f'swim_ci_{tag}_4ppd.bin', q, 'int16', scale=1e-4, nodata=-32768, ppd=4,
                               units='ice consistency (-1..1)')
        meta[tag]['stats'] = [float(np.nanmin(r)), float(np.nanmax(r)), float(np.nanmean(r))]
    return meta


def read_dbf(path):
    b = open(path, 'rb').read()
    n, hlen, rlen = struct.unpack('<IHH', b[4:12])
    fields, off = [], 32
    while b[off] != 0x0D:
        name = b[off:off + 11].split(b'\0')[0].decode('latin-1')
        typ = chr(b[off + 11]); ln = b[off + 16]
        fields.append((name, typ, ln)); off += 32
    rows = []
    for i in range(n):
        rec = b[hlen + i * rlen: hlen + (i + 1) * rlen]
        if rec[:1] == b'*':
            continue
        p, row = 1, {}
        for name, typ, ln in fields:
            v = rec[p:p + ln].decode('utf-8', 'replace').strip(); p += ln
            if typ in 'NF':
                try: v = float(v)
                except ValueError: v = None
            row[name] = v
        rows.append(row)
    return fields, rows


def names(dbf, outdir):
    fields, rows = read_dbf(dbf)
    keep = []
    for r in rows:
        if (r.get('approval') or r.get('APPROVAL') or '').lower().startswith('drop'):
            continue
        g = {k.lower(): v for k, v in r.items()}
        lat, lon = g.get('center_lat'), g.get('center_lon')
        if lat is None or lon is None:
            continue
        keep.append([g.get('clean_name') or g.get('name'), round(lat, 4), round(lon % 360, 4),
                     round(g.get('diameter') or 0, 1), g.get('type', ''), g.get('origin', '')[:160]])
    keep.sort(key=lambda x: -x[3])
    save_json(os.path.join(outdir, 'names.json'), {'fields': ['name', 'lat', 'lon_e', 'diameter_km', 'type', 'origin'],
                                                    'source_fields': [f[0] for f in fields], 'features': keep})
    return len(keep), [f[0] for f in fields]


def rovers(srcdir, outdir):
    out = {}
    for rover, wp, tr in (('perseverance', 'MESIS_M20_waypoints.json', 'MESIS_M20_traverse.json'),
                          ('curiosity', 'MESIS_MSL_waypoints.json', 'MESIS_MSL_traverse.json')):
        w = json.load(open(os.path.join(srcdir, wp), encoding='utf-8'))
        pts = []
        for f in w['features']:
            p = f['properties']
            lon, lat = (p.get('lon'), p.get('lat')) if p.get('lon') is not None else f['geometry']['coordinates'][:2]
            pts.append({'rmc': p.get('RMC'), 'site': p.get('site'), 'drive': p.get('drive'), 'sol': p.get('sol'),
                        'lat': round(lat, 6), 'lon': round(lon % 360, 6), 'elev_m': p.get('elev_geoid')})
        pts.sort(key=lambda x: (x['sol'] or 0, x['site'] or 0, x['drive'] or 0))
        t = json.load(open(os.path.join(srcdir, tr), encoding='utf-8'))
        line = []
        for f in t['features']:
            g = f['geometry']
            parts = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
            for part in parts:
                for c in part[::3]:   # thin vertices (3x) for display; waypoints keep full precision
                    line.append([round(c[0] % 360, 5), round(c[1], 5)])
        out[rover] = {'waypoints': pts, 'track': line, 'last': pts[-1],
                      'first': pts[0], 'sol_range': [pts[0]['sol'], pts[-1]['sol']]}
    return out


def images(srcdir, outdir, rv):
    cat = json.load(open(os.path.join(srcdir, 'MESIS_m20_image_catalog.json'), encoding='utf-8'))
    by_rmc = {(w['site'], w['drive']): w for w in rv['perseverance']['waypoints']}
    os.makedirs(os.path.join(outdir, 'img'), exist_ok=True)
    keep = []
    for c in cat:
        src = os.path.join(srcdir, 'MESIS_IMG_' + c['file'])
        if not os.path.exists(src) or os.path.getsize(src) < 3000:   # drop tiny/blank subframes
            continue
        w = by_rmc.get((c['site'], c['drive']))
        exact = w is not None
        if w is None:  # fall back to the latest waypoint at or before this site (flagged approximate)
            cands = [x for x in rv['perseverance']['waypoints'] if (x['site'], x['drive']) <= (c['site'], c['drive'])]
            w = cands[-1] if cands else None
        if w is None:
            continue
        shutil.copy(src, os.path.join(outdir, 'img', c['file']))
        c.update({'rover_lat': w['lat'], 'rover_lon': w['lon'], 'position_match': 'exact site/drive' if exact else
                  'nearest earlier waypoint (approximate)', 'target_location': 'not computed (no range data)'})
        keep.append(c)
    return keep


def main(rawswim, rawnames, downloads, outdir):
    meta = {'swim': swim(rawswim, outdir)}
    meta['names_count'], meta['names_fields'] = names(os.path.join(rawnames, 'MARS_nomenclature_center_pts.dbf'), outdir)
    rv = rovers(downloads, outdir)
    rv['images'] = images(downloads, outdir, rv)
    save_json(os.path.join(outdir, 'rovers.json'), rv)
    meta['rovers'] = {k: {'waypoints': len(v['waypoints']), 'track_pts': len(v['track']), 'sols': v['sol_range']}
                      for k, v in rv.items() if k != 'images'}
    meta['images'] = len(rv['images'])
    save_json(os.path.join(outdir, 'ice_names_rovers_meta.json'), meta)
    print(json.dumps(meta, indent=1)[:2500])


if __name__ == '__main__':
    main(*sys.argv[1:5])
