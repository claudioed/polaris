import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { startIssuer, type FakeIssuer } from "./issuer";

export const CLIENT_ID = "polaris-web";
export const AUTHORIZED_EMAIL = "engineer-1@example.com";
export const INGEST_KEY = "integration-ingest-secret";

const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

// Node has no sessionStorage; the api client reads the bearer token from it.
if (typeof globalThis.sessionStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

export interface Stack {
  baseUrl: string;
  issuer: FakeIssuer;
  token(options?: { sub?: string; email?: string; expiresInSeconds?: number }): Promise<string>;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("could not allocate a free port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForReady(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health/ready`);
      if (response.ok) return;
    } catch {
      // Process not accepting connections yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Polaris API did not become ready in time");
}

/** Boots postgres (testcontainer or POLARIS_TEST_DATABASE_URL), the fake OIDC issuer, and the real Go API. */
export async function startStack(): Promise<Stack> {
  const issuer = await startIssuer();

  let container: PostgreSqlContainer | undefined;
  let databaseUrl = process.env.POLARIS_TEST_DATABASE_URL;
  if (!databaseUrl) {
    container = await new PostgreSqlContainer("postgres:18.4-alpine")
      .withDatabase("polaris")
      .withUsername("polaris")
      .withPassword("polaris")
      .start();
    databaseUrl = container.getConnectionUri();
  }
  if (!databaseUrl.includes("sslmode=")) {
    databaseUrl += databaseUrl.includes("?") ? "&sslmode=disable" : "?sslmode=disable";
  }

  const buildDir = mkdtempSync(join(tmpdir(), "polaris-web-integration-"));
  const binary = join(buildDir, "polaris-api");
  await new Promise<void>((resolve, reject) => {
    const build = spawn("go", ["build", "-o", binary, "./cmd/polaris"], { cwd: repoRoot });
    build.once("error", reject);
    build.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`go build exited with ${code}`)),
    );
  });

  const httpPort = await freePort();
  const baseUrl = `http://127.0.0.1:${httpPort}`;
  const child: ChildProcess = spawn(binary, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      POLARIS_DATABASE_URL: databaseUrl,
      POLARIS_HTTP_ADDRESS: `127.0.0.1:${httpPort}`,
      POLARIS_OIDC_ISSUER: issuer.url,
      POLARIS_OIDC_CLIENT_ID: CLIENT_ID,
      POLARIS_AUTHORIZED_EMAIL: AUTHORIZED_EMAIL,
      POLARIS_INGEST_SECRET_KEY: INGEST_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  async function stop(): Promise<void> {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5_000).unref();
    });
    await issuer.stop();
    if (container) await container.stop();
    rmSync(buildDir, { recursive: true, force: true });
  }

  try {
    await waitForReady(baseUrl, 120_000);
  } catch (error) {
    await stop();
    throw new Error(`${(error as Error).message}\nAPI output:\n${output}`, { cause: error });
  }

  return {
    baseUrl,
    issuer,
    token: (options = {}) =>
      issuer.token({
        sub: options.sub ?? "engineer-1",
        email: options.email ?? AUTHORIZED_EMAIL,
        expiresInSeconds: options.expiresInSeconds,
      }),
    stop,
  };
}
