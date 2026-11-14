"""MOLA MEGDR terrain products.

Input : megt90n000eb.img  (MGS-M-MOLA-5-MEGDR-L3-V1.0, 16 pixels/degree, MSB int16 metres
        relative to the MOLA areoid, 5760 x 2880, row 0 centred at 89.96875N, col 0 at 0.03125E)
Output: (8 ppd grids, ~7.4 km/pixel at the equator)
  dem_8ppd.bin        int16  elevation (m)                         [Published -> resampled]
  slope_8ppd.bin      uint8  max slope inside the 8ppd cell, deg*4  [Derived]
  rough_8ppd.bin      uint8  std-dev of 16ppd elevations in cell /8 m [Derived]
  dem_2ppd.bin        int16  overview elevation for fast global scans
  basemap_8ppd.jpg    colour-shaded relief (visualisation only)
Slope is computed on the native 16 ppd grid (~3.7 km) with metric pixel spacing
(dx = R*cos(lat)*dlon, dy = R*dlat). A 3.7 km baseline smooths metre-scale hazards:
the slope layer is a *regional* terrain indicator, not a rover-traverse safety product.
"""
import os, sys, math
import numpy as np
from common import MARS_R_M, write_grid, block_reduce, save_json


def load_megdr(path, ppd=16):
    a = np.fromfile(path, dtype='>i2')
    W, H = 360 * ppd, 180 * ppd
    assert a.size == W * H, f'unexpected size {a.size}, expected {W*H}'
    return a.reshape(H, W).astype(np.float32)


def slope_deg(dem, ppd):
    H, W = dem.shape
    lat = 90 - (np.arange(H) + 0.5) / ppd
    d = math.radians(1 / ppd)
    dy = MARS_R_M * d
    dx = np.maximum(MARS_R_M * np.cos(np.radians(lat)) * d, 1000.0)[:, None]  # avoid polar convergence artefacts
    gx = (np.roll(dem, -1, 1) - np.roll(dem, 1, 1)) / (2 * dx)
    gy = np.zeros_like(dem)
    gy[1:-1] = (dem[:-2] - dem[2:]) / (2 * dy)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def hillshade(dem, ppd, az=315, alt=35, z=3.0):
    H, W = dem.shape
    lat = 90 - (np.arange(H) + 0.5) / ppd
    d = math.radians(1 / ppd)
    dx = np.maximum(MARS_R_M * np.cos(np.radians(lat)) * d, 50.0)[:, None]
    dy = MARS_R_M * d
    gx = (np.roll(dem, -1, 1) - np.roll(dem, 1, 1)) / (2 * dx) * z
    gy = np.zeros_like(dem); gy[1:-1] = (dem[:-2] - dem[2:]) / (2 * dy) * z
    slope = np.arctan(np.hypot(gx, gy)); aspect = np.arctan2(gy, -gx)
    a, al = math.radians(360 - az + 90), math.radians(alt)
    hs = np.sin(al) * np.cos(slope) + np.cos(al) * np.sin(slope) * np.cos(a - aspect)
    return np.clip(hs, 0, 1)


def basemap(dem8, ppd, path):
    from PIL import Image
    # perceptual-ish elevation ramp (low = deep blue-grey, mid = ochre, high = pale)
    stops = np.array([-8200, -5000, -3000, -1000, 1000, 3000, 6000, 12000, 21300], float)
    cols = np.array([[30, 40, 70], [55, 70, 105], [110, 95, 85], [150, 105, 70], [180, 125, 80],
                     [200, 150, 105], [215, 180, 145], [235, 215, 195], [250, 245, 240]], float)
    e = np.clip(dem8, stops[0], stops[-1])
    rgb = np.stack([np.interp(e, stops, cols[:, k]) for k in range(3)], -1)
    hs = hillshade(dem8, ppd)[..., None]
    img = rgb * (0.35 + 0.8 * hs)
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path, quality=86, optimize=True)


def main(src, outdir):
    dem16 = load_megdr(src)
    s16 = slope_deg(dem16, 16)
    dem8 = block_reduce(dem16, 2, 'mean')
    slope8 = block_reduce(s16, 2, 'max')
    rough8 = block_reduce(dem16, 2, 'std')
    # std of 4 samples underestimates; use local 3x3 std at 16ppd for a steadier roughness index
    from numpy.lib.stride_tricks import sliding_window_view
    pad = np.pad(dem16, ((1, 1), (1, 1)), mode='edge')
    win = sliding_window_view(pad, (3, 3)).reshape(dem16.shape[0], dem16.shape[1], 9)
    r16 = win.std(axis=-1)
    rough8 = block_reduce(r16, 2, 'mean')
    dem2 = block_reduce(dem16, 8, 'mean')
    out = {}
    out['dem'] = write_grid(outdir, 'dem_8ppd.bin', np.round(dem8), 'int16', ppd=8, units='m')
    out['slope'] = write_grid(outdir, 'slope_8ppd.bin', np.clip(np.round(slope8 * 4), 0, 255), 'uint8', scale=0.25, ppd=8, units='deg')
    out['rough'] = write_grid(outdir, 'rough_8ppd.bin', np.clip(np.round(rough8 / 8), 0, 255), 'uint8', scale=8, ppd=8, units='m')
    out['dem2'] = write_grid(outdir, 'dem_2ppd.bin', np.round(dem2), 'int16', ppd=2, units='m')
    basemap(dem8, 8, os.path.join(outdir, 'basemap_8ppd.jpg'))
    stats = {k: {'min': float(v.min()), 'max': float(v.max()), 'mean': float(v.mean())}
             for k, v in [('dem8_m', dem8), ('slope8_deg', slope8), ('rough8_m', rough8)]}
    out['stats'] = stats
    save_json(os.path.join(outdir, 'mola_meta.json'), out)
    print(stats)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
