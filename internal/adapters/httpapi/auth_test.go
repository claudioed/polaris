package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/claudioed/polaris/internal/adapters/httpapi/oidctest"
)

func newTestAuth(t *testing.T) (*oidctest.Issuer, *Authenticator) {
	t.Helper()
	issuer := oidctest.New(t)
	auth, err := NewOIDC(context.Background(), issuer.Server.URL, testClientID, testAuthorizedEmail)
	if err != nil {
		t.Fatalf("new oidc: %v", err)
	}
	return issuer, auth.WithIngestKey(testIngestKey)
}

func doRequest(handler http.Handler, method, target, token, apiKey, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if apiKey != "" {
		req.Header.Set("X-API-Key", apiKey)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestHealthEndpointsArePublic(t *testing.T) {
	_, auth := newTestAuth(t)
	handler := newTestHandler(auth)
	if rec := doRequest(handler, http.MethodGet, "/api/v1/health/live", "", "", ""); rec.Code != http.StatusOK {
		t.Fatalf("liveness without credentials = %d, want 200", rec.Code)
	}
	if rec := doRequest(handler, http.MethodGet, "/api/v1/health/ready", "", "", ""); rec.Code != http.StatusOK {
		t.Fatalf("readiness without credentials = %d, want 200", rec.Code)
	}
}

func TestBusinessEndpointsRequireBearerToken(t *testing.T) {
	issuer, auth := newTestAuth(t)
	handler := newTestHandler(auth)

	cases := []struct {
		name   string
		token  string
		apiKey string
	}{
		{name: "anonymous"},
		{name: "api key instead of bearer", apiKey: testIngestKey},
		{name: "malformed header", token: "not-a-jwt"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := doRequest(handler, http.MethodGet, "/api/v1/tribes", tc.token, tc.apiKey, "")
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("GET /tribes = %d, want 401", rec.Code)
			}
			if want := `Bearer realm="polaris"`; rec.Header().Get("WWW-Authenticate") != want {
				t.Fatalf("WWW-Authenticate = %q, want %q", rec.Header().Get("WWW-Authenticate"), want)
			}
		})
	}

	rec := doRequest(handler, http.MethodGet, "/api/v1/tribes", issuer.Token(t, issuer.Claims(testClientID, "user-1")), "", "")
	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("GET /tribes with valid token was rejected at the auth gate")
	}
}

func TestOIDCRejectsInvalidTokens(t *testing.T) {
	issuer, auth := newTestAuth(t)
	handler := newTestHandler(auth)

	expired := issuer.Claims(testClientID, "user-1")
	expired["exp"] = time.Now().Add(-time.Minute).Unix()
	wrongAudience := issuer.Claims("some-other-app", "user-1")
	wrongIssuer := issuer.Claims(testClientID, "user-1")
	wrongIssuer["iss"] = "https://evil.example.com"

	cases := []struct {
		name   string
		claims map[string]any
	}{
		{name: "expired", claims: expired},
		{name: "wrong audience", claims: wrongAudience},
		{name: "wrong issuer", claims: wrongIssuer},
		{name: "missing subject", claims: map[string]any{"iss": issuer.Server.URL, "aud": testClientID, "exp": time.Now().Add(time.Hour).Unix()}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := doRequest(handler, http.MethodGet, "/api/v1/tribes", issuer.Token(t, tc.claims), "", "")
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("GET /tribes = %d, want 401", rec.Code)
			}
		})
	}

	tampered := "garbage." + strings.Split(issuer.Token(t, issuer.Claims(testClientID, "user-1")), ".")[1]
	if rec := doRequest(handler, http.MethodGet, "/api/v1/tribes", tampered, "", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /tribes with tampered token = %d, want 401", rec.Code)
	}
}

