package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-chi/chi/v5/middleware"
)

type principalKey struct{}

// Principal is the authenticated caller identity extracted from a verified ID token.
type Principal struct {
	Subject string
	Email   string
}

// PrincipalFrom returns the authenticated principal, if any.
func PrincipalFrom(ctx context.Context) (Principal, bool) {
	principal, ok := ctx.Value(principalKey{}).(Principal)
	return principal, ok
}

// Authenticator gates API routes behind OpenID Connect (Google) or a shared ingest secret.
type Authenticator struct {
	verifier        *oidc.IDTokenVerifier
	authorizedEmail string
	ingestKey       string
}

// NewOIDC connects to the issuer, discovers its keys, and prepares token verification.
func NewOIDC(ctx context.Context, issuer, clientID, authorizedEmail string) (*Authenticator, error) {
	if strings.TrimSpace(authorizedEmail) == "" {
		return nil, fmt.Errorf("authorized email is required")
	}
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("discover oidc issuer %q: %w", issuer, err)
	}
	return &Authenticator{
		verifier:        provider.Verifier(&oidc.Config{ClientID: clientID}),
		authorizedEmail: strings.TrimSpace(authorizedEmail),
	}, nil
}

// WithIngestKey arms the shared-secret path used by measurement producers.
func (a *Authenticator) WithIngestKey(secret string) *Authenticator {
	a.ingestKey = secret
	return a
}

func (a *Authenticator) RequireOIDC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := bearerToken(r)
		if raw == "" {
			unauthorized(w, r, "missing bearer token")
			return
		}
		idToken, err := a.verifier.Verify(r.Context(), raw)
		if err != nil {
			unauthorized(w, r, "invalid bearer token")
			return
		}
		claims := struct {
			Sub           string `json:"sub"`
			Email         string `json:"email"`
			EmailVerified bool   `json:"email_verified"`
		}{}
		if err = idToken.Claims(&claims); err != nil || claims.Sub == "" {
			unauthorized(w, r, "invalid bearer token claims")
			return
		}
		if !claims.EmailVerified || !strings.EqualFold(strings.TrimSpace(claims.Email), a.authorizedEmail) {
			forbidden(w, r, "Google account is not authorized to access Polaris")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, Principal{
			Subject: claims.Sub, Email: claims.Email,
		})))
	})
}

func (a *Authenticator) RequireIngestKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provided := r.Header.Get("X-API-Key")
		if provided == "" {
			unauthorized(w, r, "missing X-API-Key header")
			return
		}
		if len(provided) != len(a.ingestKey) || subtle.ConstantTimeCompare([]byte(provided), []byte(a.ingestKey)) != 1 {
			unauthorized(w, r, "invalid X-API-Key header")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func bearerToken(r *http.Request) string {
	value := r.Header.Get("Authorization")
	if value == "" {
		return ""
	}
	scheme, token, found := strings.Cut(value, " ")
	if !found || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}
	return strings.TrimSpace(token)
}

func unauthorized(w http.ResponseWriter, r *http.Request, detail string) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="polaris"`)
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(http.StatusUnauthorized)
	title := http.StatusText(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type": "https://polaris.local/problems/unauthorized", "title": title,
		"status": http.StatusUnauthorized, "code": "UNAUTHENTICATED", "detail": detail,
		"instance": r.URL.Path, "correlationId": middleware.GetReqID(r.Context()),
	})
}

func forbidden(w http.ResponseWriter, r *http.Request, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(http.StatusForbidden)
	title := http.StatusText(http.StatusForbidden)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type": "https://polaris.local/problems/forbidden", "title": title,
		"status": http.StatusForbidden, "code": "FORBIDDEN", "detail": detail,
		"instance": r.URL.Path, "correlationId": middleware.GetReqID(r.Context()),
	})
}
