/*
 * The screens. All scoring math lives in scoring.js; all saving goes through api.js.
 */
(function () {
  'use strict';
  var Sc = window.Scoring, API = window.API;
  var app = document.getElementById('app');

  var data = null;       // raw league data from the server
  var season = null;     // computed results (Scoring.computeSeason)
  var loadError = null;
  var entry = { step: 'team' };   // player score-entry flow
  var adminCard = null;           // admin card editor
  var flash = null;               // one-time message shown on the next screen

  /* ---------- small helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Team name that wraps at the slash ("ANDREW/ ORLANDO") instead of mid-word.
  function tn(s) { return esc(s).replace(/\//g, '/<wbr>'); }
  function store(kind) {
    return {
      get: function (k, d) { try { var v = window[kind].getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
      set: function (k, v) { try { window[kind].setItem(k, JSON.stringify(v)); } catch (e) { /* storage off */ } },
      del: function (k) { try { window[kind].removeItem(k); } catch (e) { /* storage off */ } }
    };
  }
  var local = store('localStorage'), session = store('sessionStorage');

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtDate(iso, long) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString(undefined, long ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function fmtWhen(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function money(n) {
    n = Number(n) || 0;
    return '$' + (Math.round(n) === n ? String(n) : n.toFixed(2));
  }
  function signed(n) { return n === 0 ? 'E' : n > 0 ? '+' + n : String(n); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function teeById(id) { return (data.tees || []).filter(function (t) { return t.id === id; })[0] || null; }
  function teamById(id) { return (data.teams || []).filter(function (t) { return t.id === id; })[0] || null; }
  function weekById(id) { return (season.weeks || []).filter(function (w) { return w.id === Number(id); })[0] || null; }
  function activeTees() { return data.tees.filter(function (t) { return t.active; }); }
  function activeTeams() { return data.teams.filter(function (t) { return t.active; }); }
  function weekName(w) { return w ? (w.label || (w.is_final ? 'Final' : 'Week ' + w.num)) : ''; }
  function teeChip(id) {
    var t = teeById(id);
    if (!t) return '<span class="tee muted">no tee</span>';
    return '<span class="tee"><i style="background:' + esc(t.color) + '"></i>' + esc(t.name) + (t.active ? '' : ' (removed)') + '</span>';
  }
  function playersTees(team, tee1, tee2) {
    if (tee1 === tee2 || tee2 == null) return esc(team.player1 + ' & ' + team.player2) + ': ' + teeChip(tee1);
    return esc(team.player1) + ': ' + teeChip(tee1) + ' · ' + esc(team.player2) + ': ' + teeChip(tee2);
  }
  function scoreName(gross, par) {
    if (gross === 1) return 'Ace!';
    var d = gross - par;
    return ({ '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', '0': 'Par', '1': 'Bogey', '2': 'Double', '3': 'Triple' })[d] || (d > 0 ? '+' + d : String(d));
  }
  function dots(n) { return n > 0 ? new Array(n + 1).join('•') : n < 0 ? '−' + (-n) : ''; }
  function markClass(h) {
    if (h.capped) return 'mark capped';
    var d = h.entered - h.par;
    return 'mark' + (d <= -2 ? ' u2' : d === -1 ? ' u1' : d === 1 ? ' o1' : d >= 2 ? ' o2' : '');
  }
  function route() { return (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean); }
  function go(h) { if (location.hash === h) render(); else location.hash = h; }
  function resultFor(w) { return w ? season.results[w.id] : null; }
  function rowFor(w, teamId) {
    var r = resultFor(w);
    return r ? r.rows.filter(function (x) { return x.teamId === teamId; })[0] : null;
  }

  /* ---------- data ---------- */
  function refresh() {
    return API.call('get_league', {}).then(function (res) {
      if (!res.ok) { loadError = res.error; return; }
      loadError = null;
      data = res.data;
      data.teams.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0) || a.id - b.id; });
      season = Sc.computeSeason(data, todayISO());
    });
  }

  // Pages that redraw on their own when new scores come in.
  function isPassive() {
    var r = route()[0] || '';
    return ['', 'week', 'standings', 'weeks', 'final', 'log', 'more', 'rules'].indexOf(r) >= 0;
  }
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    refresh().then(function () { if (isPassive()) render(true); });
  }, 20000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refresh().then(function () { if (isPassive()) render(true); });
  });

  /* ---------- layout ---------- */
  function header(title, sub, backHref) {
    var demo = !API.live ? ' <span class="badge demo">DEMO</span>' : '';
    return '<header class="top">' +
      (backHref ? '<a class="back" href="' + backHref + '" aria-label="Back">‹</a>' : '<span class="flag" aria-hidden="true">⛳</span>') +
      '<div class="title"><h1>' + esc(title) + demo + '</h1>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div></header>';
  }
  function nav() {
    var r = route()[0] || '';
    var items = [['', '🏠', 'Home'], ['week', '📋', 'Cards'], ['standings', '🏆', 'Standings'], ['weeks', '📅', 'Weeks'], ['more', '☰', 'More']];
    return '<nav class="nav">' + items.map(function (it) {
      var on = r === it[0] || (it[0] === 'more' && ['final', 'log', 'admin', 'rules'].indexOf(r) >= 0);
      return '<a href="#/' + it[0] + '" class="' + (on ? 'on' : '') + '"><span class="ico" aria-hidden="true">' + it[1] + '</span>' + it[2] + '</a>';
    }).join('') + '</nav>';
  }
  function flashHtml() {
    if (!flash) return '';
    var h = '<div class="msg ' + (flash.ok ? 'ok' : 'err') + '">' + esc(flash.text) + '</div>';
    flash = null;
    return h;
  }

  function render(keepScroll) {
    var y = window.scrollY;
    if (!data) {
      app.innerHTML = loadError
        ? header('Scoreboard') + '<div class="panel notice danger"><p>' + esc(loadError) + '</p><button class="btn-block" data-act="retry">Try again</button></div>'
        : '<div class="loading">Loading the scoreboard…</div>';
      return;
    }
    var r = route();
    var html;
    switch (r[0] || '') {
      case '': html = viewHome(); break;
      case 'enter': html = viewEnter(); break;
      case 'week': html = viewWeek(r[1]); break;
      case 'standings': html = viewStandings(); break;
      case 'weeks': html = viewWeeks(); break;
      case 'final': html = viewFinal(); break;
      case 'log': html = viewLog(); break;
      case 'more': html = viewMore(); break;
      case 'rules': html = viewRules(); break;
      case 'admin': html = viewAdmin(r.slice(1)); break;
      default: html = viewHome();
    }
    app.innerHTML = html;
    if (keepScroll) window.scrollTo(0, y);
  }

  /* ---------- shared pieces ---------- */
  function leaderboard(res, opts) {
    opts = opts || {};
    var played = res.rows.filter(function (r) { return r.status === 'played'; });
    if (!played.length) return '<p class="muted">No cards in yet.</p>';
    var my = local.get('myTeam', null);
    var head = res.isFinal
      ? '<tr><th>Pos</th><th class="team">Team</th><th>Start</th><th>Net</th><th>Final</th><th>Prize</th></tr>'
      : '<tr><th>Pos</th><th class="team">Team</th><th>Gross</th><th>Net</th><th>Pts</th><th>$</th></tr>';
    var body = played.map(function (r) {
      var tie = r.tiedWith > 1 ? 'T' : '';
      var link = '#/week/' + res.week.id + '/' + r.teamId;
      var cells = res.isFinal
        ? '<td>' + signed(r.start) + '</td><td>' + r.score.total.net + '</td><td class="big">' + r.finalScore + '</td><td>' + (r.prize ? money(r.prize) : '–') + '</td>'
        : '<td>' + r.score.total.gross + '</td><td class="big">' + r.score.total.net + '</td><td>' + r.points + '</td><td>' + (r.payout ? money(r.payout) : '–') + '</td>';
      return '<tr class="' + (r.teamId === my ? 'me' : '') + '"><td class="pos">' + tie + r.place + '</td><td class="team"><a href="' + link + '">' + tn(r.team.name) + '</a></td>' + cells + '</tr>';
    }).join('');
    var rest = res.rows.filter(function (r) { return r.status !== 'played'; }).map(function (r) {
      return '<tr class="dim"><td>–</td><td class="team">' + tn(r.team.name) + '</td><td colspan="4">' + (r.status === 'absent' ? 'Did not play' : 'Not in yet') + '</td></tr>';
    }).join('');
    return '<div class="table-wrap"><table class="board">' + head + body + (opts.hideRest ? '' : rest) + '</table></div>';
  }

  function pendingNote(res) {
    if (!res.open || !res.pending.length) return '';
    return '<div class="panel notice"><b>Still to post (' + res.pending.length + '):</b> ' +
      res.pending.map(function (r) { return esc(r.team.name); }).join(', ') +
      '<p class="small muted">Results are not final until every team is in.</p></div>';
  }

  function sectionWinners(res) {
    if (!res.played) return '';
    var lines = res.sections.map(function (s) {
      if (!s.payout) return '<li><b>' + s.name + ':</b> ' + s.winners.map(function (w) { return esc(w.team.name); }).join(' & ') + ' (net ' + s.best + ')</li>';
      var names = s.winners.map(function (w) { return esc(w.team.name); }).join(' & ');
      var amt = s.winners.length > 1 ? 'tie, ' + money(s.each) + ' each' : money(s.each);
      return '<li><b>' + s.name + ':</b> ' + names + ' — net ' + s.best + ' <span class="badge warn">' + amt + '</span></li>';
    }).join('');
    return '<div class="panel"><h3>💰 Section winners' + (res.complete ? '' : ' so far') + '</h3><ul style="padding-left:20px;margin:8px 0 0">' + lines + '</ul></div>';
  }

  // Full read-only scorecard for one team: 3 sections of 4 holes.
  function cardGrid(row, res) {
    var sc = row.score;
    var winSecs = row.sectionWins || [];
    var html = Sc.SECTIONS.map(function (sec, si) {
      var hs = sc.holes.slice(sec.from, sec.to);
      var t = sc.sections[si];
      var won = winSecs.indexOf(si) >= 0;
      return '<table class="sc">' +
        '<tr class="hole"><th>Hole</th>' + hs.map(function (h, k) { return '<td>' + (sec.from + k + 1) + '</td>'; }).join('') + '<td class="sum">' + (sec.from + 1) + '-' + sec.to + '</td></tr>' +
        '<tr class="par"><th>Par</th>' + hs.map(function (h) { return '<td>' + h.par + '</td>'; }).join('') + '<td class="sum">' + t.par + '</td></tr>' +
        '<tr class="gross"><th>Score</th>' + hs.map(function (h) {
          var title = h.capped ? ' title="Entered ' + h.entered + ', counts as ' + h.gross + ' (Double Maxx)"' : '';
          return '<td><span class="' + markClass(h) + '"' + title + '>' + (h.capped ? h.gross + '*' : h.gross) + '</span><span class="dots">' + dots(h.strokes) + '</span></td>';
        }).join('') + '<td class="sum">' + t.gross + '</td></tr>' +
        '<tr class="net"><th>Net</th>' + hs.map(function (h) { return '<td>' + h.net + '</td>'; }).join('') +
        '<td class="sum' + (won ? ' win' : '') + '">' + t.net + (won ? ' 💰' : '') + '</td></tr>' +
        '</table>';
    }).join('');
    var anyCapped = sc.holes.some(function (h) { return h.capped; });
    html += '<div class="totals-line"><div><b>' + sc.total.gross + '</b><span>Gross</span></div><div><b>' + sc.total.strokes + '</b><span>Strokes</span></div><div><b>' + sc.total.net + '</b><span>Net</span></div>' +
      (res && res.isFinal ? '<div><b>' + signed(row.start) + '</b><span>Start</span></div><div><b>' + row.finalScore + '</b><span>Final</span></div>' : '') + '</div>';
    if (anyCapped) html += '<p class="small muted">* Double Maxx: score entered was higher; it counts as the max. Entered: ' +
      sc.holes.map(function (h, i) { return h.capped ? 'hole ' + (i + 1) + ' = ' + h.entered : null; }).filter(Boolean).join(', ') + '.</p>';
    html += '<p class="small muted">• = handicap stroke on that hole.</p>';
    return html;
  }

  function teamCard(row, res, open) {
    var placeBox = row.status === 'played'
      ? '<div class="place">' + (row.tiedWith > 1 ? 'T' : '') + row.place + '</div>'
      : '<div class="place none">–</div>';
    var tot = row.status === 'played'
      ? '<b>' + (res.isFinal ? row.finalScore : row.score.total.net) + '</b><span>' + (res.isFinal ? 'final' : 'net') + '</span>'
      : '<span>' + (row.status === 'absent' ? 'Did not play' : 'Not in yet') + '</span>';
    var extras = [];
    if (row.status === 'played' && !res.isFinal) extras.push(plural(row.points, 'pt', 'pts'));
    if (row.payout) extras.push(money(row.payout) + ' sections');
    if (row.prize) extras.push(money(row.prize) + ' prize');
    var body = '<div class="card-body"><p class="small">' + playersTees(row.team, row.tee1, row.tee2) + ' · Handicap ' + row.handicap +
      (row.card && row.card.entered_by === 'admin' ? ' · <span class="badge">entered by admin</span>' : '') + '</p>' +
      (row.status === 'played' ? cardGrid(row, res) : '') + '</div>';
    return '<details class="card" id="team-' + row.teamId + '"' + (open ? ' open' : '') + '><summary>' + placeBox +
      '<div class="who"><b>' + tn(row.team.name) + '</b><span>Hcp ' + row.handicap + (extras.length ? ' · ' + extras.join(' · ') : '') + '</span></div>' +
      '<div class="tot">' + tot + '</div></summary>' + body + '</details>';
  }

  /* ---------- Home ---------- */
  function viewHome() {
    var w = season.current;
    var name = data.league.name || 'Golf League';
    var html = header(name, 'Live scoreboard');
    if (!API.live) {
      html += '<div class="panel notice small"><b>Demo mode.</b> Scores stay on this device only. Team PIN is <b>' + API.demoPins.team +
        '</b>, admin PIN is <b>' + API.demoPins.admin + '</b>. <a href="#/more">Reset demo</a></div>';
    }
    if (!w) return html + '<div class="panel">No weeks on the schedule yet.</div>' + nav();
    var res = resultFor(w);
    html += '<div class="panel hero"><div class="wk">' + esc(weekName(w)) + ' · ' + fmtDate(w.play_date) + '</div>';
    if (!w.setup_done) {
      html += '<div class="course">⏳</div><p><b>Waiting for the admin to set this week\'s course.</b></p><p class="small muted">Check back soon. This page updates by itself.</p></div>';
    } else {
      html += '<div class="course">' + esc(w.course) + '</div><p class="muted small">Par ' + w.pars.reduce(function (a, b) { return a + b; }, 0) + ' · 12 holes · two-man scramble</p>' +
        '<a class="btn btn-primary btn-big" href="#/enter">⛳ Enter our score</a></div>';
    }
    if (w.setup_done) {
      html += '<h2>' + (w.is_final ? '🏆 Final leaderboard' : 'This week\'s leaderboard') + '</h2>' + leaderboard(res);
      html += pendingNote(res) + sectionWinners(res);
      html += '<a class="btn btn-block" href="#/week/' + w.id + '">See every scorecard</a>';
    }
    if (season.finalWeek && !w.is_final) {
      html += '<a class="btn btn-block" href="#/final">🏆 The Final · ' + fmtDate(season.finalWeek.play_date) + '</a>';
    }
    return html + nav();
  }

  /* ---------- Player score entry ---------- */
  function viewEnter() {
    var w = season.current;
    if (!w || !w.setup_done) {
      return header('Enter score', '', '#/') + '<div class="panel notice"><p><b>Waiting for the admin to set this week\'s course.</b></p><p>You can enter scores once that\'s done.</p></div>' + nav();
    }
    if (entry.weekId !== w.id) entry = { step: 'team', weekId: w.id };
    var team = entry.teamId ? teamById(entry.teamId) : null;
    var row = team ? rowFor(w, team.id) : null;
    if (row && row.card && entry.step !== 'done') entry.step = 'locked';

    if (entry.step === 'team' || !team) return enterTeam(w);
    if (entry.step === 'pin') return enterPin(w, team);
    if (entry.step === 'card') return enterCard(w, team, row);
    if (entry.step === 'review') return enterReview(w, team, row);
    return enterLocked(w, team, row);
  }

  function enterTeam(w) {
    var my = local.get('myTeam', null);
    var mine = my && teamById(my) && teamById(my).active ? teamById(my) : null;
    var html = header('Enter score', esc(weekName(w)) + ' · ' + esc(w.course), '#/');
    if (mine) {
      html += '<button class="btn-primary btn-big" data-act="pick-team" data-id="' + mine.id + '">We\'re ' + esc(mine.name) + '</button><h2>Or pick another team</h2>';
    } else {
      html += '<h2>Which team are you?</h2>';
    }
    html += activeTeams().filter(function (t) { return !mine || t.id !== mine.id; }).map(function (t) {
      var r = rowFor(w, t.id);
      var tag = r && r.card ? '<span class="badge ok">in ✓</span>' : '';
      return '<button class="list-btn" data-act="pick-team" data-id="' + t.id + '"><span>' + esc(t.name) +
        '<span class="sub">' + esc(t.player1 + ' & ' + t.player2) + '</span></span>' + tag + '</button>';
    }).join('');
    return html + nav();
  }

  function enterPin(w, team) {
    var n = (entry.pin || '').length;
    var html = header(team.name, 'Type your team\'s 4-digit PIN', '#/enter');
    html += '<div id="pinbox" class="' + (entry.shake ? 'shake' : '') + '"><div class="pin-dots">' + [0, 1, 2, 3].map(function (i) { return '<i class="' + (i < n ? 'on' : '') + '"></i>'; }).join('') + '</div></div>';
    if (entry.msg) html += '<div class="msg err center">' + esc(entry.msg) + '</div>';
    if (entry.checking) html += '<p class="center muted">Checking…</p>';
    if (!team.has_pin) html += '<div class="panel notice small">Your team has no PIN yet. Ask the league admin to set one.</div>';
    html += '<div class="keypad">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'clear'].map(function (k) {
      if (k === 'back') return '<button data-act="pin-key" data-k="back" aria-label="Delete">⌫</button>';
      if (k === 'clear') return '<button data-act="pin-key" data-k="clear" style="font-size:1rem">Clear</button>';
      return '<button data-act="pin-key" data-k="' + k + '">' + k + '</button>';
    }).join('') + '</div>';
    html += '<p class="center small muted" style="margin-top:20px">Not your team? <a href="#/enter" data-act="change-team">Pick again</a></p>';
    entry.shake = false;
    return html + nav();
  }

  function draftKey(w, team) { return 'draft:' + w.id + ':' + team.id; }

  function entryPars(row) { return row.pars; }

  function holeRows(ctx, gross, row) {
    var sc = Sc.scoreCard(gross, row.pars, row.strokes, season.settings);
    var html = '';
    Sc.SECTIONS.forEach(function (sec, si) {
      for (var i = sec.from; i < sec.to; i++) {
        var h = sc.holes[i];
        html += '<div class="hole-row">' +
          '<div class="info"><b>Hole ' + (i + 1) + '</b><span>Par ' + h.par + (h.strokes ? ' <span class="dots" title="Handicap stroke">' + dots(h.strokes) + '</span>' : '') + '</span></div>' +
          '<button data-act="dec" data-ctx="' + ctx + '" data-i="' + i + '" aria-label="One less on hole ' + (i + 1) + '">−</button>' +
          '<div class="val" id="v' + i + '">' + holeVal(h) + '</div>' +
          '<button class="plus" data-act="inc" data-ctx="' + ctx + '" data-i="' + i + '" aria-label="One more on hole ' + (i + 1) + '">+</button></div>';
      }
      html += '<div class="sec-bar" id="sec' + si + '">' + secBar(sc, si) + '</div>';
    });
    return html;
  }
  function holeVal(h) {
    return '<b>' + h.entered + '</b>' + (h.capped ? '<span class="capped">counts ' + h.gross + '</span>' : '<span>' + scoreName(h.entered, h.par) + '</span>');
  }
  function secBar(sc, si) {
    var t = sc.sections[si];
    return '<span>' + Sc.SECTIONS[si].name + '</span><span>Gross ' + t.gross + '</span><span class="net">Net ' + t.net + '</span>';
  }
  function footSum(sc) {
    return '<span>12 holes</span>Gross ' + sc.total.gross + ' · <span style="display:inline;color:var(--blue);font-size:inherit;text-transform:none;font-weight:800">Net ' + sc.total.net + '</span>';
  }
  function updateHoleDom(gross, row, i) {
    var sc = Sc.scoreCard(gross, row.pars, row.strokes, season.settings);
    var v = document.getElementById('v' + i);
    if (v) v.innerHTML = holeVal(sc.holes[i]);
    [0, 1, 2].forEach(function (si) { var el = document.getElementById('sec' + si); if (el) el.innerHTML = secBar(sc, si); });
    var f = document.getElementById('footsum');
    if (f) f.innerHTML = footSum(sc);
  }

  function enterCard(w, team, row) {
    if (!entry.gross) entry.gross = local.get(draftKey(w, team), null) || entryPars(row).slice();
    var sc = Sc.scoreCard(entry.gross, row.pars, row.strokes, season.settings);
    var html = '<div class="entry-head"><div class="team">' + esc(team.name) + '</div>' +
      '<div class="tees">' + esc(weekName(w)) + ' · ' + esc(w.course) + ' · Handicap ' + row.handicap + '</div>' +
      '<div class="tees">' + playersTees(team, row.tee1, row.tee2) + '</div></div>';
    html += '<p class="small muted">Tap + or − for each hole. Every hole starts at par. Your scores are saved on this phone as you go. ' +
      (row.handicap ? '<span style="color:var(--gold)">•</span> = you get a stroke on that hole.' : '') +
      (season.settings.doubleMaxxOn ? ' Double Maxx: the most that counts on a hole is ' + (season.settings.doubleMaxxMultiple === 2 ? 'double par' : season.settings.doubleMaxxMultiple + '× par') + '.' : '') + '</p>';
    html += holeRows('entry', entry.gross, row);
    html += '<div class="sticky-foot"><div class="inner"><div class="sum" id="footsum">' + footSum(sc) + '</div>' +
      '<button class="btn-primary" data-act="to-review">Review card ›</button></div></div>';
    return html;
  }

  function previewRow(row, gross) {
    return Object.assign({}, row, { score: Sc.scoreCard(gross, row.pars, row.strokes, season.settings), sectionWins: [] });
  }

  function enterReview(w, team, row) {
    var pr = previewRow(row, entry.gross);
    var html = header('Check your card', esc(team.name) + ' · ' + esc(w.course), null);
    html += '<p class="small">' + playersTees(team, row.tee1, row.tee2) + ' · Handicap ' + row.handicap + '</p>';
    html += '<div class="panel">' + cardGrid(pr, null) + '</div>';
    html += '<div class="panel notice danger"><b>⚠️ Once you submit, you can\'t change this card. Only the league admin can fix mistakes.</b></div>';
    if (entry.msg) html += '<div class="msg err">' + esc(entry.msg) + '</div>';
    html += '<button class="btn-green btn-big" data-act="submit-card"' + (entry.sending ? ' disabled' : '') + '>' + (entry.sending ? 'Sending…' : '✓ Submit our card') + '</button>';
    html += '<button class="btn-block" data-act="back-to-card">‹ Go back and fix a hole</button>';
    return html;
  }

  function enterLocked(w, team, row) {
    var res = resultFor(w);
    var html = header(team.name, esc(weekName(w)) + ' · ' + esc(w.course), '#/');
    if (entry.step === 'done') html += '<div class="panel notice good"><b>✓ Card submitted. Nice round!</b></div>';
    else html += '<div class="panel notice"><b>🔒 Your card for this week is already in and locked.</b></div>';
    html += '<p class="small muted">Only the league admin can fix mistakes.</p>';
    if (row && row.status === 'played') html += teamCard(row, res, true);
    else if (row && row.status === 'absent') html += '<div class="panel">The admin marked your team as not playing this week.</div>';
    html += '<a class="btn btn-block" href="#/">See the leaderboard</a>';
    return html + nav();
  }

  /* ---------- This week / any week ---------- */
  function viewWeek(id) {
    var w = id ? weekById(id) : season.current;
    if (!w) return header('Scorecards', '', '#/') + '<div class="panel">No weeks yet.</div>' + nav();
    var res = resultFor(w);
    var focus = Number(route()[2]) || null;
    var html = header(weekName(w) + (w.course ? ' · ' + w.course : ''), fmtDate(w.play_date, true), id ? '#/weeks' : null);
    if (!w.setup_done) return html + '<div class="panel notice">Waiting for the admin to set this week\'s course.</div>' + weekPicker(w) + nav();
    html += pendingNote(res);
    html += '<h2>Leaderboard</h2>' + leaderboard(res, { hideRest: true });
    html += sectionWinners(res);
    html += '<h2>Scorecards</h2><p class="small muted">Tap a team to open or close its card. Circles = under par, squares = over par.</p>';
    html += res.rows.map(function (r) { return teamCard(r, res, focus ? r.teamId === focus : r.status === 'played'); }).join('');
    html += weekPicker(w);
    if (focus) setTimeout(function () { var el = document.getElementById('team-' + focus); if (el) el.scrollIntoView(); }, 0);
    return html + nav();
  }

  function weekPicker(current) {
    return '<label for="wkpick">Jump to another week</label><select id="wkpick" data-change="go-week">' + season.weeks.map(function (w) {
      return '<option value="' + w.id + '"' + (current && w.id === current.id ? ' selected' : '') + '>' + esc(weekName(w)) + ' · ' + fmtDate(w.play_date) + (w.course ? ' · ' + esc(w.course) : '') + '</option>';
    }).join('') + '</select>';
  }

  /* ---------- Standings ---------- */
  function viewStandings() {
    var s = season.settings;
    var html = header('Season standings', 'Regular weeks only');
    var my = local.get('myTeam', null);
    html += '<div class="table-wrap"><table class="board compact"><tr><th>Pos</th><th class="team">Team</th><th>Pts</th><th>Net</th><th>Wins</th><th>Won</th><th>Start</th></tr>' +
      season.standings.map(function (r) {
        return '<tr class="' + (r.teamId === my ? 'me' : '') + '"><td class="pos">' + (r.tiedWith > 1 ? 'T' : '') + r.place + '</td><td class="team">' + tn(r.team.name) +
          '<div class="small muted" style="font-weight:400">' + plural(r.rounds, 'round', 'rounds') + (r.absences ? ', ' + r.absences + ' missed' : '') + '</div></td>' +
          '<td class="big">' + r.points + '</td><td>' + (r.rounds ? r.net : '–') + '</td><td>' + r.sectionWins + '</td><td>' + (r.totalMoney ? '$' + Math.round(r.totalMoney) : '–') + '</td>' +
          '<td><b>' + signed(r.startStrokes) + '</b></td></tr>';
      }).join('') + '</table></div>';
    html += '<div class="panel small"><p><b>Pts</b> = season points. <b>Net</b> = total net strokes for the season (lower is better). <b>Wins</b> = 4-hole sections won. ' +
      '<b>Won</b> = money won so far. <b>Start</b> = strokes you\'d start the final with if the season ended today.</p>' +
      '<p>Ties are broken by ' + (s.standingsTiebreak === 'wins-then-net' ? 'most section wins, then lowest ' + (s.netTiebreakBasis === 'average' ? 'average' : 'total') + ' net' : 'lowest ' + (s.netTiebreakBasis === 'average' ? 'average net per round' : 'total season net strokes') + ', then most section wins') + '.</p></div>';
    return html + nav();
  }

  /* ---------- Weeks list ---------- */
  function viewWeeks() {
    var html = header('All weeks', 'Tap a week to see its results');
    html += season.weeks.map(function (w) {
      var res = resultFor(w);
      var status = !w.setup_done ? '<span class="badge">Not set up</span>'
        : res.complete ? '<span class="badge ok">Final</span>'
        : '<span class="badge warn">' + res.played + ' in</span>';
      var winner = res && res.played ? res.rows.filter(function (r) { return r.place === 1; }).map(function (r) { return esc(r.team.name); }).join(' & ') : '';
      return '<a class="btn list-btn" href="#/' + (w.is_final ? 'final' : 'week/' + w.id) + '"><span>' + (w.is_final ? '🏆 ' : '') + esc(weekName(w)) +
        '<span class="sub">' + fmtDate(w.play_date) + (w.course ? ' · ' + esc(w.course) : '') + (winner ? ' · 1st: ' + winner : '') + '</span></span>' + status + '</a>';
    }).join('');
    return html + nav();
  }

  /* ---------- Final ---------- */
  function viewFinal() {
    var s = season.settings;
    var fw = season.finalWeek;
    var html = header('The Final', fw ? fmtDate(fw.play_date, true) + (fw.course ? ' · ' + esc(fw.course) : '') : 'Not scheduled');
    var pool = s.finalPrizes.reduce(function (a, b) { return a + b; }, 0);
    html += '<div class="panel hero"><div class="wk">Prize pool ' + money(pool) + '</div><p>' + s.finalPrizes.map(function (p, i) {
      return '<b>' + ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'][i] + '</b> ' + money(p);
    }).join(' · ') + '</p><p class="small muted">Final score = 12-hole net + starting strokes. Lowest wins. Ties split the prize money.</p></div>';
    if (!fw) return html + '<div class="panel">The admin hasn\'t put the final on the schedule yet.</div>' + nav();
    var res = season.final;
    if (fw.setup_done && res.played) {
      html += '<h2>Final leaderboard</h2>' + leaderboard(res) + pendingNote(res) + (s.payFinalSections ? sectionWinners(res) : '');
      html += '<a class="btn btn-block" href="#/week/' + fw.id + '">See every final scorecard</a>';
    } else {
      html += fw.setup_done ? '<div class="panel notice">The final is open. No cards in yet.</div>' : '';
      html += '<h2>Starting strokes' + (fw.setup_done ? '' : ' if the season ended today') + '</h2>';
      html += '<div class="table-wrap"><table class="board"><tr><th>Pos</th><th class="team">Team</th><th>Pts</th><th>Starts at</th></tr>' +
        season.standings.map(function (r) {
          return '<tr><td class="pos">' + (r.tiedWith > 1 ? 'T' : '') + r.place + '</td><td class="team">' + tn(r.team.name) + '</td><td>' + r.points + '</td><td class="big">' + signed(r.startStrokes) + '</td></tr>';
        }).join('') + '</table></div>';
    }
    return html + nav();
  }

  /* ---------- Change log ---------- */
  function diffText(e) {
    var o = e.old_value, n = e.new_value;
    var og = o && (Array.isArray(o) ? o : o.gross), ng = n && (Array.isArray(n) ? n : n.gross);
    if (e.action === 'Card submitted' && Array.isArray(n)) return 'Scores: ' + n.join(' ');
    if (og && ng) {
      var ch = [];
      for (var i = 0; i < 12; i++) if (og[i] !== ng[i]) ch.push('hole ' + (i + 1) + ': ' + og[i] + ' → ' + ng[i]);
      return ch.length ? ch.join(', ') : 'No score changes';
    }
    if (!o && ng) return 'Scores: ' + ng.join(' ');
    if (og && !n) return 'Removed card: ' + og.join(' ');
    if (o && o.status === 'absent' && !n) return 'Removed "did not play"';
    if (o && n && o.settings && n.settings) {
      var ns = Sc.normalizeSettings(n.settings), os = Sc.normalizeSettings(o.settings);
      var changed = Object.keys(ns).filter(function (k) { return JSON.stringify(ns[k]) !== JSON.stringify(os[k]); });
      if (o.name !== n.name) changed.unshift('league name');
      if (o.current_week_id !== n.current_week_id) changed.push('"this week" choice');
      return changed.length ? 'Changed: ' + changed.join(', ') : 'No changes';
    }
    if (o && n && (o.course !== undefined)) {
      var parts = [];
      if (o.course !== n.course) parts.push('course: "' + (o.course || '–') + '" → "' + n.course + '"');
      if (JSON.stringify(o.pars) !== JSON.stringify(n.pars)) parts.push('par: ' + (o.pars ? o.pars.join(' ') : '–') + ' → ' + n.pars.join(' '));
      if (JSON.stringify(o.sis) !== JSON.stringify(n.sis)) parts.push('stroke index: ' + (o.sis ? o.sis.join(' ') : '–') + ' → ' + n.sis.join(' '));
      if (JSON.stringify(o.tee_pars) !== JSON.stringify(n.tee_pars)) parts.push('tee pars changed');
      var oh = {}; (o.teams || []).forEach(function (t) { oh[t.team_id] = t; });
      (n.teams || []).forEach(function (t) {
        var p = oh[t.team_id];
        var tm = teamById(t.team_id);
        var nm = tm ? tm.name : 'team ' + t.team_id;
        if (p && p.handicap !== t.handicap) parts.push(nm + ' handicap ' + p.handicap + ' → ' + t.handicap);
        if (p && (p.tee1 !== t.tee1 || p.tee2 !== t.tee2)) parts.push(nm + ' tees changed');
      });
      if (o.open !== n.open) parts.push(n.open ? 'opened for scoring' : 'closed for scoring');
      return parts.join('; ');
    }
    return '';
  }

  function viewLog() {
    var html = header('Change log', 'Every submission and admin change, for everyone to see');
    var items = data.log || [];
    if (!items.length) return html + '<p class="muted">Nothing yet.</p>' + nav();
    html += items.slice(0, 300).map(function (e) {
      var w = e.week_id ? weekById(e.week_id) : null, t = e.team_id ? teamById(e.team_id) : null;
      var d = diffText(e);
      return '<div class="log-item"><div class="when">' + fmtWhen(e.at) + ' · by ' + esc(e.who) + '</div>' +
        '<div class="what">' + esc(e.action) + (t ? ' · ' + esc(t.name) : '') + (w ? ' · ' + esc(weekName(w)) : '') + '</div>' +
        (d ? '<div class="diff">' + esc(d) + '</div>' : '') + (e.reason ? '<div class="why">Reason: ' + esc(e.reason) + '</div>' : '') + '</div>';
    }).join('');
    return html + nav();
  }

  /* ---------- More & rules ---------- */
  function viewMore() {
    var html = header('More', '');
    html += '<a class="btn list-btn" href="#/final"><span>🏆 The Final<span class="sub">Prize money and starting strokes</span></span>›</a>';
    html += '<a class="btn list-btn" href="#/rules"><span>📖 League rules<span class="sub">How scoring works</span></span>›</a>';
    html += '<a class="btn list-btn" href="#/log"><span>📝 Change log<span class="sub">Every card and every admin fix</span></span>›</a>';
    html += '<a class="btn list-btn" href="#/admin"><span>🔑 League admin<span class="sub">For the admin only</span></span>›</a>';
    if (!API.live) html += '<h2>Demo</h2><button class="btn-block btn-danger" data-act="reset-demo">Reset demo data</button>';
    html += '<p class="small muted center" style="margin-top:24px">Tip: add this page to your home screen for one-tap access.</p>';
    return html + nav();
  }

  function viewRules() {
    var s = season.settings;
    var tiers = function (list, field, fmt) {
      var from = 1;
      return list.map(function (t) { var line = (from === t.upTo ? 'Place ' + from : 'Places ' + from + '-' + t.upTo) + ': ' + fmt(t[field]); from = t.upTo + 1; return line; }).join('<br>');
    };
    var html = header('League rules', '', '#/more');
    html += '<div class="panel"><ul style="padding-left:20px;margin:0">' +
      '<li>12 holes, two-man scramble. One team score per hole.</li>' +
      '<li>Each player plays from the tee box the admin sets each week. Handicaps cover the difference.</li>' +
      (s.doubleMaxxOn ? '<li><b>Double Maxx:</b> the most that counts on a hole is ' + (s.doubleMaxxMultiple === 2 ? 'double par (8 on a par 4)' : s.doubleMaxxMultiple + '× par') + ', before handicap strokes.</li>' : '<li>No maximum score per hole.</li>') +
      '<li><b>Handicap strokes:</b> a team with handicap 5 gets one stroke on each of the 5 hardest holes (by stroke index). Over 12, every hole gets one and the extras go to the hardest holes again.</li>' +
      '<li><b>Net</b> = score minus strokes.</li>' +
      '<li><b>Weekly payouts:</b> ' + money(s.sectionPayout) + ' for the lowest net on holes 1-4, 5-8 and 9-12. Ties split it.</li>' +
      '<li><b>Weekly points</b> (by 12-hole net):<br>' + tiers(s.pointsTiers, 'points', function (p) { return plural(p, 'point', 'points'); }) +
      '<br>' + (s.tiedPoints === 'better' ? 'Tied teams all get the better place\'s points.' : 'Tied teams share the points of the places they cover.') + ' Missing a week = ' + plural(s.absentPoints, 'point', 'points') + '.</li>' +
      '<li><b>Final starting strokes</b> (by season place):<br>' + tiers(s.finalStartTiers, 'strokes', signed) + '</li>' +
      '<li><b>Final prizes:</b> ' + s.finalPrizes.map(money).join(' / ') + '. Ties add up the tied places\' prizes and split them.</li>' +
      '<li>Once a card is submitted it is locked. Only the admin can fix it, and every fix shows in the change log.</li>' +
      '</ul></div>';
    return html + nav();
  }

  /* ======================================================================
   * Admin
   * ====================================================================== */
  function adminPin() { return session.get('adminPin', null); }
  function adminWho() { return local.get('adminWho', '') || 'Admin'; }
  function adminCall(name, params) {
    var from = location.hash;
    return API.call(name, Object.assign({ p_pin: adminPin(), p_who: adminWho() }, params)).then(function (res) {
      if (!res.ok && /wrong pin|too many/i.test(res.error || '')) session.del('adminPin');
      res.from = from;
      return res;
    });
  }
  // Shows the result of an admin save, unless the admin has already moved to another page.
  function afterSave(res, okText, href) {
    var from = res.from || location.hash;
    if (location.hash !== from) { if (res.ok) refresh(); return; }
    if (!res.ok) { flash = { ok: false, text: res.error }; render(true); return; }
    return refresh().then(function () {
      if (location.hash !== from) return;
      flash = { ok: true, text: okText };
      if (href) go(href); else render(true);
    });
  }

  function viewAdmin(r) {
    if (!data.league.admin_set) return adminClaim();
    if (!adminPin()) return adminLogin();
    var page = r[0] || '';
    switch (page) {
      case 'setup': return adminSetup(r[1]);
      case 'scores': return adminScores(r[1]);
      case 'card': return adminCardView(r[1], r[2]);
      case 'teams': return adminTeams();
      case 'tees': return adminTees();
      case 'schedule': return adminSchedule();
      case 'settings': return adminSettings();
      case 'export': return adminExport();
      case 'pin': return adminChangePin();
      default: return adminHome();
    }
  }

  function adminClaim() {
    return header('Admin setup', 'First time only', '#/more') + flashHtml() +
      '<div class="panel"><p>No admin PIN has been set yet. Choose one now (4 to 8 digits). Only the league admin should know it.</p>' +
      '<label for="np1">New admin PIN</label><input id="np1" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8">' +
      '<label for="np2">Type it again</label><input id="np2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8">' +
      '<button class="btn-primary btn-big" data-act="admin-claim">Set admin PIN</button></div>' + nav();
  }

  function adminLogin() {
    return header('League admin', 'Admin only', '#/more') + flashHtml() +
      '<div class="panel"><label for="who">Your name (shows in the change log)</label><input id="who" value="' + esc(local.get('adminWho', '')) + '" autocomplete="name">' +
      '<label for="apin">Admin PIN</label><input id="apin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8">' +
      '<button class="btn-primary btn-big" data-act="admin-login">Log in</button></div>' +
      (!API.live ? '<p class="small muted">Demo admin PIN: ' + API.demoPins.admin + '</p>' : '') + nav();
  }

  function adminHome() {
    var w = season.current;
    var res = resultFor(w);
    var html = header('League admin', 'Logged in as ' + esc(adminWho()), '#/more') + flashHtml();
    if (w) {
      html += '<div class="panel hero"><div class="wk">' + esc(weekName(w)) + ' · ' + fmtDate(w.play_date) + '</div>' +
        '<div class="course">' + (w.setup_done ? esc(w.course) : 'Not set up yet') + '</div>' +
        (w.setup_done ? '<p class="muted">' + res.played + ' cards in · ' + res.pending.length + ' to go</p>' : '<p class="muted">Players can\'t enter scores until you do the weekly setup.</p>') +
        '<a class="btn btn-primary btn-big" href="#/admin/setup/' + w.id + '">' + (w.setup_done ? 'Edit this week\'s setup' : '⛳ Set up this week') + '</a></div>';
    }
    var items = [
      ['scores' + (w ? '/' + w.id : ''), '✏️ Scores & fixes', 'Enter for a team, correct, unlock, mark absent'],
      ['setup', '⛳ Weekly setup (any week)', 'Course, par, stroke index, handicaps, tees'],
      ['teams', '👥 Teams & PINs', 'Names, players, usual tees, PINs'],
      ['tees', '🎯 Tee boxes', 'Add, rename, remove'],
      ['schedule', '📅 Schedule', 'Week dates and the final'],
      ['settings', '⚙️ Rules & settings', 'Double Maxx, payouts, points, final'],
      ['export', '📄 Download spreadsheet', 'CSV for Excel or Google Sheets'],
      ['pin', '🔑 Change admin PIN', '']
    ];
    html += items.map(function (it) {
      return '<a class="btn list-btn" href="#/admin/' + it[0] + '"><span>' + it[1] + (it[2] ? '<span class="sub">' + it[2] + '</span>' : '') + '</span>›</a>';
    }).join('');
    html += '<button class="btn-block btn-danger" data-act="admin-logout">Log out</button>';
    return html + nav();
  }

  function weekSelect(id, current, action) {
    return '<label for="' + id + '">Week</label><select id="' + id + '" data-change="' + action + '">' + season.weeks.map(function (w) {
      return '<option value="' + w.id + '"' + (current && w.id === current.id ? ' selected' : '') + '>' + esc(weekName(w)) + ' · ' + fmtDate(w.play_date) +
        (w.setup_done ? ' ✓' : '') + '</option>';
    }).join('') + '</select>';
  }

  function teeOptions(selected) {
    var list = data.tees.filter(function (t) { return t.active || t.id === selected; });
    return '<option value="">– none –</option>' + list.map(function (t) {
      return '<option value="' + t.id + '"' + (t.id === selected ? ' selected' : '') + '>' + esc(t.name) + (t.yards ? ' (' + t.yards + ' yds)' : '') + (t.active ? '' : ' (removed)') + '</option>';
    }).join('');
  }

  // Handicaps and tees to start from: this week's if saved, else the latest earlier week's, else each team's usual tees.
  function setupDefaults(w) {
    var mine = data.week_teams.filter(function (x) { return x.week_id === w.id; });
    if (mine.length) return { from: null, list: mine };
    var earlier = season.weeks.filter(function (x) { return Sc.weekSort(x, w) < 0 && data.week_teams.some(function (y) { return y.week_id === x.id; }); });
    var prev = earlier[earlier.length - 1];
    if (prev) return { from: prev, list: data.week_teams.filter(function (x) { return x.week_id === prev.id; }) };
    return { from: null, list: [] };
  }

  function adminSetup(id) {
    var w = id ? weekById(id) : season.current;
    if (!w) return header('Weekly setup', '', '#/admin') + '<div class="panel">Add weeks in Schedule first.</div>' + nav();
    var hasCards = data.cards.some(function (c) { return c.week_id === w.id; });
    var defs = setupDefaults(w);
    var html = header('Weekly setup', esc(weekName(w)) + ' · ' + fmtDate(w.play_date), '#/admin') + flashHtml();
    html += weekSelect('setupweek', w, 'go-setup');
    if (hasCards) html += '<div class="panel notice small"><b>Scores are already in for this week.</b> Any change here recalculates everyone\'s results and is logged with your reason.</div>';
    html += '<form id="setup" onsubmit="return false">';
    html += '<label for="course">Course name</label><input id="course" name="course" value="' + esc(w.course) + '" placeholder="e.g. Pebble Beach" autocomplete="off">';

    html += '<h2>Holes</h2><p class="small muted">Stroke index (hole handicap) is on the course scorecard: 1 = hardest. 18-hole numbers are fine.</p>';
    html += '<table class="setup-holes"><tr><th>Hole</th><th>Par</th><th>Stroke index</th></tr>';
    for (var i = 0; i < 12; i++) {
      var par = w.pars ? w.pars[i] : 4;
      html += '<tr><td>' + (i + 1) + '</td><td><div class="seg">' + [3, 4, 5].map(function (p) {
        return '<label><input type="radio" name="par' + i + '" value="' + p + '"' + (p === par ? ' checked' : '') + '><span>' + p + '</span></label>';
      }).join('') + '</div></td><td><input name="si' + i + '" type="number" inputmode="numeric" min="1" max="18" value="' + (w.sis ? w.sis[i] : '') + '" style="max-width:5em"></td></tr>';
    }
    html += '</table>';

    html += '<details class="more"' + (w.tee_pars && Object.keys(w.tee_pars).length ? ' open' : '') + '><summary>A tee box plays a different par this week?</summary>' +
      '<p class="small muted">Only fill this in if the scorecard shows a different par from a certain tee. Leave a box blank to use the course par above.</p>' +
      activeTees().map(function (t) {
        var o = (w.tee_pars || {})[String(t.id)] || [];
        return '<p>' + teeChip(t.id) + '</p><div class="tee-pars">' + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(function (k) {
          return '<input name="tp_' + t.id + '_' + k + '" type="number" inputmode="numeric" min="2" max="7" placeholder="' + (k + 1) + '" value="' + (o[k] && w.pars && o[k] !== w.pars[k] ? o[k] : '') + '" aria-label="' + esc(t.name) + ' hole ' + (k + 1) + ' par">';
        }).join('') + '</div>';
      }).join('') + '</details>';

    html += '<h2>Handicaps & tees</h2>';
    html += defs.from ? '<p class="small muted">Filled in from ' + esc(weekName(defs.from)) + '. Just change what moved.</p>' : '';
    var byTeam = {};
    defs.list.forEach(function (x) { byTeam[x.team_id] = x; });
    var teamsHere = data.teams.filter(function (t) { return t.active || data.week_teams.some(function (x) { return x.week_id === w.id && x.team_id === t.id; }); });
    html += teamsHere.map(function (t) {
      var d = byTeam[t.id] || { handicap: 0, tee1: t.tee1, tee2: t.tee2 };
      var same = d.tee1 === d.tee2;
      return '<div class="team-setup"><div class="field-row" style="align-items:center"><div class="name">' + tn(t.name) + '</div>' +
        '<div style="flex:0 0 auto"><div class="small muted">Handicap</div><div class="stepper">' +
        '<button type="button" data-act="hcp" data-d="-1" data-team="' + t.id + '" aria-label="Lower handicap">−</button>' +
        '<input name="hcp_' + t.id + '" type="number" inputmode="numeric" value="' + d.handicap + '" aria-label="' + esc(t.name) + ' handicap">' +
        '<button type="button" data-act="hcp" data-d="1" data-team="' + t.id + '" aria-label="Raise handicap">+</button></div></div></div>' +
        '<label class="check"><input type="checkbox" name="same_' + t.id + '" data-change="same-tee" data-team="' + t.id + '"' + (same ? ' checked' : '') + '> Both on the same tee</label>' +
        '<div class="tee-pick"><span>' + (same ? 'Both' : esc(t.player1)) + '</span><select name="tee1_' + t.id + '" id="tee1lbl_' + t.id + '" aria-label="Tee">' + teeOptions(d.tee1) + '</select></div>' +
        '<div class="tee-pick' + (same ? ' hidden' : '') + '" id="tee2row_' + t.id + '"><span>' + esc(t.player2) + '</span><select name="tee2_' + t.id + '" aria-label="' + esc(t.player2) + ' tee">' + teeOptions(d.tee2) + '</select></div></div>';
    }).join('');

    if (hasCards) html += '<label for="reason">Reason for the change (required)</label><textarea id="reason" name="reason" placeholder="e.g. Hole 7 is par 3, not par 4"></textarea>';
    html += '</form>';
    html += '<button class="btn-green btn-big" data-act="save-setup" data-week="' + w.id + '" data-open="1">' + (w.setup_done ? 'Save changes' : '✓ Save & open for scores') + '</button>';
    if (!hasCards) html += '<button class="btn-block" data-act="save-setup" data-week="' + w.id + '" data-open="0">Save, but don\'t open yet</button>';
    return html + nav();
  }

  function readSetup(weekId, open) {
    var f = document.getElementById('setup');
    var fd = new FormData(f);
    var pars = [], sis = [];
    for (var i = 0; i < 12; i++) { pars.push(Number(fd.get('par' + i))); sis.push(Number(fd.get('si' + i))); }
    var teePars = {};
    activeTees().forEach(function (t) {
      var vals = [], any = false;
      for (var k = 0; k < 12; k++) {
        var v = fd.get('tp_' + t.id + '_' + k);
        if (v !== null && v !== '') { vals.push(Number(v)); any = true; } else vals.push(pars[k]);
      }
      if (any && vals.some(function (v, k) { return v !== pars[k]; })) teePars[String(t.id)] = vals;
    });
    var teams = [];
    data.teams.forEach(function (t) {
      var h = fd.get('hcp_' + t.id);
      if (h === null) return;
      var tee1 = fd.get('tee1_' + t.id) ? Number(fd.get('tee1_' + t.id)) : null;
      var same = fd.get('same_' + t.id) !== null;
      var tee2 = same ? tee1 : (fd.get('tee2_' + t.id) ? Number(fd.get('tee2_' + t.id)) : null);
      teams.push({ team_id: t.id, handicap: Math.trunc(Number(h) || 0), tee1: tee1, tee2: tee2 });
    });
    return { p_week_id: weekId, p_course: String(fd.get('course') || ''), p_pars: pars, p_sis: sis, p_tee_pars: teePars, p_teams: teams, p_open: open, p_reason: String(fd.get('reason') || '') };
  }

  function adminScores(id) {
    var w = id ? weekById(id) : season.current;
    if (!w) return header('Scores & fixes', '', '#/admin') + nav();
    var res = resultFor(w);
    var html = header('Scores & fixes', esc(weekName(w)) + (w.course ? ' · ' + esc(w.course) : ''), '#/admin') + flashHtml();
    html += weekSelect('scoreweek', w, 'go-scores');
    if (!w.setup_done) html += '<div class="panel notice small">This week isn\'t set up yet. <a href="#/admin/setup/' + w.id + '">Set it up</a> before entering scores.</div>';
    html += '<p class="small muted">Tap a team to enter, correct, unlock or mark as not playing.</p>';
    html += res.rows.slice().sort(function (a, b) { return (a.team.sort || 0) - (b.team.sort || 0); }).map(function (r) {
      var badge = r.status === 'played' ? '<span class="badge ok">Net ' + r.score.total.net + '</span>' : r.status === 'absent' ? '<span class="badge bad">Absent</span>' : '<span class="badge warn">Not in</span>';
      return '<a class="btn list-btn" href="#/admin/card/' + w.id + '/' + r.teamId + '"><span>' + tn(r.team.name) +
        '<span class="sub">' + (r.card ? (r.card.entered_by === 'admin' ? 'Entered by admin' : 'Submitted by team') + ' · ' + fmtWhen(r.card.submitted_at) : 'No card yet') + '</span></span>' + badge + '</a>';
    }).join('');
    return html + nav();
  }

  function adminCardView(weekId, teamId) {
    var w = weekById(weekId), t = teamById(Number(teamId));
    if (!w || !t) return header('Card', '', '#/admin') + '<div class="panel">Not found.</div>' + nav();
    var res = resultFor(w);
    var row = rowFor(w, t.id);
    if (!adminCard || adminCard.weekId !== w.id || adminCard.teamId !== t.id) {
      adminCard = { weekId: w.id, teamId: t.id, gross: row.card && row.card.gross ? row.card.gross.slice() : row.pars.slice() };
    }
    var html = header(t.name, esc(weekName(w)) + (w.course ? ' · ' + esc(w.course) : ''), '#/admin/scores/' + w.id) + flashHtml();
    html += '<p class="small">' + playersTees(t, row.tee1, row.tee2) + ' · Handicap ' + row.handicap + (row.setUp ? '' : ' <span class="badge bad">not in this week\'s setup</span>') + '</p>';
    if (row.status === 'played') html += '<h2>Current card</h2>' + teamCard(row, res, false);
    else if (row.status === 'absent') html += '<div class="panel notice">Marked as not playing this week.</div>';
    else html += '<div class="panel">No card yet.</div>';
    if (!w.setup_done) return html + '<div class="panel notice">Set up this week first.</div>' + nav();

    html += '<h2>' + (row.card ? 'Correct the scores' : 'Enter scores for this team') + '</h2>';
    html += holeRows('admin', adminCard.gross, row);
    html += '<div class="panel"><div id="footsum" class="sum">' + footSum(Sc.scoreCard(adminCard.gross, row.pars, row.strokes, season.settings)) + '</div></div>';
    html += '<label for="reason">Reason' + (row.card ? ' (required)' : ' (optional)') + '</label><textarea id="reason" placeholder="e.g. Team entered 5 on hole 3, they had a 4"></textarea>';
    html += '<button class="btn-green btn-big" data-act="admin-card" data-a="set">Save these scores</button>';
    html += '<div class="btn-row">' +
      (row.status !== 'absent' ? '<button data-act="admin-card" data-a="absent">Mark as not playing</button>' : '') +
      (row.card ? '<button class="btn-danger" data-act="admin-card" data-a="unlock">Unlock for the team</button>' : '') + '</div>';
    html += '<p class="small muted">"Unlock" removes this card so the team can enter it again themselves.</p>';
    return html + nav();
  }

  function adminTeams() {
    var html = header('Teams & PINs', '', '#/admin') + flashHtml();
    if (adminCard && adminCard.newPins) {
      html += '<div class="panel notice good"><h3>New PINs: write these down now</h3><p class="small">They can\'t be shown again. Give each team its own PIN.</p><table class="pin-list">' +
        adminCard.newPins.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td>' + p.pin + '</td></tr>'; }).join('') + '</table>' +
        '<button class="btn-block" data-act="hide-pins">I\'ve written them down</button></div>';
    }
    html += '<button class="btn-block" data-act="all-pins">🎲 Make new random PINs for every team</button>';
    html += data.teams.map(function (t) {
      return '<details class="card"><summary><div class="who"><b>' + tn(t.name) + (t.active ? '' : ' <span class="badge bad">inactive</span>') + '</b><span>' +
        esc(t.player1 + ' & ' + t.player2) + ' · ' + (t.has_pin ? 'PIN set ✓' : '<span style="color:var(--red)">No PIN</span>') + '</span></div></summary><div class="card-body">' + teamForm(t) + '</div></details>';
    }).join('');
    html += '<h2>Add a team</h2><div class="panel">' + teamForm(null) + '</div>';
    return html + nav();
  }

  function teamForm(t) {
    var p = t ? 't' + t.id : 'tnew';
    t = t || { id: null, name: '', player1: '', player2: '', tee1: null, tee2: null, active: true };
    var html = '<label for="' + p + 'n">Team name</label><input id="' + p + 'n" value="' + esc(t.name) + '">' +
      '<div class="field-row"><div><label for="' + p + 'p1">Player 1</label><input id="' + p + 'p1" value="' + esc(t.player1) + '"></div>' +
      '<div><label for="' + p + 'p2">Player 2</label><input id="' + p + 'p2" value="' + esc(t.player2) + '"></div></div>' +
      '<div class="field-row"><div><label for="' + p + 't1">Player 1 usual tee</label><select id="' + p + 't1">' + teeOptions(t.tee1) + '</select></div>' +
      '<div><label for="' + p + 't2">Player 2 usual tee</label><select id="' + p + 't2">' + teeOptions(t.tee2) + '</select></div></div>';
    if (t.id) html += '<label class="check"><input type="checkbox" id="' + p + 'a"' + (t.active ? ' checked' : '') + '> Active this season</label>';
    html += '<button class="btn-primary btn-block" data-act="save-team" data-id="' + (t.id || '') + '">' + (t.id ? 'Save team' : 'Add team') + '</button>';
    if (t.id) {
      html += '<label for="' + p + 'pin">New 4-digit PIN</label><div class="field-row"><input id="' + p + 'pin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="e.g. 4821">' +
        '<button data-act="set-pin" data-id="' + t.id + '" style="flex:0 0 auto">Set PIN</button></div>';
    }
    return html;
  }

  function adminTees() {
    var html = header('Tee boxes', '', '#/admin') + flashHtml();
    html += '<p class="small muted">These are the choices in weekly setup. Removing a tee hides it from new weeks; past weeks keep it.</p>';
    html += data.tees.map(function (t) { return '<div class="panel">' + teeForm(t) + '</div>'; }).join('');
    html += '<h2>Add a tee box</h2><div class="panel">' + teeForm(null) + '</div>';
    return html + nav();
  }

  function teeForm(t) {
    var p = t ? 'e' + t.id : 'enew';
    t = t || { id: null, name: '', color: '#ffffff', yards: '', active: true };
    return '<div class="field-row"><div><label for="' + p + 'n">Name</label><input id="' + p + 'n" value="' + esc(t.name) + '" placeholder="e.g. Blue"></div>' +
      '<div style="flex:0 0 auto"><label for="' + p + 'c">Color</label><input id="' + p + 'c" type="color" value="' + esc(t.color || '#ffffff') + '"></div>' +
      '<div style="flex:0 0 6em"><label for="' + p + 'y">Yards</label><input id="' + p + 'y" type="number" inputmode="numeric" value="' + (t.yards || '') + '" placeholder="opt."></div></div>' +
      (t.id && !t.active ? '<p class="badge bad">Removed</p>' : '') +
      '<div class="btn-row"><button class="btn-primary" data-act="save-tee" data-id="' + (t.id || '') + '">' + (t.id ? 'Save' : 'Add tee box') + '</button>' +
      (t.id ? '<button class="' + (t.active ? 'btn-danger' : '') + '" data-act="toggle-tee" data-id="' + t.id + '">' + (t.active ? 'Remove' : 'Bring back') + '</button>' : '') + '</div>';
  }

  function adminSchedule() {
    var html = header('Schedule', '', '#/admin') + flashHtml();
    html += '<p class="small muted">One entry per league night. Tick "Final" on the championship night (only one).</p>';
    html += season.weeks.map(function (w) { return '<div class="panel">' + weekForm(w) + '</div>'; }).join('');
    var last = season.weeks.filter(function (w) { return !w.is_final; }).slice(-1)[0];
    var next = { id: null, num: last ? last.num + 1 : 1, label: 'Week ' + (last ? last.num + 1 : 1), play_date: last ? Sc.addDays(last.play_date, 7) : todayISO(), is_final: false };
    html += '<h2>Add a week</h2><div class="panel">' + weekForm(next) + '</div>';
    return html + nav();
  }

  function weekForm(w) {
    var p = w.id ? 'w' + w.id : 'wnew';
    var hasCards = w.id && data.cards.some(function (c) { return c.week_id === w.id; });
    return '<div class="field-row"><div><label for="' + p + 'l">Name</label><input id="' + p + 'l" value="' + esc(w.label) + '"></div>' +
      '<div style="flex:0 0 5em"><label for="' + p + 'n">No.</label><input id="' + p + 'n" type="number" inputmode="numeric" value="' + (w.num || '') + '"></div></div>' +
      '<label for="' + p + 'd">Date</label><input id="' + p + 'd" type="date" value="' + esc(w.play_date || '') + '">' +
      '<label class="check"><input type="checkbox" id="' + p + 'f"' + (w.is_final ? ' checked' : '') + '> 🏆 This is the Final</label>' +
      '<div class="btn-row"><button class="btn-primary" data-act="save-week" data-id="' + (w.id || '') + '">' + (w.id ? 'Save' : 'Add week') + '</button>' +
      (w.id && !hasCards ? '<button class="btn-danger" data-act="del-week" data-id="' + w.id + '">Delete</button>' : '') + '</div>';
  }

  function adminSettings() {
    var s = season.settings;
    var html = header('Rules & settings', 'Changes apply to every week, past and present', '#/admin') + flashHtml();
    var tierRows = function (name, list, field, label) {
      var rows = list.concat([{ upTo: '', points: '', strokes: '' }]);
      return rows.map(function (t, i) {
        return '<div class="field-row" style="align-items:center;margin:6px 0"><span style="flex:0 0 auto">Places up to</span><input name="' + name + '_up_' + i + '" type="number" inputmode="numeric" value="' + t.upTo + '" style="max-width:5em">' +
          '<span style="flex:0 0 auto">' + label + '</span><input name="' + name + '_v_' + i + '" type="number" inputmode="numeric" step="any" value="' + t[field] + '" style="max-width:5em"></div>';
      }).join('');
    };
    html += '<form id="settings" onsubmit="return false">';
    html += '<label for="lname">League name</label><input id="lname" name="lname" value="' + esc(data.league.name) + '">';
    html += '<label for="cw">"This week" is</label><select id="cw" name="cw"><option value="">Picked automatically by date</option>' + season.weeks.map(function (w) {
      return '<option value="' + w.id + '"' + (data.league.current_week_id === w.id ? ' selected' : '') + '>' + esc(weekName(w)) + ' · ' + fmtDate(w.play_date) + '</option>';
    }).join('') + '</select><p class="small muted">Automatic: a week stays "this week" until <input name="grace" type="number" inputmode="numeric" value="' + s.currentWeekGraceDays + '" style="max-width:4em;min-height:36px;padding:4px"> days after its date.</p>';

    html += '<h2>Double Maxx</h2><label class="check"><input type="checkbox" name="dmOn"' + (s.doubleMaxxOn ? ' checked' : '') + '> Cap each hole\'s score</label>' +
      '<div class="field-row" style="align-items:center"><span style="flex:0 0 auto">Most that counts = par ×</span><input name="dmMult" type="number" inputmode="decimal" step="0.5" value="' + s.doubleMaxxMultiple + '" style="max-width:5em"></div>';
    html += '<label for="mixed">If a team\'s two tees have a different par on a hole, use</label><select id="mixed" name="mixed">' +
      [['higher', 'the higher par'], ['lower', 'the lower par'], ['course', 'the course par']].map(function (o) { return '<option value="' + o[0] + '"' + (s.mixedTeePar === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';

    html += '<h2>Weekly payouts</h2><div class="field-row" style="align-items:center"><span style="flex:0 0 auto">$ per 4-hole section</span><input name="payout" type="number" inputmode="decimal" step="any" value="' + s.sectionPayout + '" style="max-width:6em"></div>' +
      '<label class="check"><input type="checkbox" name="payFinal"' + (s.payFinalSections ? ' checked' : '') + '> Also pay the sections on final day</label>';

    html += '<h2>Weekly points</h2>' + tierRows('pt', s.pointsTiers, 'points', 'get points') +
      '<label for="tied">Tied teams</label><select id="tied" name="tied"><option value="better"' + (s.tiedPoints === 'better' ? ' selected' : '') + '>all get the better place\'s points</option><option value="average"' + (s.tiedPoints === 'average' ? ' selected' : '') + '>share the points of the places they cover</option></select>' +
      '<div class="field-row" style="align-items:center;margin-top:10px"><span style="flex:0 0 auto">Points for missing a week</span><input name="absent" type="number" inputmode="numeric" step="any" value="' + s.absentPoints + '" style="max-width:5em"></div>';

    html += '<h2>Standings tiebreak</h2><select name="tb"><option value="net-then-wins"' + (s.standingsTiebreak === 'net-then-wins' ? ' selected' : '') + '>Lowest net, then most section wins</option><option value="wins-then-net"' + (s.standingsTiebreak === 'wins-then-net' ? ' selected' : '') + '>Most section wins, then lowest net</option></select>' +
      '<label for="basis">"Lowest net" means</label><select id="basis" name="basis"><option value="total"' + (s.netTiebreakBasis === 'total' ? ' selected' : '') + '>total net strokes for the season</option><option value="average"' + (s.netTiebreakBasis === 'average' ? ' selected' : '') + '>average net per round played (fairer if a team missed a week)</option></select>';

    html += '<h2>Final starting strokes</h2>' + tierRows('fs', s.finalStartTiers, 'strokes', 'start at') + '<p class="small muted">Use −2 for "2 under", 0 for even.</p>';
    html += '<h2>Final prize money</h2><div class="field-row">' + s.finalPrizes.concat(['', '']).map(function (p, i) {
      return '<div><label for="prize' + i + '" class="small">' + ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'][i] + '</label><input id="prize' + i + '" name="prize' + i + '" type="number" inputmode="numeric" value="' + p + '"></div>';
    }).slice(0, 6).join('') + '</div>';
    html += '<h2>Score entry</h2><div class="field-row" style="align-items:center"><span style="flex:0 0 auto">Highest score the + button goes to</span><input name="maxEntry" type="number" inputmode="numeric" value="' + s.maxEntry + '" style="max-width:5em"></div>';
    html += '</form><button class="btn-green btn-big" data-act="save-settings">Save rules</button>';
    html += '<button class="btn-block" data-act="default-settings">Put back the original league rules</button>';
    return html + nav();
  }

  function readSettings() {
    var fd = new FormData(document.getElementById('settings'));
    var tiers = function (name, field) {
      var out = [];
      for (var i = 0; i < 10; i++) {
        var up = fd.get(name + '_up_' + i), v = fd.get(name + '_v_' + i);
        if (up === null) break;
        if (up === '' || v === '') continue;
        var o = { upTo: Number(up) }; o[field] = Number(v); out.push(o);
      }
      return out;
    };
    var prizes = [];
    for (var i = 0; i < 6; i++) { var p = fd.get('prize' + i); if (p !== null && p !== '') prizes.push(Number(p)); }
    var settings = Sc.normalizeSettings({
      doubleMaxxOn: fd.get('dmOn') !== null, doubleMaxxMultiple: fd.get('dmMult'), sectionPayout: fd.get('payout'),
      payFinalSections: fd.get('payFinal') !== null, pointsTiers: tiers('pt', 'points'), tiedPoints: fd.get('tied'),
      absentPoints: fd.get('absent'), standingsTiebreak: fd.get('tb'), netTiebreakBasis: fd.get('basis'),
      finalStartTiers: tiers('fs', 'strokes'), finalPrizes: prizes, mixedTeePar: fd.get('mixed'), maxEntry: fd.get('maxEntry'),
      currentWeekGraceDays: fd.get('grace')
    });
    return { p_name: String(fd.get('lname') || ''), p_settings: settings, p_current_week_id: fd.get('cw') ? Number(fd.get('cw')) : null };
  }

  function csvCell(v) {
    v = v == null ? '' : String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function download(name, rows) {
    var text = '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function teeName(id) { var t = teeById(id); return t ? t.name : ''; }

  function exportScores() {
    var head = ['Week', 'Date', 'Course', 'Final?', 'Team', 'Player 1', 'Player 1 tee', 'Player 2', 'Player 2 tee', 'Handicap', 'Status'];
    for (var i = 1; i <= 12; i++) head.push('Hole ' + i);
    head = head.concat(['Gross 1-4', 'Net 1-4', 'Gross 5-8', 'Net 5-8', 'Gross 9-12', 'Net 9-12', 'Gross total', 'Strokes', 'Net total', 'Start strokes', 'Final score', 'Place', 'Points', 'Section $', 'Prize $', 'Entered by']);
    var rows = [head];
    season.weeks.forEach(function (w) {
      var res = resultFor(w);
      if (!w.setup_done) return;
      res.rows.forEach(function (r) {
        var sc = r.score;
        var line = [weekName(w), w.play_date, w.course, w.is_final ? 'yes' : '', r.team.name, r.team.player1, teeName(r.tee1), r.team.player2, teeName(r.tee2), r.handicap,
          r.status === 'played' ? 'played' : r.status === 'absent' ? 'did not play' : 'not in'];
        for (var i = 0; i < 12; i++) line.push(r.card && r.card.gross ? r.card.gross[i] : '');
        if (sc) line = line.concat([sc.sections[0].gross, sc.sections[0].net, sc.sections[1].gross, sc.sections[1].net, sc.sections[2].gross, sc.sections[2].net, sc.total.gross, sc.total.strokes, sc.total.net]);
        else line = line.concat(['', '', '', '', '', '', '', '', '']);
        line = line.concat([res.isFinal ? r.start : '', res.isFinal && sc ? r.finalScore : '', r.place || '', res.isFinal ? '' : r.points, r.payout || 0, r.prize || 0, r.card ? r.card.entered_by : '']);
        rows.push(line);
      });
    });
    download('league-scores.csv', rows);
  }
  function exportStandings() {
    var rows = [['Place', 'Team', 'Players', 'Points', 'Rounds', 'Missed', 'Total net', 'Average net', 'Section wins', 'Section $ (regular weeks)', 'Final $', 'Total $', 'Final start']];
    season.standings.forEach(function (r) {
      rows.push([r.place, r.team.name, r.team.player1 + ' & ' + r.team.player2, r.points, r.rounds, r.absences, r.net, r.avgNet == null ? '' : r.avgNet, r.sectionWins, r.money, r.finalMoney || 0, r.totalMoney, signed(r.startStrokes)]);
    });
    download('league-standings.csv', rows);
  }
  function exportLog() {
    var rows = [['When', 'Who', 'What', 'Week', 'Team', 'Details', 'Reason']];
    (data.log || []).forEach(function (e) {
      var w = e.week_id ? weekById(e.week_id) : null, t = e.team_id ? teamById(e.team_id) : null;
      rows.push([new Date(e.at).toLocaleString(), e.who, e.action, w ? weekName(w) : '', t ? t.name : '', diffText(e), e.reason]);
    });
    download('league-change-log.csv', rows);
  }

  function adminExport() {
    return header('Download spreadsheet', 'Opens in Excel, Numbers or Google Sheets', '#/admin') +
      '<button class="btn-primary btn-big" data-act="csv" data-k="scores">📄 Every card, every week</button>' +
      '<button class="btn-big" data-act="csv" data-k="standings">🏆 Season standings</button>' +
      '<button class="btn-big" data-act="csv" data-k="log">📝 Change log</button>' + nav();
  }

  function adminChangePin() {
    return header('Change admin PIN', '', '#/admin') + flashHtml() + '<div class="panel">' +
      '<label for="np1">New admin PIN (4 to 8 digits)</label><input id="np1" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password">' +
      '<label for="np2">Type it again</label><input id="np2" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password">' +
      '<button class="btn-primary btn-big" data-act="admin-newpin">Change PIN</button></div>' + nav();
  }

  /* ======================================================================
   * Actions
   * ====================================================================== */
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function checked(id) { var el = document.getElementById(id); return !!(el && el.checked); }
  function numOrNull(v) { return v === '' || v == null ? null : Number(v); }

  var actions = {
    retry: function () { refresh().then(function () { render(); }); },

    'pick-team': function (el) {
      var id = Number(el.dataset.id);
      entry = { step: 'pin', weekId: season.current.id, teamId: id, pin: '' };
      render();
      window.scrollTo(0, 0);
    },
    'change-team': function (el, ev) { ev.preventDefault(); entry = { step: 'team', weekId: season.current.id }; render(); },
    'pin-key': function (el) {
      if (entry.checking) return;
      var k = el.dataset.k;
      entry.msg = '';
      if (k === 'back') entry.pin = (entry.pin || '').slice(0, -1);
      else if (k === 'clear') entry.pin = '';
      else if ((entry.pin || '').length < 4) entry.pin = (entry.pin || '') + k;
      if (entry.pin.length === 4) {
        entry.checking = true;
        render();
        API.call('check_team_pin', { p_team_id: entry.teamId, p_pin: entry.pin }).then(function (res) {
          entry.checking = false;
          if (!res.ok) { entry.msg = res.error; entry.pin = ''; entry.shake = true; render(); return; }
          local.set('myTeam', entry.teamId);
          return refresh().then(function () { entry.step = 'card'; entry.gross = null; render(); window.scrollTo(0, 0); });
        });
        return;
      }
      render();
    },
    inc: function (el) { bump(el, 1); },
    dec: function (el) { bump(el, -1); },
    'to-review': function () { entry.step = 'review'; entry.msg = ''; render(); window.scrollTo(0, 0); },
    'back-to-card': function () { entry.step = 'card'; render(); window.scrollTo(0, 0); },
    'submit-card': function () {
      if (entry.sending) return;
      var w = season.current, team = teamById(entry.teamId);
      entry.sending = true; entry.msg = ''; render();
      API.call('submit_card', { p_week_id: w.id, p_team_id: team.id, p_pin: entry.pin, p_gross: entry.gross }).then(function (res) {
        entry.sending = false;
        if (res.ok || res.locked) {
          if (res.ok) local.del(draftKey(w, team));
          return refresh().then(function () { entry.step = res.ok ? 'done' : 'locked'; render(); window.scrollTo(0, 0); });
        }
        entry.msg = res.error;
        if (/wrong pin/i.test(res.error || '')) { entry.step = 'pin'; entry.pin = ''; }
        render();
      });
    },

    'reset-demo': function () {
      if (!confirm('Erase all demo scores and start the demo over?')) return;
      API.resetDemo(); session.del('adminPin'); entry = { step: 'team' };
      refresh().then(function () { go('#/'); });
    },

    'admin-claim': function () {
      var a = val('np1'), b = val('np2');
      if (a !== b) { flash = { ok: false, text: 'The two PINs don\'t match.' }; render(); return; }
      API.call('admin_claim', { p_new_pin: a }).then(function (res) {
        if (!res.ok) { flash = { ok: false, text: res.error }; render(); return; }
        session.set('adminPin', a);
        refresh().then(function () { flash = { ok: true, text: 'Admin PIN set. Keep it safe.' }; go('#/admin'); });
      });
    },
    'admin-login': function () {
      var pin = val('apin');
      local.set('adminWho', val('who').trim());
      API.call('admin_check', { p_pin: pin }).then(function (res) {
        if (!res.ok) { flash = { ok: false, text: res.error }; render(); return; }
        session.set('adminPin', pin);
        render();
      });
    },
    'admin-logout': function () { session.del('adminPin'); go('#/'); },
    'admin-newpin': function () {
      var a = val('np1'), b = val('np2');
      if (a !== b) { flash = { ok: false, text: 'The two PINs don\'t match.' }; render(); return; }
      adminCall('admin_change_pin', { p_new_pin: a }).then(function (res) {
        if (res.ok) session.set('adminPin', a);
        afterSave(res, 'Admin PIN changed.', '#/admin');
      });
    },

    hcp: function (el) {
      var input = document.querySelector('input[name="hcp_' + el.dataset.team + '"]');
      input.value = (Math.trunc(Number(input.value) || 0)) + Number(el.dataset.d);
    },
    'save-setup': function (el) {
      var p = readSetup(Number(el.dataset.week), el.dataset.open === '1');
      if (!p.p_course.trim()) { flash = { ok: false, text: 'Enter the course name.' }; render(true); return; }
      var missing = p.p_sis.map(function (v, i) { return v ? null : i + 1; }).filter(Boolean);
      if (missing.length) { flash = { ok: false, text: 'Enter the stroke index for hole ' + missing.join(', ') + '.' }; render(true); restoreSetup(p); return; }
      var seen = {}, dup = [];
      p.p_sis.forEach(function (v) { if (seen[v]) dup.push(v); seen[v] = 1; });
      if (dup.length && !confirm('Stroke index ' + dup.join(', ') + ' is used on more than one hole. Save anyway?')) return;
      var noTee = p.p_teams.filter(function (t) { return !t.tee1; }).length;
      if (noTee && !confirm(plural(noTee, 'team has', 'teams have') + ' no tee box picked. Save anyway?')) return;
      adminCall('admin_save_week_setup', p).then(function (res) {
        if (!res.ok) { flash = { ok: false, text: res.error }; render(true); restoreSetup(p); return; }
        refresh().then(function () { flash = { ok: true, text: p.p_open ? 'Saved. Players can now enter scores.' : 'Saved (not open yet).' }; go('#/admin'); });
      });
    },
    'admin-card': function (el) {
      var a = el.dataset.a;
      var reason = val('reason');
      var row = rowFor(weekById(adminCard.weekId), adminCard.teamId);
      if (row.card && !reason.trim()) { flash = { ok: false, text: 'Please give a reason. It shows in the change log.' }; render(true); return; }
      if (a === 'unlock' && !confirm('Remove this card so the team can enter it again?')) return;
      if (a === 'absent' && !confirm('Mark this team as not playing this week? They get no points or payouts.')) return;
      adminCall('admin_save_card', { p_week_id: adminCard.weekId, p_team_id: adminCard.teamId, p_action: a, p_gross: a === 'set' ? adminCard.gross : null, p_reason: reason })
        .then(function (res) {
          var wk = adminCard.weekId;
          if (res.ok) adminCard = null;
          afterSave(res, a === 'set' ? 'Scores saved.' : a === 'absent' ? 'Marked as not playing.' : 'Card unlocked. The team can enter it again.', res.ok ? '#/admin/scores/' + wk : null);
        });
    },
    'save-team': function (el) {
      var id = el.dataset.id ? Number(el.dataset.id) : null;
      var p = id ? 't' + id : 'tnew';
      var team = { id: id, name: val(p + 'n'), player1: val(p + 'p1'), player2: val(p + 'p2'), tee1: numOrNull(val(p + 't1')), tee2: numOrNull(val(p + 't2')) };
      if (id) team.active = checked(p + 'a');
      adminCall('admin_save_team', { p_team: team }).then(function (res) { afterSave(res, id ? 'Team saved.' : 'Team added. Now set its PIN.'); });
    },
    'set-pin': function (el) {
      var id = Number(el.dataset.id);
      var pin = val('t' + id + 'pin').trim();
      if (!/^\d{4}$/.test(pin)) { flash = { ok: false, text: 'A team PIN is exactly 4 digits.' }; render(true); return; }
      adminCall('admin_set_team_pin', { p_team_id: id, p_new_pin: pin }).then(function (res) { afterSave(res, 'PIN set for ' + teamById(id).name + '.'); });
    },
    'all-pins': function () {
      if (!confirm('Give every active team a new random PIN? Their old PINs stop working.')) return;
      var list = activeTeams().map(function (t) {
        var pin = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        if (window.crypto && crypto.getRandomValues) pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
        return { id: t.id, name: t.name, pin: pin };
      });
      var done = [];
      var next = function (i) {
        if (i >= list.length) {
          adminCard = { newPins: done };
          return refresh().then(function () { render(); window.scrollTo(0, 0); });
        }
        return adminCall('admin_set_team_pin', { p_team_id: list[i].id, p_new_pin: list[i].pin }).then(function (res) {
          if (!res.ok) { adminCard = { newPins: done }; flash = { ok: false, text: 'Stopped at ' + list[i].name + ': ' + res.error }; render(); return; }
          done.push(list[i]);
          return next(i + 1);
        });
      };
      next(0);
    },
    'hide-pins': function () { adminCard = null; render(); },
    'save-tee': function (el) {
      var id = el.dataset.id ? Number(el.dataset.id) : null;
      var p = id ? 'e' + id : 'enew';
      adminCall('admin_save_tee', { p_tee: { id: id, name: val(p + 'n'), color: val(p + 'c'), yards: val(p + 'y') } }).then(function (res) { afterSave(res, 'Tee box saved.'); });
    },
    'toggle-tee': function (el) {
      var t = teeById(Number(el.dataset.id));
      adminCall('admin_save_tee', { p_tee: { id: t.id, name: t.name, color: t.color, yards: t.yards == null ? '' : String(t.yards), active: !t.active } })
        .then(function (res) { afterSave(res, t.active ? 'Tee box removed.' : 'Tee box is back.'); });
    },
    'save-week': function (el) {
      var id = el.dataset.id ? Number(el.dataset.id) : null;
      var p = id ? 'w' + id : 'wnew';
      var wk = { id: id, label: val(p + 'l'), num: numOrNull(val(p + 'n')), play_date: val(p + 'd'), is_final: checked(p + 'f') };
      adminCall('admin_save_week', { p_week: wk }).then(function (res) { afterSave(res, id ? 'Week saved.' : 'Week added.'); });
    },
    'del-week': function (el) {
      if (!confirm('Delete this week from the schedule?')) return;
      adminCall('admin_delete_week', { p_week_id: Number(el.dataset.id) }).then(function (res) { afterSave(res, 'Week deleted.'); });
    },
    'save-settings': function () {
      adminCall('admin_save_settings', readSettings()).then(function (res) { afterSave(res, 'Rules saved. All results recalculated.'); });
    },
    'default-settings': function () {
      if (!confirm('Put every rule back to the original league sheet?')) return;
      adminCall('admin_save_settings', { p_name: data.league.name, p_settings: Sc.normalizeSettings({}), p_current_week_id: null })
        .then(function (res) { afterSave(res, 'Original rules restored.'); });
    },
    csv: function (el) {
      ({ scores: exportScores, standings: exportStandings, log: exportLog })[el.dataset.k]();
    }
  };

  // Puts the admin's typed setup back after a failed save so nothing is lost.
  function restoreSetup(p) {
    var f = document.getElementById('setup');
    if (!f) return;
    f.elements.course.value = p.p_course;
    p.p_pars.forEach(function (v, i) { var r = f.querySelector('input[name="par' + i + '"][value="' + v + '"]'); if (r) r.checked = true; });
    p.p_sis.forEach(function (v, i) { f.elements['si' + i].value = v || ''; });
    p.p_teams.forEach(function (t) {
      if (f.elements['hcp_' + t.team_id]) f.elements['hcp_' + t.team_id].value = t.handicap;
      if (f.elements['tee1_' + t.team_id]) f.elements['tee1_' + t.team_id].value = t.tee1 || '';
      if (f.elements['tee2_' + t.team_id]) f.elements['tee2_' + t.team_id].value = t.tee2 || '';
    });
    if (f.elements.reason) f.elements.reason.value = p.p_reason;
  }

  function bump(el, d) {
    var i = Number(el.dataset.i);
    var ctx = el.dataset.ctx;
    var max = season.settings.maxEntry;
    var w, team, row, gross;
    if (ctx === 'entry') {
      w = season.current; team = teamById(entry.teamId); row = rowFor(w, team.id); gross = entry.gross;
    } else {
      w = weekById(adminCard.weekId); row = rowFor(w, adminCard.teamId); gross = adminCard.gross;
    }
    gross[i] = Math.max(1, Math.min(max, gross[i] + d));
    if (ctx === 'entry') local.set(draftKey(w, team), gross);
    updateHoleDom(gross, row, i);
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el || !actions[el.dataset.act]) return;
    actions[el.dataset.act](el, ev);
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    var a = el.dataset && el.dataset.change;
    if (a === 'go-week') go('#/week/' + el.value);
    else if (a === 'go-setup') go('#/admin/setup/' + el.value);
    else if (a === 'go-scores') go('#/admin/scores/' + el.value);
    else if (a === 'same-tee') {
      var id = el.dataset.team;
      document.getElementById('tee2row_' + id).classList.toggle('hidden', el.checked);
      var lbl = document.getElementById('tee1lbl_' + id).previousElementSibling;
      var t = teamById(Number(id));
      lbl.textContent = el.checked ? 'Both' : t.player1;
    }
  });
  window.addEventListener('hashchange', function () {
    var r = route();
    if (r[0] !== 'admin' || r[1] !== 'card') adminCard = adminCard && adminCard.newPins && r[1] === 'teams' ? adminCard : null;
    render();
    window.scrollTo(0, 0);
  });

  refresh().then(function () { render(); });
})();
