/* Fence elevation renderer (SVG). Mirrors the Ruby geometry closely enough
   to give an accurate front view of a panel or gate for the current settings.
   Plain ES5/ES6 for SketchUp 2017's Chromium 52. */
(function (global) {
  'use strict';

  function n(v, d) { v = parseFloat(v); return isNaN(v) ? (d || 0) : v; }
  function on(v) { return v === true || v === 'true' || v === 1 || v === '1'; }
  var uid = 0;

  function rgbOf(cat, id) {
    var c = cat && cat.colors && cat.colors[id];
    return c ? c.rgb : [40, 40, 40];
  }
  function css(rgb, k) {
    k = k || 1;
    return 'rgb(' + rgb.map(function (v) { return Math.max(0, Math.min(255, Math.round(v * k))); }).join(',') + ')';
  }
  function lum(rgb) { return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255; }

  function fmtLen(inches) {
    var t = Math.round(Math.abs(inches) * 8), ft = Math.floor(t / 96), rem = t - ft * 96;
    var whole = Math.floor(rem / 8), frac = rem % 8, s = ft > 0 ? ft + "' " : '';
    if (frac) {
      var g = frac % 4 === 0 ? 4 : (frac % 2 === 0 ? 2 : 1);
      s += whole + '-' + (frac / g) + '/' + (8 / g) + '"';
    } else { s += whole + '"'; }
    return s.trim();
  }

  function Draw(sw) { this.o = []; this.sw = sw; }
  Draw.prototype.rect = function (x0, z0, x1, z1, fill, stroke, extra) {
    if (x1 < x0) { var t = x0; x0 = x1; x1 = t; }
    if (z1 < z0) { var u = z0; z0 = z1; z1 = u; }
    this.o.push('<rect x="' + x0.toFixed(3) + '" y="' + (-z1).toFixed(3) + '" width="' + (x1 - x0).toFixed(3) +
      '" height="' + (z1 - z0).toFixed(3) + '" fill="' + fill + '" stroke="' + (stroke || 'none') +
      '" stroke-width="' + this.sw + '"' + (extra || '') + '/>');
  };
  Draw.prototype.poly = function (pts, fill, stroke, extra) {
    this.o.push('<polygon points="' + pts.map(function (p) { return p[0].toFixed(3) + ',' + (-p[1]).toFixed(3); }).join(' ') +
      '" fill="' + fill + '" stroke="' + (stroke || 'none') + '" stroke-width="' + this.sw + '" stroke-linejoin="round"' + (extra || '') + '/>');
  };
  Draw.prototype.line = function (x0, z0, x1, z1, stroke, w, extra) {
    this.o.push('<line x1="' + x0.toFixed(3) + '" y1="' + (-z0).toFixed(3) + '" x2="' + x1.toFixed(3) + '" y2="' + (-z1).toFixed(3) +
      '" stroke="' + stroke + '" stroke-width="' + (w || this.sw) + '"' + (extra || '') + '/>');
  };
  Draw.prototype.circle = function (x, z, r, fill, stroke) {
    this.o.push('<circle cx="' + x.toFixed(3) + '" cy="' + (-z).toFixed(3) + '" r="' + r.toFixed(3) + '" fill="' + fill +
      '" stroke="' + (stroke || 'none') + '" stroke-width="' + this.sw + '"/>');
  };
  Draw.prototype.text = function (x, z, str, size, fill, anchor, rot) {
    var tr = rot ? ' transform="rotate(' + rot + ' ' + x.toFixed(2) + ' ' + (-z).toFixed(2) + ')"' : '';
    this.o.push('<text x="' + x.toFixed(2) + '" y="' + (-z).toFixed(2) + '" font-size="' + size.toFixed(2) +
      '" fill="' + fill + '" text-anchor="' + (anchor || 'middle') + '" font-family="Segoe UI, Helvetica, Arial, sans-serif"' + tr + '>' + str + '</text>');
  };
  Draw.prototype.raw = function (s) { this.o.push(s); };

  function layout(span, pw, air) {
    if (span < pw) return [];
    var cnt = air <= 0.01 ? Math.floor(span / pw) : Math.ceil((span - air) / (pw + air));
    if (cnt < 1) cnt = 1;
    while (cnt > 1 && cnt * pw > span) cnt--;
    var gap = (span - cnt * pw) / (cnt + 1), out = [];
    for (var i = 0; i < cnt; i++) out.push(gap * (i + 1) + pw * (i + 0.5));
    return out;
  }

  function curveFn(c) {
    if (!c || !(n(c.h) > 0) || (c.type !== 'convex' && c.type !== 'concave')) return function () { return 0; };
    return function (x) {
      var t = (x + c.x0) / c.cw; t = Math.max(0, Math.min(1, t));
      var v = Math.sin(Math.PI * t) * c.h;
      return c.type === 'concave' ? -v : v;
    };
  }

  // ---------------------------------------------------------------- infill
  function picket(d, s, xc, pw, zb, zt, fill, stroke) {
    var x0 = xc - pw / 2, x1 = xc + pw / 2, f = s.finial;
    if (f === 'dogear') {
      var de = Math.min(pw * 0.18, 1);
      d.poly([[x0, zb], [x1, zb], [x1, zt - de], [x1 - de, zt], [x0 + de, zt], [x0, zt - de]], fill, stroke);
    } else if (f === 'point') {
      var p = pw * 0.5;
      d.poly([[x0, zb], [x1, zb], [x1, zt - p], [xc, zt], [x0, zt - p]], fill, stroke);
    } else if (f === 'gothic') {
      var q = pw * 0.9;
      d.poly([[x0, zb], [x1, zb], [x1, zt - q], [x1 - pw * 0.1, zt - q * 0.5], [xc + pw * 0.18, zt - q * 0.15], [xc, zt],
        [xc - pw * 0.18, zt - q * 0.15], [x0 + pw * 0.1, zt - q * 0.5], [x0, zt - q]], fill, stroke);
    } else {
      d.rect(x0, zb, x1, zt, fill, stroke);
      if (f === 'spear') {
        var hx = pw * 0.65, sh = Math.max(pw * 3.2, 2);
        d.poly([[xc - hx, zt], [xc + hx, zt], [xc, zt + sh]], fill, stroke);
      } else if (f === 'trident') {
        var th = Math.max(pw * 1.6, 1.5);
        [-1, 0, 1].forEach(function (k) {
          var cx = xc + k * pw / 3, h2 = pw / 6;
          d.poly([[cx - h2, zt], [cx + h2, zt], [cx, zt + (k === 0 ? th * 1.4 : th)]], fill, stroke);
        });
      } else if (f === 'pyramid') {
        d.poly([[x0, zt], [x1, zt], [xc, zt + pw * 0.6]], fill, stroke);
      } else if (f === 'ball') {
        d.circle(xc, zt + pw * 0.6, pw * 0.7, fill, stroke);
      }
    }
  }

  function vertical(d, s, X, w, o, col) {
    var h = n(s.height, 72), c = o.clearance, pw = n(s.picket_w, 0.75), air = n(s.air_space, 3.625);
    var rh = n(s.rail_h, 1.75), lat = n(s.lattice_h);
    if (lat < rh * 3) lat = 0;
    var mainTop = h - lat;
    var topExt = (s.top === 'extended' && lat <= 0) ? n(s.top_ext) : 0;
    var botExt = s.bottom === 'extended' ? n(s.bottom_ext) : 0;
    var trTop = mainTop - topExt, brBot = c + botExt;
    var nr = Math.max(parseInt(s.rails, 10) || 2, 2);
    var back = s.rail_mount === 'back';
    var fs = o.frame ? n(s.gate_frame, 1.75) : 0;
    var cv = curveFn(o.curve);
    var step = (trTop - rh - brBot) / (nr - 1);

    function rails() {
      for (var i = 0; i < nr; i++) {
        var zb = brBot + step * i;
        if (i === nr - 1 && lat <= 0 && o.curve && n(o.curve.h) > 0 && o.curve.type !== 'none') {
          var pts = [], k, K = 16;
          for (k = 0; k <= K; k++) { var x = fs + (w - 2 * fs) * k / K; pts.push([X + x, zb + rh + cv(x)]); }
          for (k = K; k >= 0; k--) { var x2 = fs + (w - 2 * fs) * k / K; pts.push([X + x2, zb + cv(x2)]); }
          d.poly(pts, col.frame, col.stroke);
        } else {
          d.rect(X + fs, zb, X + w - fs, zb + rh, col.frame, col.stroke);
        }
      }
    }
    function stiles() {
      if (!o.frame) return;
      d.rect(X, brBot, X + fs, trTop, col.frame, col.stroke);
      d.rect(X + w - fs, brBot, X + w, trTop, col.frame, col.stroke);
      if (on(s.gate_brace)) {
        d.poly([[X + fs, brBot + rh], [X + fs, brBot + rh * 2.4], [X + w - fs, trTop - rh], [X + w - fs, trTop - rh * 2.4]], col.frame, col.stroke);
      }
    }
    var span = w - 2 * fs, fronts = layout(span, pw, air).map(function (x) { return x + fs; });
    var backs = [];
    if (s.layout === 'shadowbox') for (var b = 0; b < fronts.length - 1; b++) backs.push((fronts[b] + fronts[b + 1]) / 2);

    if (back) { rails(); stiles(); }
    var bc = lat > 0 ? function () { return 0; } : cv;
    backs.forEach(function (x) { picket(d, s, X + x, pw, c, mainTop + bc(x), col.infillDark, col.stroke); });
    fronts.forEach(function (x) { picket(d, s, X + x, pw, c, mainTop + bc(x), col.infill, col.stroke); });
    if (on(s.puppy) && s.layout !== 'shadowbox') {
      var ph = n(s.puppy_h, 14);
      for (var p = 0; p < fronts.length - 1; p++) {
        var xm = (fronts[p] + fronts[p + 1]) / 2;
        d.rect(X + xm - pw / 2, c, X + xm + pw / 2, c + ph, col.infill, col.stroke);
      }
    }
    if (!back) { rails(); stiles(); }
    if (lat > 0) {
      d.rect(X + fs, mainTop, X + w - fs, mainTop + rh, col.frame, col.stroke);
      var z0 = mainTop + rh, z1 = h - rh, xx, dip = o.curve && o.curve.type === 'concave' ? n(o.curve.h) : 0;
      for (xx = fs + 1.75; xx < w - fs; xx += 3.5) d.rect(X + xx - 0.6, z0, X + xx + 0.6, z1 + cv(xx), col.infill, col.stroke);
      for (var zz = z0 + 1.75; zz < z1 - dip; zz += 3.5) d.rect(X + fs, zz - 0.6, X + w - fs, zz + 0.6, col.infill, col.stroke);
      var tp = [], K = 16, k;
      for (k = 0; k <= K; k++) { var xa = fs + (w - 2 * fs) * k / K; tp.push([X + xa, h + cv(xa)]); }
      for (k = K; k >= 0; k--) { var xb = fs + (w - 2 * fs) * k / K; tp.push([X + xb, h - rh + cv(xb)]); }
      d.poly(tp, col.frame, col.stroke);
    }
    if (on(s.cap)) {
      d.rect(X - (o.frame ? 0 : 0.5), h, X + w + (o.frame ? 0 : 0.5), h + n(s.cap_t, 1.5), col.frame, col.stroke);
      if (on(s.trim)) d.rect(X, h - 3.5, X + w, h, col.frame, col.stroke);
    }
  }

  function horizontal(d, s, X, w, o, col) {
    var h = n(s.height, 48), c = o.clearance, bh = n(s.board_h, 5.5), gap = n(s.board_gap, 0.5);
    var cnt = parseInt(s.h_count, 10) || 0, mount = s.h_mount || 'face';
    var fs = o.frame ? n(s.gate_frame, 3.5) : 0;
    var x0, x1;
    if (o.frame) { x0 = fs; x1 = w - fs; } else if (mount === 'between') { x0 = 0; x1 = w; } else { x0 = -o.extA; x1 = w + o.extB; }
    var zs = [];
    if (cnt > 0) {
      var top = h - bh, bot = c + n(s.bottom_ext);
      if (cnt === 1) zs.push(top); else for (var i = 0; i < cnt; i++) zs.push(bot + (top - bot) * i / (cnt - 1));
    } else {
      for (var z = h - bh; z >= c - 1e-6; z -= bh + gap) zs.push(z);
    }
    if (o.frame) {
      d.rect(X, c, X + fs, h, col.frame, col.stroke);
      d.rect(X + w - fs, c, X + w, h, col.frame, col.stroke);
    }
    zs.forEach(function (zb) { d.rect(X + x0, zb, X + x1, zb + bh, col.infill, col.stroke); });
    if (o.frame && (on(s.gate_brace) || mount === 'face')) {
      d.poly([[X + x0, c + 3.5], [X + x0, c + 3.5 * 2.4], [X + x1, h - 3.5], [X + x1, h - 3.5 * 2.4]], col.infillDark, col.stroke, ' opacity="0.55"');
    }
    if (on(s.cap)) d.rect(X + x0, h, X + x1, h + n(s.cap_t, 1.5), col.frame, col.stroke);
  }

  function chainLink(d, s, X, w, o, col, defs) {
    var h = n(s.height, 72), c = o.clearance, r = n(s.rail_od, 1.66) / 2;
    var fill = col.fabricFill;
    if (o.frame) {
      var fr = n(s.gate_frame, 1.9) / 2;
      d.rect(X + 2 * fr, c + 2 * fr, X + w - 2 * fr, h - 2 * fr, fill, 'none');
      d.rect(X, c, X + 2 * fr, h, col.frame, col.stroke);
      d.rect(X + w - 2 * fr, c, X + w, h, col.frame, col.stroke);
      [c, h - 2 * fr, (c + h) / 2 - fr].forEach(function (z) { d.rect(X, z, X + w, z + 2 * fr, col.frame, col.stroke); });
      return;
    }
    var x0 = X - o.extA, x1 = X + w + o.extB;
    d.rect(X, h - 2 * r, X + w, h, col.frame, col.stroke);
    if (on(s.mid_rail)) { var zm = c + (h - c) / 2; d.rect(X, zm - r, X + w, zm + r, col.frame, col.stroke); }
    if (on(s.bottom_rail)) d.rect(X, c, X + w, c + 2 * r, col.frame, col.stroke);
    else d.line(x0, c + 1, x1, c + 1, col.stroke, 0.3);
    d.rect(x0, c, x1, h, fill, 'none');
    var nb = parseInt(s.barbed, 10) || 0;
    for (var k = 1; k <= nb; k++) {
      var z = h + 2 + 3 * k * 0.7071;
      d.line(x0, z, x1, z, col.wire, 0.35, ' stroke-dasharray="1.2 0.8"');
    }
  }

  function post(d, s, xc, size, top, type, col) {
    var hs = size / 2, round = s.post_shape === 'round', cap = s.post_cap;
    d.rect(xc - hs, -2, xc + hs, top, col.frame, col.stroke, round ? ' rx="' + (hs * 0.2).toFixed(2) + '"' : '');
    if (round) {
      if (cap !== 'none') {
        if (type === 'line') d.rect(xc - hs * 1.12, top - 1.5, xc + hs * 1.12, top + 0.25, col.frame, col.stroke);
        else d.raw('<path d="M' + (xc - hs * 1.15).toFixed(2) + ' ' + (-top).toFixed(2) + ' A ' + (hs * 1.15).toFixed(2) + ' ' +
          (hs * 1.15).toFixed(2) + ' 0 0 1 ' + (xc + hs * 1.15).toFixed(2) + ' ' + (-top).toFixed(2) + ' Z" fill="' + col.frame +
          '" stroke="' + col.stroke + '" stroke-width="' + d.sw + '"/>');
      }
    } else {
      var o = Math.max(hs * 0.08, 0.125);
      if (cap === 'flat') d.rect(xc - hs - o, top, xc + hs + o, top + 0.375, col.frame, col.stroke);
      else if (cap === 'pyramid') { d.rect(xc - hs - o, top, xc + hs + o, top + 0.25, col.frame, col.stroke); d.poly([[xc - hs - o, top + 0.25], [xc + hs + o, top + 0.25], [xc, top + 0.25 + hs * 0.9]], col.frame, col.stroke); }
      else if (cap === 'ball') { d.rect(xc - hs - o, top, xc + hs + o, top + 0.25, col.frame, col.stroke); d.circle(xc, top + 0.25 + hs * 0.7, hs * 0.75, col.frame, col.stroke); }
      else if (cap === 'new_england') {
        d.rect(xc - hs - 0.5, top, xc + hs + 0.5, top + 0.75, col.frame, col.stroke);
        d.rect(xc - hs - 0.25, top + 0.75, xc + hs + 0.25, top + 1.5, col.frame, col.stroke);
        d.poly([[xc - hs - 0.25, top + 1.5], [xc + hs + 0.25, top + 1.5], [xc, top + 1.5 + hs * 0.45]], col.frame, col.stroke);
      } else if (cap === 'gothic') {
        d.rect(xc - hs - 0.25, top, xc + hs + 0.25, top + 0.75, col.frame, col.stroke);
        d.poly([[xc - hs - 0.25, top + 0.75], [xc + hs + 0.25, top + 0.75], [xc, top + 0.75 + hs * 1.6]], col.frame, col.stroke);
      }
    }
    if ((parseInt(s.barbed, 10) || 0) > 0) d.line(xc, top, xc + 13 * 0.7071 * 0.35, top + 13 * 0.7071, col.frame, 1.0);
  }

  function colors(s, cat) {
    var f = rgbOf(cat, s.color);
    var inf = s.infill_color ? rgbOf(cat, s.infill_color) : f;
    var stroke = lum(f) < 0.3 ? 'rgba(0,0,0,0.85)' : css(f, 0.62);
    var fabric = s.infill === 'chain_link'
      ? (on(s.slats) ? css(s.infill_color ? inf : rgbOf(cat, 'green')) : 'url(#__pat__)')
      : css(inf);
    return {
      frame: css(f), stroke: stroke, infill: css(inf), infillDark: css(inf, 0.78), wire: css(f, 0.7),
      fabricFill: fabric, fabricLine: css(s.infill_color ? inf : f, 0.85)
    };
  }

  function infill(d, s, X, w, o, col) {
    if (s.infill === 'horizontal') horizontal(d, s, X, w, o, col);
    else if (s.infill === 'chain_link') chainLink(d, s, X, w, o, col);
    else vertical(d, s, X, w, o, col);
  }

  function postSizes(s) {
    var ps = n(s.post_size, 2.5), t = n(s.terminal_post_size);
    return { line: ps, terminal: t > 0 ? t : ps, gate: Math.max(n(s.gate_post_size, 4), ps) };
  }

  function topExtra(s) {
    var e = 0;
    if (s.finial === 'spear') e = Math.max(n(s.picket_w) * 3.2, 2);
    if (s.finial === 'trident') e = Math.max(n(s.picket_w) * 1.6, 1.5) * 1.4;
    if (on(s.cap)) e = Math.max(e, n(s.cap_t, 1.5));
    if ((parseInt(s.barbed, 10) || 0) > 0) e = Math.max(e, 13);
    return e + n(s.post_above) + 3;
  }

  function wrap(d, minx, maxx, minz, maxz, s, col, opt) {
    var id = 'p' + (++uid);
    var pat = '<defs><pattern id="' + id + '" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<path d="M0 0 L0 2 M0 0 L2 0" stroke="' + col.fabricLine + '" stroke-width="0.22" fill="none"/></pattern>' +
      '<linearGradient id="g' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fb36b" stop-opacity="0.55"/>' +
      '<stop offset="1" stop-color="#8fb36b" stop-opacity="0"/></linearGradient></defs>';
    var ground = '<rect x="' + minx + '" y="0" width="' + (maxx - minx) + '" height="' + (-minz) + '" fill="url(#g' + id + ')"/>' +
      '<line x1="' + minx + '" y1="0" x2="' + maxx + '" y2="0" stroke="#6b8f4e" stroke-width="' + (d.sw * 1.6) + '"/>';
    var body = d.o.join('').replace(/__pat__/g, id);
    var dims = opt.dimsSvg || '';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + minx.toFixed(2) + ' ' + (-maxz).toFixed(2) + ' ' +
      (maxx - minx).toFixed(2) + ' ' + (maxz - minz).toFixed(2) + '" preserveAspectRatio="xMidYMid meet">' +
      pat + ground + body + dims + '</svg>';
  }

  // Front elevation of one panel between two posts (plus half panels either side).
  function panel(s, cat, opt) {
    opt = opt || {};
    var h = n(s.height, 72), sp = n(s.post_spacing, 96), sizes = postSizes(s);
    var ps = sizes.line, gap = s.infill === 'vertical' ? 0.25 : 0;
    var c = n(s.clearance, 2), col = colors(s, cat);
    var sw = Math.max(sp, h) / 520;
    var d = new Draw(sw);
    var w = sp - ps - 2 * gap;
    var curve = { type: s.curve, h: n(s.curve_h), x0: 0, cw: w };
    var o = { clearance: c, curve: curve, extA: ps / 2 + gap, extB: ps / 2 + gap };
    var top = h + n(s.post_above);
    var posts = function () { post(d, s, 0, ps, top, 'line', col); post(d, s, sp, ps, top, 'line', col); };
    if (s.infill === 'vertical') { infill(d, s, ps / 2 + gap, w, o, col); posts(); }
    else { posts(); infill(d, s, ps / 2 + gap, w, o, col); }
    var maxz = h + Math.max(0, s.curve === 'convex' ? n(s.curve_h) : 0) + topExtra(s);
    var minx = -ps / 2 - 4, maxx = sp + ps / 2 + 4, minz = -6;
    if (opt.dims) {
      var fs = Math.max(sp, h) / 26, dd = new Draw(sw), tc = opt.dimColor || '#5b6475';
      var xd = -ps / 2 - fs * 1.4;
      dd.line(xd, 0, xd, h, tc, sw * 1.2); dd.line(xd - fs * 0.3, h, xd + fs * 0.3, h, tc, sw * 1.2); dd.line(xd - fs * 0.3, 0, xd + fs * 0.3, 0, tc, sw * 1.2);
      dd.text(xd - fs * 0.45, h / 2, fmtLen(h), fs, tc, 'middle', -90);
      var zd = -fs * 1.2;
      dd.line(0, zd, sp, zd, tc, sw * 1.2); dd.line(0, zd - fs * 0.3, 0, zd + fs * 0.3, tc, sw * 1.2); dd.line(sp, zd - fs * 0.3, sp, zd + fs * 0.3, tc, sw * 1.2);
      dd.text(sp / 2, zd - fs * 1.05, fmtLen(sp) + ' c-c', fs, tc, 'middle');
      opt.dimsSvg = dd.o.join('');
      minx = xd - fs * 1.4; minz = zd - fs * 1.6;
    }
    return wrap(d, minx, maxx, minz, maxz, s, col, opt);
  }

  // Front elevation of a gate between gate posts.
  function gate(s, cat, opt) {
    opt = opt || {};
    var h = n(s.height, 72), sizes = postSizes(s), gp = sizes.gate, col = colors(s, cat);
    var type = opt.type || s.gate_type || 'auto';
    var single = n(s.gate_single_max, 72);
    if (type === 'auto') type = 'single';
    var W = type === 'single' ? Math.min(single, 48) : type === 'double' ? Math.max(single * 2, 120) : 144;
    var c = n(s.gate_clearance, 2), hinge = n(s.gate_hinge_gap, 1), latch = n(s.gate_latch_gap, 1), cg = n(s.gate_center_gap, 1);
    var archType = { up: 'convex', down: 'concave' }[s.gate_arch], archH = n(s.gate_arch_h, 8);
    if (!archType) { archType = s.curve; archH = n(s.curve_h); }
    var span = W + gp, sw = Math.max(span, h) / 520, d = new Draw(sw);
    var top = h + (archType === 'convex' ? archH : 0) + n(s.post_above);
    var XA = gp / 2, maxx = span + gp / 2 + 4;
    var o = function (cw, x0, clr) { return { frame: true, clearance: clr, curve: { type: archType, h: archH, x0: x0, cw: cw }, extA: 0, extB: 0 }; };
    post(d, s, 0, gp, top, 'gate', col);
    post(d, s, span, gp, top, 'gate', col);
    if (type === 'single') {
      var lw = W - hinge - latch;
      infill(d, s, XA + hinge, lw, o(lw, 0, c), col);
    } else if (type === 'double') {
      var lw2 = (W - 2 * hinge - cg) / 2, cw = 2 * lw2 + cg;
      infill(d, s, XA + hinge, lw2, o(cw, 0, c), col);
      infill(d, s, XA + hinge + lw2 + cg, lw2, o(cw, lw2 + cg, c), col);
    } else {
      var tail = type === 'cantilever' ? Math.max(Math.ceil(W * 0.5 / 6) * 6, 48) : 8;
      var L = W + tail + 4, clr = Math.max(c, type === 'vtrack' ? 6 : 4);
      var o2 = { frame: true, clearance: clr, curve: null, extA: 0, extB: 0 };
      infill(d, s, XA + 1, L, o2, col);
      if (type === 'cantilever') {
        post(d, s, span + tail - 6, gp, top, 'gate', col);
        maxx = span + tail + gp;
      } else {
        d.rect(0, 0, span + W + 12, 1, '#555', 'none');
        d.circle(XA + 9, 4, 3, '#444'); d.circle(XA + L - 7, 4, 3, '#444');
        maxx = span + W + 14;
      }
    }
    var maxz = h + (archType === 'convex' ? archH : 0) + topExtra(s);
    var minx = -gp / 2 - 4, minz = -6;
    if (opt.dims) {
      var fs = Math.max(span, h) / 26, dd = new Draw(sw), tc = opt.dimColor || '#5b6475', zd = -fs * 1.2;
      dd.line(gp / 2, zd, span - gp / 2, zd, tc, sw * 1.2);
      dd.line(gp / 2, zd - fs * 0.3, gp / 2, zd + fs * 0.3, tc, sw * 1.2);
      dd.line(span - gp / 2, zd - fs * 0.3, span - gp / 2, zd + fs * 0.3, tc, sw * 1.2);
      dd.text(span / 2, zd - fs * 1.05, fmtLen(W) + ' opening', fs, tc, 'middle');
      opt.dimsSvg = dd.o.join('');
      minz = zd - fs * 1.6;
    }
    return wrap(d, minx, maxx, minz, maxz, s, col, opt);
  }

  global.FencePreview = { panel: panel, gate: gate, fmtLen: fmtLen };
})(window);
