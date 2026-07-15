import * as http from "node:http";
import * as https from "node:https";

/**
 * Custom fetch that bypasses HTTP_PROXY/HTTPS_PROXY when PI_COCRAFT_PROXY is not set.
 * - PI_COCRAFT_PROXY unset: direct connection via http(s).Agent with noProxy: "*"
 * - PI_COCRAFT_PROXY set: use default agent which respects proxy env vars
 *
 * For HTTPS with self-signed certs, set NODE_TLS_REJECT_UNAUTHORIZED=0
 * in the environment.
 */
export function createCocraftFetch(): typeof fetch {
  return async function cocraftFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const urlStr = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    const url = new URL(urlStr);
    const useProxy = !!process.env.PI_COCRAFT_PROXY;

    // Build headers
    const hdrs: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => (hdrs[k] = v));
      } else if (Array.isArray(init.headers)) {
        init.headers.forEach(([k, v]) => (hdrs[k] = v));
      } else {
        Object.assign(hdrs, init.headers);
      }
    }
    if (!hdrs["User-Agent"] && !hdrs["user-agent"] && !hdrs["USER-AGENT"]) {
      hdrs["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
    }

    if (url.protocol === "http:") {
      return new Promise((resolve, reject) => {
        const options: http.RequestOptions = {
          method: init?.method || "GET",
          headers: hdrs,
          agent: useProxy ? undefined : new http.Agent({ noProxy: "*" } as http.AgentOptions),
        };
        const req = http.request(url, options, (res) => {
          const stream = new ReadableStream({
            start(controller) {
              res.on("data", (chunk) => controller.enqueue(chunk));
              res.on("end", () => controller.close());
              res.on("error", (err) => controller.error(err));
            },
            cancel() {
              res.destroy();
            }
          });
          const responseHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) responseHeaders[k] = v.join(", ");
            else if (v) responseHeaders[k] = v;
          }
          resolve(new Response(stream, {
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: responseHeaders,
          }));
        });
        req.on("error", reject);
        if (init?.body) req.write(init.body);
        req.end();
      });
    }

    if (url.protocol === "https:") {
      return new Promise((resolve, reject) => {
        const options: https.RequestOptions = {
          method: init?.method || "GET",
          headers: hdrs,
          agent: useProxy ? undefined : new https.Agent({ noProxy: "*" } as https.AgentOptions),
        };
        const req = https.request(url, options, (res) => {
          const stream = new ReadableStream({
            start(controller) {
              res.on("data", (chunk) => controller.enqueue(chunk));
              res.on("end", () => controller.close());
              res.on("error", (err) => controller.error(err));
            },
            cancel() {
              res.destroy();
            }
          });
          const responseHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) responseHeaders[k] = v.join(", ");
            else if (v) responseHeaders[k] = v;
          }
          resolve(new Response(stream, {
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: responseHeaders,
          }));
        });
        req.on("error", reject);
        if (init?.body) req.write(init.body);
        req.end();
      });
    }

    // Other protocols: fall back to native fetch
    return fetch(input, { ...init, headers: hdrs });
  };
}