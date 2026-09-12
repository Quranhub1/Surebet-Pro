import { getAiModels, type AiProvider } from './AiModelService';
import { AiPredictionService } from './AiPredictionService';

const WINDOW_MS = 60_000;
const BUDGETS: Record<AiProvider, number> = { gemini: 20_000, groq: 6_500 };
type Usage = { at: number; tokens: number };
const usage: Record<AiProvider, Usage[]> = { gemini: [], groq: [] };

function cleanup(provider: AiProvider, now: number): Usage[] {
  usage[provider] = usage[provider].filter(item => item.at > now - WINDOW_MS);
  return usage[provider];
}

function used(provider: AiProvider, now: number): number {
  return cleanup(provider, now).reduce((total, item) => total + item.tokens, 0);
}

function chooseProviders(estimatedTokens: number): AiProvider[] {
  const configured = getAiModels().filter(model => model.configured).map(model => model.provider);
  if (configured.length <= 1) return configured;
  const now = Date.now();
  const ranked = configured.map(provider => ({
    provider,
    used: used(provider, now),
    projected: used(provider, now) + estimatedTokens,
  })).sort((a, b) => {
    const aRatio = a.projected / BUDGETS[a.provider];
    const bRatio = b.projected / BUDGETS[b.provider];
    return aRatio - bRatio;
  });

  const primary = ranked[0].provider;
  usage[primary].push({ at: now, tokens: estimatedTokens });
  const secondary = ranked[1].provider;
  return [primary, secondary];
}

const prototype = AiPredictionService.prototype as unknown as {
  rankProviders: (position: number, estimatedTokens: number) => AiProvider[];
};

prototype.rankProviders = function (_position: number, estimatedTokens: number): AiProvider[] {
  const providers = chooseProviders(estimatedTokens);
  if (providers.length > 1) {
    const now = Date.now();
    console.log(`[AI] Load-aware routing selected ${providers[0].toUpperCase()} first (${used(providers[0], now)}/${BUDGETS[providers[0]]} estimated tokens in the current minute).`);
  }
  return providers;
};

console.log('[AI] Dynamic provider router loaded. Gemini/Groq selection is based on current rolling usage, not match position.');
