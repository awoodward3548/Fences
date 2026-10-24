/* Catalog Manager: browse, add and edit product lines, styles and colors.
   Works on a copy of the user catalog; nothing is written until Save.
   Built-in items are copied into the user catalog the first time they are
   edited ("modified") and can be reset back to the shipped version. */
(function () {
  'use strict';

  var CM = window.CM = {
    builtin: null, user: null, saved: '{}', photos: {},
    mode: 'lines', sel: null, kind: 'all', query: '', pv: 'panel',
    pvStyle: null, pvHeight: null, pvLine: null, creating: false
  };
  var FF = window.FenceFields;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function n(v, d) { v = parseFloat(v); return isNaN(v) ? (d || 0) : v; }
  function on(v) { return v === true || v === 'true' || v === 1 || v === '1'; }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function keys(o) { return Object.keys(o || {}); }
  function assign(t) { for (var i = 1; i < arguments.length; i++) { var o = arguments[i] || {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) t[k] = o[k]; } return t; }
  var fmt = function (v) { return window.FencePreview.fmtLen(v); };

  function call(name, payload) {
    if (window.sketchup && typeof window.sketchup[name] === 'function') {
      if (payload === undefined) window.sketchup[name](); else window.sketchup[name](typeof payload === 'string' ? payload : JSON.stringify(payload));
    } else {
      CM.status({ msg: 'Demo mode: "' + name + '" only works inside SketchUp.', kind: 'warn' });
    }
  }

  // ----------------------------------------------------------- catalog data
  function merged(includeHidden) {
    var c = clone(CM.builtin), u = CM.user;
    ['colors', 'styles'].forEach(function (k) { assign(c[k], u[k]); });
    (u.lines || []).forEach(function (l) {
      var i = indexOfLine(c.lines, l.id);
      if (i >= 0) c.lines[i] = clone(l); else c.lines.push(clone(l));
    });
    if (!includeHidden) c.lines = c.lines.filter(function (l) { return (u.hidden_lines || []).indexOf(l.id) < 0; });
    return c;
  }
  function indexOfLine(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return i; return -1; }
  function builtinLine(id) { var i = indexOfLine(CM.builtin.lines, id); return i >= 0 ? CM.builtin.lines[i] : null; }
  function userLine(id) { var i = indexOfLine(CM.user.lines, id); return i >= 0 ? CM.user.lines[i] : null; }
  function anyLine(id) { return userLine(id) || builtinLine(id); }

  function stateOf(type, id) {
    var b, u;
    if (type === 'line') { b = builtinLine(id); u = userLine(id); }
    else { b = CM.builtin[type + 's'][id]; u = CM.user[type + 's'][id]; }
    return !b ? 'custom' : (u ? 'modified' : 'built-in');
  }
  function isHidden(id) { return (CM.user.hidden_lines || []).indexOf(id) >= 0; }

  // Return the user's editable copy, copying a built-in item on first edit.
  function editable(type, id) {
    if (type === 'line') {
      var u = userLine(id);
      if (!u) { u = clone(builtinLine(id)); CM.user.lines.push(u); }
      return u;
    }
    var bag = CM.user[type + 's'];
    if (!bag[id]) bag[id] = clone(CM.builtin[type + 's'][id]);
    return bag[id];
  }

  function dirty() { return JSON.stringify(CM.user) !== CM.saved; }
  function touch() {
    $('#dirty').style.display = dirty() ? '' : 'none';
  }

  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
  }
  function uniqueId(base, taken) {
    var id = base, i = 2;
    while (taken(id)) id = base + '_' + (i++);
    return id;
  }
  function lineIdTaken(id) { return !!anyLine(id); }
  function styleIdTaken(id) { return !!(CM.user.styles[id] || CM.builtin.styles[id]); }
  function colorIdTaken(id) { return !!(CM.user.colors[id] || CM.builtin.colors[id]); }

  function postSizeFor(ln, h) {
    var r = ln.post_rules || [];
    for (var i = 0; i < r.length; i++) if (h <= n(r[i][0])) return n(r[i][1]);
    return null;
  }

  // Same rule as Fence Builder: the line's default, else the global default
  // if the line offers it, else the middle height.
  function defaultHeight(cat, ln) {
    var hs = ln.heights || [];
    if (ln.defaults && ln.defaults.height) return n(ln.defaults.height);
    if (hs.indexOf(n(cat.base.height)) >= 0) return n(cat.base.height);
    return hs[Math.floor(hs.length / 2)];
  }

  function settingsFor(cat, ln, styleId, height) {
    var st = cat.styles[styleId] || { defaults: {} };
    var s = assign({}, cat.base, ln.defaults, st.defaults);
    s.line = ln.id; s.style = styleId; s.kind = ln.kind;
    if (height) s.height = n(height);
    var ps = postSizeFor(ln, s.height);
    if (ps) s.post_size = ps;
    return s;
  }

  // ------------------------------------------------------------- side list
  function renderSide() {
    $$('#segs .seg').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === CM.mode); });
    var cat = merged(true), html = '', q = CM.query.toLowerCase();
    var kindsHtml = '';
    if (CM.mode === 'lines') {
      kindsHtml = '<button data-kind="all" class="' + (CM.kind === 'all' ? 'on' : '') + '">All</button>' +
        keys(cat.kinds).map(function (k) { return '<button data-kind="' + k + '" class="' + (CM.kind === k ? 'on' : '') + '">' + esc(cat.kinds[k].name) + '</button>'; }).join('');
    }
    $('#kinds').innerHTML = kindsHtml;
    var match = function (txt) { return !q || txt.toLowerCase().indexOf(q) >= 0; };

    if (CM.mode === 'lines') {
      cat.lines.forEach(function (l) {
        if (CM.kind !== 'all' && l.kind !== CM.kind) return;
        if (!match([l.name, l.brand, l.grade, l.id].join(' '))) return;
        var st = stateOf('line', l.id);
        html += item(l.id, l.name, (l.brand || '') + ' · ' + (cat.kinds[l.kind] ? cat.kinds[l.kind].name : l.kind),
          badge(st) + (isHidden(l.id) ? '<span class="badge hidden">hidden</span>' : ''));
      });
      $('#btnNew').textContent = '+ New product line';
    } else if (CM.mode === 'styles') {
      keys(cat.styles).sort(function (a, b) { return cat.styles[a].name.localeCompare(cat.styles[b].name); }).forEach(function (id) {
        var st = cat.styles[id];
        if (!match(st.name + ' ' + id + ' ' + (st.description || ''))) return;
        html += item(id, st.name, usedBy('styles', id).length + ' line(s) · ' + id, badge(stateOf('style', id)));
      });
      $('#btnNew').textContent = '+ New style';
    } else {
      keys(cat.colors).forEach(function (id) {
        var c = cat.colors[id];
        if (!match(c.name + ' ' + id)) return;
        html += item(id, c.name, id, badge(stateOf('color', id)), 'rgb(' + c.rgb.join(',') + ')');
      });
      $('#btnNew').textContent = '+ New color';
    }
    $('#list').innerHTML = html || '<div class="empty">Nothing found.</div>';
  }
  function badge(st) { return st === 'built-in' ? '' : '<span class="badge ' + st + '">' + st + '</span>'; }
  function item(id, name, sub, badges, dot) {
    return '<div class="item' + (CM.sel === id ? ' on' : '') + '" data-id="' + esc(id) + '">' +
      (dot ? '<span class="dot" style="background:' + dot + '"></span>' : '') +
      '<div class="t"><div class="n">' + esc(name) + '</div><div class="s">' + esc(sub) + '</div></div>' + badges + '</div>';
  }
  function usedBy(field, id) {
    return merged(true).lines.filter(function (l) { return (l[field] || []).indexOf(id) >= 0; });
  }

  // ---------------------------------------------------------------- editor
  function sec(title, body, lead) {
    return '<div class="sec"><h4>' + esc(title) + '</h4><div class="rows">' + (lead ? '<div class="row wide lead">' + lead + '</div>' : '') + body + '</div></div>';
  }
  function textRow(label, path, val, opt) {
    opt = opt || {};
    var inp = opt.area
      ? '<textarea data-path="' + path + '">' + esc(val) + '</textarea>'
      : '<input type="text" data-path="' + path + '" value="' + esc(val) + '"' + (opt.ro ? ' readonly' : '') + '>';
    return '<div class="row' + (opt.wide ? ' wide' : '') + '"><label class="l">' + esc(label) + '</label>' + inp +
      (opt.hint ? '<div class="inh">' + opt.hint + '</div>' : '') + '</div>';
  }
  function selRow(label, path, val, options, wide) {
    return '<div class="row' + (wide ? ' wide' : '') + '"><label class="l">' + esc(label) + '</label><select data-path="' + path + '">' +
      options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(val) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') +
      '</select></div>';
  }

  function renderEditor() {
    if (CM.creating) return renderNewForm();
    var el = $('#editor');
    if (!CM.sel) { el.innerHTML = '<div class="empty">Pick an item on the left, or create a new one.</div>'; return; }
    if (CM.mode === 'lines') el.innerHTML = lineEditor(CM.sel);
    else if (CM.mode === 'styles') el.innerHTML = styleEditor(CM.sel);
    else el.innerHTML = colorEditor(CM.sel);
  }

  function headActions(type, id) {
    var st = stateOf(type, id), a = '';
    a += '<button data-act="duplicate">Duplicate</button>';
    if (st === 'modified') a += '<button data-act="reset" title="Throw away your changes to this built-in item">Reset to built-in</button>';
    if (st === 'custom') a += '<button data-act="delete" class="danger">Delete</button>';
    if (type === 'line' && st !== 'custom') a += '<button data-act="hide">' + (isHidden(id) ? 'Show in Fence Builder' : 'Hide from Fence Builder') + '</button>';
    return a;
  }

  function lineEditor(id) {
    var cat = merged(true), l = null;
    cat.lines.forEach(function (x) { if (x.id === id) l = x; });
    if (!l) return '<div class="empty">This line no longer exists.</div>';
    var st = stateOf('line', id), custom = st === 'custom';
    var h = '<div class="ed-head"><h2>' + esc(l.name) + '</h2>' + badge(st) + (isHidden(id) ? '<span class="badge hidden">hidden</span>' : '') +
      '<div class="acts">' + headActions('line', id) + '</div></div>';
    h += '<p class="lead">' + (st === 'built-in' ? 'Built-in product line. Editing it saves your own version, and you can reset it later.' :
      st === 'modified' ? 'You have changed this built-in line.' : 'Your own product line.') + '</p>';

    h += sec('Product', textRow('Name', 'name', l.name) + textRow('Brand / manufacturer', 'brand', l.brand) +
      selRow('Fence type', 'kind', l.kind, keys(cat.kinds).map(function (k) { return [k, cat.kinds[k].name]; })) +
      textRow('Id', 'id', l.id, { ro: !custom, hint: custom ? 'Letters, numbers and _ only. Used for photo names.' : 'Built-in ids cannot change.' }) +
      textRow('Grade', 'grade', l.grade) + textRow('Material', 'material', l.material) +
      textRow('Description', 'description', l.description, { area: true, wide: true }));

    var hs = l.heights || [];
    var dh = defaultHeight(cat, l);
    h += sec('Heights & post sizes',
      textRow('Available heights (inches, comma separated)', 'heights', hs.join(', '), { wide: true, hint: hs.map(fmt).join(' · ') }) +
      selRow('Default height', 'defaults.height', dh, hs.map(function (x) { return [x, fmt(x)]; })) +
      '<div class="row wide"><label class="l">Post size by height (first rule that fits wins)</label><table class="grid"><tr><th>Up to height (in)</th><th>Line post size (in)</th><th></th></tr>' +
      (l.post_rules || []).map(function (r, i) {
        return '<tr><td><input type="number" step="1" data-rule="' + i + '" data-col="0" value="' + esc(r[0]) + '"></td>' +
          '<td><input type="number" step="0.125" data-rule="' + i + '" data-col="1" value="' + esc(r[1]) + '"></td>' +
          '<td><button class="mini danger" data-act="rule-del" data-i="' + i + '">Remove</button></td></tr>';
      }).join('') + '</table><button class="mini" data-act="rule-add" style="margin:6px 0 0">+ Add rule</button></div>');

    var allStyles = keys(cat.styles), chosen = l.styles || [];
    var ordered = chosen.concat(allStyles.filter(function (s) { return chosen.indexOf(s) < 0; }).sort(function (a, b) { return cat.styles[a].name.localeCompare(cat.styles[b].name); }));
    h += sec('Styles', '<div class="row wide"><div class="picks">' + ordered.map(function (s) {
      var i = chosen.indexOf(s), onp = i >= 0;
      return '<label class="pick' + (onp ? ' on' : '') + '" title="' + esc(cat.styles[s].description || '') + '"><input type="checkbox" data-style-pick="' + esc(s) + '"' + (onp ? ' checked' : '') + '>' +
        '<span class="nm">' + esc(cat.styles[s].name) + '</span>' +
        (onp ? '<span class="ord">#' + (i + 1) + '</span><button class="mv" data-act="style-up" data-s="' + esc(s) + '" title="Move up">▲</button>' : '') + '</label>';
    }).join('') + '</div><button class="mini" data-act="new-style-for-line" style="margin:6px 0 0">+ New style for this line</button></div>',
    'Ticked styles appear in Fence Builder in this order. The first one is the default.');

    var chosenC = l.colors || [], defC = (l.defaults && l.defaults.color) || chosenC[0];
    h += sec('Colors', '<div class="row wide"><div class="picks">' + keys(cat.colors).map(function (c) {
      var onp = chosenC.indexOf(c) >= 0, col = cat.colors[c];
      return '<label class="pick' + (onp ? ' on' : '') + '"><input type="checkbox" data-color-pick="' + esc(c) + '"' + (onp ? ' checked' : '') + '>' +
        '<span class="sw" style="background:rgb(' + col.rgb.join(',') + ')"></span><span class="nm">' + esc(col.name) + '</span>' +
        (onp ? (c === defC ? '<span class="ord">default</span>' : '<button class="mv" data-act="color-default" data-c="' + esc(c) + '" title="Make default">★</button>') : '') + '</label>';
    }).join('') + '</div></div>');

    var spec = l.spec || {};
    h += sec('Spec notes', '<div class="row wide"><table class="grid"><tr><th>Label</th><th>Value</th><th></th></tr>' +
      keys(spec).map(function (k, i) {
        return '<tr><td><input type="text" data-spec="' + i + '" data-col="0" value="' + esc(k) + '"></td><td><input type="text" data-spec="' + i + '" data-col="1" value="' + esc(spec[k]) + '"></td>' +
          '<td><button class="mini danger" data-act="spec-del" data-k="' + esc(k) + '">Remove</button></td></tr>';
      }).join('') + '</table><button class="mini" data-act="spec-add" style="margin:6px 0 0">+ Add note</button></div>',
    'Shown in Fence Builder and on the bill of materials, e.g. "Picket: 3/4 in sq, 18 ga", "Mesh: 2 in, 9 ga", "SKU prefix".');

    h += sec('Photos', '<div class="row wide"><div class="photos">' + chosen.map(function (s) {
      var key = l.id + '__' + s, ph = CM.photos[key];
      var img = ph ? '<img src="' + esc(ph) + '" alt="">' : window.FencePreview.panel(settingsFor(cat, l, s, dh), cat, {});
      return '<div class="ph"><div class="im">' + img + '</div><div class="cap"><b>' + esc(cat.styles[s].name) + '</b>' +
        '<button data-act="photo" data-key="' + esc(key) + '">' + (ph ? 'Replace' : 'Choose photo') + '</button>' +
        (ph ? '<button data-act="photo-del" data-key="' + esc(key) + '">Remove</button>' : '') + '</div></div>';
    }).join('') + '</div></div>', 'Photos are saved right away to your data folder, as &lt;line&gt;__&lt;style&gt; images.');

    h += defaultsEditor('line', l, assign({}, cat.base), settingsFor(cat, l, CM.pvStyle && chosen.indexOf(CM.pvStyle) >= 0 ? CM.pvStyle : chosen[0], CM.pvHeight || dh));
    return h;
  }

  // Dimension/default fields. own = values set on this item; inherited = the
  // values it falls back to; eff = full settings used for show() rules.
  function defaultsEditor(type, obj, inherited, eff) {
    var own = obj.defaults || {}, cat = merged(true), h = '';
    var sections = FF.sections.concat([{ id: 'gates', title: 'Gates', fields: FF.gateFields.concat([
      { k: 'gate_type', t: 'sel', label: 'Default gate type', o: [['auto', 'Auto'], ['single', 'Single swing'], ['double', 'Double swing'], ['cantilever', 'Cantilever slide'], ['vtrack', 'V-track slide']] }
    ]) }]);
    sections.forEach(function (sc) {
      if (sc.show && !sc.show(eff)) return;
      var rows = sc.fields.map(function (f) {
        if (f.k === 'height') return '';
        if (f.show && !f.show(eff)) return '';
        var has = Object.prototype.hasOwnProperty.call(own, f.k);
        var v = has ? own[f.k] : (inherited[f.k] !== undefined ? inherited[f.k] : eff[f.k]);
        var path = 'defaults.' + f.k, input;
        if (f.t === 'chk') {
          input = '<label class="chk" style="padding-top:2px"><input type="checkbox" data-path="' + path + '" data-t="chk"' + (on(v) ? ' checked' : '') + '> yes</label>';
        } else if (f.t === 'sel') {
          input = '<select data-path="' + path + '">' + f.o.map(function (o) { return '<option value="' + o[0] + '"' + (String(v) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
        } else if (f.t === 'color' || f.t === 'icolor') {
          var opts = (f.t === 'icolor' ? [['', 'Same as fence']] : []).concat(keys(cat.colors).map(function (c) { return [c, cat.colors[c].name]; }));
          input = '<select data-path="' + path + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(v) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
        } else {
          var step = f.t === 'int' || f.t === 'deg' ? '1' : '0.125';
          var hint = f.t === 'len' && n(v) >= 12 ? fmt(n(v)) : (f.t === 'len' ? 'in' : (f.t === 'deg' ? 'deg' : ''));
          input = '<div class="with"><input type="number" step="' + step + '" data-path="' + path + '" data-t="' + f.t + '" value="' + esc(v) + '"><span class="fi">' + esc(hint) + '</span></div>';
        }
        return '<div class="row' + (has ? ' own' : '') + '"><label class="l">' + esc(f.label) +
          (has ? '<button class="rst" data-act="unset" data-k="' + f.k + '" title="Use the inherited value again">×</button>' : '') + '</label>' + input + '</div>';
      }).join('');
      if (rows) h += '<div class="sec' + (sc.id === 'footings' ? ' closed' : '') + '"><h4>' + esc(sc.title) + '</h4><div class="rows">' + rows + '</div></div>';
    });
    var lead = type === 'line'
      ? 'Default dimensions for this product line. Highlighted values are set on this line; the rest come from the global defaults. Styles can still override them (for example rails or top style).'
      : 'Settings this style applies on top of the product line. Highlighted values are set by the style; the rest come from the preview line.';
    return '<h3 class="sub" style="margin-top:18px">Dimensions & defaults</h3><p class="lead">' + lead + '</p>' + h;
  }

  function styleEditor(id) {
    var cat = merged(true), s = cat.styles[id];
    if (!s) return '<div class="empty">This style no longer exists.</div>';
    var st = stateOf('style', id), custom = st === 'custom';
    var used = usedBy('styles', id);
    var h = '<div class="ed-head"><h2>' + esc(s.name) + '</h2>' + badge(st) + '<div class="acts">' + headActions('style', id) + '</div></div>';
    h += sec('Style', textRow('Name', 'name', s.name) + textRow('Id', 'id', id, { ro: !custom, hint: custom ? 'Letters, numbers and _ only.' : 'Built-in ids cannot change.' }) +
      textRow('Description', 'description', s.description, { area: true, wide: true }) +
      '<div class="row wide"><label class="l">Used by</label><div class="links">' +
      (used.length ? used.map(function (l) { return '<a data-goto-line="' + esc(l.id) + '">' + esc(l.name) + '</a>'; }).join('') : '<span class="hint">No product line uses this style yet. Tick it under a line’s Styles.</span>') +
      '</div></div>');
    var ph = CM.photos[id];
    h += sec('Photo', '<div class="row wide"><div class="photos"><div class="ph"><div class="im">' +
      (ph ? '<img src="' + esc(ph) + '">' : window.FencePreview.panel(styleSettings(cat, id), cat, {})) + '</div><div class="cap"><b>All lines</b>' +
      '<button data-act="photo" data-key="' + esc(id) + '">' + (ph ? 'Replace' : 'Choose photo') + '</button>' +
      (ph ? '<button data-act="photo-del" data-key="' + esc(id) + '">Remove</button>' : '') + '</div></div></div></div>',
    'Used for every line with this style unless the line has its own photo.');
    var ln = previewLineFor(cat, id);
    h += defaultsEditor('style', s, assign({}, cat.base, ln.defaults), styleSettings(cat, id));
    return h;
  }

  function previewLineFor(cat, styleId) {
    var ln = null;
    if (CM.pvLine) cat.lines.forEach(function (l) { if (l.id === CM.pvLine) ln = l; });
    if (!ln) cat.lines.forEach(function (l) { if (!ln && (l.styles || []).indexOf(styleId) >= 0) ln = l; });
    return ln || cat.lines[0];
  }
  function styleSettings(cat, id) {
    var ln = previewLineFor(cat, id);
    return settingsFor(cat, ln, id, CM.pvHeight || defaultHeight(cat, ln));
  }

  function colorEditor(id) {
    var cat = merged(true), c = cat.colors[id];
    if (!c) return '<div class="empty">This color no longer exists.</div>';
    var st = stateOf('color', id), custom = st === 'custom';
    var hex = '#' + c.rgb.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('');
    var used = usedBy('colors', id);
    var h = '<div class="ed-head"><h2>' + esc(c.name) + '</h2>' + badge(st) + '<div class="acts">' + headActions('color', id) + '</div></div>';
    h += sec('Color', textRow('Name', 'name', c.name) + textRow('Id', 'id', id, { ro: !custom }) +
      '<div class="row"><label class="l">Color</label><input type="color" data-path="rgb" value="' + hex + '" style="width:100%;height:34px"></div>' +
      '<div class="row"><label class="l">RGB</label><input type="text" data-path="rgbtext" value="' + c.rgb.join(', ') + '"></div>' +
      '<div class="row wide"><label class="l">Offered on</label><div class="links">' +
      (used.length ? used.map(function (l) { return '<a data-goto-line="' + esc(l.id) + '">' + esc(l.name) + '</a>'; }).join('') : '<span class="hint">No line offers this color yet. Tick it under a line’s Colors.</span>') +
      '</div></div>');
    return h;
  }

  function renderNewForm() {
    var cat = merged(true), what = CM.mode === 'lines' ? 'product line' : CM.mode === 'styles' ? 'style' : 'color';
    var h = '<div class="ed-head"><h2>New ' + what + '</h2></div><div class="form-new"><div class="rows">' +
      '<div class="row"><label class="l">Name</label><input type="text" id="newName" placeholder="e.g. ' +
      (CM.mode === 'lines' ? 'Bufftech Galveston' : CM.mode === 'styles' ? 'Double Top Rail' : 'Khaki') + '"></div>';
    if (CM.mode === 'lines') {
      h += '<div class="row"><label class="l">Brand / manufacturer</label><input type="text" id="newBrand" placeholder="e.g. CertainTeed"></div>' +
        '<div class="row wide"><label class="l">Start from (copies dimensions, styles and colors)</label><select id="newFrom">' +
        cat.lines.map(function (l) { return '<option value="' + esc(l.id) + '"' + (l.id === CM.sel ? ' selected' : '') + '>' + esc((cat.kinds[l.kind] || {}).name + ' – ' + l.name) + '</option>'; }).join('') + '</select></div>';
    } else if (CM.mode === 'styles') {
      h += '<div class="row wide"><label class="l">Start from</label><select id="newFrom">' +
        keys(cat.styles).map(function (s) { return '<option value="' + esc(s) + '"' + (s === CM.sel ? ' selected' : '') + '>' + esc(cat.styles[s].name) + '</option>'; }).join('') + '</select></div>';
    } else {
      var base = cat.colors[CM.sel], hex = base ? '#' + base.rgb.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('') : '#8a8f96';
      h += '<div class="row"><label class="l">Color</label><input type="color" id="newColor" value="' + hex + '" style="width:100%;height:34px"></div>';
    }
    h += '</div><div class="btnrow"><button class="primary" data-act="create">Create</button><button data-act="cancel-new">Cancel</button></div></div>';
    $('#editor').innerHTML = h;
    setTimeout(function () { var x = $('#newName'); if (x) x.focus(); }, 0);
  }

  // --------------------------------------------------------------- preview
  function renderPreview() {
    var cat = merged(true), s, ctl = '', hint = '', photo = null;
    $$('.pv-toggle .seg').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-pv') === CM.pv); });
    if (CM.mode === 'lines' && CM.sel && !CM.creating) {
      var l = null;
      cat.lines.forEach(function (x) { if (x.id === CM.sel) l = x; });
      if (!l) { $('#preview').innerHTML = ''; return; }
      var styles = l.styles || [];
      if (styles.indexOf(CM.pvStyle) < 0) CM.pvStyle = styles[0];
      var hs = l.heights || [];
      var h = hs.indexOf(n(CM.pvHeight)) >= 0 ? CM.pvHeight : defaultHeight(cat, l);
      s = settingsFor(cat, l, CM.pvStyle, h);
      ctl += '<div class="row"><label class="l">Style</label><select id="pvStyle">' + styles.map(function (x) { return '<option value="' + esc(x) + '"' + (x === CM.pvStyle ? ' selected' : '') + '>' + esc((cat.styles[x] || {}).name || x) + '</option>'; }).join('') + '</select></div>';
      ctl += '<div class="row"><label class="l">Height</label><select id="pvHeight">' + hs.map(function (x) { return '<option value="' + x + '"' + (n(x) === n(h) ? ' selected' : '') + '>' + fmt(x) + '</option>'; }).join('') + '</select></div>';
      photo = CM.photos[l.id + '__' + CM.pvStyle] || CM.photos[CM.pvStyle];
      hint = 'Line post ' + fmt(n(s.post_size)) + ' · posts ' + fmt(n(s.post_spacing)) + ' on center.';
    } else if (CM.mode === 'styles' && CM.sel && !CM.creating && cat.styles[CM.sel]) {
      s = styleSettings(cat, CM.sel);
      var ln = previewLineFor(cat, CM.sel);
      ctl += '<div class="row"><label class="l">Preview on line</label><select id="pvLine">' + cat.lines.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === ln.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div>';
      photo = CM.photos[ln.id + '__' + CM.sel] || CM.photos[CM.sel];
    } else if (CM.mode === 'colors' && CM.sel && !CM.creating && cat.colors[CM.sel]) {
      var used = usedBy('colors', CM.sel), l2 = used[0] || cat.lines[0];
      s = settingsFor(cat, l2, (l2.styles || [])[0], defaultHeight(cat, l2));
      s.color = CM.sel;
      hint = 'Shown on ' + l2.name + '.';
    }
    if (!s) { $('#preview').innerHTML = ''; $('#pvCtl').innerHTML = ''; $('#pvPhoto').innerHTML = ''; $('#pvHint').textContent = ''; return; }
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var opt = { dims: true, dimColor: dark ? '#9aa3b2' : '#5b6475' };
    $('#preview').innerHTML = CM.pv === 'gate' ? window.FencePreview.gate(s, cat, opt) : window.FencePreview.panel(s, cat, opt);
    $('#pvCtl').innerHTML = ctl;
    $('#pvPhoto').innerHTML = photo ? '<img src="' + esc(photo) + '" alt="">' : '';
    $('#pvHint').textContent = hint;
  }

  function renderAll() { renderSide(); renderEditor(); renderPreview(); touch(); }

  // --------------------------------------------------------------- editing
  function current() { return CM.mode === 'lines' ? 'line' : CM.mode === 'styles' ? 'style' : 'color'; }

  function parseVal(el) {
    var t = el.getAttribute('data-t');
    if (el.type === 'checkbox') return el.checked;
    if (t === 'int') return parseInt(el.value, 10) || 0;
    if (el.type === 'number') { var v = parseFloat(el.value); return isNaN(v) ? null : v; }
    return el.value;
  }

  function setPath(el, full) {
    var path = el.getAttribute('data-path'), type = current(), id = CM.sel;
    var v = parseVal(el);
    if (v === null) return;
    var o = editable(type, id);
    if (path === 'id') {
      var nid = slug(v);
      if (nid === id) return;
      var taken = type === 'line' ? lineIdTaken : type === 'style' ? styleIdTaken : colorIdTaken;
      if (taken(nid)) { CM.status({ msg: 'That id is already used.', kind: 'error' }); renderEditor(); return; }
      renameId(type, id, nid);
      renderAll();
      return;
    }
    if (path === 'heights') {
      o.heights = v.split(/[,\s]+/).map(function (x) { return n(x, NaN); }).filter(function (x) { return x > 0; })
        .sort(function (a, b) { return a - b; });
    } else if (path === 'rgb') {
      o.rgb = [1, 3, 5].map(function (i) { return parseInt(v.substr(i, 2), 16); });
    } else if (path === 'rgbtext') {
      var parts = v.split(/[,\s]+/).map(function (x) { return Math.max(0, Math.min(255, parseInt(x, 10) || 0)); });
      if (parts.length === 3) o.rgb = parts;
    } else if (path.indexOf('defaults.') === 0) {
      o.defaults = o.defaults || {};
      var k = path.slice(9);
      o.defaults[k] = (k === 'height') ? n(v) : v;
    } else {
      o[path] = v;
    }
    touch();
    if (full) renderAll(); else { renderPreview(); }
  }

  function renameId(type, oldId, newId) {
    if (type === 'line') {
      userLine(oldId).id = newId;
      CM.user.hidden_lines = (CM.user.hidden_lines || []).map(function (x) { return x === oldId ? newId : x; });
    } else {
      var bag = CM.user[type + 's'];
      bag[newId] = bag[oldId]; delete bag[oldId];
      var field = type + 's';
      CM.user.lines.forEach(function (l) { l[field] = (l[field] || []).map(function (x) { return x === oldId ? newId : x; }); });
      if (type === 'color') CM.user.lines.forEach(function (l) { if (l.defaults && l.defaults.color === oldId) l.defaults.color = newId; });
    }
    CM.sel = newId;
  }

  function act(name, el) {
    var type = current(), id = CM.sel, o, i;
    switch (name) {
      case 'unset':
        o = editable(type, id);
        if (o.defaults) delete o.defaults[el.getAttribute('data-k')];
        break;
      case 'rule-add':
        o = editable('line', id); o.post_rules = o.post_rules || [];
        var last = o.post_rules[o.post_rules.length - 1];
        o.post_rules.push([999, last ? last[1] : 2.5]);
        break;
      case 'rule-del':
        o = editable('line', id); o.post_rules.splice(+el.getAttribute('data-i'), 1);
        break;
      case 'spec-add':
        o = editable('line', id); o.spec = o.spec || {};
        var k = 'Note'; i = 2; while (o.spec[k] !== undefined) k = 'Note ' + (i++);
        o.spec[k] = '';
        break;
      case 'spec-del':
        o = editable('line', id); delete o.spec[el.getAttribute('data-k')];
        break;
      case 'style-up':
        o = editable('line', id); var s = el.getAttribute('data-s'); i = o.styles.indexOf(s);
        if (i > 0) { o.styles.splice(i, 1); o.styles.splice(i - 1, 0, s); }
        break;
      case 'color-default':
        o = editable('line', id); o.defaults = o.defaults || {}; o.defaults.color = el.getAttribute('data-c');
        break;
      case 'new-style-for-line':
        CM.pendingLine = id; CM.mode = 'styles'; CM.creating = true; CM.sel = (anyLine(id).styles || [])[0];
        break;
      case 'photo': call('choose_photo', el.getAttribute('data-key')); return;
      case 'photo-del': call('remove_photo', el.getAttribute('data-key')); return;
      case 'duplicate':
        CM.creating = true;
        break;
      case 'reset':
        if (!confirm('Throw away your changes to this item and go back to the built-in version?')) return;
        if (type === 'line') CM.user.lines.splice(indexOfLine(CM.user.lines, id), 1);
        else delete CM.user[type + 's'][id];
        break;
      case 'delete':
        if (!confirm('Delete this ' + type + '?')) return;
        if (!deleteItem(type, id)) return;
        CM.sel = null;
        break;
      case 'hide':
        var hl = CM.user.hidden_lines = CM.user.hidden_lines || [];
        i = hl.indexOf(id);
        if (i >= 0) hl.splice(i, 1); else hl.push(id);
        break;
      case 'create': createItem(); return;
      case 'cancel-new': CM.creating = false; CM.pendingLine = null; break;
      default: return;
    }
    renderAll();
  }

  function deleteItem(type, id) {
    if (type === 'line') {
      CM.user.lines.splice(indexOfLine(CM.user.lines, id), 1);
      CM.user.hidden_lines = (CM.user.hidden_lines || []).filter(function (x) { return x !== id; });
      return true;
    }
    var field = type + 's';
    var blocked = merged(true).lines.filter(function (l) { return (l[field] || []).length === 1 && l[field][0] === id; });
    if (blocked.length) {
      CM.status({ msg: blocked[0].name + ' only has this ' + type + '. Give it another one first.', kind: 'error' });
      return false;
    }
    usedBy(field, id).forEach(function (l) {
      var e = editable('line', l.id);
      e[field] = e[field].filter(function (x) { return x !== id; });
    });
    delete CM.user[field][id];
    return true;
  }

  function createItem() {
    var name = ($('#newName').value || '').trim();
    if (!name) { CM.status({ msg: 'Give it a name first.', kind: 'error' }); return; }
    var cat = merged(true), id;
    if (CM.mode === 'lines') {
      var from = null, fid = $('#newFrom').value;
      cat.lines.forEach(function (l) { if (l.id === fid) from = l; });
      var l = clone(from);
      id = uniqueId(slug(name), lineIdTaken);
      l.id = id; l.name = name; l.brand = ($('#newBrand').value || '').trim() || 'Custom';
      CM.user.lines.push(l);
    } else if (CM.mode === 'styles') {
      var st = clone(cat.styles[$('#newFrom').value] || { defaults: {} });
      id = uniqueId(slug(name), styleIdTaken);
      st.name = name;
      CM.user.styles[id] = st;
      if (CM.pendingLine) {
        var ln = editable('line', CM.pendingLine);
        ln.styles = (ln.styles || []).concat([id]);
        CM.pendingLine = null;
      }
    } else {
      var hex = $('#newColor').value;
      id = uniqueId(slug(name), colorIdTaken);
      CM.user.colors[id] = { name: name, rgb: [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16); }) };
    }
    CM.creating = false;
    CM.sel = id;
    renderAll();
    CM.status({ msg: 'Created "' + name + '". Remember to Save.', kind: 'ok' });
  }

  // ------------------------------------------------------------------ bind
  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target, el;
      if ((el = t.closest('#segs .seg'))) { CM.mode = el.getAttribute('data-mode'); CM.sel = null; CM.creating = false; renderAll(); return; }
      if ((el = t.closest('#kinds button'))) { CM.kind = el.getAttribute('data-kind'); renderSide(); return; }
      if ((el = t.closest('.item'))) { CM.sel = el.getAttribute('data-id'); CM.creating = false; CM.pvLine = null; renderAll(); return; }
      if ((el = t.closest('.pv-toggle .seg'))) { CM.pv = el.getAttribute('data-pv'); renderPreview(); return; }
      if ((el = t.closest('[data-goto-line]'))) { CM.mode = 'lines'; CM.sel = el.getAttribute('data-goto-line'); renderAll(); return; }
      if ((el = t.closest('.sec > h4'))) { el.parentNode.classList.toggle('closed'); return; }
      if ((el = t.closest('[data-act]'))) { e.preventDefault(); act(el.getAttribute('data-act'), el); return; }
    });

    document.addEventListener('input', function (e) {
      var el = e.target;
      if (el.getAttribute('data-path') && (el.type === 'number' || el.type === 'color')) setPath(el, false);
    });

    document.addEventListener('change', function (e) {
      var el = e.target, o;
      if (el.id === 'pvStyle') { CM.pvStyle = el.value; renderPreview(); if (CM.mode === 'lines') renderEditor(); return; }
      if (el.id === 'pvHeight') { CM.pvHeight = n(el.value); renderPreview(); return; }
      if (el.id === 'pvLine') { CM.pvLine = el.value; renderEditor(); renderPreview(); return; }
      if (el.getAttribute('data-path')) {
        setPath(el, true);
        return;
      }
      if (el.getAttribute('data-style-pick')) {
        o = editable('line', CM.sel); var s = el.getAttribute('data-style-pick');
        o.styles = (o.styles || []).filter(function (x) { return x !== s; });
        if (el.checked) o.styles.push(s);
        renderAll(); return;
      }
      if (el.getAttribute('data-color-pick')) {
        o = editable('line', CM.sel); var c = el.getAttribute('data-color-pick');
        o.colors = (o.colors || []).filter(function (x) { return x !== c; });
        if (el.checked) o.colors.push(c);
        renderAll(); return;
      }
      if (el.getAttribute('data-rule') !== null) {
        o = editable('line', CM.sel);
        o.post_rules[+el.getAttribute('data-rule')][+el.getAttribute('data-col')] = n(el.value);
        o.post_rules.sort(function (a, b) { return a[0] - b[0]; });
        renderAll(); return;
      }
      if (el.getAttribute('data-spec') !== null) {
        o = editable('line', CM.sel);
        var ks = keys(o.spec), idx = +el.getAttribute('data-spec'), col = +el.getAttribute('data-col');
        var nspec = {};
        ks.forEach(function (k, i) {
          if (i !== idx) { nspec[k] = o.spec[k]; return; }
          if (col === 0) nspec[el.value.trim() || k] = o.spec[k]; else nspec[k] = el.value;
        });
        o.spec = nspec;
        renderAll(); return;
      }
    });

    $('#search').addEventListener('input', function (e) { CM.query = e.target.value.trim(); renderSide(); });
    $('#btnNew').addEventListener('click', function () { CM.creating = true; CM.pendingLine = null; renderAll(); });
    $('#btnSave').addEventListener('click', function () {
      var err = validate();
      if (err) { CM.status({ msg: err, kind: 'error' }); return; }
      call('save', CM.user);
    });
    $('#btnDiscard').addEventListener('click', function () {
      if (!dirty() || confirm('Discard all unsaved changes?')) { CM.user = JSON.parse(CM.saved); renderAll(); }
    });
    $('#btnExport').addEventListener('click', function () { call('export', CM.user); });
    $('#btnImport').addEventListener('click', function () { call('import'); });
    $('#btnFolder').addEventListener('click', function () { call('open_folder'); });
    window.addEventListener('beforeunload', function (e) { if (dirty()) { e.returnValue = 'Unsaved changes'; return e.returnValue; } });
  }

  function validate() {
    var bad = null;
    CM.user.lines.forEach(function (l) {
      if (bad) return;
      if (!(l.heights || []).length) bad = l.name + ': add at least one height.';
      else if (!(l.styles || []).length) bad = l.name + ': tick at least one style.';
      else if (!(l.colors || []).length) bad = l.name + ': tick at least one color.';
    });
    return bad;
  }

  // ------------------------------------------------------------ Ruby API
  CM.onInit = function (d) {
    CM.builtin = d.builtin;
    CM.user = d.user;
    ['lines', 'hidden_lines'].forEach(function (k) { CM.user[k] = CM.user[k] || []; });
    ['styles', 'colors'].forEach(function (k) { CM.user[k] = CM.user[k] || {}; });
    CM.saved = JSON.stringify(CM.user);
    CM.photos = d.photos || {};
    $('#fileHint').textContent = d.user_file ? 'Your catalog: ' + d.user_file : '';
    if (!CM.sel && CM.builtin.lines.length) CM.sel = CM.builtin.lines[0].id;
    renderAll();
  };
  CM.onSaved = function (d) {
    CM.builtin = d.builtin;
    CM.saved = JSON.stringify(CM.user);
    CM.photos = d.photos || CM.photos;
    renderAll();
  };
  CM.onPhotos = function (p) { CM.photos = p || {}; renderEditor(); renderPreview(); };
  CM.onImport = function (data) {
    var u = CM.user, nl = 0;
    (data.lines || []).forEach(function (l) {
      var i = indexOfLine(u.lines, l.id);
      if (i >= 0) u.lines[i] = l; else u.lines.push(l);
      nl++;
    });
    assign(u.styles, data.styles);
    assign(u.colors, data.colors);
    (data.hidden_lines || []).forEach(function (x) { if (u.hidden_lines.indexOf(x) < 0) u.hidden_lines.push(x); });
    renderAll();
    CM.status({ msg: 'Imported ' + nl + ' line(s), ' + keys(data.styles).length + ' style(s), ' + keys(data.colors).length + ' color(s). Review, then Save.', kind: 'ok' });
  };
  CM.status = function (st) {
    var el = $('#status');
    el.textContent = st.msg;
    el.className = 'status ' + (st.kind || '');
    clearTimeout(CM._t);
    CM._t = setTimeout(function () { el.textContent = ''; }, 7000);
  };

  bind();
  if (window.sketchup && typeof window.sketchup.ready === 'function') {
    window.sketchup.ready();
  } else {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '../data/catalog.json');
    xhr.onload = function () {
      CM.onInit({ builtin: JSON.parse(xhr.responseText), user: {}, photos: {} });
    };
    xhr.send();
  }
})();
