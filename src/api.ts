/**
 * Cocraft PI Auth API
 *
 * Ported from opencode-codev-auth/src/api.ts
 * Uses PI_COCRAFT_API_BASE env var for all API endpoints.
 */

import { createCocraftFetch } from "./fetch-agent.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  organizationAlias: string;
  expiresInMs: number;
}

export interface ModelConfig {
  apiKey: string;
  value: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function getBaseUrl(): string {
  const base = process.env.PI_COCRAFT_API_BASE;
  if (!base) {
    throw new Error("PI_COCRAFT_API_BASE environment variable is not set");
  }
  return base;
}

/**
 * Build the chat completions URL for a given organization alias.
 * e.g. https://api.cocraft.ai/{alias}/api/v1/ai/chat/completions
 */
export function buildChatUrl(alias: string): string {
  return `${getBaseUrl()}/${alias}/api/v1/ai/chat/completions`;
}

/**
 * Build the model-config URL for a given organization alias.
 * e.g. https://api.cocraft.ai/{alias}/api/v1/model-config
 */
export function buildModelConfigUrl(alias: string): string {
  return `${getBaseUrl()}/${alias}/api/v1/model-config`;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

const cocraftFetch = createCocraftFetch();

/**
 * Refresh an access token using a refresh token.
 *
 * POST {PI_COCRAFT_API_BASE}/auth/api/v1/auth/refresh
 * Body: { refreshToken: string }
 * Response: { code: 1000, result: RefreshResult }
 */
export async function refreshToken(refreshTokenStr: string): Promise<RefreshResult> {
  const base = getBaseUrl();
  const url = `${base}/auth/api/v1/auth/refresh`;

  const res = await cocraftFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: refreshTokenStr }),
  });

  if (!res.ok) {
    throw new Error(`refreshToken failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as { code: number; result: RefreshResult };
  if (json.code !== 1000) {
    throw new Error(`refreshToken error: code=${json.code}`);
  }

  return json.result;
}

/**
 * Fetch the model configuration for a given organization alias.
 *
 * GET {PI_COCRAFT_API_BASE}/{alias}/api/v1/model-config
 * Headers: Authorization: Bearer {accessToken}
 * Response: { code: number, result: ModelConfig }
 */
export async function fetchModelConfig(accessToken: string, alias: string): Promise<ModelConfig> {
  const url = buildModelConfigUrl(alias);

  const res = await cocraftFetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`fetchModelConfig failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as { code: number; result: ModelConfig };
  if (json.code !== 1000) {
    throw new Error(`fetchModelConfig error: code=${json.code}`);
  }

  return json.result;
}

export interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export async function fetchOpenAIModels(accessToken: string, alias: string): Promise<OpenAIModel[]> {
  const base = getBaseUrl();
  const url = `${base}/${alias}/api/v1/ai/models`;

  const res = await cocraftFetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`fetchOpenAIModels failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as { data: OpenAIModel[] };
  return json.data || [];
}

/**
 * Extract the model identifier from a ModelConfig's value field.
 * The value is expected to contain a line of the form "model: <model-id>".
 *
 * Uses regex: /^\s*model:\s*(\S+)/m
 */
export function extractModelFromConfig(config: ModelConfig): string {
  const match = config.value.match(/^\s*model:\s*(\S+)/m);
  if (!match) {
    throw new Error("Could not extract model from config.value");
  }
  return match[1];
}