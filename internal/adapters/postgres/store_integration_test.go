//go:build integration

package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/claudioed/polaris/internal/application"
	"github.com/claudioed/polaris/internal/domain/fitness"
	"github.com/google/uuid"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

func skipIfDisabled(t *testing.T) {
	t.Helper()
	if os.Getenv("POLARIS_SKIP_INTEGRATION") == "1" {
		t.Skip("POLARIS_SKIP_INTEGRATION=1")
	}
}

// startPostgres boots an ephemeral PostgreSQL 18 container and returns its DSN.
func startPostgres(ctx context.Context, t *testing.T) string {
	t.Helper()
	if dsn := os.Getenv("POLARIS_TEST_DATABASE_URL"); dsn != "" {
		return dsn
	}
	container, err := postgres.Run(ctx, "postgres:18.4-alpine",
		postgres.WithDatabase("polaris"),
		postgres.WithUsername("polaris"),
		postgres.WithPassword("polaris"),
		testcontainers.WithCmdArgs("-c", "fsync=off"),
		testcontainers.WithAdditionalWaitStrategyAndDeadline(60*time.Second,
			wait.ForLog("database system is ready to accept connections").WithOccurrence(2),
		),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = container.Terminate(shutdownCtx)
	})
	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("container connection string: %v", err)
	}
	return dsn
}

type suite struct {
	store *Store
	dsn   string
	now   time.Time
}

func newSuite(t *testing.T) *suite {
	t.Helper()
	skipIfDisabled(t)
	ctx := context.Background()
	dsn := startPostgres(ctx, t)
	if err := Migrate(ctx, dsn); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	store, err := New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(store.Close)
	return &suite{store: store, dsn: dsn, now: time.Now().UTC().Truncate(time.Microsecond)}
}

// reset truncates all business tables between tests while keeping migrations.
func (s *suite) reset(t *testing.T) {
	t.Helper()
	tables := []string{
		"event_acknowledgements", "outbox_events", "evaluations", "measurement_submissions",
		"collection_attempts", "collection_schedules", "fitness_function_versions",
		"fitness_functions", "measurement_producers", "measurement_sources",
		"source_connection_checks", "fitness_targets", "squads", "tribes", "resource_documents",
	}
	for _, table := range tables {
		if _, err := s.store.pool.Exec(context.Background(), "TRUNCATE TABLE "+table+" CASCADE"); err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}
}

func (s *suite) event(eventType, aggregateID string) application.Event {
	return application.Event{
		ID: uuid.NewString(), Type: eventType, Version: 1, AggregateType: "test",
		AggregateID: aggregateID, OccurredAt: s.now, Actor: "tester",
		CorrelationID: uuid.NewString(), Payload: map[string]any{"test": true},
	}
}

func (s *suite) mustCreateTribeSquadTarget(t *testing.T) (tribe, squad, target application.Record) {
	t.Helper()
	ctx := context.Background()
	tribe = application.Record{ID: uuid.NewString(), Kind: "tribe", Status: "ACTIVE", Revision: 1, Data: map[string]any{"name": "Tribe " + uuid.NewString()[:8]}, CreatedAt: s.now, UpdatedAt: s.now}
	if err := s.store.CreateRecord(ctx, tribe, s.event("tribeCreated", tribe.ID)); err != nil {
		t.Fatalf("create tribe: %v", err)
	}
	squad = application.Record{ID: uuid.NewString(), ParentID: tribe.ID, Kind: "squad", Status: "ACTIVE", Revision: 1, Data: map[string]any{"name": "Squad " + uuid.NewString()[:8]}, CreatedAt: s.now, UpdatedAt: s.now}
	if err := s.store.CreateRecord(ctx, squad, s.event("squadCreated", squad.ID)); err != nil {
		t.Fatalf("create squad: %v", err)
	}
	target = application.Record{ID: uuid.NewString(), ParentID: squad.ID, Kind: "fitness-target", Status: "ACTIVE", Revision: 1, Data: map[string]any{"name": "target"}, CreatedAt: s.now, UpdatedAt: s.now}
	if err := s.store.CreateRecord(ctx, target, s.event("targetCreated", target.ID)); err != nil {
		t.Fatalf("create target: %v", err)
	}
	return tribe, squad, target
}

func (s *suite) pushFunction(squadID, targetID, producerID string) fitness.Definition {
	return fitness.Definition{
		Name: "fn-" + uuid.NewString()[:8], Purpose: "p", Objective: "o",
		TargetIDs: []string{targetID}, FreshnessSecond: 300, Enforcement: fitness.Block,
		Criteria:    []fitness.Criterion{{Key: "latency", Unit: "ms", Required: true, FailureComparison: fitness.GreaterThan, FailureValue: 500}},
		Acquisition: fitness.Acquisition{Mode: fitness.Push, ProducerID: producerID, MaximumObservationAgeSecond: 600},
	}
}

