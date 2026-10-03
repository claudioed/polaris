//go:build integration

package postgres

import (
	"context"
	"testing"

	"github.com/claudioed/polaris/internal/application"
	"github.com/google/uuid"
)

// TestListMeasurementProducers covers the ListRecords("measurement-producer", ...)
// case: measurement_producers has no status/revision/updated_at columns, so
// the store must synthesize a valid Record shape around the raw table.
func TestListMeasurementProducers(t *testing.T) {
	s := newSuite(t)
	ctx := context.Background()
	_, squad, _ := s.mustCreateTribeSquadTarget(t)

	for _, name := range []string{"ci-pipeline", "release-bot"} {
		producer := application.Record{ID: uuid.NewString(), ParentID: squad.ID, Kind: "measurement-producer", Status: "ACTIVE", Revision: 1, Data: map[string]any{"name": name}, CreatedAt: s.now, UpdatedAt: s.now}
		if err := s.store.CreateRecord(ctx, producer, s.event("producerCreated", producer.ID)); err != nil {
			t.Fatalf("create producer %s: %v", name, err)
		}
	}

	page, next, err := s.store.ListRecords(ctx, "measurement-producer", squad.ID, 10, "")
	if err != nil || len(page) != 2 || next != "" {
		t.Fatalf("list producers = %d items, next %q, err %v", len(page), next, err)
	}
	for _, record := range page {
		if record.ParentID != squad.ID {
			t.Fatalf("producer parentId = %q, want %q", record.ParentID, squad.ID)
		}
		if record.Status != "ACTIVE" || record.Revision != 1 {
			t.Fatalf("producer synthesized fields wrong: %#v", record)
		}
		if record.Data["name"] == nil {
			t.Fatalf("producer data missing name: %#v", record)
		}
	}

	// A squad with no producers lists empty, not an error.
	_, otherSquad, _ := s.mustCreateTribeSquadTarget(t)
	empty, _, err := s.store.ListRecords(ctx, "measurement-producer", otherSquad.ID, 10, "")
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty producer list = %d items, err %v", len(empty), err)
	}
}
