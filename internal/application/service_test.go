package application

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/claudioed/polaris/internal/domain/fitness"
)

type testIDs struct{ next int }

func (g *testIDs) New() string {
	g.next++
	return fmt.Sprintf("id-%d", g.next)
}

type testClock struct{ now time.Time }

func (c testClock) Now() time.Time { return c.now }

type testCollector struct {
	checkErr error
	queryErr error
	value    float64
	// lastTimeout records the deadline duration passed to the most recent Query.
	lastTimeout time.Duration
}

func (c *testCollector) Check(context.Context, string) error { return c.checkErr }
func (c *testCollector) Query(_ context.Context, _ string, _ fitness.MetricQuery, _ time.Time, timeout time.Duration) (float64, map[string]any, error) {
	c.lastTimeout = timeout
	return c.value, map[string]any{"source": "test"}, c.queryErr
}

type memoryStore struct {
	records     map[string]Record
	functions   map[string]*fitness.Function
	submissions map[string]EvaluationRecord
	evaluations map[string]EvaluationRecord
	events      []Event
	due         []string
	pingErr     error
	ownedErr    error
	findErr     error
	claimErr    error
	getFnErr    error
	saveFnErr   error
	updateErr   error
	// seenLimits, seenBatches capture clamped values reaching the store.
	seenLimits  []int
	seenBatches []int
}

func newMemoryStore() *memoryStore {
	return &memoryStore{
		records: map[string]Record{}, functions: map[string]*fitness.Function{},
		submissions: map[string]EvaluationRecord{}, evaluations: map[string]EvaluationRecord{},
	}
}

func recordKey(kind, id string) string { return kind + ":" + id }
func (m *memoryStore) Ping(context.Context) error {
	return m.pingErr
}
func (m *memoryStore) CreateRecord(_ context.Context, r Record, e Event) error {
	key := recordKey(r.Kind, r.ID)
	if _, exists := m.records[key]; exists {
		return ErrConflict
	}
	m.records[key], m.events = r, append(m.events, e)
	return nil
}
func (m *memoryStore) GetRecord(_ context.Context, kind, id string) (Record, error) {
	r, ok := m.records[recordKey(kind, id)]
	if !ok {
		return Record{}, ErrNotFound
	}
	return r, nil
}
func (m *memoryStore) ListRecords(_ context.Context, kind, parent string, limit int, _ string) ([]Record, string, error) {
	m.seenLimits = append(m.seenLimits, limit)
	var result []Record
	for _, r := range m.records {
		if r.Kind == kind && (parent == "" || r.ParentID == parent) {
			result = append(result, r)
			if len(result) == limit {
				return result, "next", nil
			}
		}
	}
	return result, "", nil
}
func (m *memoryStore) UpdateRecord(_ context.Context, r Record, e Event) error {
	if m.updateErr != nil {
		return m.updateErr
	}
	if _, ok := m.records[recordKey(r.Kind, r.ID)]; !ok {
		return ErrNotFound
	}
	m.records[recordKey(r.Kind, r.ID)], m.events = r, append(m.events, e)
	return nil
}
func (m *memoryStore) OwnedTargetIDs(_ context.Context, squad string) ([]string, error) {
	if m.ownedErr != nil {
		return nil, m.ownedErr
	}
	var ids []string
	for _, r := range m.records {
		if r.Kind == "fitness-target" && r.ParentID == squad {
			ids = append(ids, r.ID)
		}
	}
	return ids, nil
}
func (m *memoryStore) CreateFitnessFunction(_ context.Context, fn *fitness.Function, e Event) error {
	m.functions[fn.ID], m.events = fn, append(m.events, e)
	return nil
}
func (m *memoryStore) GetFitnessFunction(_ context.Context, id string) (*fitness.Function, error) {
	if m.getFnErr != nil {
		return nil, m.getFnErr
	}
	fn, ok := m.functions[id]
	if !ok {
		return nil, ErrNotFound
	}
	return fn, nil
}
func (m *memoryStore) SaveFitnessFunction(_ context.Context, fn *fitness.Function, e Event) error {
	if m.saveFnErr != nil {
		return m.saveFnErr
	}
	m.functions[fn.ID], m.events = fn, append(m.events, e)
	return nil
}
func (m *memoryStore) ListFitnessFunctions(_ context.Context, squad string, limit int, _ string) ([]*fitness.Function, string, error) {
	m.seenLimits = append(m.seenLimits, limit)
	var result []*fitness.Function
	for _, fn := range m.functions {
		if fn.OwnerSquadID == squad {
			result = append(result, fn)
			if len(result) == limit {
				return result, "next", nil
			}
		}
	}
	return result, "", nil
}
func (m *memoryStore) FindSubmission(_ context.Context, producer, run string) (EvaluationRecord, error) {
	if m.findErr != nil {
		return EvaluationRecord{}, m.findErr
	}
	value, ok := m.submissions[producer+":"+run]
	if !ok {
		return EvaluationRecord{}, ErrNotFound
	}
	return value, nil
}
func (m *memoryStore) SaveSubmissionAndEvaluation(_ context.Context, r Record, e EvaluationRecord, event Event) error {
	m.records[recordKey(r.Kind, r.ID)] = r
	if producer, ok := r.Data["producerId"].(string); ok {
		run, _ := r.Data["externalRunId"].(string)
		m.submissions[producer+":"+run] = e
	}
	m.evaluations[e.ID], m.events = e, append(m.events, event)
	return nil
}
func (m *memoryStore) GetEvaluation(_ context.Context, id string) (EvaluationRecord, error) {
	e, ok := m.evaluations[id]
	if !ok {
		return EvaluationRecord{}, ErrNotFound
	}
	return e, nil
}
func (m *memoryStore) ListEvaluations(_ context.Context, fn string, limit int, _ string) ([]EvaluationRecord, string, error) {
	m.seenLimits = append(m.seenLimits, limit)
	var result []EvaluationRecord
	for _, e := range m.evaluations {
		if e.FitnessFunctionID == fn {
			result = append(result, e)
			if len(result) == limit {
				return result, "next", nil
			}
		}
	}
	return result, "", nil
}
func (m *memoryStore) AppendEvent(_ context.Context, e Event) error {
	m.events = append(m.events, e)
	return nil
}
func (m *memoryStore) PollEvents(_ context.Context, cursor int64, limit int) ([]Event, int64, error) {
	m.seenLimits = append(m.seenLimits, limit)
	start := int(cursor)
	if start > len(m.events) {
		start = len(m.events)
	}
	end := min(start+limit, len(m.events))
	return m.events[start:end], int64(end), nil
}
func (m *memoryStore) AcknowledgeEvents(context.Context, string, []string, time.Time) error {
	return nil
}
func (m *memoryStore) ClaimDueCollections(_ context.Context, _ time.Time, batch int) ([]string, error) {
	m.seenBatches = append(m.seenBatches, batch)
	return m.due, m.claimErr
}

