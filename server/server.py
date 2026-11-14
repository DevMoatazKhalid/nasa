"""MESIS local server: static site + JSON API over the same data package.

    python3 server/server.py [--port 8000] [--dist web/dist]

Endpoints
  GET /api/health                      -> {"ok": true, "layers": N}
  GET /api/registry                    -> the central data registry (manifest.json)
  GET /api/point?lat=18.4&lon=77.5     -> every gridded layer sampled at the point, with status/units
                                          (null + status 'unavailable' where the source has no data)
  GET /api/craters?lat=..&lon=..&km=50 -> craters (centre within radius), nearest first
Everything else is served from the built site. Only the Python standard library and numpy are needed.
"""
import argparse, gzip, json, math, os, sys
from functools import lru_cache
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import numpy as np

DT = {'int16': '<i2', 'uint16': '<u2', 'uint8': 'u1', 'float32': '<f4'}
R_KM = 3389.5


def _read_gz(root, file):
    """Read <file>.gz, or the base64 <file>.gz.json variant shipped with the hosted site."""
    import base64
    p = os.path.join(root, file + '.gz')
    if os.path.exists(p):
        return gzip.open(p).read()
    return gzip.decompress(base64.b64decode(json.load(open(p + '.json'))))


class Package:
    def __init__(self, root):
        self.root = root
        self.manifest = json.load(open(os.path.join(root, 'manifest.json'), encoding='utf-8'))

    @lru_cache(maxsize=64)
    def grid(self, file, dtype, h, w):
        return np.frombuffer(_read_gz(self.root, file), DT[dtype]).reshape(h, w)

    def sample(self, L, lat, lon):
        g = L['grid']
        a = self.grid(g['file'], g['dtype'], g['height'], g['width'])
        r = min(g['height'] - 1, max(0, int((90 - lat) * g['ppd'])))
        c = int((lon % 360) * g['ppd']) % g['width']
        v = a[r, c].item()
        if g['nodata'] is not None and v == g['nodata'] or (isinstance(v, float) and math.isnan(v)):
            return None
        return v * g['scale'] + g['offset']

    def point(self, lat, lon):
        out = {}
        for L in self.manifest['layers']:
            if not L['grid']:
                continue
            v = self.sample(L, lat, lon)
            out[L['id']] = {'value': None if v is None else round(v, 6), 'units': L['units'],
                            'status': 'unavailable' if v is None else L['status'], 'name': L['name']}
        return {'lat': lat, 'lon': lon % 360, 'archival_not_live': True, 'values': out}

    @lru_cache(maxsize=1)
    def craters(self):
        raw = _read_gz(self.root, 'craters.bin')
        rec = np.frombuffer(raw, dtype=[('lat', '<f4'), ('lon', '<f4'), ('d', '<f4'), ('conf', 'u1'), ('deg', 'u1'), ('fl', 'u1'), ('pad', 'u1')])
        return rec

    def craters_near(self, lat, lon, km):
        c = self.craters()
        p1, p2 = math.radians(lat), np.radians(c['lat'])
        dl = np.radians(c['lon'] - lon)
        a = np.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
        d = 2 * R_KM * np.arcsin(np.minimum(1, np.sqrt(a)))
        idx = np.where(d <= km)[0]
        idx = idx[np.argsort(d[idx])][:500]
        return [{'lat': float(c['lat'][i]), 'lon': float(c['lon'][i]), 'diameter_km': float(c['d'][i]), 'distance_km': float(d[i])} for i in idx]


def make_handler(pkg, dist):
    class H(SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=dist, **k)

        def _json(self, obj, code=200):
            b = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

        def do_GET(self):
            u = urlparse(self.path)
            if not u.path.startswith('/api/'):
                return super().do_GET()
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            try:
                if u.path == '/api/health':
                    return self._json({'ok': True, 'layers': len(pkg.manifest['layers'])})
                if u.path == '/api/registry':
                    return self._json(pkg.manifest)
                lat, lon = float(q['lat']), float(q['lon'])
                if not (-90 <= lat <= 90):
                    return self._json({'error': 'lat out of range'}, 400)
                if u.path == '/api/point':
                    return self._json(pkg.point(lat, lon))
                if u.path == '/api/craters':
                    return self._json({'craters': pkg.craters_near(lat, lon, min(500.0, float(q.get('km', 50))))})
                return self._json({'error': 'unknown endpoint'}, 404)
            except (KeyError, ValueError) as e:
                return self._json({'error': f'bad request: {e}'}, 400)

        def log_message(self, fmt, *args):
            sys.stderr.write('[mesis] ' + fmt % args + '\n')
    return H


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=int(os.environ.get('MESIS_PORT', 8000)))
    ap.add_argument('--dist', default=os.environ.get('MESIS_DIST', os.path.join(here, '..', 'web', 'dist')))
    canon = os.path.join(here, '..', 'web', 'public', 'data')
    if not os.path.exists(os.path.join(canon, 'dem_8ppd.bin.gz')):
        canon = os.path.join(here, '..', 'web', 'dist', 'data')
    ap.add_argument('--data', default=os.environ.get('MESIS_DATA', canon),
                    help='canonical data package (gzip grids) used by the API')
    a = ap.parse_args()
    pkg = Package(a.data)
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), make_handler(pkg, a.dist))
    print(f'MESIS running at http://127.0.0.1:{a.port}/  (API under /api/)')
    srv.serve_forever()


if __name__ == '__main__':
    main()
