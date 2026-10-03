import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INGEST_KEY, startStack } from "../integration/stack";
import { startEdgeServer } from "./edge-server";

export const handoffPath = join(dirname(fileURLToPath(import.meta.url)), ".stack.json");

/**
 * Boots the full stack once per run: postgres (testcontainer or
 * POLARIS_TEST_DATABASE_URL), the fake OIDC issuer, the real Go API, and an
 * edge server that serves the built SPA with the production security headers.
 * Tests receive the URLs and pre-minted tokens through .stack.json.
 */
export default async function globalSetup() {
  if (process.env.POLARIS_SKIP_INTEGRATION === "1") {
    return async () => undefined;
  }

  const stack = await startStack();
  const edge = await startEdgeServer(stack.baseUrl);

  await writeFile(
    handoffPath,
    JSON.stringify({
      spaUrl: edge.url,
      apiUrl: stack.baseUrl,
      ingestKey: INGEST_KEY,
      validToken: await stack.token(),
      intruderToken: await stack.token({ sub: "intruder-1", email: "intruder@example.com" }),
      expiredToken: await stack.token({ expiresInSeconds: -60 }),
    }),
    "utf8",
  );

  return async () => {
    await edge.stop();
    await stack.stop();
  };
}
