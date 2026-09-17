import { createOpenAI } from '@ai-sdk/openai';

// xAI client configured via OpenAI-compatible interface
export const xai = createOpenAI({
  baseURL: 'https://api.x.ai/v1',
  apiKey: process.env.XAI_API_KEY!,
});

// Model used for all generation (brief, research, writing, editing, grading, brand voice, etc.)
// Override by setting XAI_MODEL env var. Default: grok-4.6
export const XAI_MODEL = process.env.XAI_MODEL || 'grok-4.6';
