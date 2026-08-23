package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/claudioed/polaris/internal/application"
	"github.com/claudioed/polaris/internal/domain/fitness"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ pool *pgxpool.Pool }

func New(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close()                         { s.pool.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

func (s *Store) CreateRecord(ctx context.Context, r application.Record, event application.Event) error {
	return s.tx(ctx, func(tx pgx.Tx) error {
		data, _ := json.Marshal(r.Data)
		var err error
		switch r.Kind {
		case "tribe":
			_, err = tx.Exec(ctx, `INSERT INTO tribes(id,name,description,status,revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
				r.ID, text(r.Data, "name"), text(r.Data, "description"), r.Status, r.Revision, r.CreatedAt, r.UpdatedAt)
		case "squad":
			_, err = tx.Exec(ctx, `INSERT INTO squads(id,tribe_id,name,mission,status,data,revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
				r.ID, r.ParentID, text(r.Data, "name"), text(r.Data, "mission"), r.Status, data, r.Revision, r.CreatedAt, r.UpdatedAt)
		case "fitness-target":
			_, err = tx.Exec(ctx, `INSERT INTO fitness_targets(id,squad_id,name,lifecycle,data,revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
				r.ID, r.ParentID, text(r.Data, "name"), r.Status, data, r.Revision, r.CreatedAt, r.UpdatedAt)
		case "measurement-source":
			_, err = tx.Exec(ctx, `INSERT INTO measurement_sources(id,squad_id,name,provider_type,base_url,status,data,revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
				r.ID, r.ParentID, text(r.Data, "name"), text(r.Data, "providerType"), text(r.Data, "baseUrl"), r.Status, data, r.Revision, r.CreatedAt, r.UpdatedAt)
		case "measurement-producer":
			_, err = tx.Exec(ctx, `INSERT INTO measurement_producers(id,squad_id,name,data,created_at) VALUES($1,$2,$3,$4,$5)`,
				r.ID, r.ParentID, text(r.Data, "name"), data, r.CreatedAt)
		default:
			_, err = tx.Exec(ctx, `INSERT INTO resource_documents(id,parent_id,kind,status,revision,data,created_at,updated_at) VALUES($1,NULLIF($2,'')::uuid,$3,$4,$5,$6,$7,$8)`,
				r.ID, r.ParentID, r.Kind, r.Status, r.Revision, data, r.CreatedAt, r.UpdatedAt)
		}
		if err != nil {
			return mapError(err)
		}
		return insertEvent(ctx, tx, event)
	})
}

func (s *Store) GetRecord(ctx context.Context, kind, id string) (application.Record, error) {
	var r application.Record
	var data []byte
	r.Kind, r.ID = kind, id
	var err error
	switch kind {
	case "tribe":
		err = s.pool.QueryRow(ctx, `SELECT status,revision,created_at,updated_at,jsonb_build_object('name',name,'description',description) FROM tribes WHERE id=$1`, id).
			Scan(&r.Status, &r.Revision, &r.CreatedAt, &r.UpdatedAt, &data)
	case "squad":
		err = s.pool.QueryRow(ctx, `SELECT tribe_id,status,revision,created_at,updated_at,data FROM squads WHERE id=$1`, id).
			Scan(&r.ParentID, &r.Status, &r.Revision, &r.CreatedAt, &r.UpdatedAt, &data)
	case "fitness-target":
		err = s.pool.QueryRow(ctx, `SELECT squad_id,lifecycle,revision,created_at,updated_at,data FROM fitness_targets WHERE id=$1`, id).
			Scan(&r.ParentID, &r.Status, &r.Revision, &r.CreatedAt, &r.UpdatedAt, &data)
	case "measurement-source":
		err = s.pool.QueryRow(ctx, `SELECT squad_id,status,revision,created_at,updated_at,data || jsonb_build_object('name',name,'providerType',provider_type,'baseUrl',base_url) FROM measurement_sources WHERE id=$1`, id).
			Scan(&r.ParentID, &r.Status, &r.Revision, &r.CreatedAt, &r.UpdatedAt, &data)
	default:
		err = s.pool.QueryRow(ctx, `SELECT COALESCE(parent_id::text,''),status,revision,created_at,updated_at,data FROM resource_documents WHERE kind=$1 AND id=$2`, kind, id).
			Scan(&r.ParentID, &r.Status, &r.Revision, &r.CreatedAt, &r.UpdatedAt, &data)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return r, application.ErrNotFound
	}
	if err != nil {
		return r, err
	}
	_ = json.Unmarshal(data, &r.Data)
	return r, nil
}

func (s *Store) ListRecords(ctx context.Context, kind, parentID string, limit int, cursor string) ([]application.Record, string, error) {
	after := time.Unix(0, 0).UTC()
	if cursor != "" {
		if n, err := strconv.ParseInt(cursor, 10, 64); err == nil {
			after = time.Unix(0, n).UTC()
		}
	}
	query := `SELECT id,COALESCE(parent_id::text,''),status,revision,created_at,updated_at,data FROM resource_documents WHERE kind=$1 AND ($2='' OR parent_id=$2::uuid) AND created_at>$3 ORDER BY created_at,id LIMIT $4`
	args := []any{kind, parentID, after, limit}
	switch kind {
	case "tribe":
		query = `SELECT id,''::text,status,revision,created_at,updated_at,jsonb_build_object('name',name,'description',description) FROM tribes WHERE created_at>$1 ORDER BY created_at,id LIMIT $2`
		args = []any{after, limit}
	case "squad":
		query = `SELECT id,tribe_id::text,status,revision,created_at,updated_at,data FROM squads WHERE ($1='' OR tribe_id=$1::uuid) AND created_at>$2 ORDER BY created_at,id LIMIT $3`
		args = []any{parentID, after, limit}
	case "fitness-target":
		query = `SELECT id,squad_id::text,lifecycle,revision,created_at,updated_at,data FROM fitness_targets WHERE ($1='' OR squad_id=$1::uuid) AND created_at>$2 ORDER BY created_at,id LIMIT $3`
		args = []any{parentID, after, limit}
	case "measurement-source":
		query = `SELECT id,squad_id::text,status,revision,created_at,updated_at,data || jsonb_build_object('name',name,'providerType',provider_type,'baseUrl',base_url) FROM measurement_sources WHERE ($1='' OR squad_id=$1::uuid) AND created_at>$2 ORDER BY created_at,id LIMIT $3`
		args = []any{parentID, after, limit}
	}
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	var result []application.Record
	for rows.Next() {
		var r application.Record
		var data []byte
		r.Kind = kind
		if err = rows.Scan(&r.ID, &r.ParentID, &r.Status, &r.Revision, &r.CreatedAt, &r.UpdatedAt, &data); err != nil {
			return nil, "", err
		}
		_ = json.Unmarshal(data, &r.Data)
		result = append(result, r)
	}
	next := ""
	if len(result) == limit {
		next = strconv.FormatInt(result[len(result)-1].CreatedAt.UnixNano(), 10)
	}
	return result, next, rows.Err()
}

func (s *Store) UpdateRecord(ctx context.Context, r application.Record, event application.Event) error {
	return s.tx(ctx, func(tx pgx.Tx) error {
		data, _ := json.Marshal(r.Data)
		var tag pgx.Rows
		_ = tag
		var err error
		switch r.Kind {
		case "tribe":
			_, err = tx.Exec(ctx, `UPDATE tribes SET status=$2,revision=$3,updated_at=$4 WHERE id=$1`, r.ID, r.Status, r.Revision, r.UpdatedAt)
		case "squad":
			_, err = tx.Exec(ctx, `UPDATE squads SET tribe_id=$2,status=$3,data=$4,revision=$5,updated_at=$6 WHERE id=$1`,
				r.ID, r.ParentID, r.Status, data, r.Revision, r.UpdatedAt)
		case "fitness-target":
			_, err = tx.Exec(ctx, `UPDATE fitness_targets SET lifecycle=$2,data=$3,revision=$4,updated_at=$5 WHERE id=$1`, r.ID, r.Status, data, r.Revision, r.UpdatedAt)
		case "measurement-source":
			_, err = tx.Exec(ctx, `UPDATE measurement_sources SET status=$2,data=$3,revision=$4,updated_at=$5 WHERE id=$1`, r.ID, r.Status, data, r.Revision, r.UpdatedAt)
		default:
			_, err = tx.Exec(ctx, `UPDATE resource_documents SET status=$2,data=$3,revision=$4,updated_at=$5 WHERE id=$1 AND kind=$6`, r.ID, r.Status, data, r.Revision, r.UpdatedAt, r.Kind)
		}
		if err != nil {
			return mapError(err)
		}
		return insertEvent(ctx, tx, event)
	})
}

func (s *Store) OwnedTargetIDs(ctx context.Context, squadID string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT id FROM fitness_targets WHERE squad_id=$1 AND lifecycle IN ('ACTIVE','DEPRECATED') ORDER BY id`, squadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Store) CreateFitnessFunction(ctx context.Context, fn *fitness.Function, event application.Event) error {
	return s.tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO fitness_functions(id,squad_id,name,lifecycle,active_version,revision,created_at,updated_at) VALUES($1,$2,$3,$4,NULL,$5,$6,$6)`,
			fn.ID, fn.OwnerSquadID, fn.Versions[0].Definition.Name, fn.Lifecycle, fn.Revision, fn.Versions[0].CreatedAt); err != nil {
			return mapError(err)
		}
		if err := insertVersions(ctx, tx, fn); err != nil {
			return err
		}
		return insertEvent(ctx, tx, event)
	})
}

func (s *Store) GetFitnessFunction(ctx context.Context, id string) (*fitness.Function, error) {
	fn := &fitness.Function{ID: id}
	if err := s.pool.QueryRow(ctx, `SELECT squad_id,lifecycle,COALESCE(active_version,0),revision FROM fitness_functions WHERE id=$1`, id).
		Scan(&fn.OwnerSquadID, &fn.Lifecycle, &fn.ActiveVersion, &fn.Revision); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, application.ErrNotFound
		}
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT version,state,definition,created_at,activated_at FROM fitness_function_versions WHERE fitness_function_id=$1 ORDER BY version`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var v fitness.Version
		var data []byte
		if err = rows.Scan(&v.Number, &v.State, &data, &v.CreatedAt, &v.ActivatedAt); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(data, &v.Definition); err != nil {
			return nil, err
		}
		fn.Versions = append(fn.Versions, v)
	}
	return fn, rows.Err()
}

func (s *Store) SaveFitnessFunction(ctx context.Context, fn *fitness.Function, event application.Event) error {
	return s.tx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE fitness_functions SET lifecycle=$2,active_version=NULLIF($3,0),revision=$4,updated_at=$5 WHERE id=$1 AND revision=$4-1`,
			fn.ID, fn.Lifecycle, fn.ActiveVersion, fn.Revision, event.OccurredAt)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return application.ErrConflict
		}
		if _, err = tx.Exec(ctx, `DELETE FROM fitness_function_versions WHERE fitness_function_id=$1`, fn.ID); err != nil {
			return err
		}
		if err = insertVersions(ctx, tx, fn); err != nil {
			return err
		}
		if definition, active := fn.ActiveDefinition(); active &&
			definition.Acquisition.Mode == fitness.Pull &&
			definition.Acquisition.Trigger == "SCHEDULED" {
			_, err = tx.Exec(ctx, `INSERT INTO collection_schedules(fitness_function_id,fitness_function_version,next_run_at,interval_seconds)
				VALUES($1,$2,$3,$4)
				ON CONFLICT(fitness_function_id) DO UPDATE SET fitness_function_version=EXCLUDED.fitness_function_version,
				next_run_at=EXCLUDED.next_run_at,interval_seconds=EXCLUDED.interval_seconds,lease_until=NULL,lease_owner=NULL`,
				fn.ID, fn.ActiveVersion, event.OccurredAt.Add(time.Duration(definition.Acquisition.IntervalSecond)*time.Second), definition.Acquisition.IntervalSecond)
		} else {
			_, err = tx.Exec(ctx, `DELETE FROM collection_schedules WHERE fitness_function_id=$1`, fn.ID)
		}
		if err != nil {
			return err
		}
		return insertEvent(ctx, tx, event)
	})
}

