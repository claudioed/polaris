package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/claudioed/polaris/internal/domain/fitness"
)

var (
	ErrNotFound   = errors.New("resource not found")
	ErrConflict   = errors.New("resource conflict")
	ErrInvalid    = errors.New("invalid request")
	ErrBadRequest = errors.New("bad request")
)

type IDGenerator interface{ New() string }
type Clock interface{ Now() time.Time }

type Record struct {
	ID        string         `json:"id"`
	ParentID  string         `json:"parentId,omitempty"`
	Kind      string         `json:"kind"`
	Status    string         `json:"status,omitempty"`
	Revision  int            `json:"revision"`
	Data      map[string]any `json:"data"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
}

type Event struct {
	ID            string         `json:"id"`
	Type          string         `json:"type"`
	Version       int            `json:"version"`
	AggregateType string         `json:"aggregateType"`
	AggregateID   string         `json:"aggregateId"`
	OccurredAt    time.Time      `json:"occurredAt"`
	Actor         string         `json:"actor"`
	CorrelationID string         `json:"correlationId"`
	Payload       map[string]any `json:"payload"`
}

type EvaluationRecord struct {
	ID                     string
	FitnessFunctionID      string
	FitnessFunctionVersion int
	AcquisitionMode        fitness.AcquisitionMode
	OriginID               string
	Evaluation             fitness.Evaluation
	Data                   map[string]any
}

type Store interface {
	Ping(context.Context) error
	CreateRecord(context.Context, Record, Event) error
	GetRecord(context.Context, string, string) (Record, error)
	ListRecords(context.Context, string, string, int, string) ([]Record, string, error)
	UpdateRecord(context.Context, Record, Event) error
	OwnedTargetIDs(context.Context, string) ([]string, error)

	CreateFitnessFunction(context.Context, *fitness.Function, Event) error
	GetFitnessFunction(context.Context, string) (*fitness.Function, error)
	SaveFitnessFunction(context.Context, *fitness.Function, Event) error
	ListFitnessFunctions(context.Context, string, int, string) ([]*fitness.Function, string, error)

	FindSubmission(context.Context, string, string) (EvaluationRecord, error)
	SaveSubmissionAndEvaluation(context.Context, Record, EvaluationRecord, Event) error
	GetEvaluation(context.Context, string) (EvaluationRecord, error)
	ListEvaluations(context.Context, string, int, string) ([]EvaluationRecord, string, error)

	AppendEvent(context.Context, Event) error
	PollEvents(context.Context, int64, int) ([]Event, int64, error)
	AcknowledgeEvents(context.Context, string, []string, time.Time) error
}

type ScheduleStore interface {
	ClaimDueCollections(context.Context, time.Time, int) ([]string, error)
}

type Collector interface {
	Check(context.Context, string) error
	Query(context.Context, string, fitness.MetricQuery, time.Time, time.Duration) (float64, map[string]any, error)
}

type Service struct {
	store     Store
	ids       IDGenerator
	clock     Clock
	collector Collector
}

func NewService(store Store, ids IDGenerator, clock Clock, collector Collector) *Service {
	return &Service{store: store, ids: ids, clock: clock, collector: collector}
}

func (s *Service) Ready(ctx context.Context) error { return s.store.Ping(ctx) }

func (s *Service) CreateRecord(ctx context.Context, kind, parentID string, data map[string]any) (Record, error) {
	now := s.clock.Now()
	status := "ACTIVE"
	switch kind {
	case "measurement-source":
		status = "DRAFT"
	case "evaluation-request":
		status = "PENDING"
	case "waiver":
		status = "PROPOSED"
	}
	record := Record{ID: s.ids.New(), ParentID: parentID, Kind: kind, Status: status, Revision: 1, Data: clone(data), CreatedAt: now, UpdatedAt: now}
	event := s.event(kind+"Created", kind, record.ID, map[string]any{"parentId": parentID})
	if err := s.store.CreateRecord(ctx, record, event); err != nil {
		return Record{}, err
	}
	return record, nil
}

func (s *Service) GetRecord(ctx context.Context, kind, id string) (Record, error) {
	return s.store.GetRecord(ctx, kind, id)
}

func (s *Service) ListRecords(ctx context.Context, kind, parentID string, limit int, cursor string) ([]Record, string, error) {
	if limit < 1 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	return s.store.ListRecords(ctx, kind, parentID, limit, cursor)
}

func (s *Service) TransitionRecord(ctx context.Context, kind, id, status string, patch map[string]any) (Record, error) {
	record, err := s.store.GetRecord(ctx, kind, id)
	if err != nil {
		return Record{}, err
	}
	record.Status = status
	for key, value := range patch {
		record.Data[key] = value
	}
	if kind == "squad" {
		if tribeID, ok := patch["tribeId"].(string); ok && tribeID != "" {
			record.ParentID = tribeID
		}
	}
	record.Revision++
	record.UpdatedAt = s.clock.Now()
	if err := s.store.UpdateRecord(ctx, record, s.event(kind+status, kind, id, patch)); err != nil {
		return Record{}, err
	}
	return record, nil
}

func (s *Service) CreateFitnessFunction(ctx context.Context, squadID string, definition fitness.Definition) (*fitness.Function, error) {
	targets, err := s.store.OwnedTargetIDs(ctx, squadID)
	if err != nil {
		return nil, err
	}
	fn, err := fitness.New(s.ids.New(), squadID, definition, targets, s.clock.Now())
	if err != nil {
		return nil, err
	}
	if err := s.store.CreateFitnessFunction(ctx, fn, s.event("FitnessFunctionDrafted", "fitness-function", fn.ID, nil)); err != nil {
		return nil, err
	}
	return fn, nil
}

func (s *Service) AddFitnessVersion(ctx context.Context, id string, definition fitness.Definition, expectedRevision int) (*fitness.Function, error) {
	fn, err := s.store.GetFitnessFunction(ctx, id)
	if err != nil {
		return nil, err
	}
	targets, err := s.store.OwnedTargetIDs(ctx, fn.OwnerSquadID)
	if err != nil {
		return nil, err
	}
	if _, err = fn.AddVersion(definition, targets, expectedRevision, s.clock.Now()); err != nil {
		return nil, err
	}
	if err = s.store.SaveFitnessFunction(ctx, fn, s.event("FitnessFunctionVersionCreated", "fitness-function", fn.ID, nil)); err != nil {
		return nil, err
	}
	return fn, nil
}

func (s *Service) ActivateFitnessVersion(ctx context.Context, id string, version int) (*fitness.Function, error) {
	fn, err := s.store.GetFitnessFunction(ctx, id)
	if err != nil {
		return nil, err
	}
	if err = fn.Activate(version, s.clock.Now()); err != nil {
		return nil, err
	}
	if err = s.store.SaveFitnessFunction(ctx, fn, s.event("FitnessFunctionVersionActivated", "fitness-function", id, map[string]any{"version": version})); err != nil {
		return nil, err
	}
	return fn, nil
}

func (s *Service) GetFitnessFunction(ctx context.Context, id string) (*fitness.Function, error) {
	return s.store.GetFitnessFunction(ctx, id)
}

func (s *Service) ListFitnessFunctions(ctx context.Context, squadID string, limit int, cursor string) ([]*fitness.Function, string, error) {
	if limit < 1 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	return s.store.ListFitnessFunctions(ctx, squadID, limit, cursor)
}

func (s *Service) UpdateFitnessVersion(ctx context.Context, id string, version, expectedRevision int, definition fitness.Definition) (*fitness.Function, error) {
	fn, err := s.store.GetFitnessFunction(ctx, id)
	if err != nil {
		return nil, err
	}
	targets, err := s.store.OwnedTargetIDs(ctx, fn.OwnerSquadID)
	if err != nil {
		return nil, err
	}
	if err = fn.UpdateDraft(version, expectedRevision, definition, targets); err != nil {
		return nil, err
	}
	if err = s.store.SaveFitnessFunction(ctx, fn, s.event("FitnessFunctionVersionUpdated", "fitness-function", id, map[string]any{"version": version})); err != nil {
		return nil, err
	}
	return fn, nil
}

func (s *Service) RetireFitnessFunction(ctx context.Context, id string) (*fitness.Function, error) {
	fn, err := s.store.GetFitnessFunction(ctx, id)
	if err != nil {
		return nil, err
	}
	if err = fn.Retire(); err != nil {
		return nil, err
	}
	if err = s.store.SaveFitnessFunction(ctx, fn, s.event("FitnessFunctionRetired", "fitness-function", id, nil)); err != nil {
		return nil, err
	}
	return fn, nil
}

func (s *Service) CheckMeasurementSource(ctx context.Context, id string) (Record, error) {
	source, err := s.store.GetRecord(ctx, "measurement-source", id)
	if err != nil {
		return Record{}, err
	}
	baseURL, _ := source.Data["baseUrl"].(string)
	status := "SUCCEEDED"
	message := ""
	if err = s.collector.Check(ctx, baseURL); err != nil {
		status, message = "FAILED", err.Error()
	}
	check, createErr := s.CreateRecord(ctx, "source-connection-check", id, map[string]any{
		"status": status, "message": message, "checkedAt": s.clock.Now(),
	})
	if createErr != nil {
		return Record{}, createErr
	}
	if err != nil {
		return check, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	return check, nil
}

func (s *Service) ValidateSourceQuery(ctx context.Context, sourceID string, query fitness.MetricQuery, execute bool) (map[string]any, error) {
	source, err := s.store.GetRecord(ctx, "measurement-source", sourceID)
	if err != nil {
		return nil, err
	}
	if query.Expression == "" || query.CriterionKey == "" {
		return nil, fmt.Errorf("%w: criterionKey and expression are required", ErrInvalid)
	}
	result := map[string]any{"valid": true, "executed": false}
	if !execute {
		return result, nil
	}
	baseURL, _ := source.Data["baseUrl"].(string)
	value, evidence, err := s.collector.Query(ctx, baseURL, query, s.clock.Now(), 10*time.Second)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	result["executed"], result["sampleValue"], result["evidence"] = true, value, evidence
	return result, nil
}

func (s *Service) GetEvaluation(ctx context.Context, id string) (EvaluationRecord, error) {
	return s.store.GetEvaluation(ctx, id)
}

func (s *Service) ListEvaluations(ctx context.Context, functionID string, limit int, cursor string) ([]EvaluationRecord, string, error) {
	if limit < 1 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	return s.store.ListEvaluations(ctx, functionID, limit, cursor)
}

func (s *Service) PollEvents(ctx context.Context, cursor int64, limit int) ([]Event, int64, error) {
	if limit < 1 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	return s.store.PollEvents(ctx, cursor, limit)
}

func (s *Service) AcknowledgeEvents(ctx context.Context, consumerID string, ids []string) error {
	if consumerID == "" || len(ids) == 0 {
		return fmt.Errorf("%w: consumerId and eventIds are required", ErrInvalid)
	}
	return s.store.AcknowledgeEvents(ctx, consumerID, ids, s.clock.Now())
}

func (s *Service) RunScheduledCollections(ctx context.Context, batchSize int) error {
	schedules, ok := s.store.(ScheduleStore)
	if !ok {
		return nil
	}
	if batchSize < 1 {
		batchSize = 20
	}
	ids, err := schedules.ClaimDueCollections(ctx, s.clock.Now(), batchSize)
	if err != nil {
		return err
	}
	var failures []error
	for _, id := range ids {
		if _, collectErr := s.Collect(ctx, id); collectErr != nil {
			failures = append(failures, fmt.Errorf("collect %s: %w", id, collectErr))
		}
	}
	return errors.Join(failures...)
}

type Submission struct {
	ProducerID          string
	ExternalRunID       string
	FitnessVersion      int
	ObservedAt          time.Time
	Measurements        []fitness.Measurement
	Evidence            []map[string]any
	EvaluationRequestID string
}

func (s *Service) Submit(ctx context.Context, functionID string, submission Submission) (EvaluationRecord, bool, error) {
	if existing, err := s.store.FindSubmission(ctx, submission.ProducerID, submission.ExternalRunID); err == nil {
		return existing, true, nil
	} else if !errors.Is(err, ErrNotFound) {
		return EvaluationRecord{}, false, err
	}
	fn, err := s.store.GetFitnessFunction(ctx, functionID)
	if err != nil {
		return EvaluationRecord{}, false, err
	}
	if fn.ActiveVersion != submission.FitnessVersion || fn.Lifecycle != fitness.Active {
		return EvaluationRecord{}, false, fmt.Errorf("%w: submitted version is not active", ErrConflict)
	}
	definition, ok := fn.ActiveDefinition()
	if !ok || definition.Acquisition.Mode != fitness.Push || definition.Acquisition.ProducerID != submission.ProducerID {
		return EvaluationRecord{}, false, fmt.Errorf("%w: producer is not declared by the active definition", ErrInvalid)
	}
	now := s.clock.Now()
	if submission.ObservedAt.After(now) || now.Sub(submission.ObservedAt) > time.Duration(definition.Acquisition.MaximumObservationAgeSecond)*time.Second {
		return EvaluationRecord{}, false, fmt.Errorf("%w: observation time is outside the push contract", ErrInvalid)
	}
	for i := range submission.Measurements {
		submission.Measurements[i].ObservedAt = submission.ObservedAt
	}
	evaluation, err := fitness.Evaluate(definition, submission.Measurements, false)
	if err != nil {
		return EvaluationRecord{}, false, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	submissionID, evaluationID := s.ids.New(), s.ids.New()
	data := map[string]any{"producerId": submission.ProducerID, "externalRunId": submission.ExternalRunID, "measurements": submission.Measurements, "evidence": submission.Evidence}
	record := Record{ID: submissionID, ParentID: functionID, Kind: "measurement-submission", Status: "ACCEPTED", Revision: 1, Data: data, CreatedAt: now, UpdatedAt: now}
	result := EvaluationRecord{ID: evaluationID, FitnessFunctionID: functionID, FitnessFunctionVersion: submission.FitnessVersion, AcquisitionMode: fitness.Push, OriginID: submissionID, Evaluation: evaluation, Data: data}
	if err = s.store.SaveSubmissionAndEvaluation(ctx, record, result, s.event("EvaluationRecorded", "evaluation", evaluationID, map[string]any{"outcome": evaluation.Outcome})); err != nil {
		return EvaluationRecord{}, false, err
	}
	return result, false, nil
}

func (s *Service) Collect(ctx context.Context, functionID string) (EvaluationRecord, error) {
	fn, err := s.store.GetFitnessFunction(ctx, functionID)
	if err != nil {
		return EvaluationRecord{}, err
	}
	definition, ok := fn.ActiveDefinition()
	if !ok || definition.Acquisition.Mode != fitness.Pull {
		return EvaluationRecord{}, fmt.Errorf("%w: active pull definition required", ErrInvalid)
	}
	source, err := s.store.GetRecord(ctx, "measurement-source", definition.Acquisition.SourceID)
	if err != nil {
		return EvaluationRecord{}, err
	}
	if source.Status != "ACTIVE" {
		return EvaluationRecord{}, fmt.Errorf("%w: measurement source is not active", ErrConflict)
	}
	baseURL, _ := source.Data["baseUrl"].(string)
	now := s.clock.Now()
	measurements := make([]fitness.Measurement, 0, len(definition.Acquisition.Queries))
	evidence := make([]map[string]any, 0, len(definition.Acquisition.Queries))
	for _, query := range definition.Acquisition.Queries {
		value, details, queryErr := s.collector.Query(ctx, baseURL, query, now, time.Duration(definition.Acquisition.TimeoutSecond)*time.Second)
		if queryErr != nil {
			return EvaluationRecord{}, queryErr
		}
		measurements = append(measurements, fitness.Measurement{CriterionKey: query.CriterionKey, Value: value, Unit: query.Unit, ObservedAt: now})
		evidence = append(evidence, details)
	}
	evaluation, err := fitness.Evaluate(definition, measurements, false)
	if err != nil {
		return EvaluationRecord{}, err
	}
	originID, evaluationID := s.ids.New(), s.ids.New()
	data := map[string]any{"sourceId": definition.Acquisition.SourceID, "measurements": measurements, "evidence": evidence}
	record := Record{ID: originID, ParentID: functionID, Kind: "collection-attempt", Status: "SUCCEEDED", Revision: 1, Data: data, CreatedAt: now, UpdatedAt: now}
	result := EvaluationRecord{ID: evaluationID, FitnessFunctionID: functionID, FitnessFunctionVersion: fn.ActiveVersion, AcquisitionMode: fitness.Pull, OriginID: originID, Evaluation: evaluation, Data: data}
	if err = s.store.SaveSubmissionAndEvaluation(ctx, record, result, s.event("CollectionCompleted", "collection-attempt", originID, map[string]any{"evaluationId": evaluationID})); err != nil {
		return EvaluationRecord{}, err
	}
	return result, nil
}

func (s *Service) event(eventType, aggregateType, aggregateID string, payload map[string]any) Event {
	if payload == nil {
		payload = map[string]any{}
	}
	now := s.clock.Now()
	return Event{ID: s.ids.New(), Type: eventType, Version: 1, AggregateType: aggregateType, AggregateID: aggregateID, OccurredAt: now, Actor: "anonymous", CorrelationID: s.ids.New(), Payload: payload}
}

func clone(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	raw, _ := json.Marshal(value)
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	return result
}

func RequestHash(value any) string {
	raw, _ := json.Marshal(value)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
