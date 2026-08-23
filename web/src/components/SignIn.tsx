import { useEffect, useRef, useState } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { initializeGoogleSignIn, isConfigured, type GoogleUser } from "../auth";

export function SignIn({ onSignedIn }: { onSignedIn: (user: GoogleUser) => void }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!isConfigured() || !buttonRef.current) return;
    let cancelled = false;
    initializeGoogleSignIn(buttonRef.current, (user) => {
      if (!cancelled) onSignedIn(user);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(String(cause instanceof Error ? cause.message : cause));
    });
    return () => {
      cancelled = true;
    };
  }, [onSignedIn]);

  return (
    <div className="signin-shell">
      <div className="signin-card">
        <div className="brand-mark"><span /><span /><span /></div>
        <h1>Polaris Control Tower</h1>
        <p>Sign in with your Google account to govern fitness functions.</p>
        {isConfigured() ? (
          error ? (
            <p className="signin-error" role="alert">
              <AlertTriangle size={16} /> {error}
            </p>
          ) : (
            <div ref={buttonRef} className="signin-button">
              <span className="signin-loading"><LoaderCircle className="spin" size={18} /> Loading Google Sign-In…</span>
            </div>
          )
        ) : (
          <p className="signin-error" role="alert">
            <AlertTriangle size={16} /> Google Sign-In is not configured. Set VITE_GOOGLE_CLIENT_ID at build time.
          </p>
        )}
      </div>
    </div>
  );
}
