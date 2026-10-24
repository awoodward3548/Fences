/* Shared settings schema used by the Fence Builder dialog and the Catalog
   Manager. Each field: k = settings key, t = type (len|int|deg|sel|chk|color|
   icolor), label, optional o (options), chips, show(settings) and
   catalogOnly (only shown in the Catalog Manager). */
(function (global) {
  'use strict';
  function on(v) { return v === true || v === 'true' || v === 1 || v === '1'; }
  function n(v) { v = parseFloat(v); return isNaN(v) ? 0 : v; }

  var V = function (s) { return s.infill === 'vertical'; };
  var HZ = function (s) { return s.infill === 'horizontal'; };
  var CL = function (s) { return s.infill === 'chain_link'; };
  var ORN = function (s) { return s.kind === 'ornamental'; };

  var FINIALS = [['flat', 'Flat'], ['dogear', 'Dog-ear'], ['point', 'Point'], ['gothic', 'Gothic'], ['spear', 'Spear'],
    ['trident', 'Trident'], ['pyramid', 'Pyramid cap'], ['ball', 'Ball']];
  var CAPS = [['none', 'None'], ['flat', 'Flat'], ['pyramid', 'Pyramid'], ['ball', 'Ball'], ['new_england', 'New England'],
    ['gothic', 'Gothic'], ['dome', 'Dome (round posts)']];

  var SECTIONS = [
    { id: 'construction', title: 'Construction type', catalogOnly: true, fields: [
      { k: 'infill', t: 'sel', label: 'Infill type', o: [['vertical', 'Vertical pickets / boards'], ['horizontal', 'Horizontal boards / rails'], ['chain_link', 'Chain link fabric'], ['netting', 'Netting on poles (ball stop)']] }
    ] },
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
      { k: 'trim', t: 'chk', label: 'Trim board under cap', show: function (s) { return on(s.cap); } },
      { k: 'kickboard', t: 'chk', label: 'Kickboard (rot board at the bottom)', show: function (s) { return s.rail_mount === 'back'; } },
      { k: 'kick_h', t: 'len', label: 'Kickboard height', chips: [5.5, 7.25], show: function (s) { return s.rail_mount === 'back' && on(s.kickboard); } }
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
      { k: 'barbed', t: 'int', label: 'Barbed wire strands', chips: [0, 3] },
      { k: 'windscreen', t: 'chk', label: 'Windscreen' },
      { k: 'windscreen_h', t: 'len', label: 'Windscreen height (0 = 1\' less than fence)', chips: [72, 96, 108], show: function (s) { return on(s.windscreen); } },
      { k: 'windscreen_color', t: 'icolor', label: 'Windscreen color', show: function (s) { return on(s.windscreen); } },
      { k: 'net_above', t: 'len', label: 'Ball-stop netting above fence (0 = none)', chips: [0, 72, 120, 240] },
      { k: 'net_color', t: 'icolor', label: 'Netting color', show: function (s) { return n(s.net_above) > 0; } },
      { k: 'net_cables', t: 'int', label: 'Net support cables', chips: [2, 3], show: function (s) { return n(s.net_above) > 0; } }
    ] },
    { id: 'netting', title: 'Netting', show: function (s) { return s.infill === 'netting'; }, fields: [
      { k: 'net_cables', t: 'int', label: 'Support cables (top, bottom, extra)', chips: [2, 3, 4] },
      { k: 'infill_color', t: 'icolor', label: 'Netting color' }
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

  global.FenceFields = { sections: SECTIONS, gateFields: GATE_FIELDS, finials: FINIALS, caps: CAPS, on: on };
})(window);