func TestRecordCRUDAndPagination(t *testing.T) {
	s := newSuite(t)
	ctx := context.Background()

	tribe, squad, _ := s.mustCreateTribeSquadTarget(t)

	got, err := s.store.GetRecord(ctx, "squad", squad.ID)
	if err != nil || got.ParentID != tribe.ID || got.Data["name"] != squad.Data["name"] {
		t.Fatalf("squad round-trip failed: %#v %v", got, err)
	}
	if _, err = s.store.GetRecord(ctx, "tribe", uuid.NewString()); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("missing tribe = %v, want ErrNotFound", err)
	}

	squad.Status = "ARCHIVED"
	squad.Revision = 2
	if err = s.store.UpdateRecord(ctx, squad, s.event("squadArchived", squad.ID)); err != nil {
		t.Fatalf("update squad: %v", err)
	}
	got, err = s.store.GetRecord(ctx, "squad", squad.ID)
	if err != nil || got.Status != "ARCHIVED" || got.Revision != 2 {
		t.Fatalf("squad update round-trip failed: %#v %v", got, err)
	}

	duplicate := tribe
	duplicate.ID = uuid.NewString()
	if err = s.store.CreateRecord(ctx, duplicate, s.event("x", duplicate.ID)); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("duplicate tribe name = %v, want ErrConflict", err)
	}
	orphan := application.Record{ID: uuid.NewString(), ParentID: uuid.NewString(), Kind: "squad", Status: "ACTIVE", Revision: 1, Data: map[string]any{"name": "orphan"}, CreatedAt: s.now, UpdatedAt: s.now}
	if err = s.store.CreateRecord(ctx, orphan, s.event("x", orphan.ID)); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("orphan squad = %v, want ErrNotFound (fk)", err)
	}

	s.reset(t)
	_, squad2, _ := s.mustCreateTribeSquadTarget(t)
	for i := range 3 {
		record := application.Record{ID: uuid.NewString(), ParentID: squad2.ID, Kind: "waiver", Status: "PROPOSED", Revision: 1, Data: map[string]any{"reason": fmt.Sprintf("w-%d", i)}, CreatedAt: s.now.Add(time.Duration(i) * time.Second), UpdatedAt: s.now}
		if err = s.store.CreateRecord(ctx, record, s.event("waiverCreated", record.ID)); err != nil {
			t.Fatalf("create waiver %d: %v", i, err)
		}
	}
	page1, next, err := s.store.ListRecords(ctx, "waiver", squad2.ID, 2, "")
	if err != nil || len(page1) != 2 || next == "" {
		t.Fatalf("first page = %d items, next %q, err %v", len(page1), next, err)
	}
	page2, next2, err := s.store.ListRecords(ctx, "waiver", squad2.ID, 2, next)
	if err != nil || len(page2) != 1 || next2 != "" {
		t.Fatalf("second page = %d items, next %q, err %v", len(page2), next2, err)
	}
	if page1[0].Data["reason"] == page2[0].Data["reason"] {
		t.Fatal("pagination returned overlapping items")
	}
}

