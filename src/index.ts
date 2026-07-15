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
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEBUG = process.env.PI_COCRAFT_DEBUG === "1";
function dbg(...args: unknown[]): void {
  if (DEBUG) console.error("[cocraft]", ...args);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Module-level credential storage for token management
// ---------------------------------------------------------------------------

interface StoredCredentials {
  access: string;
  refresh: string;
  expires: number;
  organizationAlias?: string;
}

let storedCredentials: StoredCredentials | null = null;
let storedApiBase: string | null = null;

// ---------------------------------------------------------------------------
// Proactive refresh mutex — serialises refreshToken() calls across concurrent
// requests so we rotate the refresh token once, not once per concurrent request.
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<StoredCredentials> | null = null;

/**
 * Get a fresh access token, rotating the refresh token every time.
 * Uses a serialisation lock so concurrent callers share the same in-flight refresh.
 */
async function getFreshAccessToken(): Promise<string> {
  if (!storedCredentials?.refresh) {
    dbg("getFreshAccessToken: no refresh token available");
    throw new Error("No refresh token available");
  }

  const kickoff = refreshToken(storedCredentials.refresh).then((result) => {
    dbg("getFreshAccessToken: got new tokens, rotating refresh");
    const next: StoredCredentials = {
      access: result.accessToken,
      refresh: result.refreshToken,
      expires: Date.now() + result.expiresInMs,
      organizationAlias: result.organizationAlias ?? storedCredentials!.organizationAlias,
    };
    storedCredentials = next;
    persistCredentials(next);
    return next;
  });

  if (!refreshInFlight) {
    refreshInFlight = kickoff;
    dbg("getFreshAccessToken: started new refresh");
  } else {
    dbg("getFreshAccessToken: reusing in-flight refresh");
  }

  const result = await refreshInFlight;
  refreshInFlight = null;
  dbg("getFreshAccessToken: returning access token");
  return result.access;
}

// ---------------------------------------------------------------------------
// Credential persistence
// ---------------------------------------------------------------------------

function getAuthPath(): string {
  return join(process.env.HOME ?? "/root", ".pi/agent/auth.json");
}

/**
 * Persist the updated cocraft credentials to pi's auth.json.
 * Reads the file, updates only the `cocraft` key, writes back atomically.
 */
function persistCredentials(next: StoredCredentials): void {
  const authPath = getAuthPath();
  try {
    const authData = JSON.parse(readFileSync(authPath, "utf-8"));
    authData.cocraft = {
      access: next.access,
      refresh: next.refresh,
      expires: next.expires,
      ...(next.organizationAlias !== undefined && {
        organizationAlias: next.organizationAlias,
      }),
    };
    writeFileSync(authPath, JSON.stringify(authData, null, 2));
  } catch {
    // Auth file may not exist yet on first login — persistCredentials is
    // called for 401-refreshed tokens which should already have been stored
    // by pi's login flow, so failures here are non-fatal.
  }
}

// ---------------------------------------------------------------------------
// OAuth callback functions
// ---------------------------------------------------------------------------

async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const token = await callbacks.onPrompt({ message: "Enter your Cocraft refresh token:" });
  if (!token) {
    throw new Error("Refresh token was not provided");
  }
  dbg("login: got token, calling refreshToken");

  const refreshResult = await refreshToken(token);
  dbg("login: refreshResult", refreshResult);

  const credentials: StoredCredentials = {
    access: refreshResult.accessToken,
    refresh: refreshResult.refreshToken,
    expires: Date.now() + refreshResult.expiresInMs,
    organizationAlias: refreshResult.organizationAlias,
  };

  storedCredentials = credentials;
  persistCredentials(credentials);

  await reRegisterWithDiscoveredModels(refreshResult.accessToken, refreshResult.organizationAlias);

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
  persistCredentials(updated);
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
// Module-level pi reference for dynamic re-registration after login
// ---------------------------------------------------------------------------

let piRef: ExtensionAPI | null = null;

/**
 * Re-register the cocraft provider with discovered models after login.
 * Called from login() once we have an access token and org alias.
 */
async function reRegisterWithDiscoveredModels(accessToken: string, organizationAlias: string): Promise<void> {
  if (!piRef) return;

  try {
    const config = await fetchModelConfig(accessToken, organizationAlias);

    // Parse model names from YAML config value
    const modelNames: string[] = [];
    for (const match of config.value.matchAll(/^name:\s*(\S+)/gm)) {
      modelNames.push(match[1]);
    }

    if (modelNames.length === 0) {
      return;
    }

    // Build Model objects from discovered names
    const discoveredModels = modelNames.map((name) => ({
      id: name,
      name: name,
      reasoning: false,
      input: ["text"] as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000000,
      maxTokens: 65536,
    }));

    const baseUrl = storedApiBase ?? process.env.PI_COCRAFT_API_BASE ?? "";

    piRef.registerProvider("cocraft", {
      name: "Cocraft",
      baseUrl,
      api: "openai-completions",
      oauth: {
        name: "Cocraft (OAuth)",
        login,
        refreshToken: refreshTokenFn,
        getApiKey,
        modifyModels,
      },
      models: discoveredModels,
      // @ts-expect-error — fetch is a valid runtime option not yet in ProviderConfig type
      fetch: customFetch,
    });
  } catch {
    // Non-fatal: login succeeded, model discovery failed — keep hardcoded models
  }
}

// ---------------------------------------------------------------------------
// Custom fetch with 401 auto-refresh and model prefix stripping
// ---------------------------------------------------------------------------

const cocraftFetch = createCocraftFetch();

async function customFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  dbg("customFetch called:", init?.method ?? "POST", urlStr);

  const headers = new Headers(init?.headers);

  let freshAccessToken: string | undefined;
  try {
    freshAccessToken = await getFreshAccessToken();
    dbg("customFetch: got fresh access token");
  } catch (e) {
    dbg("customFetch: no credentials, proceeding without auth", e);
  }

  if (freshAccessToken) {
    headers.set("Authorization", `Bearer ${freshAccessToken}`);
  }

  let body = init?.body;
  if (body) {
    try {
      const bodyStr = typeof body === "string" ? body : "";
      const parsed = bodyStr ? JSON.parse(bodyStr) as { model?: string } : null;
      if (parsed?.model && typeof parsed.model === "string" && parsed.model.includes("/")) {
        parsed.model = parsed.model.split("/").pop()!;
      }
      body = JSON.stringify(parsed);
      headers.delete("Content-Length");
      headers.delete("content-length");
    } catch {
      // Non-JSON body — leave unchanged
    }
  }

  dbg("customFetch: calling cocraftFetch");
  let response = await cocraftFetch(input, {
    method: init?.method ?? "POST",
    headers,
    body,
    signal: init?.signal,
  });
  dbg("customFetch: cocraftFetch returned status", response.status);

  // 401 fallback — proactive refresh missed (e.g., no stored credentials on startup)
  if (response.status === 401 && storedCredentials?.refresh) {
    dbg("customFetch: got 401, falling back to refresh");
    try {
      const result = await refreshToken(storedCredentials.refresh);
      const next: StoredCredentials = {
        access: result.accessToken,
        refresh: result.refreshToken,
        expires: Date.now() + result.expiresInMs,
        organizationAlias: result.organizationAlias ?? storedCredentials.organizationAlias,
      };
      storedCredentials = next;
      persistCredentials(next);

      const retryHeaders = new Headers(headers);
      retryHeaders.set("Authorization", `Bearer ${next.access}`);

      response = await cocraftFetch(input, {
        method: init?.method ?? "POST",
        headers: retryHeaders,
        body,
        signal: init?.signal,
      });
      dbg("customFetch: retry after 401, status", response.status);
    } catch (e) {
      dbg("customFetch: 401 refresh fallback failed", e);
    }
  }

  return response;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default async function (pi: ExtensionAPI): Promise<void> {
  // Wipe proxy env vars so pi's internal HTTP client bypasses the system proxy
  // for this extension's internal-IP API server. Must happen before any HTTP calls.
  delete process.env.http_proxy;
  delete process.env.https_proxy;
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  delete process.env.ALL_PROXY;
  delete process.env.all_proxy;

  const apiBase = process.env.PI_COCRAFT_API_BASE;
  if (!apiBase) {
    throw new Error("PI_COCRAFT_API_BASE environment variable is not set");
  }

  piRef = pi;
  storedApiBase = apiBase;

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

  // On startup, check for existing credentials and fetch models if found
  const authPath = join(process.env.HOME ?? "/root", ".pi/agent/auth.json");
  try {
    const authData = JSON.parse(readFileSync(authPath, "utf-8"));
    const creds = authData.cocraft;
    if (creds?.access && creds?.refresh && creds?.organizationAlias) {
      storedCredentials = {
        access: creds.access,
        refresh: creds.refresh,
        expires: creds.expires ?? 0,
        organizationAlias: creds.organizationAlias,
      };
      reRegisterWithDiscoveredModels(creds.access, creds.organizationAlias).catch(() => {
        // ignore — we already registered with fallback models
      });
    }
  } catch {
    // No existing credentials — startup with fallback models only
  }
}