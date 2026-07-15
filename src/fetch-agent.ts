import * as http from "node:http";
import * as https from "node:https";

/**
 * Custom fetch that bypasses HTTP_PROXY/HTTPS_PROXY for direct connection.
 * Uses node:http / node:https with noProxy: "*" for reliable proxy bypass.
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

    const hdrs: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => (hdrs[k] = v));
      } else if (Array.isArray(init.headers)) {
        init.headers.forEach(([k, v]) => (hdrs[k] = v));
      } else {
        Object.assign(hdrs, init.headers as Record<string, string>);
      }
    }
    if (!hdrs["User-Agent"] && !hdrs["user-agent"] && !hdrs["USER-AGENT"]) {
      hdrs["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
    }

    const bodyStr = init?.body
      ? (typeof init.body === "string" ? init.body : String(init.body))
      : "";

    const isHttps = url.protocol === "https:";

    const transport = isHttps
      ? https.request(url, {
          method: init?.method || "GET",
          headers: hdrs,
          noProxy: "*",
          rejectUnauthorized: false,
        } as https.RequestOptions)
      : http.request(url, {
          method: init?.method || "GET",
          headers: hdrs,
          noProxy: "*",
        } as http.RequestOptions);

    return new Promise((resolve, reject) => {
      const req = transport as http.ClientRequest;

      req.on("error", (err: Error) => {
        reject(err);
      });

      req.on("response", (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          const responseHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            responseHeaders[k] = Array.isArray(v) ? v.join(", ") : (v ?? "");
          }
          resolve(new Response(body, {
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: responseHeaders,
          }));
        });
      });

      if (bodyStr) {
        req.write(bodyStr);
      }
      req.end();
    });
  };
}