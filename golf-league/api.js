/*
 * Talks to the database. Two modes:
 *  - Live: config.js has your Supabase address and key. Everyone shares the same data.
 *  - Demo: config.js is blank. Data lives only in this browser, for trying the app out.
 * Both modes answer the same calls with { ok: true, ... } or { ok: false, error: '...' }.
 */
(function () {
  'use strict';
  var cfg = window.LEAGUE_CONFIG || {};
  var url = String(cfg.supabaseUrl || '').trim().replace(/\/+$/, '');
  var key = String(cfg.supabaseKey || '').trim();
  var live = !!(url && key && url.indexOf('YOUR-') < 0 && key.indexOf('YOUR-') < 0);

  function liveCall(name, params) {
    var headers = { 'Content-Type': 'application/json', apikey: key };
    if (key.indexOf('eyJ') === 0) headers.Authorization = 'Bearer ' + key;
    return fetch(url + '/rest/v1/rpc/' + name, { method: 'POST', headers: headers, body: JSON.stringify(params || {}) })
      .then(function (res) {
        return res.text().then(function (text) {
          var body = null;
          try { body = JSON.parse(text); } catch (e) { /* not JSON */ }
          if (res.ok && body) return body;
          var msg = body && (body.message || body.hint) ? body.message || body.hint : text.slice(0, 160);
          return { ok: false, error: 'The scoreboard server had a problem (' + res.status + '). ' + msg };
        });
      })
      .catch(function () {
        return { ok: false, offline: true, error: "Can't reach the scoreboard. Check your connection and try again." };
      });
  }

  /* ------------------------------------------------------------------
   * Demo mode: a stand-in for the database, kept in this browser only.
   * It follows the same rules as supabase/setup.sql.
   * ------------------------------------------------------------------ */
  var DEMO_KEY = 'golfLeagueDemoDB.v1';
  var TEAMS = [
    ['MIKE', 'RICH'], ['ZEB', 'TAT'], ['KEVIN', 'CHRIS'], ['BOB', 'TOM'], ['BRYAN', 'NEIL'], ['NATE', 'ADRIAN'],
    ['MIKE', 'CHIP'], ['EVAN', 'CHUCK'], ['ANDREW', 'ORLANDO'], ['MIKE', 'JAKE'], ['NICK', 'DUSTIN'],
    ['JIM', 'BILL'], ['ANDY', 'CHRIS'], ['JAROD', 'DAVE']
  ];
  var DEMO_ADMIN_PIN = '0000';
  var DEMO_TEAM_PIN = '1234';

  function cap(s) { return s.charAt(0) + s.slice(1).toLowerCase(); }
  // Demo only: a light scramble so PINs aren't kept as typed. The live database uses bcrypt.
  function hash(pin) {
    var h = 2166136261;
    var s = 'golf-demo:' + pin;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'demo$' + (h >>> 0).toString(16);
  }

  function seed() {
    var db = {
      league: { name: 'Indoor Golf League (demo)', settings: {}, current_week_id: null, admin_pin_hash: hash(DEMO_ADMIN_PIN) },
      tees: [
        { id: 1, name: 'Black', color: '#222222', yards: null, active: true, sort: 1 },
        { id: 2, name: 'Blue', color: '#2f6fdf', yards: null, active: true, sort: 2 },
        { id: 3, name: 'White', color: '#ffffff', yards: null, active: true, sort: 3 },
        { id: 4, name: 'Gold', color: '#e8b923', yards: null, active: true, sort: 4 },
        { id: 5, name: 'Red', color: '#d93838', yards: null, active: true, sort: 5 }
      ],
      teams: TEAMS.map(function (p, i) {
        return { id: i + 1, name: p[0] + '/' + p[1], player1: cap(p[0]), player2: cap(p[1]), tee1: 3, tee2: 3,
                 active: true, sort: i + 1, pin_hash: hash(DEMO_TEAM_PIN) };
      }),
      weeks: [], week_teams: [], cards: [], log: [], seq: 100
    };
    var start = new Date(Date.UTC(2026, 9, 26));
    for (var w = 1; w <= 8; w++) {
      var d = new Date(start.getTime() + (w - 1) * 7 * 86400000);
      db.weeks.push({ id: w, num: w, label: 'Week ' + w, play_date: d.toISOString().slice(0, 10), is_final: false,
                      course: '', pars: null, sis: null, tee_pars: {}, setup_done: false });
    }
    db.weeks.push({ id: 9, num: 9, label: 'Final', play_date: '2026-12-21', is_final: true,
                    course: '', pars: null, sis: null, tee_pars: {}, setup_done: false });

    // Sample: week 1 played by everyone but one team, week 2 open with a few cards in.
    var courses = [
      ['Pebble Beach', [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3], [8, 4, 2, 12, 10, 6, 11, 3, 1, 7, 5, 9]],
      ['St Andrews', [4, 4, 4, 4, 5, 4, 4, 3, 4, 4, 3, 4], [5, 9, 1, 7, 3, 11, 2, 12, 8, 6, 10, 4]]
    ];
    var rnd = 7;
    function r() { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280; }
    [1, 2].forEach(function (wid) {
      var wk = db.weeks[wid - 1], c = courses[wid - 1];
      wk.course = c[0]; wk.pars = c[1]; wk.sis = c[2]; wk.setup_done = true;
      db.teams.forEach(function (t) {
        var h = Math.floor(r() * 7);
        var tee = h > 4 ? 4 : h < 1 ? 2 : 3;
        db.week_teams.push({ week_id: wid, team_id: t.id, handicap: h, tee1: tee, tee2: tee });
        if (wid === 2 && t.id > 5) return;
        if (wid === 1 && t.id === 12) {
          db.cards.push({ week_id: 1, team_id: 12, gross: null, status: 'absent', entered_by: 'admin', submitted_at: wk.play_date + 'T23:00:00Z' });
          return;
        }
        var g = c[1].map(function (par) { var x = r(); return par + (x < 0.18 ? -1 : x < 0.68 ? 0 : x < 0.93 ? 1 : 2); });
        db.cards.push({ week_id: wid, team_id: t.id, gross: g, status: 'submitted', entered_by: 'team', submitted_at: wk.play_date + 'T22:00:00Z' });
      });
    });
    db.log.push({ id: 1, at: '2026-10-26T23:00:00Z', who: 'Admin', action: 'Marked absent', week_id: 1, team_id: 12,
                  old_value: null, new_value: { status: 'absent' }, reason: 'Out of town' });
    return db;
  }

  function load() {
    try {
      var raw = localStorage.getItem(DEMO_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* fall through */ }
    var db = seed();
    save(db);
    return db;
  }
  function save(db) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch (e) { /* private mode */ } }
  function err(msg) { return { ok: false, error: msg }; }
  function ok(extra) { return Object.assign({ ok: true }, extra || {}); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function validScores(g) {
    return Array.isArray(g) && g.length === 12 && g.every(function (x) { return Number.isInteger(x) && x >= 1 && x <= 30; });
  }
  function log(db, who, action, week, team, oldV, newV, reason) {
    db.log.unshift({ id: ++db.seq, at: new Date().toISOString(), who: (who || '').trim() || 'Admin', action: action,
                     week_id: week, team_id: team, old_value: oldV, new_value: newV, reason: reason || '' });
  }
  function find(list, pred) { return list.filter(pred)[0]; }
  function card(db, w, t) { return find(db.cards, function (c) { return c.week_id === w && c.team_id === t; }); }
  function adminOk(db, pin) {
    if (!db.league.admin_pin_hash) return 'No PIN has been set yet. Ask the league admin.';
    return hash(pin) === db.league.admin_pin_hash ? null : 'Wrong PIN. Try again.';
  }

  var demo = {
    get_league: function (db) {
      var d = clone(db);
      return ok({ data: {
        league: { name: d.league.name, settings: d.league.settings, current_week_id: d.league.current_week_id, admin_set: !!d.league.admin_pin_hash, demo: true },
        tees: d.tees,
        teams: d.teams.map(function (t) { var o = Object.assign({}, t, { has_pin: !!t.pin_hash }); delete o.pin_hash; return o; }),
        weeks: d.weeks, week_teams: d.week_teams, cards: d.cards, log: d.log
      } });
    },
    check_team_pin: function (db, p) {
      var t = find(db.teams, function (x) { return x.id === p.p_team_id && x.active; });
      if (!t || !t.pin_hash) return err('No PIN has been set yet. Ask the league admin.');
      return hash(p.p_pin) === t.pin_hash ? ok() : err('Wrong PIN. Try again.');
    },
    submit_card: function (db, p) {
      var w = find(db.weeks, function (x) { return x.id === p.p_week_id; });
      if (!w || !w.setup_done) return err('This week is not open for scores yet.');
      var t = find(db.teams, function (x) { return x.id === p.p_team_id && x.active; });
      if (!t) return err('Team not found.');
      var chk = demo.check_team_pin(db, p);
      if (!chk.ok) return chk;
      if (card(db, w.id, t.id)) return { ok: false, locked: true, error: 'This card is already submitted and locked.' };
      if (!find(db.week_teams, function (x) { return x.week_id === w.id && x.team_id === t.id; })) {
        return err('Your team is not set up for this week yet. Ask the league admin.');
      }
      if (!validScores(p.p_gross)) return err('Every hole needs a score between 1 and 30.');
      db.cards.push({ week_id: w.id, team_id: t.id, gross: p.p_gross, status: 'submitted', entered_by: 'team', submitted_at: new Date().toISOString() });
      log(db, t.name, 'Card submitted', w.id, t.id, null, p.p_gross, '');
      return ok();
    },
    admin_claim: function (db, p) {
      if (!/^\d{4,8}$/.test(p.p_new_pin || '')) return err('The admin PIN must be 4 to 8 digits.');
      if (db.league.admin_pin_hash) return err('An admin PIN is already set.');
      db.league.admin_pin_hash = hash(p.p_new_pin);
      return ok();
    },
    admin_check: function () { return ok(); },
    admin_change_pin: function (db, p) {
      if (!/^\d{4,8}$/.test(p.p_new_pin || '')) return err('The admin PIN must be 4 to 8 digits.');
      db.league.admin_pin_hash = hash(p.p_new_pin);
      log(db, p.p_who, 'Admin PIN changed', null, null, null, null, '');
      return ok();
    },
    admin_save_settings: function (db, p) {
      var old = { name: db.league.name, settings: db.league.settings, current_week_id: db.league.current_week_id };
      db.league.name = (p.p_name || '').trim() || db.league.name;
      db.league.settings = p.p_settings;
      db.league.current_week_id = p.p_current_week_id;
      log(db, p.p_who, 'Rules changed', null, null, old, { name: p.p_name, settings: p.p_settings, current_week_id: p.p_current_week_id }, '');
      return ok();
    },
    admin_save_tee: function (db, p) {
      var t = p.p_tee;
      if (!(t.name || '').trim()) return err('The tee needs a name.');
      var yards = t.yards === '' || t.yards == null ? null : parseInt(t.yards, 10);
      if (t.id == null) {
        db.tees.push({ id: ++db.seq, name: t.name.trim(), color: t.color || '#ffffff', yards: yards, active: true, sort: db.tees.length + 1 });
      } else {
        var e = find(db.tees, function (x) { return x.id === t.id; });
        if (e) { e.name = t.name.trim(); e.color = t.color || e.color; e.yards = yards; if (t.active != null) e.active = !!t.active; }
      }
      return ok();
    },
    admin_save_team: function (db, p) {
      var t = p.p_team;
      if (!(t.name || '').trim()) return err('The team needs a name.');
      if (t.id == null) {
        var n = { id: ++db.seq, name: t.name.trim(), player1: (t.player1 || '').trim(), player2: (t.player2 || '').trim(),
                  tee1: t.tee1, tee2: t.tee2, active: true, sort: db.teams.length + 1, pin_hash: null };
        db.teams.push(n);
        log(db, p.p_who, 'Team added', null, n.id, null, t, '');
        return ok({ id: n.id });
      }
      var e = find(db.teams, function (x) { return x.id === t.id; });
      if (!e) return err('Team not found.');
      var old = clone(e); delete old.pin_hash;
      e.name = t.name.trim(); e.player1 = (t.player1 || '').trim(); e.player2 = (t.player2 || '').trim();
      e.tee1 = t.tee1; e.tee2 = t.tee2; if (t.active != null) e.active = !!t.active;
      if (old.name !== e.name || old.active !== e.active) log(db, p.p_who, 'Team changed', null, e.id, old, t, '');
      return ok({ id: e.id });
    },
    admin_set_team_pin: function (db, p) {
      if (!/^\d{4}$/.test(p.p_new_pin || '')) return err('Team PINs are exactly 4 digits.');
      var e = find(db.teams, function (x) { return x.id === p.p_team_id; });
      if (!e) return err('Team not found.');
      e.pin_hash = hash(p.p_new_pin);
      log(db, p.p_who, 'Team PIN reset', null, e.id, null, null, '');
      return ok();
    },
    admin_save_week: function (db, p) {
      var w = p.p_week;
      if (!w.play_date) return err('Pick a date.');
      if (w.is_final && db.weeks.some(function (x) { return x.is_final && x.id !== w.id; })) {
        return err('There is already a final. Untick the other one first.');
      }
      if (w.id == null) {
        var n = { id: ++db.seq, num: w.num || 0, label: w.label || '', play_date: w.play_date, is_final: !!w.is_final,
                  course: '', pars: null, sis: null, tee_pars: {}, setup_done: false };
        db.weeks.push(n);
        log(db, p.p_who, 'Week added', n.id, null, null, w, '');
        return ok({ id: n.id });
      }
      var e = find(db.weeks, function (x) { return x.id === w.id; });
      var old = { num: e.num, label: e.label, play_date: e.play_date, is_final: e.is_final };
      e.num = w.num == null ? e.num : w.num; e.label = w.label == null ? e.label : w.label;
      e.play_date = w.play_date; e.is_final = w.is_final == null ? e.is_final : !!w.is_final;
      log(db, p.p_who, 'Schedule changed', e.id, null, old, w, '');
      return ok({ id: e.id });
    },
    admin_delete_week: function (db, p) {
      if (db.cards.some(function (c) { return c.week_id === p.p_week_id; })) return err("This week already has scores, so it can't be deleted.");
      var e = find(db.weeks, function (x) { return x.id === p.p_week_id; });
      db.weeks = db.weeks.filter(function (x) { return x.id !== p.p_week_id; });
      db.week_teams = db.week_teams.filter(function (x) { return x.week_id !== p.p_week_id; });
      if (db.league.current_week_id === p.p_week_id) db.league.current_week_id = null;
      log(db, p.p_who, 'Week deleted', null, null, e ? { label: e.label, play_date: e.play_date } : null, null, '');
      return ok();
    },
    admin_save_week_setup: function (db, p) {
      var w = find(db.weeks, function (x) { return x.id === p.p_week_id; });
      if (!w) return err('Week not found.');
      if (!(p.p_course || '').trim()) return err('Enter the course name.');
      if (!Array.isArray(p.p_pars) || p.p_pars.length !== 12 || p.p_pars.some(function (x) { return !(x >= 2 && x <= 7); })) {
        return err('Every hole needs a par between 2 and 7.');
      }
      if (!Array.isArray(p.p_sis) || p.p_sis.length !== 12 || p.p_sis.some(function (x) { return !(x >= 1 && x <= 18); })) {
        return err('Every hole needs a stroke index (hole handicap) between 1 and 18.');
      }
      var hasCards = db.cards.some(function (c) { return c.week_id === w.id; });
      if (hasCards && !(p.p_reason || '').trim()) return err('Scores are already in for this week. Please give a reason for the change.');
      if (hasCards && !p.p_open) return err('Scores are already in, so this week has to stay open.');
      var snap = function () {
        return { course: w.course, pars: w.pars, sis: w.sis, tee_pars: w.tee_pars, open: w.setup_done,
                 teams: db.week_teams.filter(function (x) { return x.week_id === w.id; })
                   .map(function (x) { return { team_id: x.team_id, handicap: x.handicap, tee1: x.tee1, tee2: x.tee2 }; })
                   .sort(function (a, b) { return a.team_id - b.team_id; }) };
      };
      var old = clone(snap());
      w.course = p.p_course.trim(); w.pars = p.p_pars; w.sis = p.p_sis; w.tee_pars = p.p_tee_pars || {}; w.setup_done = !!p.p_open;
      db.week_teams = db.week_teams.filter(function (x) { return x.week_id !== w.id; });
      (p.p_teams || []).forEach(function (x) {
        if (!find(db.teams, function (t) { return t.id === x.team_id; })) return;
        db.week_teams.push({ week_id: w.id, team_id: x.team_id, handicap: x.handicap || 0, tee1: x.tee1, tee2: x.tee2 == null ? x.tee1 : x.tee2 });
      });
      var neu = clone(snap());
      if (JSON.stringify(old) !== JSON.stringify(neu)) {
        log(db, p.p_who, hasCards ? 'Course/handicaps corrected' : 'Week set up', w.id, null, old, neu, p.p_reason);
      }
      return ok();
    },
    admin_save_card: function (db, p) {
      if (!find(db.weeks, function (x) { return x.id === p.p_week_id; })) return err('Week not found.');
      if (!find(db.teams, function (x) { return x.id === p.p_team_id; })) return err('Team not found.');
      var c = card(db, p.p_week_id, p.p_team_id);
      if (c && !(p.p_reason || '').trim()) return err('This card is already in. Please give a reason for the change.');
      var old = c ? { status: c.status, gross: c.gross } : null;
      var now = new Date().toISOString();
      if (p.p_action === 'set') {
        if (!validScores(p.p_gross)) return err('Every hole needs a score between 1 and 30.');
        if (!find(db.week_teams, function (x) { return x.week_id === p.p_week_id && x.team_id === p.p_team_id; })) {
          return err('Set up this team for the week first (Weekly setup).');
        }
        if (c) { c.gross = p.p_gross; c.status = 'submitted'; c.entered_by = 'admin'; }
        else db.cards.push({ week_id: p.p_week_id, team_id: p.p_team_id, gross: p.p_gross, status: 'submitted', entered_by: 'admin', submitted_at: now });
        log(db, p.p_who, c ? 'Card corrected' : 'Card entered by admin', p.p_week_id, p.p_team_id, old, { status: 'submitted', gross: p.p_gross }, p.p_reason);
      } else if (p.p_action === 'absent') {
        if (c) { c.gross = null; c.status = 'absent'; c.entered_by = 'admin'; }
        else db.cards.push({ week_id: p.p_week_id, team_id: p.p_team_id, gross: null, status: 'absent', entered_by: 'admin', submitted_at: now });
        log(db, p.p_who, 'Marked absent', p.p_week_id, p.p_team_id, old, { status: 'absent' }, p.p_reason);
      } else if (p.p_action === 'unlock') {
        if (!c) return err('There is no card to unlock.');
        db.cards = db.cards.filter(function (x) { return x !== c; });
        log(db, p.p_who, 'Card unlocked', p.p_week_id, p.p_team_id, old, null, p.p_reason);
      } else {
        return err('Unknown action.');
      }
      return ok();
    }
  };

  function demoCall(name, params) {
    var db = load();
    var fn = demo[name];
    if (!fn) return Promise.resolve(err('Unknown request.'));
    if (name.indexOf('admin_') === 0 && name !== 'admin_claim') {
      var e = adminOk(db, params.p_pin);
      if (e) return Promise.resolve(err(e));
    }
    var res = fn(db, clone(params || {}));
    if (res.ok && name !== 'get_league') save(db);
    return new Promise(function (resolve) { setTimeout(function () { resolve(res); }, 120); });
  }

  window.API = {
    live: live,
    call: live ? liveCall : demoCall,
    demoPins: { admin: DEMO_ADMIN_PIN, team: DEMO_TEAM_PIN },
    resetDemo: function () { try { localStorage.removeItem(DEMO_KEY); } catch (e) { /* ignore */ } }
  };
})();
