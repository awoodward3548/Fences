"""Tiny painter's-algorithm renderer for the OBJ files written by
run_builds.rb --obj. Produces shaded PNGs for a quick visual check.

    python3 test/render_obj.py test/out/montage_plus__majestic.obj out.png [az el zoom cx cy cz]
"""
import math
import sys
from PIL import Image, ImageDraw


def load(path):
    mtl = {}
    try:
        cur = None
        for line in open(path[:-4] + '.mtl'):
            p = line.split()
            if not p:
                continue
            if p[0] == 'newmtl':
                cur = p[1]
                mtl[cur] = [0.6, 0.6, 0.6, 1.0]
            elif p[0] == 'Kd':
                mtl[cur][:3] = [float(v) for v in p[1:4]]
            elif p[0] == 'd':
                mtl[cur][3] = float(p[1])
    except OSError:
        pass
    verts, faces, cur = [], [], None
    for line in open(path):
        p = line.split()
        if not p:
            continue
        if p[0] == 'v':
            verts.append([float(v) for v in p[1:4]])
        elif p[0] == 'usemtl':
            cur = p[1]
        elif p[0] == 'f':
            faces.append(([verts[int(i) - 1] for i in p[1:]], mtl.get(cur, [0.6, 0.6, 0.6, 1.0])))
    return faces


def render(path, out, az=-35, el=28, zoom=1.0, center=None, size=(1400, 900)):
    faces = load(path)
    a, e = math.radians(az), math.radians(el)
    # OBJ is y-up; build camera basis
    fwd = [math.cos(e) * math.sin(a), -math.sin(e), -math.cos(e) * math.cos(a)]
    right = [math.cos(a), 0, math.sin(a)]
    up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]]
    light = [0.4, 0.8, 0.45]
    ln = math.sqrt(sum(v * v for v in light))
    light = [v / ln for v in light]
    allp = [p for f, _ in faces for p in f]
    if center is None:
        center = [(min(p[i] for p in allp) + max(p[i] for p in allp)) / 2 for i in range(3)]
    proj = lambda p: (sum((p[i] - center[i]) * right[i] for i in range(3)),
                      sum((p[i] - center[i]) * up[i] for i in range(3)),
                      sum((p[i] - center[i]) * fwd[i] for i in range(3)))
    pf = []
    for pts, col in faces:
        q = [proj(p) for p in pts]
        if len(pts) < 3:
            continue
        u = [pts[1][i] - pts[0][i] for i in range(3)]
        v = [pts[2][i] - pts[0][i] for i in range(3)]
        nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        l = math.sqrt(sum(x * x for x in nrm)) or 1
        nrm = [x / l for x in nrm]
        shade = 0.45 + 0.55 * abs(sum(nrm[i] * light[i] for i in range(3)))
        depth = sum(p[2] for p in q) / len(q)
        pf.append((depth, q, col, shade))
    xs = [p[0] for _, q, _, _ in pf for p in q]
    ys = [p[1] for _, q, _, _ in pf for p in q]
    w, h = size
    sc = min(w / (max(xs) - min(xs) + 1e-6), h / (max(ys) - min(ys) + 1e-6)) * 0.92 * zoom
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    img = Image.new('RGB', size, (236, 240, 245))
    dr = ImageDraw.Draw(img, 'RGBA')
    pf.sort(key=lambda t: -t[0])
    for _, q, col, shade in pf:
        pts = [(w / 2 + (p[0] - cx) * sc, h / 2 - (p[1] - cy) * sc) for p in q]
        c = tuple(int(min(255, col[i] * 255 * shade)) for i in range(3)) + (int(col[3] * 255),)
        dr.polygon(pts, fill=c, outline=(0, 0, 0, 40))
    img.save(out)


if __name__ == '__main__':
    args = sys.argv[1:]
    extra = [float(v) for v in args[2:]]
    az = extra[0] if len(extra) > 0 else -35
    el = extra[1] if len(extra) > 1 else 28
    zoom = extra[2] if len(extra) > 2 else 1.0
    center = extra[3:6] if len(extra) >= 6 else None
    render(args[0], args[1], az, el, zoom, center)
