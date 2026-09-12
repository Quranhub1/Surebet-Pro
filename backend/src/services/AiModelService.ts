export type AiProvider = 'gemini' | 'groq';

export interface AiModelConfig {
  provider: AiProvider;
  model: string;
  configured: boolean;
}

export interface GenerateOptions {
  provider?: AiProvider;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
}

function getGroqModel(): string {
  return process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
}

function getProvider(): AiProvider {
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  return provider === 'groq' ? 'groq' : 'gemini';
}

function getApiKey(provider: AiProvider): string {
  if (provider === 'gemini') return process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY || '';
  return process.env.GROQ_API_KEY || '';
}

function isConfigured(provider: AiProvider): boolean {
  return Boolean(getApiKey(provider));
}

export function getAiModels(): AiModelConfig[] {
  return [
    { provider: 'gemini', model: getGeminiModel(), configured: isConfigured('gemini') },
    { provider: 'groq', model: getGroqModel(), configured: isConfigured('groq') },
  ];
}

export function getActiveAiConfig(): AiModelConfig {
  const provider = getProvider();
  return { provider, model: provider === 'gemini' ? getGeminiModel() : getGroqModel(), configured: isConfigured(provider) };
}

/** Single-provider call used by the dynamic football router. It never starts a second review call. */
export async function generateSingleWithAi(options: GenerateOptions & { provider: AiProvider }): Promise<string> {
  const provider = options.provider;
  const apiKey = getApiKey(provider);
  if (!apiKey) throw new Error(`${provider.toUpperCase()} API key is not configured`);
  return provider === 'gemini'
    ? generateWithGemini(options, apiKey)
    : generateWithGroq(options, apiKey);
}

/** Backwards-compatible two-provider helper for the admin/test endpoint. */
export async function generateWithAi(options: GenerateOptions): Promise<string> {
  const requestedProvider = options.provider || getProvider();
  const secondaryProvider: AiProvider = requestedProvider === 'gemini' ? 'groq' : 'gemini';
  const primaryConfigured = isConfigured(requestedProvider);
  const secondaryConfigured = isConfigured(secondaryProvider);

  if (!primaryConfigured && !secondaryConfigured) throw new Error('Neither Gemini nor Groq API key is configured');

  let primaryRaw: string | null = null;
  let primaryError: unknown = null;
  if (primaryConfigured) {
    try {
      primaryRaw = await generateSingleWithAi({ ...options, provider: requestedProvider });
      console.log(`[AI] ${requestedProvider.toUpperCase()} completed the primary analysis.`);
    } catch (error) {
      primaryError = error;
      console.warn(`[AI] ${requestedProvider.toUpperCase()} primary analysis failed:`, error instanceof Error ? error.message : error);
    }
  }

  if (!secondaryConfigured) {
    if (primaryRaw) return primaryRaw;
    throw primaryError instanceof Error ? primaryError : new Error(`${requestedProvider.toUpperCase()} API key is not configured`);
  }

  const reviewSystem = `${options.system || 'Analyze the supplied football data and return valid JSON.'}\nYou are the second AI reviewer. Re-check the first analysis against the supplied evidence and return only valid JSON.`;
  const reviewPrompt = primaryRaw
    ? `${options.prompt}\n\nFIRST AI ANALYSIS TO REVIEW:\n${primaryRaw}\n\nReturn the corrected final JSON.`
    : `${options.prompt}\n\nThe primary AI was unavailable. Produce the final analysis from the supplied evidence.`;

  try {
    return await generateSingleWithAi({ ...options, provider: secondaryProvider, system: reviewSystem, prompt: reviewPrompt });
  } catch (secondaryError) {
    if (primaryRaw) return primaryRaw;
    throw secondaryError;
  }
}

async function generateWithGemini(options: GenerateOptions, apiKey: string): Promise<string> {
  const model = getGeminiModel();
  const contents = [
    ...(options.system ? [{ role: 'user', parts: [{ text: `System instructions:\n${options.system}` }] }] : []),
    { role: 'user', parts: [{ text: options.prompt }] },
  ];
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.2,
        maxOutputTokens: options.maxTokens ?? 900,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${body.slice(0, 700)}`);
  }
  const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}

async function generateWithGroq(options: GenerateOptions, apiKey: string): Promise<string> {
  const model = getGroqModel();
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        ...(options.system ? [{ role: 'system', content: options.system }] : []),
        { role: 'user', content: options.prompt },
      ],
      temperature: options.temperature ?? 0.2,
      max_completion_tokens: options.maxTokens ?? 900,
      response_format: { type: 'json_object' },
      reasoning_effort: 'low',
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq request failed (${response.status}): ${body.slice(0, 700)}`);
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Groq returned an empty response');
  return text;
}
