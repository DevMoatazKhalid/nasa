"""Shared helpers for the MESIS data pipeline.

Grid convention used everywhere in the processed data package:
  * simple cylindrical (equirectangular), planetocentric latitude, east-positive longitude 0..360
  * row 0 is the northernmost row; cell (r, c) covers
        lat in [90 - (r+1)*d, 90 - r*d],  lon in [c*d, (c+1)*d]
  * Mars sphere radius 3389.5 km (IAU 2000 mean radius) for distances/areas
"""
import json, math, os
import numpy as np

MARS_R_M = 3389500.0
MARS_R_KM = 3389.5


def write_grid(outdir, name, arr, dtype, scale=1.0, offset=0.0, nodata=None, ppd=8, units='', extra=None):
    """Write a little-endian grid + return the manifest 'grid' block."""
    os.makedirs(outdir, exist_ok=True)
    a = np.asarray(arr)
    a.astype(np.dtype(dtype).newbyteorder('<')).tofile(os.path.join(outdir, name))
    g = {'file': name, 'dtype': dtype, 'width': int(a.shape[1]), 'height': int(a.shape[0]), 'ppd': ppd,
         'lon0': 0.0, 'lat0': 90.0, 'scale': scale, 'offset': offset, 'nodata': nodata, 'units': units}
    if extra:
        g.update(extra)
    return g


def block_reduce(a, f, how='mean', nodata=None):
    """Reduce an (H, W) array by integer factor f; nodata-aware mean/max/min/std."""
    H, W = a.shape
    b = a[:H - H % f, :W - W % f].reshape(H // f, f, W // f, f).astype(np.float64)
    if nodata is not None:
        m = np.isclose(b, nodata) | ~np.isfinite(b)
        b = np.where(m, np.nan, b)
    with np.errstate(all='ignore'):
        if how == 'mean':
            r = np.nanmean(b, axis=(1, 3))
        elif how == 'max':
            r = np.nanmax(b, axis=(1, 3))
        elif how == 'min':
            r = np.nanmin(b, axis=(1, 3))
        elif how == 'std':
            r = np.nanstd(b, axis=(1, 3))
        elif how == 'mode':
            # categorical: most frequent value per block
            bb = b.transpose(0, 2, 1, 3).reshape(H // f, W // f, f * f)
            r = np.zeros((H // f, W // f))
            for i in range(H // f):
                for j in range(W // f):
                    v = bb[i, j][~np.isnan(bb[i, j])]
                    r[i, j] = np.bincount(v.astype(int)).argmax() if v.size else np.nan
        else:
            raise ValueError(how)
    return r


def roll_to_0_360(a):
    """Convert a grid whose first column is at -180E to one starting at 0E."""
    return np.roll(a, -a.shape[1] // 2, axis=1)


def parse_vicar(path):
    """Minimal VICAR reader (single band, BSQ, REAL/HALF/BYTE). Returns (array, header dict)."""
    raw = open(path, 'rb').read()
    head = raw[:4096].decode('latin-1')
    lblsize = int(head.split('LBLSIZE=')[1].split()[0])
    hdr_txt = raw[:lblsize].decode('latin-1')
    hdr = {}
    import shlex
    try:
        toks = shlex.split(hdr_txt.replace('\x00', ' '), posix=True)
    except ValueError:
        toks = hdr_txt.split()
    for t in toks:
        if '=' in t:
            k, v = t.split('=', 1)
            hdr.setdefault(k, v)
    nl, ns, nb = int(hdr['NL']), int(hdr['NS']), int(hdr.get('NB', 1))
    fmt = hdr.get('FORMAT', 'REAL').strip("'")
    realfmt = hdr.get('REALFMT', 'RIEEE').strip("'")
    intfmt = hdr.get('INTFMT', 'LOW').strip("'")
    nbb = int(hdr.get('NBB', 0))
    if fmt == 'REAL':
        dt = '<f4' if realfmt == 'RIEEE' else '>f4'
    elif fmt == 'HALF':
        dt = '<i2' if intfmt == 'LOW' else '>i2'
    elif fmt == 'DOUB':
        dt = '<f8' if realfmt == 'RIEEE' else '>f8'
    elif fmt == 'FULL':
        dt = '<i4' if intfmt == 'LOW' else '>i4'
    elif fmt == 'BYTE':
        dt = 'u1'
    else:
        raise ValueError('unsupported VICAR format ' + fmt)
    itemsize = np.dtype(dt).itemsize
    recsize = int(hdr.get('RECSIZE', ns * itemsize))
    off = lblsize + int(hdr.get('NLB', 0)) * recsize
    data = np.frombuffer(raw, dtype=np.uint8, count=nl * nb * recsize, offset=off).reshape(nl * nb, recsize)
    data = data[:, nbb:nbb + ns * itemsize].copy().view(dt).reshape(nb, nl, ns)[0]
    return data.astype(np.float32), hdr


def save_json(path, obj):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
