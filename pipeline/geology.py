"""USGS SIM 3292 (Tanaka et al. 2014) geologic units -> queryable raster + unit table.

Input : GeoJSON FeatureCollection of the SIM3292 'units' layer (lon/lat degrees), from the USGS
        Astrogeology pygeoapi service (collection mars/sim3292_global_geologic_map/units).
Output: geology_sim3292_8ppd.bin  uint8 unit index (255 = unmapped)
        geology_units.json        index -> {unit, desc, age, group, area_km2}
        geology_preview.png       coloured preview (visualisation only)
The raster is a *derived* product: polygons are rasterised at 8 ppd (~7.4 km), so contacts are
located to within one cell; the source map scale is 1:20,000,000 (stated minimum mappable
feature ~ tens of km), so this does not degrade the source precision materially.
"""
import json, os, sys
import numpy as np
from matplotlib.path import Path
from common import write_grid, save_json

# Age prefixes per SIM 3292 naming convention (pamphlet, 'Unit Names and Labels')
AGE = [('lA', 'Late Amazonian'), ('mA', 'Middle Amazonian'), ('eA', 'Early Amazonian'),
       ('lH', 'Late Hesperian'), ('eH', 'Early Hesperian'), ('lN', 'Late Noachian'),
       ('mN', 'Middle Noachian'), ('eN', 'Early Noachian'), ('AH', 'Amazonian and Hesperian'),
       ('HN', 'Hesperian and Noachian'), ('A', 'Amazonian'), ('H', 'Hesperian'), ('N', 'Noachian')]
GROUP = {'h': 'Highland', 'l': 'Lowland', 't': 'Transition', 'v': 'Volcanic', 'b': 'Basin',
         'p': 'Polar', 'a': 'Apron', 'i': 'Impact'}


def age_of(code):
    for p, name in AGE:
        if code.startswith(p):
            return name, code[len(p):]
    return 'Unknown', code


def rings(geom):
    if geom['type'] == 'Polygon':
        return [geom['coordinates']]
    if geom['type'] == 'MultiPolygon':
        return geom['coordinates']
    return []


def main(src, outdir, ppd=8):
    fc = json.load(open(src, encoding='utf-8'))
    feats = fc['features']
    H, W = 180 * ppd, 360 * ppd
    from PIL import Image, ImageDraw
    SS = 2  # supersample, then take the mode-free nearest (cell-centre) sample
    img = Image.new('L', (W * SS, H * SS), 255)
    draw = ImageDraw.Draw(img)
    units, idx = [], {}
    order = sorted(feats, key=lambda f: -(f['properties'].get('spharea_km') or 0))  # big first, small on top
    for f in order:
        pr = {k.lower(): v for k, v in f['properties'].items()}
        code = pr.get('unit') or '?'
        if code not in idx:
            age, rest = age_of(code)
            idx[code] = len(units)
            units.append({'unit': code, 'desc': pr.get('unitdesc', ''), 'age': age,
                          'group': GROUP.get(rest[:1], 'Other'), 'area_km2': 0.0})
        u = idx[code]
        units[u]['area_km2'] += float(pr.get('spharea_km') or 0)
        for poly in rings(f['geometry']):
            for ri, ring in enumerate(poly):
                xy = np.asarray(ring, float)
                lo = xy[:, 0] % 360.0
                if lo.max() - lo.min() > 180:          # crosses 0/360 seam: draw twice shifted
                    lo = np.where(lo > 180, lo - 360, lo)
                for shift in (0.0, 360.0):
                    px = (lo + shift) * ppd * SS; py = (90 - xy[:, 1]) * ppd * SS
                    if px.max() < 0 or px.min() > W * SS:
                        continue
                    draw.polygon(list(zip(px.tolist(), py.tolist())), fill=(u if ri == 0 else 255))
    big = np.array(img)
    grid = big[SS // 2::SS, SS // 2::SS].copy()   # value at cell centre
    assert len(units) < 255
    g = write_grid(outdir, f'geology_sim3292_{ppd}ppd.bin', grid, 'uint8', nodata=255, ppd=ppd, units='unit index')
    save_json(os.path.join(outdir, 'geology_units.json'), {'grid': g, 'units': units,
              'mapped_fraction': float((grid != 255).mean()), 'features': len(feats)})
    # preview
    from PIL import Image
    rng = np.random.default_rng(3)
    pal = rng.integers(40, 230, (256, 3)).astype(np.uint8); pal[255] = 0
    Image.fromarray(pal[grid]).resize((1440, 720)).save(os.path.join(outdir, 'geology_preview.png'))
    print(len(units), 'units; mapped fraction', float((grid != 255).mean()))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