func (s *Store) ClaimDueCollections(ctx context.Context, now time.Time, limit int) ([]string, error) {
	rows, err := s.pool.Query(ctx, `WITH due AS (
			SELECT fitness_function_id FROM collection_schedules
			WHERE next_run_at <= $1 AND (lease_until IS NULL OR lease_until < $1)
			ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT $2
		)
		UPDATE collection_schedules schedules
		SET next_run_at=$1 + make_interval(secs => schedules.interval_seconds), lease_until=NULL, lease_owner=NULL
		FROM due WHERE schedules.fitness_function_id=due.fitness_function_id
		RETURNING schedules.fitness_function_id`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Store) ListFitnessFunctions(ctx context.Context, squadID string, limit int, cursor string) ([]*fitness.Function, string, error) {
	records, next, err := s.ListRecords(ctx, "fitness-function-index", squadID, limit, cursor)
	if err == nil && len(records) > 0 {
		var result []*fitness.Function
		for _, record := range records {
			fn, getErr := s.GetFitnessFunction(ctx, record.ID)
			if getErr != nil {
				return nil, "", getErr
			}
			result = append(result, fn)
		}
		return result, next, nil
	}
	rows, err := s.pool.Query(ctx, `SELECT id FROM fitness_functions WHERE squad_id=$1 ORDER BY created_at,id LIMIT $2`, squadID, limit)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	var result []*fitness.Function
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		fn, getErr := s.GetFitnessFunction(ctx, id)
		if getErr != nil {
			return nil, "", getErr
		}
		result = append(result, fn)
	}
	return result, "", rows.Err()
}