func appDefinition(mode fitness.AcquisitionMode) fitness.Definition {
	def := fitness.Definition{
		Name: "latency", Purpose: "fast service", Objective: "protect latency",
		TargetIDs: []string{"target"}, FreshnessSecond: 60, Enforcement: fitness.Block,
		Criteria: []fitness.Criterion{{Key: "latency", Unit: "ms", Required: true, FailureComparison: fitness.GreaterThan, FailureValue: 500}},
	}
	if mode == fitness.Push {
		def.Acquisition = fitness.Acquisition{Mode: fitness.Push, ProducerID: "producer", MaximumObservationAgeSecond: 120}
	} else {
		def.Acquisition = fitness.Acquisition{
			Mode: fitness.Pull, SourceID: "source", Trigger: "ON_DEMAND", TimeoutSecond: 5,
			Queries: []fitness.MetricQuery{{CriterionKey: "latency", Expression: "latency", Mode: "INSTANT", Reduction: "LAST", SeriesPolicy: "REQUIRE_SINGLE_SERIES", Unit: "ms"}},
		}
	}
	return def
}

func fixture(t *testing.T, mode fitness.AcquisitionMode) (*Service, *memoryStore, *testCollector, time.Time, string) {
	t.Helper()
	now := time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)
	store := newMemoryStore()
	store.records[recordKey("fitness-target", "target")] = Record{ID: "target", ParentID: "squad", Kind: "fitness-target", Data: map[string]any{}}
	store.records[recordKey("measurement-source", "source")] = Record{
		ID: "source", ParentID: "squad", Kind: "measurement-source", Status: "ACTIVE", Data: map[string]any{"baseUrl": "http://prometheus"},
	}
	collector := &testCollector{value: 100}
	service := NewService(store, &testIDs{}, testClock{now}, collector)
	fn, err := service.CreateFitnessFunction(context.Background(), "squad", appDefinition(mode))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.ActivateFitnessVersion(context.Background(), fn.ID, 1); err != nil {
		t.Fatal(err)
	}
	return service, store, collector, now, fn.ID
}

