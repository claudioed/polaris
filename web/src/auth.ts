const TOKEN_KEY = "polaris.idToken";
const STORAGE_EVENT = "polaris:auth";

export interface GoogleUser {
  token: string;
  subject: string;
  email: string;
  name: string;
  picture?: string;
}

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleAccounts {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
        auto_select?: boolean;
      }) => void;
      renderButton: (
        parent: HTMLElement,
        options: Record<string, unknown>,
      ) => void;
      prompt: () => void;
      disableAutoSelect: () => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

let scriptPromise: Promise<void> | undefined;

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="accounts.google.com/gsi/client"]',
    );
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () =>
      reject(new Error("Failed to load Google Identity Services")),
    );
    if (!existing) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return scriptPromise;
}

function decodeClaims(token: string): {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
} | null {
  const segments = token.split(".");
  if (segments.length !== 3) return null;
  try {
    const bytes = Uint8Array.from(
      atob(segments[1].replace(/-/g, "+").replace(/_/g, "/")),
      (char) => char.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as {
      sub: string;
      email?: string;
      name?: string;
      picture?: string;
    };
  } catch {
    return null;
  }
}

export function isConfigured(): boolean {
  return Boolean(clientId);
}

export function currentUser(): GoogleUser | null {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  const claims = decodeClaims(token);
  if (!claims) {
    sessionStorage.removeItem(TOKEN_KEY);
    return null;
  }
  return {
    token,
    subject: claims.sub,
    email: claims.email ?? "",
    name: claims.name ?? claims.email ?? "Signed in",
    picture: claims.picture,
  };
}

export function currentToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function signOut(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new CustomEvent(STORAGE_EVENT));
  try {
    window.google?.accounts.id.disableAutoSelect();
  } catch {
    // GIS not loaded yet; nothing else to clean up.
  }
}

export function onAuthChange(listener: () => void): () => void {
  window.addEventListener(STORAGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(STORAGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export async function initializeGoogleSignIn(
  parent: HTMLElement,
  onSignedIn: (user: GoogleUser) => void,
): Promise<void> {
  if (!clientId) throw new Error("VITE_GOOGLE_CLIENT_ID is not configured");
  await loadGoogleScript();
  const google = window.google;
  if (!google) throw new Error("Google Identity Services unavailable");
  google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => {
      if (!response.credential) return;
      sessionStorage.setItem(TOKEN_KEY, response.credential);
      const user = currentUser();
      if (user) onSignedIn(user);
    },
  });
  google.accounts.id.renderButton(parent, {
    theme: "outline",
    size: "large",
    width: 300,
    text: "signin_with",
  });
  google.accounts.id.prompt();
}
