/* Fence Builder dialog logic. Talks to Ruby through the `sketchup` object that
   UI::HtmlDialog provides. Opened in a plain browser, a small demo stub is
   used so the UI can still be explored. */
(function () {
  'use strict';

  var FB = window.FB = {
    catalog: null, photos: {}, s: null, over: {}, sel: null,
    kind: 'all', query: '', pv: 'panel', live: false, editing: null
  };
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
  function n(v, d) { v = parseFloat(v); return isNaN(v) ? (d || 0) : v; }
  function on(v) { return v === true || v === 'true' || v === 1 || v === '1'; }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function assign(t) { for (var i = 1; i < arguments.length; i++) { var o = arguments[i] || {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) t[k] = o[k]; } return t; }
  function keys(o) { return Object.keys(o || {}); }
  var fmt = function (v) { return window.FencePreview.fmtLen(v); };

  // ---------------------------------------------------------- Ruby bridge
  function call(name, payload) {
    if (window.sketchup && typeof window.sketchup[name] === 'function') {
      if (payload === undefined) window.sketchup[name](); else window.sketchup[name](JSON.stringify(payload));
    } else {
      FB.status({ msg: 'Demo mode (not running inside SketchUp): "' + name + '"', kind: 'warn' });
    }
  }

  // ------------------------------------------------------------- catalog
  function line(id) {
    var ls = FB.catalog.lines;
    for (var i = 0; i < ls.length; i++) if (ls[i].id === id) return ls[i];
    return ls[0];
  }
  function style(id) { return FB.catalog.styles[id] || { name: id, defaults: {} }; }

  function postSizeFor(ln, h) {
    var r = ln.post_rules || [];
    for (var i = 0; i < r.length; i++) if (h <= r[i][0]) return r[i][1];
    return null;
  }

  function defaults(lineId, styleId, height) {
    var ln = line(lineId);
    if (ln.styles.indexOf(styleId) < 0) styleId = ln.styles[0];
    var s = assign({}, FB.catalog.base, ln.defaults, style(styleId).defaults);
    s.line = ln.id; s.style = styleId; s.kind = ln.kind;
    if (height && n(height) > 0) s.height = n(height);
    var ps = postSizeFor(ln, s.height);
    if (ps) s.post_size = ps;
    return s;
  }

  // Keys a user changed that should survive a style switch.
  var STICKY_ON_LINE = ['height', 'color', 'spacing_mode', 'slope_mode', 'corner_angle', 'show_footings', 'gate_open'];

  function selectLine(id) {
    var ln = line(id), old = FB.s || {};
    var h = ln.heights.indexOf(n(old.height)) >= 0 ? old.height : (ln.defaults && ln.defaults.height) || FB.catalog.base.height;
    if (ln.heights.indexOf(n(h)) < 0) h = ln.heights[Math.floor(ln.heights.length / 2)];
    var keep = {};
    STICKY_ON_LINE.forEach(function (k) { if (k in FB.over) keep[k] = FB.over[k]; });
    if (keep.color && (ln.colors || []).indexOf(keep.color) < 0) delete keep.color;
    FB.over = keep;
    if ('height' in keep) h = keep.height;
    var st = ln.styles.indexOf(old.style) >= 0 ? old.style : ln.styles[0];
    FB.s = assign(defaults(id, st, h), keep);
    renderAll();
  }

  function selectStyle(id) {
    var styleKeys = keys(style(id).defaults);
    var over = {};
    keys(FB.over).forEach(function (k) { if (styleKeys.indexOf(k) < 0) over[k] = FB.over[k]; });
    FB.over = over;
    FB.s = assign(defaults(FB.s.line, id, FB.s.height), over);
    renderAll();
    liveApply();
  }

  function setValue(k, v) {
    FB.s[k] = v;
    FB.over[k] = v;
    if (k === 'height') {
      var ps = postSizeFor(line(FB.s.line), n(v));
      if (ps && !('post_size' in FB.over)) FB.s.post_size = ps;
    }
    renderPreview();
    renderForm(true);
    liveApply();
  }

  // ------------------------------------------------------------- render
  function renderAll() {
    renderKinds(); renderLines(); renderLineInfo(); renderGallery();
    renderPreview(); renderForm(); renderGates(); renderBom(); updateButtons();
  }

  function renderKinds() {
    var html = '<button data-kind="all" class="' + (FB.kind === 'all' ? 'on' : '') + '">All</button>';
    keys(FB.catalog.kinds).forEach(function (k) {
      html += '<button data-kind="' + k + '" class="' + (FB.kind === k ? 'on' : '') + '">' + esc(FB.catalog.kinds[k].name) + '</button>';
    });
    $('#kinds').innerHTML = html;
  }

  function lineMatches(ln) {
    if (FB.kind !== 'all' && ln.kind !== FB.kind) return false;
    if (!FB.query) return true;
    var q = FB.query.toLowerCase();
    var hay = [ln.name, ln.brand, ln.grade, ln.material, ln.description, ln.kind].join(' ').toLowerCase();
    ln.styles.forEach(function (st) { hay += ' ' + (style(st).name + ' ' + (style(st).description || '')).toLowerCase(); });
    ln.heights.forEach(function (h) { hay += ' ' + fmt(h); });
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  function renderLines() {
    var html = '';
    FB.catalog.lines.forEach(function (ln) {
      if (!lineMatches(ln)) return;
      html += '<div class="line' + (ln.id === FB.s.line ? ' on' : '') + '" data-line="' + ln.id + '">' +
        '<div class="b">' + esc(ln.brand) + ' &middot; ' + esc(FB.catalog.kinds[ln.kind] ? FB.catalog.kinds[ln.kind].name : ln.kind) + '</div>' +
        '<div class="n">' + esc(ln.name) + '</div><div class="g">' + esc(ln.grade) + '</div></div>';
    });
    $('#lines').innerHTML = html || '<div class="empty">No fences match your search.</div>';
  }

  function renderLineInfo() {
    var ln = line(FB.s.line);
    $('#lineInfo').innerHTML = '<b>' + esc((ln.brand !== 'Generic' ? ln.brand + ' ' : '') + ln.name) + '</b> &mdash; ' +
      esc(ln.description) + '<br>' + esc(ln.material) + ' &middot; Heights ' +
      ln.heights.map(fmt).join(', ');
    $('#disclaimer').textContent = FB.catalog.disclaimer || '';
  }

  function photoFor(lineId, styleId) {
    var p = FB.photos || {};
    return p[lineId + '__' + styleId] || p[styleId] || null;
  }

  function renderGallery() {
    var ln = line(FB.s.line), html = '';
    ln.styles.forEach(function (st) {
      var sd = defaults(ln.id, st, FB.s.height);
      sd.color = FB.s.color;
      var photo = photoFor(ln.id, st);
      var img = photo ? '<img src="' + esc(photo) + '" alt="">' : window.FencePreview.panel(sd, FB.catalog, {});
      var stl = style(st);
      html += '<div class="card' + (st === FB.s.style ? ' on' : '') + '" data-style="' + st + '" title="' + esc(stl.description) + '">' +
        '<div class="img">' + img + '</div><div class="cap"><span class="tag">' + (photo ? 'photo' : '') + '</span>' +
        '<div class="n">' + esc(stl.name) + '</div><div class="d">' + esc(stl.description) + '</div></div></div>';
    });
    $('#gallery').innerHTML = html;
  }

  function renderPreview() {
    var s = FB.s, ln = line(s.line);
    var title = (ln.brand !== 'Generic' ? ln.brand + ' ' : '') + ln.name + ' – ' + style(s.style).name;
    $('#pvTitle').textContent = title + (FB.editing ? '  (editing selected fence)' : '');
    var colName = FB.catalog.colors[s.color] ? FB.catalog.colors[s.color].name : s.color;
    $('#pvSub').textContent = fmt(n(s.height)) + ' high · posts ' + fmt(n(s.post_spacing)) + ' on center · ' + colName +
      (s.infill === 'vertical' ? ' · ' + (parseInt(s.rails, 10) || 2) + ' rails' : '');
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var opt = { dims: true, dimColor: dark ? '#9aa3b2' : '#5b6475' };
    $('#preview').innerHTML = FB.pv === 'gate' ? window.FencePreview.gate(s, FB.catalog, opt) : window.FencePreview.panel(s, FB.catalog, opt);
    $$('.seg').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-pv') === FB.pv); });
  }

  // --------------------------------------------------------------- form
  var V = function (s) { return s.infill === 'vertical'; };
  var HZ = function (s) { return s.infill === 'horizontal'; };
  var CL = function (s) { return s.infill === 'chain_link'; };
  var ORN = function (s) { return s.kind === 'ornamental'; };

  var FINIALS = [['flat', 'Flat'], ['dogear', 'Dog-ear'], ['point', 'Point'], ['gothic', 'Gothic'], ['spear', 'Spear'],
    ['trident', 'Trident'], ['pyramid', 'Pyramid cap'], ['ball', 'Ball']];
  var CAPS = [['none', 'None'], ['flat', 'Flat'], ['pyramid', 'Pyramid'], ['ball', 'Ball'], ['new_england', 'New England'],
    ['gothic', 'Gothic'], ['dome', 'Dome (round posts)']];

  var SECTIONS = [
    { id: 'size', title: 'Size & spacing', fields: [
      { k: 'height', t: 'len', label: 'Fence height', chips: 'heights' },
      { k: 'post_spacing', t: 'len', label: 'Post spacing (center to center)', chips: [72, 96, 120] },
      { k: 'spacing_mode', t: 'sel', label: 'Panel layout per run', o: [['equal', 'Equal panels (all the same width)'], ['full', 'Full panels, cut the last one']] },
      { k: 'clearance', t: 'len', label: 'Ground clearance' }
    ] },
    { id: 'infill', title: 'Pickets & boards', show: V, fields: [
      { k: 'finial', t: 'sel', label: 'Picket / board top', o: FINIALS },
      { k: 'layout', t: 'sel', label: 'Board layout', o: [['single', 'Single side'], ['shadowbox', 'Shadowbox / board-on-board']] },
      { k: 'picket_w', t: 'len', label: 'Picket / board width' },
      { k: 'picket_d', t: 'len', label: 'Picket / board thickness' },
      { k: 'air_space', t: 'len', label: 'Air space between (0 = tight)', chips: [0, 2.5, 3.625, 4] },
      { k: 'top', t: 'sel', label: 'Top', o: [['flush', 'Flush (pickets stop at top rail)'], ['extended', 'Extended above top rail']] },
      { k: 'top_ext', t: 'len', label: 'Extension above top rail', show: function (s) { return s.top === 'extended'; } },
      { k: 'bottom', t: 'sel', label: 'Bottom', o: [['flush', 'Flush with bottom rail'], ['extended', 'Extended below bottom rail']] },
      { k: 'bottom_ext', t: 'len', label: 'Extension below bottom rail', show: function (s) { return s.bottom === 'extended'; } },
      { k: 'curve', t: 'sel', label: 'Top curve', o: [['none', 'Straight'], ['convex', 'Arched (up)'], ['concave', 'Scalloped (down)']] },
      { k: 'curve_h', t: 'len', label: 'Curve height', show: function (s) { return s.curve && s.curve !== 'none'; } },
      { k: 'puppy', t: 'chk', label: 'Puppy pickets (extra bottom pickets)', show: ORN },
      { k: 'puppy_h', t: 'len', label: 'Puppy picket height', show: function (s) { return ORN(s) && on(s.puppy); } },
      { k: 'lattice_h', t: 'len', label: 'Lattice topper height (0 = none)', chips: [0, 12, 18] },
      { k: 'cap', t: 'chk', label: 'Cap board on top' },
      { k: 'trim', t: 'chk', label: 'Trim board under cap', show: function (s) { return on(s.cap); } }
    ] },
    { id: 'rails', title: 'Rails', show: V, fields: [
      { k: 'rails', t: 'int', label: 'Number of rails', chips: [2, 3, 4] },
      { k: 'rail_mount', t: 'sel', label: 'Rail position', o: [['center', 'Through pickets (ornamental / vinyl)'], ['back', 'Behind boards (wood)']] },
      { k: 'rail_w', t: 'len', label: 'Rail depth' },
      { k: 'rail_h', t: 'len', label: 'Rail height' }
    ] },
    { id: 'boards', title: 'Horizontal boards / rails', show: HZ, fields: [
      { k: 'h_count', t: 'int', label: 'Number of rails (0 = fill with boards)', chips: [0, 2, 3, 4] },
      { k: 'h_mount', t: 'sel', label: 'Mounting', o: [['face', 'Face of posts'], ['between', 'Between posts'], ['through', 'Through posts (mortised)']] },
      { k: 'board_h', t: 'len', label: 'Board / rail height' },
      { k: 'board_t', t: 'len', label: 'Board / rail thickness' },
      { k: 'board_gap', t: 'len', label: 'Gap between boards', show: function (s) { return !(parseInt(s.h_count, 10) > 0); } },
      { k: 'bottom_ext', t: 'len', label: 'Bottom rail height above clearance', show: function (s) { return parseInt(s.h_count, 10) > 0; } },
      { k: 'cap', t: 'chk', label: 'Cap board on top' }
    ] },
    { id: 'chain', title: 'Chain link', show: CL, fields: [
      { k: 'rail_od', t: 'len', label: 'Rail pipe OD', chips: [1.375, 1.66, 1.9] },
      { k: 'mid_rail', t: 'chk', label: 'Middle rail' },
      { k: 'bottom_rail', t: 'chk', label: 'Bottom rail (else tension wire)' },
      { k: 'slats', t: 'chk', label: 'Privacy slats' },
      { k: 'barbed', t: 'int', label: 'Barbed wire strands', chips: [0, 3] }
    ] },
    { id: 'posts', title: 'Posts', fields: [
      { k: 'post_size', t: 'len', label: 'Line post size' },
      { k: 'terminal_post_size', t: 'len', label: 'End / corner post size (0 = same)' },
      { k: 'gate_post_size', t: 'len', label: 'Gate post size' },
      { k: 'post_shape', t: 'sel', label: 'Post shape', o: [['square', 'Square'], ['round', 'Round pipe']] },
      { k: 'post_cap', t: 'sel', label: 'Post cap', o: CAPS },
      { k: 'post_above', t: 'len', label: 'Post height above fence' }
    ] },
    { id: 'slope', title: 'Slopes & corners', fields: [
      { k: 'slope_mode', t: 'sel', label: 'On slopes', o: [['auto', 'Auto (rack, step if too steep)'], ['rack', 'Always rack (follow grade)'], ['step', 'Always step (level panels)']] },
      { k: 'max_rack', t: 'len', label: 'Max rack per panel' },
      { k: 'corner_angle', t: 'deg', label: 'Corner post when line turns more than' }
    ] },
    { id: 'look', title: 'Color', fields: [
      { k: 'color', t: 'color', label: 'Fence color', wide: true },
      { k: 'infill_color', t: 'icolor', label: 'Picket / board / fabric color', wide: true }
    ] },
    { id: 'footings', title: 'Footings & concrete', closed: true, fields: [
      { k: 'show_footings', t: 'chk', label: 'Show footings below grade' },
      { k: 'embed_depth', t: 'len', label: 'Post embedment depth' },
      { k: 'footing_dia', t: 'len', label: 'Hole diameter' }
    ] }
  ];

  var GATE_FIELDS = [
    { k: 'gate_single_max', t: 'len', label: 'Auto: widest single gate', show: function (s) { return s.gate_type === 'auto'; } },
    { k: 'gate_arch', t: 'sel', label: 'Gate top', o: [['none', 'Match fence'], ['up', 'Arched up'], ['down', 'Arched down (scallop)']] },
    { k: 'gate_arch_h', t: 'len', label: 'Arch height', show: function (s) { return s.gate_arch && s.gate_arch !== 'none'; } },
    { k: 'gate_open', t: 'deg', label: 'Swing open (0 = closed)', chips: [0, 45, 90], show: function (s) { return ['auto', 'single', 'double'].indexOf(s.gate_type) >= 0; } },
    { k: 'gate_flip', t: 'chk', label: 'Flip hinge side / slide direction' },
    { k: 'gate_brace', t: 'chk', label: 'Diagonal brace' },
    { k: 'gate_frame', t: 'len', label: 'Gate frame size' },
    { k: 'gate_post_size', t: 'len', label: 'Gate post size' },
    { k: 'gate_hinge_gap', t: 'len', label: 'Hinge gap' },
    { k: 'gate_latch_gap', t: 'len', label: 'Latch gap' },
    { k: 'gate_center_gap', t: 'len', label: 'Center gap (double)', show: function (s) { return s.gate_type === 'double' || s.gate_type === 'auto'; } },
    { k: 'gate_clearance', t: 'len', label: 'Ground clearance' }
  ];

  var GATE_TYPES = [
    ['auto', 'Auto', 'Single or double by width'],
    ['single', 'Single swing', 'Walk gate'],
    ['double', 'Double swing', 'Drive gate'],
    ['cantilever', 'Cantilever slide', 'Trackless slide'],
    ['vtrack', 'V-track slide', 'Rolls on a ground track']
  ];

  var closedSecs = {};

  function fieldHtml(f, s) {
    if (f.show && !f.show(s)) return '';
    var v = s[f.k], id = 'f_' + f.k, cls = 'row' + (f.wide ? ' wide' : ''), h = '';
    if (f.t === 'chk') {
      return '<div class="' + cls + '"><label class="chk"><input type="checkbox" id="' + id + '" data-k="' + f.k + '" data-t="chk"' +
        (on(v) ? ' checked' : '') + '>' + esc(f.label) + '</label></div>';
    }
    h += '<div class="' + cls + '"><label class="l" for="' + id + '">' + esc(f.label) + '</label>';
    if (f.t === 'sel') {
      h += '<select id="' + id + '" data-k="' + f.k + '" data-t="sel">' + f.o.map(function (o) {
        return '<option value="' + o[0] + '"' + (String(v) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
    } else if (f.t === 'color' || f.t === 'icolor') {
      var ln = line(s.line), ids = (ln.colors || []).slice();
      keys(FB.catalog.colors).forEach(function (c) { if (ids.indexOf(c) < 0) ids.push(c); });
      if (f.t === 'icolor') {
        h += '<select id="' + id + '" data-k="' + f.k + '" data-t="sel"><option value="">Same as fence</option>' +
          ids.map(function (c) { return '<option value="' + c + '"' + (v === c ? ' selected' : '') + '>' + esc(FB.catalog.colors[c].name) + '</option>'; }).join('') + '</select>';
      } else {
        h += '<div class="swatches">' + (ln.colors || []).map(function (c) {
          var col = FB.catalog.colors[c];
          return '<div class="sw' + (v === c ? ' on' : '') + '" title="' + esc(col.name) + '" data-color="' + c + '" style="background:rgb(' + col.rgb.join(',') + ')"></div>';
        }).join('') + '</div><select data-k="color" data-t="sel" style="margin-top:4px">' +
          ids.map(function (c) { return '<option value="' + c + '"' + (v === c ? ' selected' : '') + '>' + esc(FB.catalog.colors[c].name) + '</option>'; }).join('') + '</select>';
      }
    } else {
      var step = f.t === 'int' ? '1' : (f.t === 'deg' ? '1' : '0.125');
      var hint = f.t === 'len' && n(v) >= 12 ? fmt(n(v)) : (f.t === 'len' ? 'in' : (f.t === 'deg' ? 'deg' : ''));
      h += '<div class="with"><input type="number" id="' + id + '" data-k="' + f.k + '" data-t="' + f.t + '" step="' + step + '" min="0" value="' + esc(v) + '">' +
        '<span class="fi">' + esc(hint) + '</span></div>';
      var chips = f.chips === 'heights' ? line(s.line).heights : f.chips;
      if (chips) {
        h += '<div class="chips">' + chips.map(function (c) {
          var lab = f.t === 'len' ? (c >= 12 ? fmt(c) : c + '"') : (f.t === 'deg' ? c + '°' : String(c));
          return '<button data-chip="' + f.k + '" data-v="' + c + '" class="' + (n(v) === c ? 'on' : '') + '">' + lab + '</button>';
        }).join('') + '</div>';
      }
    }
    return h + '</div>';
  }

  function renderForm(keepFocus) {
    var active = document.activeElement, activeKey = active && active.getAttribute && active.getAttribute('data-k');
    if (keepFocus && activeKey && active.tagName === 'INPUT' && active.type === 'number') {
      // Refresh hints only, so typing is not interrupted.
      $$('.row .fi').forEach(function (el) {
        var inp = el.previousSibling, k = inp && inp.getAttribute('data-k'), t = inp && inp.getAttribute('data-t');
        if (t === 'len') el.textContent = n(FB.s[k]) >= 12 ? fmt(n(FB.s[k])) : 'in';
      });
      return;
    }
    var s = FB.s, html = '';
    SECTIONS.forEach(function (sec) {
      if (sec.show && !sec.show(s)) return;
      var closed = sec.id in closedSecs ? closedSecs[sec.id] : !!sec.closed;
      html += '<div class="sec' + (closed ? ' closed' : '') + '" data-sec="' + sec.id + '"><h4>' + esc(sec.title) + '</h4><div class="rows">' +
        sec.fields.map(function (f) { return fieldHtml(f, s); }).join('') + '</div></div>';
    });
    $('#pane-adjust').innerHTML = html;
  }

  function gateIcon(t) {
    var p = { stroke: 'currentColor', fill: 'none', sw: 2 };
    var post = function (x) { return '<rect x="' + x + '" y="6" width="5" height="36" fill="currentColor"/>'; };
    var leaf = function (x, w) { return '<rect x="' + x + '" y="12" width="' + w + '" height="26" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M' + (x + w / 3) + ' 12v26M' + (x + 2 * w / 3) + ' 12v26" stroke="currentColor" stroke-width="1.4"/>'; };
    var g = '';
    if (t === 'single' || t === 'auto') g = post(10) + post(85) + leaf(17, 66);
    else if (t === 'double') g = post(4) + post(91) + leaf(11, 39) + leaf(50, 39);
    else if (t === 'cantilever') g = post(4) + post(52) + post(90) + leaf(11, 86) + '<path d="M60 44h30" stroke="currentColor" stroke-dasharray="3 2"/>';
    else g = post(4) + post(48) + leaf(11, 52) + '<path d="M2 44h96" stroke="currentColor" stroke-width="2"/><circle cx="20" cy="40" r="3" fill="currentColor"/><circle cx="54" cy="40" r="3" fill="currentColor"/>';
    void p;
    return '<svg viewBox="0 0 100 48">' + g + '</svg>';
  }

  function renderGates() {
    var s = FB.s, sel = FB.sel || {};
    var html = '<div class="note"><b>Placing gates</b><ol>' +
      '<li>Double-click your fence-line group to open it.</li>' +
      '<li>Draw the gate segment so it is its own edge (split the line at each gate post).</li>' +
      '<li>Select that edge, choose a gate type below, and click <b>Mark selected edge as gate</b>.</li>' +
      '<li>Each gate edge keeps its own type and options, so a walk gate and a slide gate can share one fence. Linked fences rebuild automatically.</li>' +
      '</ol></div>';
    html += '<div class="gtypes">' + GATE_TYPES.map(function (g) {
      return '<div class="gtype' + (s.gate_type === g[0] ? ' on' : '') + '" data-gtype="' + g[0] + '" title="' + esc(g[2]) + '">' + gateIcon(g[0]) +
        '<div class="n">' + esc(g[1]) + '</div></div>';
    }).join('') + '</div>';
    html += '<div class="btnrow"><button class="primary" id="btnMarkGate">Mark selected edge as gate</button>' +
      '<button id="btnUnmarkGate">Remove gate from edge</button></div>';
    if (sel.edges) html += '<div class="hint">' + sel.edges + ' edge(s) selected, ' + (sel.gate_edges || 0) + ' already gates.</div>';
    html += '<div class="sec"><h4>Gate options</h4><div class="rows">' + GATE_FIELDS.map(function (f) { return fieldHtml(f, s); }).join('') + '</div></div>';
    html += '<p class="hint">These options also apply to gate edges that were marked without their own settings.</p>';
    $('#pane-gates').innerHTML = html;
  }

  function gateOpts() {
    var o = { gate_type: FB.s.gate_type };
    GATE_FIELDS.forEach(function (f) { o[f.k] = FB.s[f.k]; });
    return o;
  }

  function renderBom() {
    var sel = FB.sel || {}, f = (sel.fences || [])[0];
    var el = $('#pane-bom');
    if (!f || !f.bom || !f.bom.rows) {
      el.innerHTML = '<div class="empty">Select a fence to see its bill of materials.<br>' +
        'Use <b>Export CSV</b> to save every fence in the model.</div>' +
        '<div class="btnrow" style="justify-content:center"><button id="btnExport">Export CSV</button></div>';
      return;
    }
    var sm = f.bom.summary || {}, html = '<div class="kpis">' +
      kpi(sm.length || '-', 'Total length') + kpi(sm.panels, 'Panels / sections') + kpi(sm.posts, 'Posts') + kpi(sm.gates, 'Gates') + '</div>';
    html += '<table class="bom"><tr><th>Item</th><th class="q">Qty</th><th>Unit</th><th>Notes</th></tr>';
    var cat = null;
    f.bom.rows.forEach(function (r) {
      if (r.cat !== cat) { cat = r.cat; html += '<tr class="cat"><td colspan="4">' + esc(cat) + '</td></tr>'; }
      html += '<tr><td>' + esc(r.item) + '</td><td class="q">' + esc(r.qty) + '</td><td>' + esc(r.unit) + '</td><td>' + esc(r.note) + '</td></tr>';
    });
    html += '</table><div class="btnrow"><button class="primary" id="btnExport">Export CSV</button></div>';
    if ((sel.fences || []).length > 1) html = '<p class="hint">Showing the first of ' + sel.fences.length + ' selected fences. The CSV includes all of them.</p>' + html;
    el.innerHTML = html;
  }
  function kpi(v, k) { return '<div class="kpi"><div class="v">' + esc(v == null ? '-' : v) + '</div><div class="k">' + esc(k) + '</div></div>'; }

  function renderHelp() {
    $('#pane-help').innerHTML = '<div class="help">' +
      '<h4>Quick start</h4><ol>' +
      '<li>Draw your fence line with the Line tool (or Arc tool for curves) on the ground or terrain.</li>' +
      '<li>Select the edges and make them a group (<kbd>G</kbd>, or right-click &rarr; Make Group).</li>' +
      '<li>Select the group, pick a product line and style here, then click <b>Create fence</b>.</li></ol>' +
      '<h4>Editing</h4><ul>' +
      '<li>Select a fence: its settings load here. Change anything and click <b>Apply to selected fence</b>, or turn on <b>Live update</b>.</li>' +
      '<li>Moved or reshaped the line? Select the fence and click <b>Rebuild from line</b>.</li>' +
      '<li>Each part is its own group on its own tag (Fence Posts, Fence Panels, Fence Gates, Fence Footings), so you can hide or style them separately.</li></ul>' +
      '<h4>Lines, corners & slopes</h4><ul>' +
      '<li>Posts are spaced evenly along each straight run. A corner post goes wherever the line turns more than the corner angle, so arcs make smooth curved fences.</li>' +
      '<li>Lines that follow terrain make panels rack with the grade. If the slope is steeper than the max rack, panels step instead.</li>' +
      '<li>Where lines meet in a T, a junction post is placed automatically.</li></ul>' +
      '<h4>Photos</h4><ul>' +
      '<li>Put your own product photos in the plugin <b>photos</b> folder, named <code>&lt;line&gt;__&lt;style&gt;.jpg</code> (e.g. <code>montage_plus__majestic.jpg</code>) or <code>&lt;style&gt;.jpg</code>.</li>' +
      '<li><button id="btnPhotos">Open photos folder</button> <button id="btnReload">Reload catalog & photos</button></li></ul>' +
      '<h4>Your own products</h4><ul>' +
      '<li>Add or override product lines, styles and colors in <code>data/user_catalog.json</code> (same format as <code>catalog.json</code>).</li></ul>' +
      '</div>';
  }

  function selectionText(sel) {
    if (!sel) return ['Nothing selected', ''];
    if (sel.fences && sel.fences.length) return [sel.fences.length === 1 ? sel.fences[0].name : sel.fences.length + ' fences selected', 'fence'];
    if (sel.paths) return [sel.paths + ' line group(s) selected' + (sel.length ? ' · ' + sel.length : ''), 'path'];
    if (sel.edges) return [sel.edges + ' edge(s) selected' + (sel.length ? ' · ' + sel.length : '') + (sel.gate_edges ? ' · ' + sel.gate_edges + ' gate' : ''), 'path'];
    return ['Select a grouped fence line or a fence', ''];
  }

  function updateButtons() {
    var sel = FB.sel || {};
    var hasFence = !!(sel.fences && sel.fences.length);
    var hasPath = !!(sel.paths || sel.edges);
    $('#btnCreate').disabled = !hasPath && !!window.sketchup;
    $('#btnApply').disabled = !hasFence && !!window.sketchup;
    $('#btnRebuild').disabled = !hasFence && !!window.sketchup;
    var t = selectionText(sel);
    var pill = $('#selPill');
    pill.textContent = t[0];
    pill.className = 'pill ' + t[1];
  }

  // ------------------------------------------------------------ actions
  var liveTimer = null;
  function liveApply() {
    if (!FB.live || !FB.sel || !FB.sel.fences || !FB.sel.fences.length) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { call('apply', FB.s); }, 450);
  }

  function readInput(el) {
    var k = el.getAttribute('data-k'), t = el.getAttribute('data-t');
    if (!k) return;
    var v;
    if (t === 'chk') v = el.checked;
    else if (t === 'sel') v = el.value;
    else if (t === 'int') v = parseInt(el.value, 10) || 0;
    else { v = parseFloat(el.value); if (isNaN(v)) return; }
    setValue(k, v);
    if (t === 'chk' || t === 'sel') { renderForm(); renderGates(); }
  }

  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target, el;
      if ((el = t.closest('#kinds button'))) { FB.kind = el.getAttribute('data-kind'); renderKinds(); renderLines(); return; }
      if ((el = t.closest('.line'))) { selectLine(el.getAttribute('data-line')); return; }
      if ((el = t.closest('.card'))) { selectStyle(el.getAttribute('data-style')); return; }
      if ((el = t.closest('.seg'))) { FB.pv = el.getAttribute('data-pv'); renderPreview(); return; }
      if ((el = t.closest('.tab'))) {
        var tab = el.getAttribute('data-tab');
        $$('.tab').forEach(function (b) { b.classList.toggle('on', b === el); });
        $$('.pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + tab); });
        if (tab === 'gates') { FB.pv = 'gate'; renderPreview(); }
        return;
      }
      if ((el = t.closest('.sec > h4'))) {
        var sec = el.parentNode; sec.classList.toggle('closed');
        closedSecs[sec.getAttribute('data-sec')] = sec.classList.contains('closed');
        return;
      }
      if ((el = t.closest('[data-chip]'))) {
        var k = el.getAttribute('data-chip');
        setValue(k, parseFloat(el.getAttribute('data-v')));
        renderForm(); renderGates();
        return;
      }
      if ((el = t.closest('.sw'))) { setValue('color', el.getAttribute('data-color')); renderForm(); renderGallery(); return; }
      if ((el = t.closest('.gtype'))) {
        setValue('gate_type', el.getAttribute('data-gtype'));
        FB.pv = 'gate'; renderPreview(); renderGates();
        return;
      }
      if (t.closest('#btnMarkGate')) { call('mark_gate', gateOpts()); return; }
      if (t.closest('#btnUnmarkGate')) { call('unmark_gate'); return; }
      if (t.closest('#btnExport')) { call('export_bom'); return; }
      if (t.closest('#btnPhotos')) { call('open_photos'); return; }
      if (t.closest('#btnReload')) { call('reload_catalog'); return; }
    });

    document.addEventListener('change', function (e) {
      var el = e.target;
      if (el.id === 'live') { FB.live = el.checked; if (FB.live) liveApply(); return; }
      if (el.getAttribute && el.getAttribute('data-k')) readInput(el);
    });
    document.addEventListener('input', function (e) {
      var el = e.target;
      if (el.type === 'number' && el.getAttribute('data-k')) readInput(el);
    });
    $('#search').addEventListener('input', function (e) { FB.query = e.target.value.trim(); renderLines(); });

    $('#btnCreate').addEventListener('click', function () { call('create', FB.s); });
    $('#btnApply').addEventListener('click', function () { call('apply', FB.s); });
    $('#btnRebuild').addEventListener('click', function () { call('rebuild'); });
    $('#btnReset').addEventListener('click', function () {
      FB.over = {};
      FB.s = defaults(FB.s.line, FB.s.style, FB.s.height);
      renderAll();
    });
  }

  // ----------------------------------------------------------- Ruby API
  FB.onInit = function (data) {
    FB.catalog = data.catalog;
    FB.photos = data.photos || {};
    FB.s = assign(defaults(data.settings.line, data.settings.style, data.settings.height), data.settings);
    FB.over = diffFromDefaults(FB.s);
    FB.kind = 'all';
    renderHelp();
    FB.onSelection(data.selection, true);
    renderAll();
  };

  FB.onCatalog = function (data) {
    FB.catalog = data.catalog;
    FB.photos = data.photos || {};
    renderAll();
  };

  function diffFromDefaults(s) {
    var d = defaults(s.line, s.style, s.height), over = {};
    keys(s).forEach(function (k) { if (String(d[k]) !== String(s[k])) over[k] = s[k]; });
    over.height = s.height;
    return over;
  }

  FB.onSelection = function (sel, silent) {
    FB.sel = sel || {};
    var f = (FB.sel.fences || [])[0];
    if (f && f.name !== FB.editing) {
      FB.editing = f.name;
      FB.s = f.settings;
      FB.over = diffFromDefaults(FB.s);
      if (!silent) renderAll();
    } else if (!f && FB.editing) {
      FB.editing = null;
      if (!silent) renderPreview();
    }
    if (!silent) { renderBom(); renderGates(); updateButtons(); }
  };

  FB.status = function (st) {
    var el = $('#status');
    el.textContent = st.msg;
    el.className = 'status ' + (st.kind || '');
    clearTimeout(FB._stT);
    FB._stT = setTimeout(function () { el.textContent = ''; }, 6000);
  };

  // ---------------------------------------------------------------- boot
  bind();
  if (window.sketchup && typeof window.sketchup.ready === 'function') {
    window.sketchup.ready();
  } else {
    // Demo mode for browsers: load the catalog next to this file.
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '../data/catalog.json');
    xhr.onload = function () {
      try {
        var cat = JSON.parse(xhr.responseText);
        FB.onInit({ catalog: cat, photos: {}, settings: { line: cat.lines[0].id }, selection: {} });
      } catch (err) { FB.status({ msg: 'Could not load catalog: ' + err.message, kind: 'error' }); }
    };
    xhr.onerror = function () { FB.status({ msg: 'Open this inside SketchUp (Extensions > Fence Builder).', kind: 'warn' }); };
    xhr.send();
  }
})();