func (s *Store) FindSubmission(ctx context.Context, producerID, runID string) (application.EvaluationRecord, error) {
	var evaluationID string
	err := s.pool.QueryRow(ctx, `SELECT e.id FROM measurement_submissions m JOIN evaluations e ON e.origin_id=m.id WHERE m.producer_id=$1 AND m.external_run_id=$2`, producerID, runID).Scan(&evaluationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return application.EvaluationRecord{}, application.ErrNotFound
	}
	if err != nil {
		return application.EvaluationRecord{}, err
	}
	return s.GetEvaluation(ctx, evaluationID)
}

func (s *Store) SaveSubmissionAndEvaluation(ctx context.Context, record application.Record, result application.EvaluationRecord, event application.Event) error {
	return s.tx(ctx, func(tx pgx.Tx) error {
		data, _ := json.Marshal(record.Data)
		switch record.Kind {
		case "measurement-submission":
			_, err := tx.Exec(ctx, `INSERT INTO measurement_submissions(id,fitness_function_id,fitness_function_version,producer_id,external_run_id,observed_at,data,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
				record.ID, result.FitnessFunctionID, result.FitnessFunctionVersion, record.Data["producerId"], record.Data["externalRunId"], result.Evaluation.ObservedAt, data, record.CreatedAt)
			if err != nil {
				return mapError(err)
			}
		case "collection-attempt":
			sourceID, _ := record.Data["sourceId"].(string)
			_, err := tx.Exec(ctx, `INSERT INTO collection_attempts(id,fitness_function_id,fitness_function_version,source_id,trigger,status,data,completed_at,created_at) VALUES($1,$2,$3,$4,'ON_DEMAND','SUCCEEDED',$5,$6,$6)`,
				record.ID, result.FitnessFunctionID, result.FitnessFunctionVersion, sourceID, data, record.CreatedAt)
			if err != nil {
				return err
			}
		}
		evalData, _ := json.Marshal(map[string]any{"evaluation": result.Evaluation, "data": result.Data})
		if _, err := tx.Exec(ctx, `INSERT INTO evaluations(id,fitness_function_id,fitness_function_version,acquisition_mode,origin_id,outcome,disposition,observed_at,valid_until,data,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			result.ID, result.FitnessFunctionID, result.FitnessFunctionVersion, result.AcquisitionMode, result.OriginID, result.Evaluation.Outcome, result.Evaluation.Disposition, result.Evaluation.ObservedAt, result.Evaluation.ValidUntil, evalData, event.OccurredAt); err != nil {
			return err
		}
		return insertEvent(ctx, tx, event)
	})
}

func (s *Store) GetEvaluation(ctx context.Context, id string) (application.EvaluationRecord, error) {
	var result application.EvaluationRecord
	var raw []byte
	result.ID = id
	err := s.pool.QueryRow(ctx, `SELECT fitness_function_id,fitness_function_version,acquisition_mode,origin_id,data FROM evaluations WHERE id=$1`, id).
		Scan(&result.FitnessFunctionID, &result.FitnessFunctionVersion, &result.AcquisitionMode, &result.OriginID, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, application.ErrNotFound
	}
	if err != nil {
		return result, err
	}
	var envelope struct {
		Evaluation fitness.Evaluation `json:"evaluation"`
		Data       map[string]any     `json:"data"`
	}
	if err = json.Unmarshal(raw, &envelope); err != nil {
		return result, err
	}
	result.Evaluation, result.Data = envelope.Evaluation, envelope.Data
	return result, nil
}

func (s *Store) ListEvaluations(ctx context.Context, functionID string, limit int, cursor string) ([]application.EvaluationRecord, string, error) {
	rows, err := s.pool.Query(ctx, `SELECT id FROM evaluations WHERE fitness_function_id=$1 ORDER BY observed_at DESC,id DESC LIMIT $2`, functionID, limit)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	var results []application.EvaluationRecord
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		evaluation, getErr := s.GetEvaluation(ctx, id)
		if getErr != nil {
			return nil, "", getErr
		}
		results = append(results, evaluation)
	}
	return results, "", rows.Err()
}

func (s *Store) AppendEvent(ctx context.Context, event application.Event) error {
	return s.tx(ctx, func(tx pgx.Tx) error { return insertEvent(ctx, tx, event) })
}

func (s *Store) PollEvents(ctx context.Context, after int64, limit int) ([]application.Event, int64, error) {
	rows, err := s.pool.Query(ctx, `SELECT sequence,id,event_type,event_version,aggregate_type,aggregate_id,occurred_at,actor,correlation_id,payload FROM outbox_events WHERE sequence>$1 ORDER BY sequence LIMIT $2`, after, limit)
	if err != nil {
		return nil, after, err
	}
	defer rows.Close()
	var events []application.Event
	next := after
	for rows.Next() {
		var event application.Event
		var raw []byte
		if err = rows.Scan(&next, &event.ID, &event.Type, &event.Version, &event.AggregateType, &event.AggregateID, &event.OccurredAt, &event.Actor, &event.CorrelationID, &raw); err != nil {
			return nil, after, err
		}
		_ = json.Unmarshal(raw, &event.Payload)
		events = append(events, event)
	}
	return events, next, rows.Err()
}

func (s *Store) AcknowledgeEvents(ctx context.Context, consumer string, ids []string, at time.Time) error {
	return s.tx(ctx, func(tx pgx.Tx) error {
		for _, id := range ids {
			if _, err := tx.Exec(ctx, `INSERT INTO event_acknowledgements(consumer_id,event_id,acknowledged_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, consumer, id, at); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) tx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func insertVersions(ctx context.Context, tx pgx.Tx, fn *fitness.Function) error {
	for _, v := range fn.Versions {
		raw, _ := json.Marshal(v.Definition)
		sourceID := any(nil)
		if v.Definition.Acquisition.SourceID != "" {
			sourceID = v.Definition.Acquisition.SourceID
		}
		if _, err := tx.Exec(ctx, `INSERT INTO fitness_function_versions(fitness_function_id,version,state,definition,characteristic,acquisition_mode,source_id,created_at,activated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			fn.ID, v.Number, v.State, raw, v.Definition.Characteristic, v.Definition.Acquisition.Mode, sourceID, v.CreatedAt, v.ActivatedAt); err != nil {
			return err
		}
	}
	return nil
}

func insertEvent(ctx context.Context, tx pgx.Tx, event application.Event) error {
	payload, _ := json.Marshal(event.Payload)
	_, err := tx.Exec(ctx, `INSERT INTO outbox_events(id,event_type,event_version,aggregate_type,aggregate_id,occurred_at,actor,correlation_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		event.ID, event.Type, event.Version, event.AggregateType, event.AggregateID, event.OccurredAt, event.Actor, event.CorrelationID, payload)
	return err
}

func mapError(err error) error {
	if err == nil {
		return nil
	}
	if stringsContains(err.Error(), "duplicate key") || stringsContains(err.Error(), "violates unique") {
		return fmt.Errorf("%w: %v", application.ErrConflict, err)
	}
	if stringsContains(err.Error(), "violates foreign key") {
		return fmt.Errorf("%w: referenced resource does not exist: %v", application.ErrNotFound, err)
	}
	return err
}

func stringsContains(value, part string) bool {
	for i := 0; i+len(part) <= len(value); i++ {
		if value[i:i+len(part)] == part {
			return true
		}
	}
	return false
}

func text(data map[string]any, key string) string {
	value, _ := data[key].(string)
	return value
}
