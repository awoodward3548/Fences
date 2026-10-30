/*
 * League scoring math. Every number the app shows comes from this file.
 * Pure functions only: no database, no page, no clock (today's date is passed in).
 * Works in the browser (window.Scoring) and in Node (require) for the tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Scoring = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HOLES = 12;
  var SECTIONS = [
    { name: 'Holes 1-4', from: 0, to: 4 },
    { name: 'Holes 5-8', from: 4, to: 8 },
    { name: 'Holes 9-12', from: 8, to: 12 }
  ];

  var DEFAULT_SETTINGS = {
    doubleMaxxOn: true,          // cap each hole's gross score
    doubleMaxxMultiple: 2,       // cap = par x this (2 = double par)
    sectionPayout: 50,           // $ per 4-hole section each week
    payFinalSections: false,     // also pay the 3 sections on final day ($100 x 28 players = 8 weeks x $150 + $1600 pool, so off)
    pointsTiers: [               // weekly points by place
      { upTo: 3, points: 3 },
      { upTo: 10, points: 2 },
      { upTo: 14, points: 1 }
    ],
    tiedPoints: 'better',        // 'better': tied teams all get the better place's points; 'average': share the places' points
    absentPoints: 0,             // points for a team that didn't play
    standingsTiebreak: 'net-then-wins', // or 'wins-then-net'
    netTiebreakBasis: 'total',   // 'total' season net strokes, or 'average' net per round played
    finalStartTiers: [           // final-day starting strokes by season place
      { upTo: 3, strokes: -2 },
      { upTo: 10, strokes: -1 },
      { upTo: 14, strokes: 0 }
    ],
    finalPrizes: [700, 400, 300, 200],
    mixedTeePar: 'higher',       // when a team's two tees have different par on a hole: 'higher', 'lower' or 'course'
    maxEntry: 15,                // biggest number the +/- buttons go to
    currentWeekGraceDays: 3      // a week stays "this week" until this many days after its date
  };

  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function cleanTiers(tiers, field, fallback) {
    if (!Array.isArray(tiers) || !tiers.length) return fallback.map(function (t) { return Object.assign({}, t); });
    return tiers
      .map(function (t) {
        var o = { upTo: Math.max(1, Math.trunc(num(t && t.upTo, 1))) };
        o[field] = num(t && t[field], 0);
        return o;
      })
      .sort(function (a, b) { return a.upTo - b.upTo; });
  }

  function normalizeSettings(s) {
    s = s || {};
    var d = DEFAULT_SETTINGS;
    var out = Object.assign({}, d, s);
    out.doubleMaxxOn = s.doubleMaxxOn === undefined ? d.doubleMaxxOn : !!s.doubleMaxxOn;
    out.doubleMaxxMultiple = Math.max(1, num(s.doubleMaxxMultiple, d.doubleMaxxMultiple));
    out.sectionPayout = Math.max(0, num(s.sectionPayout, d.sectionPayout));
    out.payFinalSections = s.payFinalSections === undefined ? d.payFinalSections : !!s.payFinalSections;
    out.pointsTiers = cleanTiers(s.pointsTiers, 'points', d.pointsTiers);
    out.finalStartTiers = cleanTiers(s.finalStartTiers, 'strokes', d.finalStartTiers);
    out.absentPoints = num(s.absentPoints, d.absentPoints);
    out.finalPrizes = Array.isArray(s.finalPrizes)
      ? s.finalPrizes.map(function (p) { return Math.max(0, num(p, 0)); })
      : d.finalPrizes.slice();
    if (['better', 'average'].indexOf(out.tiedPoints) < 0) out.tiedPoints = d.tiedPoints;
    if (['net-then-wins', 'wins-then-net'].indexOf(out.standingsTiebreak) < 0) out.standingsTiebreak = d.standingsTiebreak;
    if (['total', 'average'].indexOf(out.netTiebreakBasis) < 0) out.netTiebreakBasis = d.netTiebreakBasis;
    if (['higher', 'lower', 'course'].indexOf(out.mixedTeePar) < 0) out.mixedTeePar = d.mixedTeePar;
    out.maxEntry = Math.max(8, Math.trunc(num(s.maxEntry, d.maxEntry)));
    out.currentWeekGraceDays = Math.max(0, Math.trunc(num(s.currentWeekGraceDays, d.currentWeekGraceDays)));
    return out;
  }

  /* ---------- Holes, strokes and one card ---------- */

  // Hole indexes ordered hardest to easiest (lowest stroke index first; ties go to the earlier hole).
  function holeOrder(sis) {
    var list = [];
    for (var i = 0; i < HOLES; i++) list.push({ i: i, si: num(sis && sis[i], 99) || 99 });
    list.sort(function (a, b) { return a.si - b.si || a.i - b.i; });
    return list.map(function (x) { return x.i; });
  }

  // Strokes a team gets on each hole. H strokes go to the H hardest holes; past 12 they wrap around.
  // A negative (plus) handicap gives strokes back on the easiest holes.
  function strokesPerHole(handicap, sis) {
    var h = Math.trunc(num(handicap, 0));
    var out = [];
    for (var k = 0; k < HOLES; k++) out.push(0);
    if (!h) return out;
    var order = holeOrder(sis);
    if (h < 0) order.reverse();
    var n = Math.abs(h), sign = h < 0 ? -1 : 1;
    var base = Math.floor(n / HOLES), extra = n % HOLES;
    order.forEach(function (holeIdx, rank) {
      out[holeIdx] = sign * (base + (rank < extra ? 1 : 0));
    });
    return out;
  }

  function validPars(p) {
    return Array.isArray(p) && p.length === HOLES && p.every(function (x) { return num(x, 0) > 0; });
  }

  function parsForTee(week, teeId) {
    var override = week && week.tee_pars && teeId != null ? week.tee_pars[String(teeId)] : null;
    if (validPars(override)) return override.map(Number);
    return (week && validPars(week.pars) ? week.pars : [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]).map(Number);
  }

  // Par used for a team on each hole (matters for the Double Maxx cap and where the +/- buttons start).
  function teamPars(week, tee1, tee2, settings) {
    var s = normalizeSettings(settings);
    var a = parsForTee(week, tee1), b = parsForTee(week, tee2 == null ? tee1 : tee2);
    var course = parsForTee(week, null);
    return a.map(function (p, i) {
      if (p === b[i]) return p;
      if (s.mixedTeePar === 'lower') return Math.min(p, b[i]);
      if (s.mixedTeePar === 'course') return course[i];
      return Math.max(p, b[i]);
    });
  }

  function capFor(par, settings) {
    var s = normalizeSettings(settings);
    return s.doubleMaxxOn ? Math.floor(par * s.doubleMaxxMultiple) : Infinity;
  }

  function emptyTotals() { return { gross: 0, strokes: 0, net: 0, holes: 0 }; }

  // Scores one card. Missing holes (null) are skipped so running totals work while entering.
  function scoreCard(gross, pars, strokes, settings) {
    var s = normalizeSettings(settings);
    var holes = [];
    for (var i = 0; i < HOLES; i++) {
      var g = gross && gross[i] != null && gross[i] !== '' ? Math.trunc(num(gross[i], NaN)) : null;
      if (g !== null && !isFinite(g)) g = null;
      var cap = capFor(pars[i], s);
      var capped = g === null ? null : Math.min(g, cap);
      holes.push({
        par: pars[i],
        entered: g,
        gross: capped,
        capped: g !== null && g > cap,
        cap: cap,
        strokes: strokes[i] || 0,
        net: capped === null ? null : capped - (strokes[i] || 0)
      });
    }
    var sections = SECTIONS.map(function (sec) {
      var t = emptyTotals();
      t.par = 0;
      for (var i = sec.from; i < sec.to; i++) {
        t.par += holes[i].par;
        if (holes[i].gross === null) continue;
        t.gross += holes[i].gross;
        t.strokes += holes[i].strokes;
        t.net += holes[i].net;
        t.holes++;
      }
      t.complete = t.holes === sec.to - sec.from;
      return t;
    });
    var total = emptyTotals();
    total.par = 0;
    sections.forEach(function (t) {
      total.gross += t.gross; total.strokes += t.strokes; total.net += t.net; total.holes += t.holes; total.par += t.par;
    });
    total.complete = total.holes === HOLES;
    return { holes: holes, sections: sections, total: total };
  }

  /* ---------- Places, points, prizes ---------- */

  // Standard competition ranking: 1, 2, 2, 4. `compare` returns <0 when a is better than b.
  function assignPlaces(items, compare) {
    var sorted = items.slice().sort(compare);
    var place = 0;
    sorted.forEach(function (it, idx) {
      if (idx === 0 || compare(sorted[idx - 1], it) !== 0) place = idx + 1;
      it.place = place;
    });
    sorted.forEach(function (it) {
      it.tiedWith = sorted.filter(function (o) { return o.place === it.place; }).length;
    });
    return sorted;
  }

  function tierValue(place, tiers, field) {
    for (var i = 0; i < tiers.length; i++) if (place <= tiers[i].upTo) return tiers[i][field];
    return 0;
  }

  function pointsForPlace(place, tiedWith, settings) {
    var s = normalizeSettings(settings);
    if (s.tiedPoints === 'average' && tiedWith > 1) {
      var sum = 0;
      for (var k = 0; k < tiedWith; k++) sum += tierValue(place + k, s.pointsTiers, 'points');
      return round2(sum / tiedWith);
    }
    return tierValue(place, s.pointsTiers, 'points');
  }

  function startStrokesForPlace(place, settings) {
    return tierValue(place, normalizeSettings(settings).finalStartTiers, 'strokes');
  }

  // Tied teams add up the prizes for the places they cover and split it.
  function prizeForPlace(place, tiedWith, settings) {
    var prizes = normalizeSettings(settings).finalPrizes;
    var sum = 0;
    for (var k = 0; k < tiedWith; k++) sum += prizes[place - 1 + k] || 0;
    return round2(sum / tiedWith);
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /* ---------- One week ---------- */

  // opts: { week, teams, weekTeams, cards, settings, startStrokes: {teamId: n} (final only) }
  function computeWeek(opts) {
    var s = normalizeSettings(opts.settings);
    var week = opts.week;
    var isFinal = !!week.is_final;
    var start = opts.startStrokes || {};
    var wts = (opts.weekTeams || []).filter(function (x) { return x.week_id === week.id; });
    var cards = (opts.cards || []).filter(function (x) { return x.week_id === week.id; });

    var teams = (opts.teams || []).filter(function (t) {
      return t.active !== false ||
        wts.some(function (x) { return x.team_id === t.id; }) ||
        cards.some(function (x) { return x.team_id === t.id; });
    });

    var rows = teams.map(function (team) {
      var wt = wts.filter(function (x) { return x.team_id === team.id; })[0];
      var card = cards.filter(function (x) { return x.team_id === team.id; })[0] || null;
      var handicap = wt ? num(wt.handicap, 0) : 0;
      var tee1 = wt ? wt.tee1 : team.tee1;
      var tee2 = wt ? wt.tee2 : team.tee2;
      var pars = teamPars(week, tee1, tee2, s);
      var strokes = strokesPerHole(handicap, week.sis);
      var status = !card ? 'pending' : card.status === 'absent' ? 'absent' : 'played';
      var score = status === 'played' ? scoreCard(card.gross, pars, strokes, s) : null;
      if (score && !score.total.complete) { status = 'pending'; score = null; }
      var row = {
        teamId: team.id, team: team, handicap: handicap, tee1: tee1, tee2: tee2,
        setUp: !!wt, pars: pars, strokes: strokes, status: status, card: card, score: score,
        start: isFinal ? num(start[team.id], 0) : 0,
        place: null, tiedWith: 0, points: 0, payout: 0, prize: 0, sectionWins: []
      };
      row.finalScore = score ? score.total.net + row.start : null;
      return row;
    });

    var played = rows.filter(function (r) { return r.status === 'played'; });
    assignPlaces(played, function (a, b) { return a.finalScore - b.finalScore; });

    rows.forEach(function (r) {
      if (isFinal) {
        r.points = 0;
        if (r.status === 'played') r.prize = prizeForPlace(r.place, r.tiedWith, s);
      } else if (r.status === 'played') {
        r.points = pointsForPlace(r.place, r.tiedWith, s);
      } else if (r.status === 'absent') {
        r.points = s.absentPoints;
      }
    });

    var paySections = !isFinal || s.payFinalSections;
    var sections = SECTIONS.map(function (sec, si) {
      var out = { name: sec.name, best: null, winners: [], each: 0, payout: paySections ? s.sectionPayout : 0 };
      if (!played.length) return out;
      out.best = Math.min.apply(null, played.map(function (r) { return r.score.sections[si].net; }));
      out.winners = played.filter(function (r) { return r.score.sections[si].net === out.best; });
      out.each = round2(out.payout / out.winners.length);
      out.winners.forEach(function (r) { r.payout = round2(r.payout + out.each); r.sectionWins.push(si); });
      out.winnerIds = out.winners.map(function (r) { return r.teamId; });
      return out;
    });

    var order = { played: 0, pending: 1, absent: 2 };
    rows.sort(function (a, b) {
      if (a.status !== b.status) return order[a.status] - order[b.status];
      if (a.status === 'played') return a.place - b.place || String(a.team.name).localeCompare(String(b.team.name));
      return (a.team.sort || 0) - (b.team.sort || 0) || String(a.team.name).localeCompare(String(b.team.name));
    });

    var pending = rows.filter(function (r) { return r.status === 'pending'; });
    return {
      week: week, isFinal: isFinal, open: !!week.setup_done, rows: rows, sections: sections,
      pending: pending, played: played.length, complete: !!week.setup_done && pending.length === 0
    };
  }

  /* ---------- Season ---------- */

  function computeStandings(weekResults, teams, settings) {
    var s = normalizeSettings(settings);
    var byId = {};
    (teams || []).forEach(function (t) {
      byId[t.id] = { teamId: t.id, team: t, points: 0, rounds: 0, net: 0, sectionWins: 0, money: 0, absences: 0 };
    });
    weekResults.forEach(function (wr) {
      if (wr.isFinal) return;
      wr.rows.forEach(function (r) {
        var st = byId[r.teamId];
        if (!st) return;
        st.points = round2(st.points + r.points);
        st.sectionWins += r.sectionWins.length;
        st.money = round2(st.money + r.payout);
        if (r.status === 'played') { st.rounds++; st.net += r.score.total.net; }
        if (r.status === 'absent') st.absences++;
      });
    });
    var rows = Object.keys(byId).map(function (k) { return byId[k]; }).filter(function (r) {
      return r.team.active !== false || r.rounds > 0 || r.points !== 0;
    });
    rows.forEach(function (r) {
      r.avgNet = r.rounds ? round2(r.net / r.rounds) : null;
      r.netKey = s.netTiebreakBasis === 'average' ? (r.rounds ? r.net / r.rounds : Infinity) : r.net;
    });
    var byNet = function (a, b) { return a.netKey === b.netKey ? 0 : a.netKey < b.netKey ? -1 : 1; };
    var byWins = function (a, b) { return b.sectionWins - a.sectionWins; };
    var tiebreaks = s.standingsTiebreak === 'wins-then-net' ? [byWins, byNet] : [byNet, byWins];
    var sorted = assignPlaces(rows, function (a, b) {
      return (b.points - a.points) || tiebreaks[0](a, b) || tiebreaks[1](a, b);
    });
    sorted.forEach(function (r) { r.startStrokes = startStrokesForPlace(r.place, s); });
    return sorted;
  }

  function weekSort(a, b) {
    return String(a.play_date || '').localeCompare(String(b.play_date || '')) || (a.num || 0) - (b.num || 0) || a.id - b.id;
  }

  function addDays(iso, days) {
    var d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // "This week": the admin's pick if set, otherwise the first week whose date (plus a few grace days) hasn't passed.
  function pickCurrentWeek(weeks, todayISO, overrideId, settings) {
    var s = normalizeSettings(settings);
    var sorted = (weeks || []).slice().sort(weekSort);
    if (!sorted.length) return null;
    if (overrideId != null) {
      var o = sorted.filter(function (w) { return w.id === overrideId; })[0];
      if (o) return o;
    }
    for (var i = 0; i < sorted.length; i++) {
      if (!sorted[i].play_date || addDays(sorted[i].play_date, s.currentWeekGraceDays) >= todayISO) return sorted[i];
    }
    return sorted[sorted.length - 1];
  }

  // Everything the pages need, from the raw league data.
  function computeSeason(data, todayISO) {
    var s = normalizeSettings(data.league && data.league.settings);
    var weeks = (data.weeks || []).slice().sort(weekSort);
    var base = { teams: data.teams, weekTeams: data.week_teams, cards: data.cards, settings: s };
    var results = {};
    var regular = [];
    weeks.forEach(function (w) {
      if (w.is_final) return;
      var r = computeWeek(Object.assign({ week: w }, base));
      results[w.id] = r;
      regular.push(r);
    });
    var standings = computeStandings(regular, data.teams, s);
    var startStrokes = {};
    standings.forEach(function (r) { startStrokes[r.teamId] = r.startStrokes; });
    var finalWeek = weeks.filter(function (w) { return w.is_final; })[0] || null;
    var final = null;
    if (finalWeek) {
      final = computeWeek(Object.assign({ week: finalWeek, startStrokes: startStrokes }, base));
      results[finalWeek.id] = final;
      final.rows.forEach(function (r) {
        var st = standings.filter(function (x) { return x.teamId === r.teamId; })[0];
        if (st) st.finalMoney = round2(r.payout + r.prize);
      });
    }
    standings.forEach(function (r) { r.totalMoney = round2(r.money + (r.finalMoney || 0)); });
    return {
      settings: s,
      weeks: weeks,
      results: results,
      standings: standings,
      startStrokes: startStrokes,
      finalWeek: finalWeek,
      final: final,
      current: pickCurrentWeek(weeks, todayISO, data.league && data.league.current_week_id, s)
    };
  }

  return {
    HOLES: HOLES,
    SECTIONS: SECTIONS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    normalizeSettings: normalizeSettings,
    holeOrder: holeOrder,
    strokesPerHole: strokesPerHole,
    parsForTee: parsForTee,
    teamPars: teamPars,
    capFor: capFor,
    scoreCard: scoreCard,
    assignPlaces: assignPlaces,
    pointsForPlace: pointsForPlace,
    startStrokesForPlace: startStrokesForPlace,
    prizeForPlace: prizeForPlace,
    computeWeek: computeWeek,
    computeStandings: computeStandings,
    computeSeason: computeSeason,
    pickCurrentWeek: pickCurrentWeek,
    weekSort: weekSort,
    addDays: addDays,
    round2: round2
  };
});