func TestRecordAndUtilityOperations(t *testing.T) {
	store := newMemoryStore()
	service := NewService(store, &testIDs{}, testClock{time.Now()}, &testCollector{})
	ctx := context.Background()
	if err := service.Ready(ctx); err != nil {
		t.Fatal(err)
	}
	record, err := service.CreateRecord(ctx, "tribe", "", map[string]any{"name": "Platform"})
	if err != nil || record.Status != "ACTIVE" {
		t.Fatalf("create failed: %#v %v", record, err)
	}
	got, err := service.GetRecord(ctx, "tribe", record.ID)
	if err != nil || got.Data["name"] != "Platform" {
		t.Fatal("get failed")
	}
	got, err = service.TransitionRecord(ctx, "tribe", record.ID, "ARCHIVED", map[string]any{"reason": "merge"})
	if err != nil || got.Revision != 2 || got.Data["reason"] != "merge" {
		t.Fatal("transition failed")
	}
	if records, _, err := service.ListRecords(ctx, "tribe", "", 0, ""); err != nil || len(records) != 1 {
		t.Fatal("list failed")
	}
	if _, err = service.GetRecord(ctx, "tribe", "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatal("expected not found")
	}
	if RequestHash(map[string]int{"a": 1}) != RequestHash(map[string]int{"a": 1}) {
		t.Fatal("request hash is not stable")
	}
}