func TestOIDCRejectsUnauthorizedEmail(t *testing.T) {
	issuer, auth := newTestAuth(t)
	handler := newTestHandler(auth)

	cases := []struct {
		name   string
		claims map[string]any
	}{
		{name: "different email", claims: issuer.Claims(testClientID, "someone-else")},
		{name: "unverified email", claims: issuer.Claims(testClientID, "user-1")},
	}
	cases[1].claims["email_verified"] = false

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := doRequest(handler, http.MethodGet, "/api/v1/tribes", issuer.Token(t, tc.claims), "", "")
			if rec.Code != http.StatusForbidden {
				t.Fatalf("GET /tribes = %d, want 403", rec.Code)
			}
			if !strings.Contains(rec.Body.String(), `"code":"FORBIDDEN"`) {
				t.Fatalf("body = %s, want FORBIDDEN problem code", rec.Body.String())
			}
			if got := rec.Header().Get("WWW-Authenticate"); got != "" {
				t.Fatalf("WWW-Authenticate = %q, want empty for authenticated caller", got)
			}
		})
	}
}

func TestIngestEndpointsRequireAPIKey(t *testing.T) {
	issuer, auth := newTestAuth(t)
	handler := newTestHandler(auth)
	target := "/api/v1/fitness-functions/fn-1/measurement-submissions"
	body := "{}"

	cases := []struct {
		name   string
		token  string
		apiKey string
	}{
		{name: "anonymous"},
		{name: "bearer token instead of key", token: issuer.Token(t, issuer.Claims(testClientID, "user-1"))},
		{name: "wrong key", apiKey: "wrong-key"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := doRequest(handler, http.MethodPost, target, tc.token, tc.apiKey, body)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("POST measurement-submissions = %d, want 401", rec.Code)
			}
		})
	}

	rec := doRequest(handler, http.MethodPost, target, "", testIngestKey, body)
	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("POST measurement-submissions with valid key was rejected at the auth gate")
	}

	rec = doRequest(handler, http.MethodPost, "/api/v1/measurement-submission-batches", "", testIngestKey, body)
	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("POST measurement-submission-batches with valid key was rejected at the auth gate")
	}
}

func TestRequireOIDCPopulatesPrincipal(t *testing.T) {
	issuer, auth := newTestAuth(t)
	var principal Principal
	var ok bool
	gated := auth.RequireOIDC(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		principal, ok = PrincipalFrom(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/echo", nil)
	req.Header.Set("Authorization", "Bearer "+issuer.Token(t, issuer.Claims(testClientID, "user-1")))
	gated.ServeHTTP(httptest.NewRecorder(), req)

	if !ok {
		t.Fatal("principal missing from request context")
	}
	if principal.Subject != "user-1" || principal.Email != "user-1@example.com" {
		t.Fatalf("principal = %+v, want subject user-1 and email user-1@example.com", principal)
	}
	if _, still := PrincipalFrom(context.Background()); still {
		t.Fatal("PrincipalFrom should report false on a bare context")
	}
}

func TestNewOIDCRejectsUnreachableIssuer(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	if _, err := NewOIDC(context.Background(), server.URL, testClientID, testAuthorizedEmail); err == nil {
		t.Fatal("NewOIDC should fail when discovery is unavailable")
	}
}

func TestNewOIDCRequiresAuthorizedEmail(t *testing.T) {
	if _, err := NewOIDC(context.Background(), "https://issuer.example.com", testClientID, " "); err == nil {
		t.Fatal("NewOIDC should reject an empty authorized email")
	}
}

func TestBearerTokenParsing(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	if got := bearerToken(r); got != "" {
		t.Fatalf("missing header = %q, want empty", got)
	}
	r.Header.Set("Authorization", "Bearer abc")
	if got := bearerToken(r); got != "abc" {
		t.Fatalf("bearer = %q, want abc", got)
	}
	r.Header.Set("Authorization", "bearer abc")
	if got := bearerToken(r); got != "abc" {
		t.Fatalf("case-insensitive scheme = %q, want abc", got)
	}
	r.Header.Set("Authorization", "Basic abc")
	if got := bearerToken(r); got != "" {
		t.Fatalf("non-bearer scheme = %q, want empty", got)
	}
}