func TestFitnessFunctionPersistence(t *testing.T) {
	s := newSuite(t)
	ctx := context.Background()
	_, squad, target := s.mustCreateTribeSquadTarget(t)

	definition := s.pushFunction(squad.ID, target.ID, "producer")
	fn, err := fitness.New(uuid.NewString(), squad.ID, definition, []string{target.ID}, s.now)
	if err != nil {
		t.Fatalf("construct function: %v", err)
	}
	if err = s.store.CreateFitnessFunction(ctx, fn, s.event("drafted", fn.ID)); err != nil {
		t.Fatalf("create function: %v", err)
	}

	loaded, err := s.store.GetFitnessFunction(ctx, fn.ID)
	if err != nil || loaded.Lifecycle != fitness.Draft || len(loaded.Versions) != 1 || loaded.Versions[0].Definition.Name != definition.Name {
		t.Fatalf("function round-trip failed: %#v %v", loaded, err)
	}

	updated := *loaded
	updatedCopy := &updated
	if _, err = updatedCopy.AddVersion(definition, []string{target.ID}, loaded.Revision, s.now); err != nil {
		t.Fatalf("add version: %v", err)
	}
	if err = s.store.SaveFitnessFunction(ctx, updatedCopy, s.event("versionAdded", fn.ID)); err != nil {
		t.Fatalf("save added version: %v", err)
	}
	if err = updatedCopy.Activate(2, s.now); err != nil {
		t.Fatalf("activate version: %v", err)
	}
	if err = s.store.SaveFitnessFunction(ctx, updatedCopy, s.event("activated", fn.ID)); err != nil {
		t.Fatalf("save function: %v", err)
	}

	reloaded, err := s.store.GetFitnessFunction(ctx, fn.ID)
	if err != nil || reloaded.ActiveVersion != 2 || reloaded.Lifecycle != fitness.Active || len(reloaded.Versions) != 2 {
		t.Fatalf("activated function round-trip failed: %#v %v", reloaded, err)
	}
	for _, version := range reloaded.Versions {
		if version.Number == 1 && version.State != fitness.VersionDraft {
			t.Fatalf("never-activated version state = %q, want DRAFT", version.State)
		}
		if version.Number == 2 && version.State != fitness.VersionActive {
			t.Fatalf("new version state = %q, want ACTIVE", version.State)
		}
	}

	stale := *reloaded
	staleCopy := &stale
	staleCopy.Revision = 1
	if err = s.store.SaveFitnessFunction(ctx, staleCopy, s.event("x", fn.ID)); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("stale save = %v, want ErrConflict", err)
	}

	ids, err := s.store.OwnedTargetIDs(ctx, squad.ID)
	if err != nil || len(ids) != 1 || ids[0] != target.ID {
		t.Fatalf("owned targets = %v, err %v", ids, err)
	}
	functions, _, err := s.store.ListFitnessFunctions(ctx, squad.ID, 10, "")
	if err != nil || len(functions) != 1 || functions[0].ID != fn.ID {
		t.Fatalf("list functions = %d, err %v", len(functions), err)
	}
}

func TestSubmissionDedupAndOutbox(t *testing.T) {
	s := newSuite(t)
	ctx := context.Background()
	_, squad, target := s.mustCreateTribeSquadTarget(t)

	producer := application.Record{ID: uuid.NewString(), ParentID: squad.ID, Kind: "measurement-producer", Status: "ACTIVE", Revision: 1, Data: map[string]any{"name": "ci"}, CreatedAt: s.now, UpdatedAt: s.now}
	if err := s.store.CreateRecord(ctx, producer, s.event("producerCreated", producer.ID)); err != nil {
		t.Fatalf("create producer: %v", err)
	}

	fn, err := fitness.New(uuid.NewString(), squad.ID, s.pushFunction(squad.ID, target.ID, producer.ID), []string{target.ID}, s.now)
	if err != nil {
		t.Fatalf("construct function: %v", err)
	}
	if err = s.store.CreateFitnessFunction(ctx, fn, s.event("drafted", fn.ID)); err != nil {
		t.Fatalf("create function: %v", err)
	}
	activate := *fn
	activateCopy := &activate
	if err = activateCopy.Activate(1, s.now); err != nil {
		t.Fatalf("activate: %v", err)
	}
	if err = s.store.SaveFitnessFunction(ctx, activateCopy, s.event("activated", fn.ID)); err != nil {
		t.Fatalf("save activation: %v", err)
	}

	submissionRecord := application.Record{ID: uuid.NewString(), ParentID: fn.ID, Kind: "measurement-submission", Status: "ACCEPTED", Revision: 1,
		Data: map[string]any{"producerId": producer.ID, "externalRunId": "run-1"}, CreatedAt: s.now, UpdatedAt: s.now}
	evaluation := application.EvaluationRecord{ID: uuid.NewString(), FitnessFunctionID: fn.ID, FitnessFunctionVersion: 1,
		AcquisitionMode: fitness.Push, OriginID: submissionRecord.ID,
		Evaluation: fitness.Evaluation{Outcome: fitness.Pass, Disposition: "ACCEPTED", ObservedAt: s.now, ValidUntil: s.now.Add(time.Minute)},
		Data:       map[string]any{"producerId": producer.ID}}
	if err = s.store.SaveSubmissionAndEvaluation(ctx, submissionRecord, evaluation, s.event("EvaluationRecorded", evaluation.ID)); err != nil {
		t.Fatalf("save submission: %v", err)
	}

	found, err := s.store.FindSubmission(ctx, producer.ID, "run-1")
	if err != nil || found.ID != evaluation.ID {
		t.Fatalf("find submission = %#v, err %v", found, err)
	}
	if _, err = s.store.FindSubmission(ctx, producer.ID, "run-2"); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("missing submission = %v, want ErrNotFound", err)
	}

	duplicateEval := evaluation
	duplicateEval.ID = uuid.NewString()
	if err = s.store.SaveSubmissionAndEvaluation(ctx, submissionRecord, duplicateEval, s.event("x", duplicateEval.ID)); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("duplicate submission = %v, want ErrConflict", err)
	}

	loaded, err := s.store.GetEvaluation(ctx, evaluation.ID)
	if err != nil || loaded.Evaluation.Outcome != fitness.Pass || loaded.Evaluation.Disposition != "ACCEPTED" {
		t.Fatalf("evaluation round-trip failed: %#v %v", loaded, err)
	}
	listed, _, err := s.store.ListEvaluations(ctx, fn.ID, 10, "")
	if err != nil || len(listed) != 1 {
		t.Fatalf("list evaluations = %d, err %v", len(listed), err)
	}

	events, cursor, err := s.store.PollEvents(ctx, 0, 100)
	if err != nil || len(events) == 0 || cursor == 0 {
		t.Fatalf("poll events = %d items, cursor %d, err %v", len(events), cursor, err)
	}
	more, _, err := s.store.PollEvents(ctx, cursor, 100)
	if err != nil || len(more) != 0 {
		t.Fatalf("poll after cursor = %d items, err %v", len(more), err)
	}
	if err = s.store.AcknowledgeEvents(ctx, "consumer-1", []string{events[0].ID}, s.now); err != nil {
		t.Fatalf("acknowledge: %v", err)
	}
}

