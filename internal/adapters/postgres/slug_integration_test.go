//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/claudioed/polaris/internal/application"
	"github.com/claudioed/polaris/internal/domain/fitness"
	"github.com/google/uuid"
)

// TestRecordSlugDerivationAndLookup covers Tribe/Squad: auto-derived slug on
// create, explicit slug on create, duplicate-slug conflict, and resolving
// GetRecord by slug instead of id.
func TestRecordSlugDerivationAndLookup(t *testing.T) {
	s := newSuite(t)
	ctx := context.Background()

	tribe := application.Record{ID: uuid.NewString(), Kind: "tribe", Status: "ACTIVE", Revision: 1, Data: map[string]any{"name": "Platform Commerce"}, CreatedAt: s.now, UpdatedAt: s.now}
	if err := s.store.CreateRecord(ctx, tribe, s.event("tribeCreated", tribe.ID)); err != nil {
		t.Fatalf("create tribe: %v", err)
	}
	got, err := s.store.GetRecord(ctx, "tribe", tribe.ID)
	if err != nil || got.Slug != "platform-commerce" {
		t.Fatalf("auto-derived tribe slug = %q, err %v, want %q", got.Slug, err, "platform-commerce")
	}

	// Explicit slug, set directly on the Record (mirrors what
	// application.Service.CreateRecord resolves before calling the store).
	custom := application.Record{ID: uuid.NewString(), Kind: "tribe", Slug: "cx", Status: "ACTIVE", Revision: 1, Data: map[string]any{"name": "Customer Experience"}, CreatedAt: s.now, UpdatedAt: s.now}
	if err := s.store.CreateRecord(ctx, custom, s.event("tribeCreated", custom.ID)); err != nil {
		t.Fatalf("create tribe with explicit slug: %v", err)
	}

	// Lookup by slug resolves the same row as lookup by id, including the
	// real id (not the slug) coming back in the result.
	bySlug, err := s.store.GetRecord(ctx, "tribe", "cx")
	if err != nil || bySlug.ID != custom.ID || bySlug.Slug != "cx" {
		t.Fatalf("lookup by slug = %#v, err %v", bySlug, err)
	}
	byID, err := s.store.GetRecord(ctx, "tribe", custom.ID)
	if err != nil || byID.Slug != "cx" {
		t.Fatalf("lookup by id = %#v, err %v", byID, err)
	}

	// Global slug uniqueness is a database constraint: a second tribe
	// explicitly reusing "cx" is rejected, even though its name differs.
	dup := application.Record{ID: uuid.NewString(), Kind: "tribe", Slug: "cx", Status: "ACTIVE", Revision: 1, Data: map[string]any{"name": "Totally Different Name"}, CreatedAt: s.now, UpdatedAt: s.now}
	if err := s.store.CreateRecord(ctx, dup, s.event("tribeCreated", dup.ID)); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("duplicate explicit slug = %v, want ErrConflict", err)
	}

	// Squad: same auto-derivation and slug-based lookup, scoped to its own
	// parent resolution but globally unique as a slug.
	squad := application.Record{ID: uuid.NewString(), ParentID: tribe.ID, Kind: "squad", Status: "ACTIVE", Revision: 1, Data: map[string]any{"name": "Checkout Squad"}, CreatedAt: s.now, UpdatedAt: s.now}
	if err := s.store.CreateRecord(ctx, squad, s.event("squadCreated", squad.ID)); err != nil {
		t.Fatalf("create squad: %v", err)
	}
	squadBySlug, err := s.store.GetRecord(ctx, "squad", "checkout-squad")
	if err != nil || squadBySlug.ID != squad.ID || squadBySlug.ParentID != tribe.ID {
		t.Fatalf("squad lookup by slug = %#v, err %v", squadBySlug, err)
	}

	// A slug that doesn't exist (and isn't a valid id either) is a plain 404,
	// not a database type-cast error.
	if _, err := s.store.GetRecord(ctx, "squad", "does-not-exist"); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("unknown slug = %v, want ErrNotFound", err)
	}
}

// TestFitnessFunctionSlugDerivationAndLookup mirrors the Record coverage
// above for the dedicated fitness.Function aggregate/table.
func TestFitnessFunctionSlugDerivationAndLookup(t *testing.T) {
	s := newSuite(t)
	ctx := context.Background()
	_, squad, target := s.mustCreateTribeSquadTarget(t)

	definition := s.pushFunction(squad.ID, target.ID, "producer")
	fn, err := fitness.New(uuid.NewString(), squad.ID, definition, []string{target.ID}, s.now)
	if err != nil {
		t.Fatalf("construct function: %v", err)
	}
	// Slug left empty: CreateFitnessFunction must derive it from the
	// definition's name, exactly like application.Service does when the
	// caller supplies no explicit slug.
	if err := s.store.CreateFitnessFunction(ctx, fn, s.event("drafted", fn.ID)); err != nil {
		t.Fatalf("create function: %v", err)
	}
	if fn.Slug == "" {
		t.Fatal("CreateFitnessFunction left Slug empty")
	}

	loaded, err := s.store.GetFitnessFunction(ctx, fn.Slug)
	if err != nil || loaded.ID != fn.ID {
		t.Fatalf("lookup by slug = %#v, err %v", loaded, err)
	}
	loadedByID, err := s.store.GetFitnessFunction(ctx, fn.ID)
	if err != nil || loadedByID.Slug != fn.Slug {
		t.Fatalf("lookup by id = %#v, err %v", loadedByID, err)
	}

	// Explicit slug on a second function, then a conflicting third.
	definition2 := s.pushFunction(squad.ID, target.ID, "producer")
	fn2, err := fitness.New(uuid.NewString(), squad.ID, definition2, []string{target.ID}, s.now)
	if err != nil {
		t.Fatalf("construct function 2: %v", err)
	}
	fn2.Slug = "code-quality"
	if err := s.store.CreateFitnessFunction(ctx, fn2, s.event("drafted", fn2.ID)); err != nil {
		t.Fatalf("create function with explicit slug: %v", err)
	}
	byCustomSlug, err := s.store.GetFitnessFunction(ctx, "code-quality")
	if err != nil || byCustomSlug.ID != fn2.ID {
		t.Fatalf("lookup by explicit slug = %#v, err %v", byCustomSlug, err)
	}

	definition3 := s.pushFunction(squad.ID, target.ID, "producer")
	fn3, err := fitness.New(uuid.NewString(), squad.ID, definition3, []string{target.ID}, s.now)
	if err != nil {
		t.Fatalf("construct function 3: %v", err)
	}
	fn3.Slug = "code-quality"
	if err := s.store.CreateFitnessFunction(ctx, fn3, s.event("drafted", fn3.ID)); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("duplicate fitness-function slug = %v, want ErrConflict", err)
	}
}
