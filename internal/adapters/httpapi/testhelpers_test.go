package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/claudioed/polaris/internal/application"
	"github.com/claudioed/polaris/internal/domain/fitness"
)

const (
	testClientID        = "polaris-web"
	testAuthorizedEmail = "user-1@example.com"
	testIngestKey       = "ingest-secret-0123456789"
)

// memStore is a concurrency-safe in-memory application.Store (+ ScheduleStore)
// used to drive the real handler and service in unit tests.
type memStore struct {
	mu          sync.Mutex
	pingErr     error
	createErr   error
	updateErr   error
	claimErr    error
	due         []string
	records     map[string]application.Record
	recordOrder []string
	functions   map[string]*fitness.Function
	fnOrder     []string
	submissions map[string]application.EvaluationRecord
	evaluations map[string]application.EvaluationRecord
	evalOrder   []string
	events      []application.Event
	acked       map[string]bool
}

func newMemStore() *memStore {
	return &memStore{
		records:     map[string]application.Record{},
		functions:   map[string]*fitness.Function{},
		submissions: map[string]application.EvaluationRecord{},
		evaluations: map[string]application.EvaluationRecord{},
		acked:       map[string]bool{},
	}
}

func recordKey(kind, id string) string { return kind + ":" + id }

func (m *memStore) Ping(context.Context) error { return m.pingErr }

func (m *memStore) CreateRecord(_ context.Context, r application.Record, e application.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.createErr != nil {
		return m.createErr
	}
	key := recordKey(r.Kind, r.ID)
	if _, exists := m.records[key]; exists {
		return application.ErrConflict
	}
	m.records[key] = r
	m.recordOrder = append(m.recordOrder, key)
	m.events = append(m.events, e)
	return nil
}

func (m *memStore) GetRecord(_ context.Context, kind, id string) (application.Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.records[recordKey(kind, id)]
	if !ok {
		return application.Record{}, application.ErrNotFound
	}
	return r, nil
}

func (m *memStore) ListRecords(_ context.Context, kind, parent string, limit int, cursor string) ([]application.Record, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	start := 0
	if cursor != "" {
		var found bool
		for i, key := range m.recordOrder {
			if key == cursor {
				start, found = i+1, true
				break
			}
		}
		if !found {
			return nil, "", application.ErrInvalid
		}
	}
	var result []application.Record
	var lastKey string
	for _, key := range m.recordOrder[start:] {
		r := m.records[key]
		if r.Kind == kind && (parent == "" || r.ParentID == parent) {
			if len(result) == limit {
				return result, lastKey, nil
			}
			result = append(result, r)
			lastKey = key
		}
	}
	return result, "", nil
}

func (m *memStore) UpdateRecord(_ context.Context, r application.Record, e application.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.updateErr != nil {
		return m.updateErr
	}
	key := recordKey(r.Kind, r.ID)
	if _, ok := m.records[key]; !ok {
		return application.ErrNotFound
	}
	m.records[key] = r
	m.events = append(m.events, e)
	return nil
}

func (m *memStore) OwnedTargetIDs(_ context.Context, squad string) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var ids []string
	for _, key := range m.recordOrder {
		r := m.records[key]
		if r.Kind == "fitness-target" && r.ParentID == squad {
			ids = append(ids, r.ID)
		}
	}
	return ids, nil
}

func (m *memStore) CreateFitnessFunction(_ context.Context, fn *fitness.Function, e application.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.functions[fn.ID] = fn
	m.fnOrder = append(m.fnOrder, fn.ID)
	m.events = append(m.events, e)
	return nil
}

func (m *memStore) GetFitnessFunction(_ context.Context, id string) (*fitness.Function, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	fn, ok := m.functions[id]
	if !ok {
		return nil, application.ErrNotFound
	}
	return fn, nil
}

func (m *memStore) SaveFitnessFunction(_ context.Context, fn *fitness.Function, e application.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.functions[fn.ID] = fn
	m.events = append(m.events, e)
	return nil
}

