const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeProbabilities,
  weightedEnsemble,
  impliedProbability,
  expectedValue,
  valueFromOdds,
  noVig,
  poissonBaseline,
  brierScore
} = require('../src/prediction-engine');

test('normalizes 1X2 probabilities', () => {
  const p = normalizeProbabilities({ home: 2, draw: 1, away: 1 });
  assert.equal(p.home, 0.5);
  assert.equal(p.draw, 0.25);
  assert.equal(p.away, 0.25);
});

test('ensemble averages independent model probabilities', () => {
  const result = weightedEnsemble([
    { provider: 'a', weight: 1, probabilities: { home: .6, draw: .2, away: .2 }, markets: { over25: .6, btts: .5 }, score: '2-1' },
    { provider: 'b', weight: 1, probabilities: { home: .4, draw: .3, away: .3 }, markets: { over25: .4, btts: .7 }, score: '1-0' }
  ]);
  assert.equal(result.modelCount, 2);
  assert.equal(result.verdict, 'HOME');
  assert.equal(Math.round(result.probabilities.home * 100), 50);
  assert.equal(result.agreement > 0, true);
});

test('calculates implied probability and expected value', () => {
  assert.equal(impliedProbability(2), 0.5);
  assert.equal(expectedValue(0.6, 2), 0.19999999999999996);
});

test('value analysis requires actual decimal odds', () => {
  const values = valueFromOdds({ home: .6, draw: .2, away: .2 }, { home: 2, draw: 4, away: 5 });
  assert.equal(values.find(x => x.selection === 'HOME').isValueBet, true);
  assert.equal(values.find(x => x.selection === 'DRAW').isValueBet, false);
});

test('removes bookmaker overround for a market', () => {
  const p = noVig({}, { home: 2, draw: 3.5, away: 4 });
  const sum = p.home + p.draw + p.away;
  assert.ok(Math.abs(sum - 1) < 1e-12);
  assert.ok(p.overround > 0);
});

test('poisson baseline is deterministic and normalized', () => {
  const result = poissonBaseline();
  const sum = Object.values(result.probabilities).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
  assert.match(result.score, /^\d+-\d+$/);
});

test('brier score is lower for the correct confident forecast', () => {
  const good = brierScore({ home: .9, draw: .05, away: .05 }, 'HOME');
  const bad = brierScore({ home: .05, draw: .05, away: .9 }, 'HOME');
  assert.ok(good < bad);
});