func TestFitnessVersionAndPushFlow(t *testing.T) {
	service, _, _, now, id := fixture(t, fitness.Push)
	ctx := context.Background()
	fn, err := service.GetFitnessFunction(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if values, _, listErr := service.ListFitnessFunctions(ctx, "squad", 0, ""); listErr != nil || len(values) != 1 {
		t.Fatal("fitness-function list failed")
	}
	if _, err = service.AddFitnessVersion(ctx, id, appDefinition(fitness.Push), 999); !errors.Is(err, fitness.ErrVersionConflict) {
		t.Fatal("expected conflict")
	}
	fn, err = service.AddFitnessVersion(ctx, id, appDefinition(fitness.Push), fn.Revision)
	if err != nil {
		t.Fatal(err)
	}
	changed := appDefinition(fitness.Push)
	changed.Name = "new latency"
	fn, err = service.UpdateFitnessVersion(ctx, id, 2, fn.Revision, changed)
	if err != nil {
		t.Fatal(err)
	}
	fn, err = service.ActivateFitnessVersion(ctx, id, 2)
	if err != nil {
		t.Fatal(err)
	}
	submission := Submission{
		ProducerID: "producer", ExternalRunID: "run-1", FitnessVersion: 2, ObservedAt: now,
		Measurements: []fitness.Measurement{{CriterionKey: "latency", Unit: "ms", Value: 100}},
	}
	evaluation, replay, err := service.Submit(ctx, id, submission)
	if err != nil || replay || evaluation.Evaluation.Outcome != fitness.Pass {
		t.Fatalf("submit failed: %#v %v", evaluation, err)
	}
	if _, replay, err = service.Submit(ctx, id, submission); err != nil || !replay {
		t.Fatal("idempotent replay failed")
	}
	if _, err = service.GetEvaluation(ctx, evaluation.ID); err != nil {
		t.Fatal(err)
	}
	if values, _, err := service.ListEvaluations(ctx, id, 0, ""); err != nil || len(values) != 1 {
		t.Fatal("evaluation list failed")
	}
	submission.ExternalRunID, submission.FitnessVersion = "wrong-version", 1
	if _, _, err = service.Submit(ctx, id, submission); !errors.Is(err, ErrConflict) {
		t.Fatal("expected inactive-version conflict")
	}
	submission.ExternalRunID, submission.FitnessVersion, submission.ProducerID = "wrong-producer", 2, "other"
	if _, _, err = service.Submit(ctx, id, submission); !errors.Is(err, ErrInvalid) {
		t.Fatal("expected producer validation")
	}
	submission.ExternalRunID, submission.ProducerID, submission.ObservedAt = "old", "producer", now.Add(-10*time.Minute)
	if _, _, err = service.Submit(ctx, id, submission); !errors.Is(err, ErrInvalid) {
		t.Fatal("expected age validation")
	}
	submission.ExternalRunID, submission.ObservedAt = "future", now.Add(time.Second)
	if _, _, err = service.Submit(ctx, id, submission); !errors.Is(err, ErrInvalid) {
		t.Fatal("expected future observation validation")
	}
	submission.ExternalRunID, submission.ObservedAt = "unit", now
	submission.Measurements[0].Unit = "seconds"
	if _, _, err = service.Submit(ctx, id, submission); !errors.Is(err, ErrInvalid) {
		t.Fatal("expected evaluation validation")
	}
	if _, err = service.RetireFitnessFunction(ctx, id); err != nil {
		t.Fatal(err)
	}
	if _, err = service.RetireFitnessFunction(ctx, id); !errors.Is(err, fitness.ErrInvalidTransition) {
		t.Fatal("expected second retirement to fail")
	}
}

func TestPullSourceEventsAndScheduler(t *testing.T) {
	service, store, collector, _, id := fixture(t, fitness.Pull)
	ctx := context.Background()
	evaluation, err := service.Collect(ctx, id)
	if err != nil || evaluation.AcquisitionMode != fitness.Pull {
		t.Fatalf("collect failed: %#v %v", evaluation, err)
	}
	check, err := service.CheckMeasurementSource(ctx, "source")
	if err != nil || check.Data["status"] != "SUCCEEDED" {
		t.Fatalf("source check failed: %#v %v", check, err)
	}
	result, err := service.ValidateSourceQuery(ctx, "source", appDefinition(fitness.Pull).Acquisition.Queries[0], false)
	if err != nil || result["executed"] != false {
		t.Fatal("structural query validation failed")
	}
	result, err = service.ValidateSourceQuery(ctx, "source", appDefinition(fitness.Pull).Acquisition.Queries[0], true)
	if err != nil || result["sampleValue"] != float64(100) {
		t.Fatal("sample query validation failed")
	}
	if collector.lastTimeout != 10*time.Second {
		t.Fatalf("sample query timeout = %v, want 10s", collector.lastTimeout)
	}
	if _, err = service.ValidateSourceQuery(ctx, "source", fitness.MetricQuery{}, false); !errors.Is(err, ErrInvalid) {
		t.Fatal("invalid query accepted")
	}
	events, cursor, err := service.PollEvents(ctx, 0, 0)
	if err != nil || len(events) == 0 || cursor == 0 {
		t.Fatal("event polling failed")
	}
	if err = service.AcknowledgeEvents(ctx, "", nil); !errors.Is(err, ErrInvalid) {
		t.Fatal("invalid acknowledgement accepted")
	}
	if err = service.AcknowledgeEvents(ctx, "consumer", []string{events[0].ID}); err != nil {
		t.Fatal(err)
	}
	store.due = []string{id}
	if err = service.RunScheduledCollections(ctx, 0); err != nil {
		t.Fatal(err)
	}
}

func TestCollectorFailures(t *testing.T) {
	service, store, _, _, id := fixture(t, fitness.Pull)
	downCollector := &testCollector{checkErr: errors.New("down"), queryErr: errors.New("query failed")}
	service.collector = downCollector
	check, err := service.CheckMeasurementSource(context.Background(), "source")
	if !errors.Is(err, ErrInvalid) || check.Data["status"] != "FAILED" {
		t.Fatal("failed source check not recorded")
	}
	if _, err = service.Collect(context.Background(), id); err == nil {
		t.Fatal("query failure not returned")
	}
	store.records[recordKey("measurement-source", "source")] = Record{ID: "source", Kind: "measurement-source", Status: "DRAFT", Data: map[string]any{}}
	if _, err = service.Collect(context.Background(), id); !errors.Is(err, ErrConflict) {
		t.Fatal("inactive source accepted")
	}
	if _, err = service.CheckMeasurementSource(context.Background(), "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatal("missing source not reported")
	}
	if _, err = service.ValidateSourceQuery(context.Background(), "missing", fitness.MetricQuery{}, false); !errors.Is(err, ErrNotFound) {
		t.Fatal("missing query source not reported")
	}
}

func TestServiceValidationFailures(t *testing.T) {
	store := newMemoryStore()
	service := NewService(store, &testIDs{}, testClock{time.Now()}, &testCollector{})
	ctx := context.Background()
	if _, err := service.CreateFitnessFunction(ctx, "squad", appDefinition(fitness.Push)); !errors.Is(err, fitness.ErrInvalidDefinition) {
		t.Fatal("unowned target accepted")
	}
	if _, _, err := service.Submit(ctx, "missing", Submission{ProducerID: "p", ExternalRunID: "r"}); !errors.Is(err, ErrNotFound) {
		t.Fatal("missing function not reported")
	}
	store.records[recordKey("fitness-target", "target")] = Record{ID: "target", ParentID: "squad", Kind: "fitness-target"}
	fn, err := service.CreateFitnessFunction(ctx, "squad", appDefinition(fitness.Push))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Collect(ctx, fn.ID); !errors.Is(err, ErrInvalid) {
		t.Fatal("draft push function collected")
	}
	if _, err = service.ActivateFitnessVersion(ctx, fn.ID, 99); !errors.Is(err, fitness.ErrInvalidTransition) {
		t.Fatal("invalid activation accepted")
	}
	if _, err = service.UpdateFitnessVersion(ctx, fn.ID, 1, 99, appDefinition(fitness.Push)); !errors.Is(err, fitness.ErrVersionConflict) {
		t.Fatal("invalid revision accepted")
	}
	if _, _, err := service.ListRecords(ctx, "tribe", "", 500, ""); err != nil {
		t.Fatal("capped record list failed")
	}
	if functions, _, err := service.ListFitnessFunctions(ctx, "squad", 500, ""); err != nil || len(functions) != 1 {
		t.Fatal("capped function list failed")
	}
	if events, _, err := service.PollEvents(ctx, 0, 500); err != nil || len(events) == 0 {
		t.Fatal("capped event poll failed")
	}
	if _, _, err := service.ListEvaluations(ctx, fn.ID, 500, ""); err != nil {
		t.Fatal("capped evaluation list failed")
	}
}

func TestCreateRecordKindStatuses(t *testing.T) {
	store := newMemoryStore()
	service := NewService(store, &testIDs{}, testClock{time.Now()}, &testCollector{})
	ctx := context.Background()

	cases := []struct {
		kind string
		want string
	}{
		{"tribe", "ACTIVE"},
		{"measurement-source", "DRAFT"},
		{"evaluation-request", "PENDING"},
		{"waiver", "PROPOSED"},
		{"source-connection-check", "ACTIVE"},
	}
	for _, tc := range cases {
		record, err := service.CreateRecord(ctx, tc.kind, "parent", map[string]any{"k": "v"})
		if err != nil {
			t.Fatalf("create %s: %v", tc.kind, err)
		}
		if record.Status != tc.want {
			t.Fatalf("create %s status = %q, want %q", tc.kind, record.Status, tc.want)
		}
		if record.Revision != 1 || record.Data["k"] != "v" {
			t.Fatalf("create %s revision/data wrong: %#v", tc.kind, record)
		}
	}

	if _, err := service.TransitionRecord(ctx, "missing", "nope", "ARCHIVED", nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("transition on missing record accepted")
	}
	squad, err := service.CreateRecord(ctx, "squad", "tribe-1", map[string]any{"name": "S"})
	if err != nil {
		t.Fatal(err)
	}
	moved, err := service.TransitionRecord(ctx, "squad", squad.ID, "ACTIVE", map[string]any{"tribeId": "tribe-2"})
	if err != nil || moved.ParentID != "tribe-2" || moved.Revision != 2 {
		t.Fatalf("squad transfer failed: %#v %v", moved, err)
	}
}

func TestServiceStoreFailurePaths(t *testing.T) {
	store := newMemoryStore()
	service := NewService(store, &testIDs{}, testClock{time.Now()}, &testCollector{})
	ctx := context.Background()
	boom := errors.New("boom")

	store.ownedErr = boom
	if _, err := service.CreateFitnessFunction(ctx, "squad", appDefinition(fitness.Push)); !errors.Is(err, boom) {
		t.Fatal("owned-target failure not propagated on create")
	}
	store.ownedErr = nil
	store.records[recordKey("fitness-target", "target")] = Record{ID: "target", ParentID: "squad", Kind: "fitness-target"}
	fn, err := service.CreateFitnessFunction(ctx, "squad", appDefinition(fitness.Push))
	if err != nil {
		t.Fatal(err)
	}

	store.getFnErr = boom
	if _, err = service.AddFitnessVersion(ctx, fn.ID, appDefinition(fitness.Push), 1); !errors.Is(err, boom) {
		t.Fatal("get failure not propagated on add version")
	}
	if _, err = service.ActivateFitnessVersion(ctx, fn.ID, 1); !errors.Is(err, boom) {
		t.Fatal("get failure not propagated on activate")
	}
	if _, err = service.UpdateFitnessVersion(ctx, fn.ID, 1, 1, appDefinition(fitness.Push)); !errors.Is(err, boom) {
		t.Fatal("get failure not propagated on update")
	}
	if _, err = service.RetireFitnessFunction(ctx, fn.ID); !errors.Is(err, boom) {
		t.Fatal("get failure not propagated on retire")
	}

	store.getFnErr = nil
	store.ownedErr = boom
	if _, err = service.AddFitnessVersion(ctx, fn.ID, appDefinition(fitness.Push), fn.Revision); !errors.Is(err, boom) {
		t.Fatal("owned-target failure not propagated on add version")
	}
	if _, err = service.UpdateFitnessVersion(ctx, fn.ID, 1, fn.Revision, appDefinition(fitness.Push)); !errors.Is(err, boom) {
		t.Fatal("owned-target failure not propagated on update")
	}

	store.ownedErr = nil
	store.saveFnErr = boom
	if _, err = service.AddFitnessVersion(ctx, fn.ID, appDefinition(fitness.Push), fn.Revision); !errors.Is(err, boom) {
		t.Fatal("save failure not propagated on add version")
	}
	if _, err = service.ActivateFitnessVersion(ctx, fn.ID, 1); !errors.Is(err, boom) {
		t.Fatal("save failure not propagated on activate")
	}
	if _, err = service.RetireFitnessFunction(ctx, fn.ID); !errors.Is(err, boom) {
		t.Fatal("save failure not propagated on retire")
	}
	if _, err = service.GetFitnessFunction(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatal("missing function not reported")
	}
}

func TestRunScheduledCollectionsFailures(t *testing.T) {
	service, store, _, _, id := fixture(t, fitness.Pull)
	ctx := context.Background()

	service.collector = &testCollector{queryErr: errors.New("down")}
	store.due = []string{id}
	if err := service.RunScheduledCollections(ctx, 0); err == nil {
		t.Fatal("collection failure not reported")
	}

	store.claimErr = errors.New("claim failed")
	if err := service.RunScheduledCollections(ctx, 1); err == nil {
		t.Fatal("claim failure not reported")
	}
}

func TestSubmitFindFailure(t *testing.T) {
	service, store, _, _, id := fixture(t, fitness.Push)
	store.findErr = errors.New("lookup failed")
	if _, _, err := service.Submit(context.Background(), id, Submission{ProducerID: "producer", ExternalRunID: "run"}); err == nil {
		t.Fatal("find failure not propagated")
	}
}

func TestLimitClampingReachesStore(t *testing.T) {
	service, store, _, now, id := fixture(t, fitness.Push)
	ctx := context.Background()
	submission := Submission{
		ProducerID: "producer", ExternalRunID: "run-clamp", FitnessVersion: 1, ObservedAt: now,
		Measurements: []fitness.Measurement{{CriterionKey: "latency", Unit: "ms", Value: 100}},
	}
	if _, _, err := service.Submit(ctx, id, submission); err != nil {
		t.Fatal(err)
	}

	cases := []struct{ requested, want int }{
		{0, 50}, {1, 1}, {200, 200}, {500, 200},
	}
	for _, tc := range cases {
		store.seenLimits = nil
		if _, _, err := service.ListRecords(ctx, "tribe", "", tc.requested, ""); err != nil {
			t.Fatal(err)
		}
		if _, _, err := service.ListFitnessFunctions(ctx, "squad", tc.requested, ""); err != nil {
			t.Fatal(err)
		}
		if _, _, err := service.ListEvaluations(ctx, id, tc.requested, ""); err != nil {
			t.Fatal(err)
		}
		if _, _, err := service.PollEvents(ctx, 0, tc.requested); err != nil {
			t.Fatal(err)
		}
		for i, seen := range store.seenLimits {
			if seen != tc.want {
				t.Fatalf("clamping call %d with requested %d reached store as %d, want %d", i, tc.requested, seen, tc.want)
			}
		}
		if len(store.seenLimits) != 4 {
			t.Fatalf("expected four limit-clamped calls, saw %d", len(store.seenLimits))
		}
	}
}

func TestScheduledCollectionBatchClamping(t *testing.T) {
	service, store, _, _, id := fixture(t, fitness.Pull)
	ctx := context.Background()
	store.due = []string{id}

	if err := service.RunScheduledCollections(ctx, 0); err != nil {
		t.Fatal(err)
	}
	if got := store.seenBatches[len(store.seenBatches)-1]; got != 20 {
		t.Fatalf("default batch = %d, want 20", got)
	}

	store.due = []string{id}
	if err := service.RunScheduledCollections(ctx, 5); err != nil {
		t.Fatal(err)
	}
	if got := store.seenBatches[len(store.seenBatches)-1]; got != 5 {
		t.Fatalf("explicit batch = %d, want 5", got)
	}

	store.due = []string{id}
	if err := service.RunScheduledCollections(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if got := store.seenBatches[len(store.seenBatches)-1]; got != 1 {
		t.Fatalf("batch of one = %d, want 1", got)
	}
}

func TestSubmitAtExactMaximumObservationAge(t *testing.T) {
	service, _, _, now, id := fixture(t, fitness.Push)
	ctx := context.Background()
	// The fixture's push contract allows 120 seconds; a run observed exactly
	// 120 seconds ago is still inside the contract (strictly older is not).
	submission := Submission{
		ProducerID: "producer", ExternalRunID: "run-edge", FitnessVersion: 1,
		ObservedAt:   now.Add(-120 * time.Second),
		Measurements: []fitness.Measurement{{CriterionKey: "latency", Unit: "ms", Value: 100}},
	}
	if _, _, err := service.Submit(ctx, id, submission); err != nil {
		t.Fatalf("boundary-age submission rejected: %v", err)
	}
	submission.ExternalRunID = "run-old"
	submission.ObservedAt = now.Add(-121 * time.Second)
	if _, _, err := service.Submit(ctx, id, submission); !errors.Is(err, ErrInvalid) {
		t.Fatal("past-boundary submission accepted")
	}
}

func TestCollectPassesConfiguredTimeout(t *testing.T) {
	service, _, collector, _, id := fixture(t, fitness.Pull)
	if _, err := service.Collect(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if collector.lastTimeout != 5*time.Second {
		t.Fatalf("collect query timeout = %v, want 5s (definition timeoutSeconds)", collector.lastTimeout)
	}
}

func TestEventsCarryPayloads(t *testing.T) {
	store := newMemoryStore()
	service := NewService(store, &testIDs{}, testClock{time.Now()}, &testCollector{})
	ctx := context.Background()
	record, err := service.CreateRecord(ctx, "tribe", "", map[string]any{"name": "Payload"})
	if err != nil {
		t.Fatal(err)
	}
	activated := false
	for _, event := range store.events {
		if event.Type == "tribeCreated" && event.AggregateID == record.ID && event.Payload["parentId"] == "" {
			activated = true
		}
	}
	if !activated {
		t.Fatal("tribeCreated event missing its payload")
	}
}

func TestActivationEventCarriesVersion(t *testing.T) {
	service, store, _, _, _ := fixture(t, fitness.Push)
	_ = service
	found := false
	for _, event := range store.events {
		if event.Type == "FitnessFunctionVersionActivated" && event.Payload["version"] != nil {
			found = true
		}
	}
	if !found {
		t.Fatal("activation event missing version payload")
	}
}

func TestUpdateFitnessVersionSaveFailure(t *testing.T) {
	store := newMemoryStore()
	service := NewService(store, &testIDs{}, testClock{time.Now()}, &testCollector{})
	ctx := context.Background()
	store.records[recordKey("fitness-target", "target")] = Record{ID: "target", ParentID: "squad", Kind: "fitness-target"}
	fn, err := service.CreateFitnessFunction(ctx, "squad", appDefinition(fitness.Push))
	if err != nil {
		t.Fatal(err)
	}
	store.saveFnErr = errors.New("save failed")
	if _, err = service.UpdateFitnessVersion(ctx, fn.ID, 1, 1, appDefinition(fitness.Push)); err == nil {
		t.Fatal("save failure not propagated on update")
	}
}
