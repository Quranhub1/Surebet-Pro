export type AiProvider = 'gemini' | 'groq';

export interface AiModelConfig {
  provider: AiProvider;
  model: string;
  configured: boolean;
}

interface GenerateOptions {
  provider?: AiProvider;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
}

function getGroqModel(): string {
  return process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
}

function getProvider(): AiProvider {
  const provider = (process.env.AI_PROVIDER || 'groq').toLowerCase();
  return provider === 'gemini' ? 'gemini' : 'groq';
}

function getApiKey(provider: AiProvider): string {
  if (provider === 'gemini') {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY || '';
  }

  return process.env.GROQ_API_KEY || '';
}

function isConfigured(provider: AiProvider): boolean {
  return Boolean(getApiKey(provider));
}

export function getAiModels(): AiModelConfig[] {
  return [
    {
      provider: 'gemini',
      model: getGeminiModel(),
      configured: isConfigured('gemini'),
    },
    {
      provider: 'groq',
      model: getGroqModel(),
      configured: isConfigured('groq'),
    },
  ];
}

export function getActiveAiConfig(): AiModelConfig {
  const provider = getProvider();
  return {
    provider,
    model: provider === 'gemini' ? getGeminiModel() : getGroqModel(),
    configured: isConfigured(provider),
  };
}

export async function generateWithAi(options: GenerateOptions): Promise<string> {
  const requestedProvider = options.provider || getProvider();
  const secondaryProvider: AiProvider = requestedProvider === 'gemini' ? 'groq' : 'gemini';
  const primaryConfigured = isConfigured(requestedProvider);
  const secondaryConfigured = isConfigured(secondaryProvider);

  if (!primaryConfigured && !secondaryConfigured) {
    throw new Error('Neither Gemini nor Groq API key is configured');
  }

  let primaryRaw: string | null = null;
  let primaryError: unknown = null;

  if (primaryConfigured) {
    try {
      primaryRaw = requestedProvider === 'gemini'
        ? await generateWithGemini(options, getApiKey('gemini'))
        : await generateWithGroq(options, getApiKey('groq'));
      console.log(`[AI] ${requestedProvider === 'gemini' ? 'Gemini' : 'Groq'} completed the primary analysis.`);
    } catch (error) {
      primaryError = error;
      console.warn(`[AI] ${requestedProvider.toUpperCase()} primary analysis failed:`, error instanceof Error ? error.message : error);
    }
  }

  if (!secondaryConfigured) {
    if (primaryRaw) return primaryRaw;
    throw primaryError instanceof Error ? primaryError : new Error(`${requestedProvider.toUpperCase()} API key is not configured`);
  }

  const reviewSystem = `${options.system || 'Analyze the supplied football data and return valid JSON.'}\n\nYou are the second AI reviewer. Another AI has already analyzed the same data. Independently check its conclusions against the supplied evidence, correct unsupported claims, and return the best final answer. Preserve the exact JSON schema requested by the original instructions. Return ONLY valid JSON.`;
  const reviewPrompt = primaryRaw
    ? `${options.prompt}\n\nFIRST AI ANALYSIS TO REVIEW:\n${primaryRaw}\n\nUse the first analysis as a draft, not as fact. Re-check it against the original evidence and return the corrected final JSON.`
    : `${options.prompt}\n\nThe primary AI was unavailable. Produce the final analysis from the supplied evidence.`;

  try {
    const reviewOptions: GenerateOptions = { ...options, system: reviewSystem, prompt: reviewPrompt };
    const finalRaw = secondaryProvider === 'gemini'
      ? await generateWithGemini(reviewOptions, getApiKey('gemini'))
      : await generateWithGroq(reviewOptions, getApiKey('groq'));
    console.log(`[AI] ${secondaryProvider === 'gemini' ? 'Gemini' : 'Groq'} completed the second-pass review.`);
    return finalRaw;
  } catch (secondaryError) {
    console.warn(`[AI] ${secondaryProvider.toUpperCase()} review failed:`, secondaryError instanceof Error ? secondaryError.message : secondaryError);
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

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxTokens ?? 4096,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';

  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}

async function generateWithGroq(options: GenerateOptions, apiKey: string): Promise<string> {
  const model = getGroqModel();
  const messages = [
    ...(options.system ? [{ role: 'system', content: options.system }] : []),
    { role: 'user', content: options.prompt },
  ];

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 4096,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content || '';

  if (!text) throw new Error('Groq returned an empty response');
  return text;
}