func (m *memStore) ListFitnessFunctions(_ context.Context, squad string, limit int, cursor string) ([]*fitness.Function, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	start := 0
	if cursor != "" {
		var found bool
		for i, id := range m.fnOrder {
			if id == cursor {
				start, found = i+1, true
				break
			}
		}
		if !found {
			return nil, "", application.ErrInvalid
		}
	}
	var result []*fitness.Function
	var lastID string
	for _, id := range m.fnOrder[start:] {
		fn := m.functions[id]
		if fn.OwnerSquadID == squad {
			if len(result) == limit {
				return result, lastID, nil
			}
			result = append(result, fn)
			lastID = id
		}
	}
	return result, "", nil
}

func (m *memStore) FindSubmission(_ context.Context, producer, run string) (application.EvaluationRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	value, ok := m.submissions[producer+":"+run]
	if !ok {
		return application.EvaluationRecord{}, application.ErrNotFound
	}
	return value, nil
}

func (m *memStore) SaveSubmissionAndEvaluation(_ context.Context, r application.Record, e application.EvaluationRecord, event application.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.records[recordKey(r.Kind, r.ID)] = r
	m.recordOrder = append(m.recordOrder, recordKey(r.Kind, r.ID))
	if producer, ok := r.Data["producerId"].(string); ok {
		run, _ := r.Data["externalRunId"].(string)
		m.submissions[producer+":"+run] = e
	}
	m.evaluations[e.ID] = e
	m.evalOrder = append(m.evalOrder, e.ID)
	m.events = append(m.events, event)
	return nil
}

func (m *memStore) GetEvaluation(_ context.Context, id string) (application.EvaluationRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.evaluations[id]
	if !ok {
		return application.EvaluationRecord{}, application.ErrNotFound
	}
	return e, nil
}

func (m *memStore) ListEvaluations(_ context.Context, fn string, limit int, cursor string) ([]application.EvaluationRecord, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	start := 0
	if cursor != "" {
		var found bool
		for i, id := range m.evalOrder {
			if id == cursor {
				start, found = i+1, true
				break
			}
		}
		if !found {
			return nil, "", application.ErrInvalid
		}
	}
	var result []application.EvaluationRecord
	var lastID string
	for _, id := range m.evalOrder[start:] {
		e := m.evaluations[id]
		if e.FitnessFunctionID == fn {
			if len(result) == limit {
				return result, lastID, nil
			}
			result = append(result, e)
			lastID = id
		}
	}
	return result, "", nil
}

func (m *memStore) AppendEvent(_ context.Context, e application.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, e)
	return nil
}

func (m *memStore) PollEvents(_ context.Context, cursor int64, limit int) ([]application.Event, int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	start := int(cursor)
	if start > len(m.events) {
		start = len(m.events)
	}
	end := min(start+limit, len(m.events))
	return m.events[start:end], int64(end), nil
}

func (m *memStore) AcknowledgeEvents(_ context.Context, _ string, ids []string, _ time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, id := range ids {
		m.acked[id] = true
	}
	return nil
}

func (m *memStore) ClaimDueCollections(context.Context, time.Time, int) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	due := m.due
	m.due = nil
	return due, m.claimErr
}

type seqIDs struct{ next int }

func (g *seqIDs) New() string {
	g.next++
	return fmt.Sprintf("id-%d", g.next)
}

type fixedClock struct{ now time.Time }

func (c fixedClock) Now() time.Time { return c.now }

type stubCollector struct {
	checkErr error
	queryErr error
	value    float64
}

func (c stubCollector) Check(context.Context, string) error { return c.checkErr }
func (c stubCollector) Query(context.Context, string, fitness.MetricQuery, time.Time, time.Duration) (float64, map[string]any, error) {
	return c.value, map[string]any{"source": "test"}, c.queryErr
}

func newTestHandler(auth *Authenticator) http.Handler {
	return newTestHandlerWithStore(auth, newMemStore())
}

func newTestHandlerWithStore(auth *Authenticator, store *memStore) http.Handler {
	service := application.NewService(store, &seqIDs{}, fixedClock{now: time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC)}, stubCollector{value: 100})
	return New(service, auth)
}