func TestScheduledCollectionClaims(t *testing.T) {
	s := newSuite(t)
	ctx := context.Background()
	_, squad, target := s.mustCreateTribeSquadTarget(t)

	source := application.Record{ID: uuid.NewString(), ParentID: squad.ID, Kind: "measurement-source", Status: "ACTIVE", Revision: 1,
		Data: map[string]any{"name": "prom", "providerType": "PROMETHEUS", "baseUrl": "http://prom"}, CreatedAt: s.now, UpdatedAt: s.now}
	if err := s.store.CreateRecord(ctx, source, s.event("sourceCreated", source.ID)); err != nil {
		t.Fatalf("create source: %v", err)
	}

	definition := fitness.Definition{
		Name: "pull-" + uuid.NewString()[:8], Purpose: "p", Objective: "o",
		TargetIDs: []string{target.ID}, FreshnessSecond: 300, Enforcement: fitness.Observe,
		Criteria: []fitness.Criterion{{Key: "latency", Unit: "ms", Required: true, FailureComparison: fitness.GreaterThan, FailureValue: 500}},
		Acquisition: fitness.Acquisition{Mode: fitness.Pull, SourceID: source.ID, Trigger: "SCHEDULED",
			IntervalSecond: 60, TimeoutSecond: 5,
			Queries: []fitness.MetricQuery{{CriterionKey: "latency", Expression: "up", Mode: "INSTANT", Reduction: "LAST", SeriesPolicy: "REQUIRE_SINGLE_SERIES", Unit: "ms"}}},
	}
	fn, err := fitness.New(uuid.NewString(), squad.ID, definition, []string{target.ID}, s.now)
	if err != nil {
		t.Fatalf("construct function: %v", err)
	}
	if err = s.store.CreateFitnessFunction(ctx, fn, s.event("drafted", fn.ID)); err != nil {
		t.Fatalf("create function: %v", err)
	}
	activate := *fn
	activateCopy := &activate
	if err = activateCopy.Activate(1, s.now); err != nil {
		t.Fatalf("activate: %v", err)
	}
	if err = s.store.SaveFitnessFunction(ctx, activateCopy, s.event("activated", fn.ID)); err != nil {
		t.Fatalf("save activation: %v", err)
	}

	claimed, err := s.store.ClaimDueCollections(ctx, s.now.Add(2*time.Minute), 10)
	if err != nil || len(claimed) != 1 || claimed[0] != fn.ID {
		t.Fatalf("claim due = %v, err %v", claimed, err)
	}
	// The first claim advanced next_run_at to claim-time + interval (now+3m);
	// a probe before that instant must not re-claim.
	claimedAgain, err := s.store.ClaimDueCollections(ctx, s.now.Add(2*time.Minute+30*time.Second), 10)
	if err != nil || len(claimedAgain) != 0 {
		t.Fatalf("second claim before next_run_at = %v, err %v", claimedAgain, err)
	}
	if _, err = s.store.ClaimDueCollections(ctx, s.now.Add(5*time.Minute), 10); err != nil {
		t.Fatalf("second window claim: %v", err)
	}
}
