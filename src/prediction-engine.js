const OUTCOMES = ['HOME', 'DRAW', 'AWAY'];

function clamp(value, min = 0, max = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function normalize(values) {
  const clean = values.map(v => Math.max(0, Number(v) || 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  if (!sum) return clean.map(() => 1 / clean.length);
  return clean.map(v => v / sum);
}

function normalizeProbabilities(input) {
  const probs = normalize([input.home, input.draw, input.away]);
  return { home: probs[0], draw: probs[1], away: probs[2] };
}

function normalizeBinary(value, fallback = 0.5) {
  if (typeof value === 'number') return clamp(value);
  if (typeof value === 'string') {
    const n = Number(value.replace('%', ''));
    if (Number.isFinite(n)) return clamp(n > 1 ? n / 100 : n);
  }
  return fallback;
}

function parseScore(score) {
  const m = String(score || '').match(/(\d+)\s*[-:]\s*(\d+)/);
  return m ? { home: Number(m[1]), away: Number(m[2]) } : null;
}

function validateModelPrediction(raw, provider) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const probabilities = normalizeProbabilities({
    home: p.probabilities?.home ?? p.homeProbability ?? p.home,
    draw: p.probabilities?.draw ?? p.drawProbability ?? p.draw,
    away: p.probabilities?.away ?? p.awayProbability ?? p.away
  });
  const score = parseScore(p.score) || { home: 0, away: 0 };
  const over25 = normalizeBinary(p.markets?.over25 ?? p.over25, 0.5);
  const btts = normalizeBinary(p.markets?.btts ?? p.btts, 0.5);
  const verdict = OUTCOMES[probabilities.home >= probabilities.draw && probabilities.home >= probabilities.away ? 0 : probabilities.draw >= probabilities.away ? 1 : 2];

  return {
    provider,
    probabilities,
    markets: { over25, btts },
    score: `${score.home}-${score.away}`,
    verdict,
    logic: String(p.logic || '').slice(0, 500)
  };
}

function weightedEnsemble(predictions) {
  const valid = predictions.filter(Boolean);
  if (!valid.length) return null;

  const weights = valid.map(p => Number(p.weight) > 0 ? Number(p.weight) : 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const average = (selector) => valid.reduce((sum, p, i) => sum + selector(p) * weights[i], 0) / totalWeight;

  const probabilities = normalizeProbabilities({
    home: average(p => p.probabilities.home),
    draw: average(p => p.probabilities.draw),
    away: average(p => p.probabilities.away)
  });
  const over25 = average(p => p.markets.over25);
  const btts = average(p => p.markets.btts);
  const winner = OUTCOMES[probabilities.home >= probabilities.draw && probabilities.home >= probabilities.away ? 0 : probabilities.draw >= probabilities.away ? 1 : 2];
  const maxProb = Math.max(probabilities.home, probabilities.draw, probabilities.away);
  const dispersion = average(p => Math.abs(p.probabilities.home - probabilities.home) + Math.abs(p.probabilities.draw - probabilities.draw) + Math.abs(p.probabilities.away - probabilities.away));
  const agreement = clamp(1 - dispersion / 2);

  return {
    probabilities,
    verdict: winner,
    over25,
    btts,
    score: bestConsensusScore(valid),
    confidence: Math.round(clamp((0.55 * agreement + 0.45 * maxProb)) * 100),
    agreement: Math.round(agreement * 100),
    providers: valid.map(p => p.provider),
    modelCount: valid.length
  };
}

function bestConsensusScore(predictions) {
  const counts = new Map();
  for (const p of predictions) {
    const score = p.score || '0-0';
    counts.set(score, (counts.get(score) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '0-0';
}

function impliedProbability(decimalOdds) {
  const odds = Number(decimalOdds);
  if (!Number.isFinite(odds) || odds <= 1) return null;
  return 1 / odds;
}

function expectedValue(probability, decimalOdds) {
  const odds = Number(decimalOdds);
  const p = clamp(probability);
  if (!Number.isFinite(odds) || odds <= 1) return null;
  return p * odds - 1;
}

function valueFromOdds(probabilities, odds) {
  if (!odds) return null;
  const selections = {
    HOME: { probability: probabilities.home, odds: odds.home },
    DRAW: { probability: probabilities.draw, odds: odds.draw },
    AWAY: { probability: probabilities.away, odds: odds.away }
  };
  return Object.entries(selections).map(([selection, x]) => ({
    selection,
    probability: x.probability,
    odds: Number(x.odds),
    impliedProbability: impliedProbability(x.odds),
    edge: Number.isFinite(x.odds) ? x.probability - impliedProbability(x.odds) : null,
    expectedValue: expectedValue(x.probability, x.odds),
    isValueBet: Number.isFinite(x.odds) && expectedValue(x.probability, x.odds) > 0.03
  }));
}

function noVig(probabilities, odds) {
  if (!odds) return null;
  const raw = [impliedProbability(odds.home), impliedProbability(odds.draw), impliedProbability(odds.away)];
  if (raw.some(v => v === null)) return null;
  const total = raw.reduce((a, b) => a + b, 0);
  return { home: raw[0] / total, draw: raw[1] / total, away: raw[2] / total, overround: total - 1 };
}

function poissonPmf(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let factorial = 1;
  for (let i = 2; i <= k; i++) factorial *= i;
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial;
}

function poissonBaseline(homeGoals = 1.35, awayGoals = 1.05) {
  const matrix = [];
  let home = 0, draw = 0, away = 0, over25 = 0, btts = 0, best = { p: 0, h: 0, a: 0 };
  for (let h = 0; h <= 6; h++) {
    matrix[h] = [];
    for (let a = 0; a <= 6; a++) {
      const p = poissonPmf(homeGoals, h) * poissonPmf(awayGoals, a);
      matrix[h][a] = p;
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
      if (h + a >= 3) over25 += p;
      if (h > 0 && a > 0) btts += p;
      if (p > best.p) best = { p, h, a };
    }
  }
  const probabilities = normalizeProbabilities({ home, draw, away });
  return { probabilities, over25: clamp(over25), btts: clamp(btts), score: `${best.h}-${best.a}` };
}

function brierScore(probabilities, actual) {
  const y = { HOME: 0, DRAW: 0, AWAY: 0 };
  if (!(actual in y)) return null;
  y[actual] = 1;
  return ['HOME', 'DRAW', 'AWAY'].reduce((s, k) => s + Math.pow((probabilities[k.toLowerCase()] || 0) - y[k], 2), 0) / 3;
}

module.exports = {
  clamp,
  normalizeProbabilities,
  validateModelPrediction,
  weightedEnsemble,
  impliedProbability,
  expectedValue,
  valueFromOdds,
  noVig,
  poissonBaseline,
  brierScore
};
