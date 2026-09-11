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
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  }

  return process.env.GROQ_API_KEY || '';
}

export function getAiModels(): AiModelConfig[] {
  return [
    {
      provider: 'gemini',
      model: getGeminiModel(),
      configured: Boolean(getApiKey('gemini')),
    },
    {
      provider: 'groq',
      model: getGroqModel(),
      configured: Boolean(getApiKey('groq')),
    },
  ];
}

export function getActiveAiConfig(): AiModelConfig {
  const provider = getProvider();
  return {
    provider,
    model: provider === 'gemini' ? getGeminiModel() : getGroqModel(),
    configured: Boolean(getApiKey(provider)),
  };
}

export async function generateWithAi(options: GenerateOptions): Promise<string> {
  const provider = options.provider || getProvider();
  const apiKey = getApiKey(provider);

  if (!apiKey) {
    throw new Error(`${provider.toUpperCase()} API key is not configured`);
  }

  if (provider === 'gemini') {
    return generateWithGemini(options, apiKey);
  }

  return generateWithGroq(options, apiKey);
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
