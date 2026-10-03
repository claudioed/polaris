import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const distDir = join(webRoot, "dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * Parses `add_header ... always;` directives from the production
 * web/security-headers.conf so the test edge serves exactly the deployed
 * policy — a regression in the conf (like the CSP bug) fails these tests.
 */
function parseSecurityHeaders(): Record<string, string> {
  const conf = readFileSync(join(webRoot, "security-headers.conf"), "utf8");
  const headers: Record<string, string> = {};
  for (const match of conf.matchAll(/add_header\s+([A-Za-z-]+)\s+"([^"]*)"\s+always;/g)) {
    headers[match[1]] = match[2];
  }
  if (Object.keys(headers).length === 0) {
    throw new Error("no security headers parsed from security-headers.conf");
  }
  return headers;
}

export interface EdgeServer {
  url: string;
  stop(): Promise<void>;
}

/**
 * Serves the built SPA (vite dist) same-origin with the API: static assets,
 * SPA fallback for client routes, and `/api` + `/openapi.yaml` proxied to the
 * running Polaris process — mirroring the control-tower nginx container.
 */
export async function startEdgeServer(apiBaseUrl: string): Promise<EdgeServer> {
  const securityHeaders = parseSecurityHeaders();
  const api = new URL(apiBaseUrl);

  const server = http.createServer(async (request, response) => {
    const url = request.url ?? "/";
    if (url.startsWith("/api/") || url === "/openapi.yaml") {
      proxy(request, response);
      return;
    }
    await serveStatic(url, response);
  });

  function proxy(request: http.IncomingMessage, response: http.ServerResponse): void {
    const target = new URL(request.url ?? "/", api);
    const upstream = http.request(
      target,
      {
        method: request.method,
        headers: { ...request.headers, host: target.host },
      },
      (res) => {
        response.writeHead(res.statusCode ?? 502, res.headers);
        res.pipe(response);
      },
    );
    upstream.on("error", () => {
      response.writeHead(502, { "Content-Type": "text/plain" });
      response.end("edge proxy error");
    });
    request.pipe(upstream);
  }

  async function serveStatic(url: string, response: http.ServerResponse): Promise<void> {
    const pathname = decodeURIComponent(new URL(url, "http://edge.local").pathname);
    const candidate = normalize(join(distDir, pathname));
    let filePath = join(distDir, "index.html");
    let body: Buffer | null = null;
    if (candidate.startsWith(distDir) && pathname.startsWith("/assets/")) {
      try {
        const info = await stat(candidate);
        if (info.isFile()) {
          body = await readFile(candidate);
          filePath = candidate;
        }
      } catch {
        body = null;
      }
    }
    body ??= await readFile(join(distDir, "index.html"));
    response.writeHead(200, {
      ...Object.fromEntries(
        Object.entries(securityHeaders).map(([name, value]) => [name.toLowerCase(), value]),
      ),
      "Content-Type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
    });
    response.end(body);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("edge server did not bind to a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
