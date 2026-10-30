// Run with:  node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../scoring.js');

const PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 5];
const SIS = [5, 1, 11, 3, 7, 9, 12, 2, 6, 4, 10, 8]; // hardest: hole 2, then 8, 4, 10, 1, ...
const ALL_PAR = PARS.slice();

function week(id, extra) {
  return Object.assign({ id, num: id, play_date: '2026-11-0' + id, pars: PARS, sis: SIS, tee_pars: {}, setup_done: true, is_final: false }, extra);
}
function teams(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ id: i, name: 'T' + String(i).padStart(2, '0'), tee1: 1, tee2: 1, active: true, sort: i });
  return out;
}
// gross card that totals par + `over`, spreading strokes over the first holes
function card(weekId, teamId, over) {
  const g = PARS.slice();
  for (let k = 0; k < Math.abs(over); k++) g[k % 12] += over > 0 ? 1 : -1;
  return { week_id: weekId, team_id: teamId, gross: g, status: 'submitted' };
}

test('strokes: 0 handicap gives no strokes', () => {
  assert.deepEqual(S.strokesPerHole(0, SIS), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('strokes: go to the hardest holes by stroke index', () => {
  const st = S.strokesPerHole(3, SIS);
  // holes 2 (SI 1), 8 (SI 2) and 4 (SI 3)
  assert.deepEqual(st, [0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]);
});

test('strokes: 12 handicap is one per hole', () => {
  assert.deepEqual(S.strokesPerHole(12, SIS), Array(12).fill(1));
});

test('strokes: handicap over 12 wraps back to the hardest holes', () => {
  const st = S.strokesPerHole(14, SIS);
  assert.equal(st.reduce((a, b) => a + b, 0), 14);
  assert.equal(st[1], 2); // SI 1
  assert.equal(st[7], 2); // SI 2
  assert.equal(st[3], 1); // SI 3
  const st26 = S.strokesPerHole(26, SIS);
  assert.equal(st26.reduce((a, b) => a + b, 0), 26);
  assert.equal(st26[1], 3);
  assert.equal(st26[6], 2); // SI 12, easiest
});

test('strokes: works with 18-hole stroke indexes that skip numbers', () => {
  const sis = [17, 1, 9, 3, 15, 5, 11, 7, 13, 18, 2, 4];
  assert.deepEqual(S.strokesPerHole(2, sis), [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
});

test('strokes: plus handicap gives strokes back on the easiest holes', () => {
  const st = S.strokesPerHole(-1, SIS);
  assert.equal(st[6], -1); // SI 12
  assert.equal(st.reduce((a, b) => a + b, 0), -1);
});

test('Double Maxx: score above double par counts as double par, before strokes', () => {
  const gross = ALL_PAR.slice();
  gross[0] = 11; // par 4, cap 8
  const strokes = S.strokesPerHole(5, SIS); // hole 1 is SI 5 -> gets a stroke
  const r = S.scoreCard(gross, PARS, strokes, {});
  assert.equal(r.holes[0].entered, 11);
  assert.equal(r.holes[0].gross, 8);
  assert.equal(r.holes[0].capped, true);
  assert.equal(r.holes[0].net, 7);
  assert.equal(r.total.gross, 48 + 4);
  assert.equal(r.total.net, 52 - 5);
});

test('Double Maxx: exactly double par is not capped; setting can turn it off', () => {
  const gross = ALL_PAR.slice();
  gross[2] = 6; // par 3
  assert.equal(S.scoreCard(gross, PARS, Array(12).fill(0), {}).holes[2].capped, false);
  gross[2] = 9;
  const off = S.scoreCard(gross, PARS, Array(12).fill(0), { doubleMaxxOn: false });
  assert.equal(off.holes[2].gross, 9);
  const triple = S.scoreCard(gross, PARS, Array(12).fill(0), { doubleMaxxMultiple: 3 });
  assert.equal(triple.holes[2].gross, 9);
});

test('section and total sums', () => {
  const strokes = S.strokesPerHole(3, SIS);
  const r = S.scoreCard(ALL_PAR, PARS, strokes, {});
  assert.deepEqual(r.sections.map((x) => x.gross), [16, 16, 16]);
  assert.deepEqual(r.sections.map((x) => x.strokes), [2, 1, 0]);
  assert.deepEqual(r.sections.map((x) => x.net), [14, 15, 16]);
  assert.equal(r.total.net, 45);
  assert.equal(r.total.complete, true);
});

test('tee par override per week, and mixed tees use the higher par by default', () => {
  const w = week(1, { tee_pars: { 2: [5, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 5] } });
  assert.equal(S.teamPars(w, 2, 2, {})[0], 5);
  assert.equal(S.teamPars(w, 1, 1, {})[0], 4);
  assert.equal(S.teamPars(w, 1, 2, {})[0], 5);
  assert.equal(S.teamPars(w, 1, 2, { mixedTeePar: 'lower' })[0], 4);
  // cap uses the tee's par: par 5 -> 10
  const gross = ALL_PAR.slice(); gross[0] = 12;
  const r = S.scoreCard(gross, S.teamPars(w, 2, 2, {}), Array(12).fill(0), {});
  assert.equal(r.holes[0].gross, 10);
});

test('weekly places and points: 3/2/1 tiers with 14 teams', () => {
  const T = teams(14);
  const cards = T.map((t) => card(1, t.id, t.id)); // team 1 best
  const r = S.computeWeek({ week: week(1), teams: T, weekTeams: [], cards, settings: {} });
  const byId = Object.fromEntries(r.rows.map((x) => [x.teamId, x]));
  assert.equal(byId[1].place, 1);
  assert.equal(byId[3].points, 3);
  assert.equal(byId[4].points, 2);
  assert.equal(byId[10].points, 2);
  assert.equal(byId[11].points, 1);
  assert.equal(byId[14].points, 1);
  assert.equal(r.complete, true);
});

test('weekly ties: tied teams all get the better place\'s points', () => {
  const T = teams(14);
  const overs = [1, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 12]; // teams 3&4 tie for 3rd, 11&12 tie for 11th
  const cards = T.map((t, i) => card(1, t.id, overs[i]));
  // a 10th/11th tie: make team 10 tie with 11
  cards[9] = card(1, 10, 10);
  const r = S.computeWeek({ week: week(1), teams: T, weekTeams: [], cards, settings: {} });
  const byId = Object.fromEntries(r.rows.map((x) => [x.teamId, x]));
  assert.equal(byId[3].place, 3);
  assert.equal(byId[4].place, 3);
  assert.equal(byId[4].points, 3);
  assert.equal(byId[5].place, 5);
  assert.equal(byId[10].place, 10);
  assert.equal(byId[11].place, 10);
  assert.equal(byId[12].place, 10);
  assert.equal(byId[12].points, 2);
  assert.equal(byId[13].place, 13);
  assert.equal(byId[13].points, 1);
  // optional rule: share the points of the tied places
  const avg = S.computeWeek({ week: week(1), teams: T, weekTeams: [], cards, settings: { tiedPoints: 'average' } });
  const a = Object.fromEntries(avg.rows.map((x) => [x.teamId, x]));
  assert.equal(a[3].points, 2.5);
  assert.equal(a[10].points, 1.33);
});

test('handicaps decide net places using that week\'s handicap', () => {
  const T = teams(2);
  const cards = [card(1, 1, 2), card(1, 2, 5)];
  const wts = [
    { week_id: 1, team_id: 1, handicap: 0, tee1: 1, tee2: 1 },
    { week_id: 1, team_id: 2, handicap: 4, tee1: 1, tee2: 1 }
  ];
  const r = S.computeWeek({ week: week(1), teams: T, weekTeams: wts, cards, settings: {} });
  assert.equal(r.rows[0].teamId, 2); // 53 - 4 = 49 beats 50
  assert.equal(r.rows[0].score.total.net, 49);
});

test('section payouts: lowest net wins $50, ties split', () => {
  const T = teams(3);
  const c1 = card(1, 1, 0); c1.gross[0] -= 1;               // wins holes 1-4 alone
  const c2 = card(1, 2, 0); c2.gross[4] -= 1;               // ties holes 5-8 with team 3
  const c3 = card(1, 3, 0); c3.gross[5] -= 1; c3.gross[8] -= 1; // and wins 9-12
  const r = S.computeWeek({ week: week(1), teams: T, weekTeams: [], cards: [c1, c2, c3], settings: {} });
  assert.deepEqual(r.sections[0].winnerIds, [1]);
  assert.equal(r.sections[0].each, 50);
  assert.deepEqual(r.sections[1].winnerIds.sort(), [2, 3]);
  assert.equal(r.sections[1].each, 25);
  const byId = Object.fromEntries(r.rows.map((x) => [x.teamId, x]));
  assert.equal(byId[1].payout, 50);
  assert.equal(byId[2].payout, 25);
  assert.equal(byId[3].payout, 75);
  // three-way tie gives cents
  const all = S.computeWeek({ week: week(1), teams: T, weekTeams: [], cards: T.map((t) => card(1, t.id, 0)), settings: {} });
  assert.equal(all.sections[0].each, 16.67);
});

test('missed week: absent team gets 0 points and no payout; pending team is listed', () => {
  const T = teams(4);
  const cards = [card(1, 1, 0), card(1, 2, 1), { week_id: 1, team_id: 3, gross: null, status: 'absent' }];
  const r = S.computeWeek({ week: week(1), teams: T, weekTeams: [], cards, settings: {} });
  const byId = Object.fromEntries(r.rows.map((x) => [x.teamId, x]));
  assert.equal(byId[3].status, 'absent');
  assert.equal(byId[3].points, 0);
  assert.equal(byId[3].payout, 0);
  assert.equal(byId[3].place, null);
  assert.equal(byId[4].status, 'pending');
  assert.equal(r.complete, false);
  assert.deepEqual(r.pending.map((x) => x.teamId), [4]);
});

test('standings: points, then lowest season net, then most section wins', () => {
  const T = teams(3);
  const w1 = week(1), w2 = week(2);
  const cards = [
    card(1, 1, 0), card(1, 2, 3), card(1, 3, 3),
    card(2, 1, 4), card(2, 2, 0), card(2, 3, 6)
  ];
  const settings = { pointsTiers: [{ upTo: 1, points: 3 }, { upTo: 3, points: 1 }] };
  const results = [w1, w2].map((w) => S.computeWeek({ week: w, teams: T, weekTeams: [], cards, settings }));
  const st = S.computeStandings(results, T, settings);
  // teams 1 and 2: 4 points each. Team 1 net 48+52=100, team 2 net 51+48=99 -> team 2 first
  assert.equal(st[0].teamId, 2);
  assert.equal(st[1].teamId, 1);
  assert.equal(st[2].teamId, 3);
  assert.equal(st[0].points, 4);
  assert.equal(st[0].net, 99);
});

test('standings: missed week counts 0 and fewer rounds; average net option', () => {
  const T = teams(2);
  const cards = [card(1, 1, 0), card(1, 2, 0), card(2, 1, 0), { week_id: 2, team_id: 2, status: 'absent', gross: null }];
  const results = [week(1), week(2)].map((w) => S.computeWeek({ week: w, teams: T, weekTeams: [], cards, settings: {} }));
  const st = S.computeStandings(results, T, {});
  const byId = Object.fromEntries(st.map((x) => [x.teamId, x]));
  assert.equal(byId[1].points, 6);
  assert.equal(byId[2].points, 3);
  assert.equal(byId[2].rounds, 1);
  assert.equal(byId[2].absences, 1);
});

test('standings: full tie shares the place and the better final start', () => {
  const T = teams(4);
  const cards = T.map((t) => card(1, t.id, 0));
  const r = S.computeWeek({ week: week(1), teams: T, weekTeams: [], cards, settings: {} });
  const st = S.computeStandings([r], T, {});
  assert.ok(st.every((x) => x.place === 1));
  assert.ok(st.every((x) => x.startStrokes === -2));
});

test('final start strokes by season place: -2 / -1 / even', () => {
  assert.equal(S.startStrokesForPlace(1, {}), -2);
  assert.equal(S.startStrokesForPlace(3, {}), -2);
  assert.equal(S.startStrokesForPlace(4, {}), -1);
  assert.equal(S.startStrokesForPlace(10, {}), -1);
  assert.equal(S.startStrokesForPlace(11, {}), 0);
  assert.equal(S.startStrokesForPlace(14, {}), 0);
});

test('prize money: ties add the tied places\' prizes and split', () => {
  assert.equal(S.prizeForPlace(1, 1, {}), 700);
  assert.equal(S.prizeForPlace(1, 2, {}), 550);   // (700+400)/2
  assert.equal(S.prizeForPlace(2, 3, {}), 300);   // (400+300+200)/3
  assert.equal(S.prizeForPlace(4, 2, {}), 100);   // (200+0)/2
  assert.equal(S.prizeForPlace(5, 1, {}), 0);
});

test('full season: final adds starting strokes and pays prizes', () => {
  const T = teams(14);
  const weeks = [week(1), week(2, { is_final: true, play_date: '2026-12-21' })];
  const cards = T.map((t) => card(1, t.id, t.id)); // week 1: team 1 best ... team 14 worst
  // final: everyone shoots the same gross, so starting strokes decide it
  T.forEach((t) => cards.push(card(2, t.id, 0)));
  const data = { league: { settings: {} }, teams: T, weeks, week_teams: [], cards };
  const season = S.computeSeason(data, '2026-12-22');
  const f = Object.fromEntries(season.final.rows.map((x) => [x.teamId, x]));
  assert.equal(f[1].start, -2);
  assert.equal(f[1].finalScore, 48 - 2);
  assert.equal(f[5].start, -1);
  assert.equal(f[14].start, 0);
  // teams 1-3 tie for 1st at 46: (700+400+300)/3
  assert.equal(f[1].place, 1);
  assert.equal(f[1].prize, 466.67);
  // teams 4-10 tie for 4th: 200/7
  assert.equal(f[4].place, 4);
  assert.equal(f[4].prize, 28.57);
  assert.equal(f[11].prize, 0);
  assert.equal(f[1].points, 0); // no season points on final day
  // final sections are not paid by default; with the setting on, a 14-way tie splits $50
  assert.equal(season.final.sections[0].each, 0);
  const paid = S.computeSeason(Object.assign({}, data, { league: { settings: { payFinalSections: true } } }), '2026-12-22');
  assert.equal(paid.final.sections[0].each, 3.57);
  assert.equal(season.current.id, 2);
});

test('this week: picks the next week not yet past, or the admin override', () => {
  const ws = [week(1, { play_date: '2026-11-02' }), week(2, { play_date: '2026-11-09' }), week(3, { play_date: '2026-11-16' })];
  assert.equal(S.pickCurrentWeek(ws, '2026-10-30', null).id, 1);
  assert.equal(S.pickCurrentWeek(ws, '2026-11-04', null).id, 1); // grace days
  assert.equal(S.pickCurrentWeek(ws, '2026-11-06', null).id, 2);
  assert.equal(S.pickCurrentWeek(ws, '2027-01-01', null).id, 3);
  assert.equal(S.pickCurrentWeek(ws, '2026-10-30', 3).id, 3);
});

test('changing a handicap in a later week does not change earlier results', () => {
  const T = teams(2);
  const cards = [card(1, 1, 2), card(1, 2, 3), card(2, 1, 2), card(2, 2, 3)];
  const wts = [
    { week_id: 1, team_id: 2, handicap: 0 },
    { week_id: 2, team_id: 2, handicap: 5 }
  ];
  const data = { league: { settings: {} }, teams: T, weeks: [week(1), week(2)], week_teams: wts, cards };
  const s = S.computeSeason(data, '2026-11-01');
  assert.equal(s.results[1].rows[0].teamId, 1);
  assert.equal(s.results[2].rows[0].teamId, 2);
});

test('settings are cleaned up and defaults filled in', () => {
  const s = S.normalizeSettings({ doubleMaxxMultiple: 'abc', pointsTiers: [{ upTo: 10, points: 2 }, { upTo: 3, points: 3 }] });
  assert.equal(s.doubleMaxxMultiple, 2);
  assert.equal(s.pointsTiers[0].upTo, 3);
  assert.equal(s.sectionPayout, 50);
});
