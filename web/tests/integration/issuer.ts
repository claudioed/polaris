import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

/**
 * In-process OpenID Connect issuer mirroring the Go suite's
 * internal/adapters/httpapi/oidctest: serves discovery and JWKS endpoints and
 * signs ID tokens with a fresh RSA key so the production verifier in the API
 * runs its real code path without external network access.
 */
export interface FakeIssuer {
  url: string;
  token(claims: { sub: string; email: string; expiresInSeconds?: number }): Promise<string>;
  stop(): Promise<void>;
}

export async function startIssuer(): Promise<FakeIssuer> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  let baseUrl = "";

  const server: Server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/.well-known/openid-configuration") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          issuer: baseUrl,
          jwks_uri: `${baseUrl}/keys`,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      );
      return;
    }
    if (request.method === "GET" && request.url === "/keys") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("issuer did not bind to a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    url: baseUrl,
    async token({ sub, email, expiresInSeconds = 3600 }) {
      return new SignJWT({ email, email_verified: true })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setSubject(sub)
        .setIssuer(baseUrl)
        .setAudience("polaris-web")
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
        .sign(privateKey);
    },
    stop() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
