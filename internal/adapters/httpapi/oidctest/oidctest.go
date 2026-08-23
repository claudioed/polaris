// Package oidctest provides an in-process OpenID Connect issuer for tests.
// It serves discovery and JWKS endpoints and signs ID tokens with a fresh RSA
// key, so a real go-oidc verifier can run against it without external network
// access. Point httpapi.NewOIDC at the issuer's URL to exercise production
// verification code paths.
package oidctest

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
)

// Issuer is a fake OpenID Connect provider backed by an httptest server.
type Issuer struct {
	Server *httptest.Server
	Key    *rsa.PrivateKey
	signer jose.Signer
}

// New starts a fake issuer and registers its cleanup with the test.
func New(t *testing.T) *Issuer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithType("JWT"))
	if err != nil {
		t.Fatalf("create signer: %v", err)
	}
	issuer := &Issuer{Key: key, signer: signer}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]any{
			"issuer":                                issuer.Server.URL,
			"jwks_uri":                              issuer.Server.URL + "/keys",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("GET /keys", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
			{Key: key.Public(), KeyID: "test-key", Algorithm: string(jose.RS256), Use: "sig"},
		}})
	})
	issuer.Server = httptest.NewServer(mux)
	t.Cleanup(issuer.Server.Close)
	return issuer
}

// Claims returns a valid claim set for the given audience and subject.
func (i *Issuer) Claims(audience, subject string) map[string]any {
	return map[string]any{
		"iss":   i.Server.URL,
		"aud":   audience,
		"sub":   subject,
		"email": subject + "@example.com",
		"exp":   time.Now().Add(time.Hour).Unix(),
	}
}

// Token signs the claim set into a compact JWT.
func (i *Issuer) Token(t *testing.T, claims map[string]any) string {
	t.Helper()
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	object, err := i.signer.Sign(payload)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	signed, err := object.CompactSerialize()
	if err != nil {
		t.Fatalf("serialize token: %v", err)
	}
	return signed
}

func writeJSON(w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}
