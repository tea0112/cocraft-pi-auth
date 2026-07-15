import { spawn } from "node:child_process";

const DEBUG = process.env.PI_COCRAFT_DEBUG === "1";
function dbg(...args: unknown[]): void {
  if (DEBUG) console.error("[cocraft-fetch]", ...args);
}

/**
 * Custom fetch that bypasses HTTP_PROXY/HTTPS_PROXY when PI_COCRAFT_PROXY is not set.
 * Uses curl subprocess with --noproxy "*" and env-wipe for reliable proxy bypass.
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

// HTTP path
    if (url.protocol === "http:") {
      return new Promise((resolve, reject) => {
        const args = ["-s", "-i", "-X", init?.method || "GET"];

        if (!useProxy) {
          args.push("--noproxy", "*");
        }

        for (const [k, v] of Object.entries(hdrs)) {
          args.push("-H", `${k}: ${v}`);
        }

        const bodyStr = init?.body ? (typeof init.body === "string" ? init.body : String(init.body)) : "";
        if (bodyStr) {
          args.push("-d", "@-");
        }

        args.push(url.href);

        const spawnEnv = useProxy
          ? process.env
          : { ...process.env, http_proxy: "", https_proxy: "", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", all_proxy: "" };

        dbg("spawning curl with args:", args);
        dbg("spawnEnv proxy vars:", { http_proxy: spawnEnv.http_proxy, HTTPS_PROXY: spawnEnv.HTTPS_PROXY });

        const child = spawn("curl", args, {
          env: spawnEnv,
          stdio: ["pipe", "pipe", "pipe"]
        });

        if (bodyStr) {
          child.stdin.write(bodyStr);
          child.stdin.end();
        } else {
          child.stdin.end();
        }

        let headerBuffer = Buffer.alloc(0);
        let headersParsed = false;
        let statusCode = 200;
        let statusText = "OK";
        const responseHeaders: Record<string, string> = {};

        const stream = new ReadableStream({
          start(controller) {
            child.stdout.on("data", (chunk: Buffer) => {
                if (!headersParsed) {
                  headerBuffer = Buffer.concat([headerBuffer, chunk]);
                  const headerEnd = headerBuffer.indexOf("\r\n\r\n");
                  if (headerEnd !== -1) {
                    headersParsed = true;
                    const headerStr = headerBuffer.subarray(0, headerEnd).toString("utf-8");
                    const lines = headerStr.split("\r\n");
                    const statusLine = lines[0].split(" ");
                    statusCode = parseInt(statusLine[1], 10) || 200;
                    statusText = statusLine.slice(2).join(" ");
                    for (let i = 1; i < lines.length; i++) {
                      const line = lines[i];
                      const colonIdx = line.indexOf(":");
                      if (colonIdx !== -1) {
                        const key = line.slice(0, colonIdx).trim().toLowerCase();
                        const val = line.slice(colonIdx + 1).trim();
                        responseHeaders[key] = responseHeaders[key] ? responseHeaders[key] + ", " + val : val;
                      }
                    }
                    dbg("curl resolved with status", statusCode);
                    const response = new Response(stream, {
                      status: statusCode,
                      statusText,
                      headers: responseHeaders,
                    });
                    const bodyChunk = headerBuffer.subarray(headerEnd + 4);
                    if (bodyChunk.length > 0) controller.enqueue(bodyChunk);
                    resolve(response);
                    return;
                  }
                } else {
                  controller.enqueue(chunk);
                }
            });
            child.stdout.on("end", () => {
              if (!headersParsed) {
                dbg("curl stdout end, headers never parsed");
                resolve(new Response("{}", { status: 200 }));
              }
              controller.close();
            });
            child.on("close", () => {});
            child.on("error", (err: Error) => {
              dbg("curl child error:", err.message);
              controller.error(err);
              if (!headersParsed) reject(err);
            });
          },
          cancel() { child.kill(); }
        });
      });
    }

// HTTPS path
    if (url.protocol === "https:") {
      return new Promise((resolve, reject) => {
        const args = ["-s", "-i", "-X", init?.method || "GET", "-k"];

        if (!useProxy) {
          args.push("--noproxy", "*");
        }

        for (const [k, v] of Object.entries(hdrs)) {
          args.push("-H", `${k}: ${v}`);
        }

        const bodyStr = init?.body ? (typeof init.body === "string" ? init.body : String(init.body)) : "";
        if (bodyStr) {
          args.push("-d", "@-");
        }

        args.push(url.href);

        const spawnEnv = useProxy
          ? process.env
          : { ...process.env, http_proxy: "", https_proxy: "", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", all_proxy: "" };

        dbg("spawning https curl with args:", args);

        const child = spawn("curl", args, {
          env: spawnEnv,
          stdio: ["pipe", "pipe", "pipe"]
        });

        if (bodyStr) {
          child.stdin.write(bodyStr);
          child.stdin.end();
        } else {
          child.stdin.end();
        }

        let headerBuffer = Buffer.alloc(0);
        let headersParsed = false;
        let statusCode = 200;
        let statusText = "OK";
        const responseHeaders: Record<string, string> = {};

        const stream = new ReadableStream({
          start(controller) {
            child.stdout.on("data", (chunk: Buffer) => {
                if (!headersParsed) {
                  headerBuffer = Buffer.concat([headerBuffer, chunk]);
                  const headerEnd = headerBuffer.indexOf("\r\n\r\n");
                  if (headerEnd !== -1) {
                    headersParsed = true;
                    const headerStr = headerBuffer.subarray(0, headerEnd).toString("utf-8");
                    const lines = headerStr.split("\r\n");
                    const statusLine = lines[0].split(" ");
                    statusCode = parseInt(statusLine[1], 10) || 200;
                    statusText = statusLine.slice(2).join(" ");
                    for (let i = 1; i < lines.length; i++) {
                      const line = lines[i];
                      const colonIdx = line.indexOf(":");
                      if (colonIdx !== -1) {
                        const key = line.slice(0, colonIdx).trim().toLowerCase();
                        const val = line.slice(colonIdx + 1).trim();
                        responseHeaders[key] = responseHeaders[key] ? responseHeaders[key] + ", " + val : val;
                      }
                    }
                    dbg("https curl resolved with status", statusCode);
                    const response = new Response(stream, { status: statusCode, statusText, headers: responseHeaders });
                    const bodyChunk = headerBuffer.subarray(headerEnd + 4);
                    if (bodyChunk.length > 0) controller.enqueue(bodyChunk);
                    resolve(response);
                    return;
                  }
                } else {
                  controller.enqueue(chunk);
                }
            });
            child.stdout.on("end", () => {
              if (!headersParsed) {
                dbg("https curl stdout end, headers never parsed");
                resolve(new Response("{}", { status: 200 }));
              }
              controller.close();
            });
            child.on("close", () => {});
            child.on("error", (err: Error) => {
              dbg("https curl child error:", err.message);
              controller.error(err);
              if (!headersParsed) reject(err);
            });
          },
          cancel() { child.kill(); }
        });
      });
    }

    // Fallback: native fetch
    return fetch(input, { ...init, headers: hdrs });
  };
}