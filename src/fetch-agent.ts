import * as http from "node:http";
import * as https from "node:https";
import { spawn } from "node:child_process";

/**
 * Custom fetch that bypasses HTTP_PROXY/HTTPS_PROXY when PI_COCRAFT_PROXY is not set.
 * - PI_COCRAFT_PROXY unset: direct connection, bypass proxy via --noproxy "*" + env wipe
 * - PI_COCRAFT_PROXY set: curl naturally uses parent process $http_proxy/$https_proxy
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

    // HTTP path: curl with proxy bypass when PI_COCRAFT_PROXY is not set
    if (url.protocol === "http:") {
      return new Promise((resolve, reject) => {
        const args = ["-s", "-i", "-X", init?.method || "GET"];

        // When PI_COCRAFT_PROXY is not set, bypass proxy explicitly
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

        // Wipe proxy env vars only when bypassing proxy (PI_COCRAFT_PROXY not set)
        const spawnEnv = useProxy
          ? process.env
          : { ...process.env, http_proxy: "", https_proxy: "", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", all_proxy: "" };

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
                        if (responseHeaders[key]) {
                          responseHeaders[key] += ", " + val;
                        } else {
                          responseHeaders[key] = val;
                        }
                      }
                    }

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
                resolve(new Response("{}", { status: 200 }));
              }
              controller.close();
            });

            child.on("close", () => {});

            child.on("error", (err: Error) => {
              console.error("Child process error:", err);
              controller.error(err);
              if (!headersParsed) reject(err);
            });
          },
          cancel() {
            child.kill();
          }
        });
      });
    }

    // HTTPS path: use proxy agent when PI_COCRAFT_PROXY is set, direct otherwise
    if (url.protocol === "https:") {
      return new Promise((resolve, reject) => {
        const options = {
          method: init?.method || "GET",
          headers: hdrs,
          // When PI_COCRAFT_PROXY is not set, use a new agent with no proxy
          // When set, use default agent which respects proxy env
          agent: useProxy ? undefined : new https.Agent(),
        };

        const req = https.request(url, options, (res: http.IncomingMessage) => {
          const stream = new ReadableStream({
            start(controller) {
              res.on("data", (chunk: Buffer) => controller.enqueue(chunk));
              res.on("end", () => controller.close());
              res.on("error", (err: Error) => controller.error(err));
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

          const response = new Response(stream, {
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: responseHeaders,
          });

          resolve(response);
        });

        req.on("error", reject);

        if (init?.body) {
          req.write(init.body as string);
        }
        req.end();
      });
    }

    const newInit = { ...init, headers: hdrs };
    return fetch(input, newInit);
  };
}