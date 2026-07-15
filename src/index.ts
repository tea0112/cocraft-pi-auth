/**
 * Cocraft PI Extension — Main entry point
 *
 * Provides OAuth-based authentication for the Cocraft AI API via pi's
 * registerProvider extension point.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Api, Model, OAuthLoginCallbacks, OAuthCredentials } from "@earendil-works/pi-ai";
import { refreshToken, fetchModelConfig, extractModelFromConfig, buildChatUrl } from "./api.js";
import { createCocraftFetch } from "./fetch-agent.js";

// ---------------------------------------------------------------------------
// Module-level credential storage for 401 auto-refresh
// ---------------------------------------------------------------------------

interface StoredCredentials {
  access: string;
  refresh: string;
  expires: number;
  organizationAlias?: string;
}

let storedCredentials: StoredCredentials | null = null;

// ---------------------------------------------------------------------------
// OAuth callback functions
// ---------------------------------------------------------------------------

async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const token = await callbacks.onPrompt({ message: "Enter your Cocraft refresh token:" });
  if (!token) {
    throw new Error("Refresh token was not provided");
  }

  const refreshResult = await refreshToken(token);

  const credentials: StoredCredentials = {
    access: refreshResult.accessToken,
    refresh: refreshResult.refreshToken,
    expires: Date.now() + refreshResult.expiresInMs,
    organizationAlias: refreshResult.organizationAlias,
  };

  storedCredentials = credentials;
  return credentials as OAuthCredentials;
}

async function refreshTokenFn(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  const sc = credentials as StoredCredentials;
  const result = await refreshToken(sc.refresh);

  const updated: StoredCredentials = {
    access: result.accessToken,
    refresh: result.refreshToken,
    expires: Date.now() + result.expiresInMs,
    organizationAlias: result.organizationAlias ?? sc.organizationAlias,
  };

  storedCredentials = updated;
  return updated as OAuthCredentials;
}

function getApiKey(credentials: OAuthCredentials): string {
  return credentials.access;
}

function modifyModels(models: unknown[], credentials: OAuthCredentials): Model<Api>[] {
  const sc = credentials as StoredCredentials;
  let alias = storedCredentials?.organizationAlias ?? sc.organizationAlias;

  if (!alias) {
    // No org alias yet — skip per-model baseUrl override until login completes
    return models as Model<Api>[];
  }

  const baseUrl = buildChatUrl(alias).replace(/\/chat\/completions$/, "");

  const modelArray = models as Model<Api>[];
  for (const model of modelArray) {
    (model as { baseUrl?: string }).baseUrl = baseUrl;
  }
  return modelArray;
}

// ---------------------------------------------------------------------------
// Custom fetch with 401 auto-refresh and model prefix stripping
// ---------------------------------------------------------------------------

const cocraftFetch = createCocraftFetch();

async function customFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const accessToken = storedCredentials?.access ?? "";
  headers.set("Authorization", `Bearer ${accessToken}`);

  let body = init?.body;
  if (body) {
    try {
      const bodyStr = typeof body === "string" ? body : "";
      const parsed = bodyStr ? JSON.parse(bodyStr) as { model?: string } : null;
      if (parsed?.model && typeof parsed.model === "string" && parsed.model.includes("/")) {
        parsed.model = parsed.model.split("/").pop()!;
      }
      body = JSON.stringify(parsed);
      // Body length changed — drop Content-Length so it recalculates
      headers.delete("Content-Length");
      headers.delete("content-length");
    } catch {
      // Non-JSON body — send as-is
    }
  }

  let response = await cocraftFetch(input, {
    method: init?.method ?? "POST",
    headers,
    body,
    signal: init?.signal,
  });

  // Auto-refresh on 401
  if (response.status === 401 && storedCredentials?.refresh) {
    try {
      const result = await refreshToken(storedCredentials.refresh);
      storedCredentials = {
        access: result.accessToken,
        refresh: result.refreshToken,
        expires: Date.now() + result.expiresInMs,
        organizationAlias: result.organizationAlias ?? storedCredentials.organizationAlias,
      };

      const retryHeaders = new Headers(init?.headers);
      retryHeaders.set("Authorization", `Bearer ${storedCredentials.access}`);

      response = await cocraftFetch(input, {
        method: init?.method ?? "POST",
        headers: retryHeaders,
        body,
        signal: init?.signal,
      });
    } catch {
      // Refresh failed — return the original 401
    }
  }

  return response;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default async function (pi: ExtensionAPI): Promise<void> {
  const apiBase = process.env.PI_COCRAFT_API_BASE;
  if (!apiBase) {
    throw new Error("PI_COCRAFT_API_BASE environment variable is not set");
  }

  pi.registerProvider("cocraft", {
    name: "Cocraft",
    baseUrl: apiBase,
    api: "openai-completions",
    oauth: {
      name: "Cocraft (OAuth)",
      login,
      refreshToken: refreshTokenFn,
      getApiKey,
      modifyModels,
    },
    models: [
      {
        id: "minimax-m2.7",
        name: "MiniMax M2.7",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000000,
        maxTokens: 65536,
      },
    ],
    // @ts-expect-error — fetch is a valid runtime option not yet in ProviderConfig type
    fetch: customFetch,
  });
}