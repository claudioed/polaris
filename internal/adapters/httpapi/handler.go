package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/claudioed/polaris/internal/application"
	"github.com/claudioed/polaris/internal/domain/fitness"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type Handler struct {
	service *application.Service
}

func New(service *application.Service, auth *Authenticator) http.Handler {
	h := &Handler{service: service}
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.Recoverer)
	r.Get("/api/v1/health/live", h.live)
	r.Get("/api/v1/health/ready", h.ready)

	oidcRoutes := r.With(auth.RequireOIDC)
	ingestRoutes := r.With(auth.RequireIngestKey)

	h.collectionRoutes(oidcRoutes)
	h.topologyRoutes(oidcRoutes)
	h.sourceRoutes(oidcRoutes)
	h.fitnessRoutes(oidcRoutes)
	h.insightRoutes(oidcRoutes)
	h.eventRoutes(oidcRoutes)
	h.ingestRoutes(ingestRoutes)
	return r
}

func (h *Handler) ingestRoutes(r chi.Router) {
	r.Post("/api/v1/fitness-functions/{fitnessFunctionId}/measurement-submissions", h.submit)
	r.Post("/api/v1/measurement-submission-batches", h.submitBatch)
}

func (h *Handler) topologyRoutes(r chi.Router) {
	r.Get("/api/v1/tribes", h.list("tribe", ""))
	r.Post("/api/v1/tribes", h.createTribe)
	r.Get("/api/v1/tribes/{tribeId}", h.get("tribe", "tribeId"))
	r.Post("/api/v1/tribes/{tribeId}/archivals", h.transition("tribe", "tribeId", "ARCHIVED"))
	r.Get("/api/v1/tribes/{tribeId}/squads", h.list("squad", "tribeId"))
	r.Post("/api/v1/tribes/{tribeId}/squads", h.createSquad)
	r.Get("/api/v1/squads/{squadId}", h.get("squad", "squadId"))
	r.Post("/api/v1/squads/{squadId}/transfers", h.transferSquad)
	r.Get("/api/v1/squads/{squadId}/fitness-targets", h.list("fitness-target", "squadId"))
	r.Post("/api/v1/squads/{squadId}/fitness-targets", h.createFitnessTarget)
	r.Get("/api/v1/fitness-targets/{targetId}", h.get("fitness-target", "targetId"))
	r.Post("/api/v1/fitness-targets/{targetId}/lifecycle-transitions", h.transitionFitnessTarget)
	r.Post("/api/v1/squads/{squadId}/measurement-producers", h.createMeasurementProducer)
}

func (h *Handler) sourceRoutes(r chi.Router) {
	r.Get("/api/v1/measurement-provider-types", func(w http.ResponseWriter, _ *http.Request) {
		write(w, http.StatusOK, page([]any{map[string]any{
			"type": "PROMETHEUS", "capabilities": []string{"INSTANT_QUERY", "RANGE_QUERY"},
			"authenticationModes": []string{"NONE"},
		}}, ""))
	})
	r.Get("/api/v1/squads/{squadId}/measurement-sources", h.list("measurement-source", "squadId"))
	r.Post("/api/v1/squads/{squadId}/measurement-sources", h.createMeasurementSource)
	r.Get("/api/v1/measurement-sources/{sourceId}", h.get("measurement-source", "sourceId"))
	r.Post("/api/v1/measurement-sources/{sourceId}/activations", h.transition("measurement-source", "sourceId", "ACTIVE"))
	r.Post("/api/v1/measurement-sources/{sourceId}/retirements", h.transition("measurement-source", "sourceId", "RETIRED"))
	r.Post("/api/v1/measurement-sources/{sourceId}/connection-checks", func(w http.ResponseWriter, r *http.Request) {
		record, err := h.service.CheckMeasurementSource(r.Context(), chi.URLParam(r, "sourceId"))
		if err != nil {
			h.problem(w, r, err)
			return
		}
		write(w, http.StatusAccepted, record)
	})
	r.Post("/api/v1/measurement-sources/{sourceId}/query-validations", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Query         fitness.MetricQuery `json:"query"`
			ExecuteSample bool                `json:"executeSample"`
		}
		if !decode(w, r, &body) {
			return
		}
		result, err := h.service.ValidateSourceQuery(r.Context(), chi.URLParam(r, "sourceId"), body.Query, body.ExecuteSample)
		if err != nil {
			h.problem(w, r, err)
			return
		}
		write(w, http.StatusOK, result)
	})
}

func (h *Handler) fitnessRoutes(r chi.Router) {
	r.Get("/api/v1/squads/{squadId}/fitness-functions", h.listFitnessFunctions)
	r.Post("/api/v1/squads/{squadId}/fitness-functions", h.createFitnessFunction)
	r.Get("/api/v1/fitness-functions/{fitnessFunctionId}", h.getFitnessFunction)
	r.Get("/api/v1/fitness-functions/{fitnessFunctionId}/versions", h.listFitnessVersions)
	r.Post("/api/v1/fitness-functions/{fitnessFunctionId}/versions", h.addFitnessVersion)
	r.Patch("/api/v1/fitness-functions/{fitnessFunctionId}/versions/{version}", h.updateFitnessVersion)
	r.Post("/api/v1/fitness-functions/{fitnessFunctionId}/versions/{version}/validations", h.validateFitnessVersion)
	r.Post("/api/v1/fitness-functions/{fitnessFunctionId}/versions/{version}/activations", h.activateFitnessVersion)
	r.Post("/api/v1/fitness-functions/{fitnessFunctionId}/retirements", h.retireFitnessFunction)

	r.Post("/api/v1/fitness-functions/{fitnessFunctionId}/evaluation-requests", h.createEvaluationRequest)
	r.Get("/api/v1/evaluation-requests/{requestId}", h.get("evaluation-request", "requestId"))
	r.Post("/api/v1/evaluation-requests/{requestId}/cancellations", h.transition("evaluation-request", "requestId", "CANCELLED"))
	r.Get("/api/v1/evaluations/{evaluationId}", h.getEvaluation)
	r.Get("/api/v1/fitness-functions/{fitnessFunctionId}/evaluations", h.listEvaluations)

	r.Post("/api/v1/fitness-functions/{fitnessFunctionId}/waivers", h.createWaiver)
	r.Post("/api/v1/waivers/{waiverId}/{transition}", func(w http.ResponseWriter, r *http.Request) {
		statuses := map[string]string{"approvals": "APPROVED", "rejections": "REJECTED", "revocations": "REVOKED"}
		status, ok := statuses[chi.URLParam(r, "transition")]
		if !ok {
			h.problem(w, r, fmt.Errorf("%w: unsupported waiver transition", application.ErrInvalid))
			return
		}
		h.transition("waiver", "waiverId", status)(w, r)
	})
}

func (h *Handler) collectionRoutes(r chi.Router) {
	r.Get("/api/v1/fitness-functions/{fitnessFunctionId}/collection-attempts", h.list("collection-attempt", "fitnessFunctionId"))
	r.Post("/api/v1/fitness-functions/{fitnessFunctionId}/collection-attempts", func(w http.ResponseWriter, r *http.Request) {
		result, err := h.service.Collect(r.Context(), chi.URLParam(r, "fitnessFunctionId"))
		if err != nil {
			h.problem(w, r, err)
			return
		}
		write(w, http.StatusAccepted, evaluationDocument(result))
	})
	r.Get("/api/v1/collection-attempts/{attemptId}", h.get("collection-attempt", "attemptId"))
	r.Post("/api/v1/collection-attempts/{attemptId}/retries", func(w http.ResponseWriter, r *http.Request) {
		attempt, err := h.service.GetRecord(r.Context(), "collection-attempt", chi.URLParam(r, "attemptId"))
		if err != nil {
			h.problem(w, r, err)
			return
		}
		result, err := h.service.Collect(r.Context(), attempt.ParentID)
		if err != nil {
			h.problem(w, r, err)
			return
		}
		write(w, http.StatusAccepted, evaluationDocument(result))
	})
}

func (h *Handler) insightRoutes(r chi.Router) {
	r.Get("/api/v1/tribes/{tribeId}/fitness-function-templates", h.list("fitness-function-template", "tribeId"))
	r.Post("/api/v1/tribes/{tribeId}/fitness-function-templates", h.createTemplate)
	r.Post("/api/v1/fitness-function-templates/{templateId}/adoptions", h.adoptTemplate)
	r.Get("/api/v1/squads/{squadId}/fitness-overview", h.overview("squad", "squadId"))
	r.Get("/api/v1/tribes/{tribeId}/fitness-overview", h.overview("tribe", "tribeId"))
	r.Get("/api/v1/fitness-targets/{targetId}/fitness-history", h.list("fitness-history", "targetId"))
}

func (h *Handler) eventRoutes(r chi.Router) {
	r.Get("/api/v1/events", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("consumerId") == "" {
			h.problem(w, r, fmt.Errorf("%w: consumerId is required", application.ErrBadRequest))
			return
		}
		cursor, _ := strconv.ParseInt(r.URL.Query().Get("cursor"), 10, 64)
		events, next, err := h.service.PollEvents(r.Context(), cursor, limit(r))
		if err != nil {
			h.problem(w, r, err)
			return
		}
		items := make([]any, len(events))
		for i := range events {
			items[i] = events[i]
		}
		write(w, http.StatusOK, page(items, strconv.FormatInt(next, 10)))
	})
	r.Post("/api/v1/event-acknowledgements", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ConsumerID string   `json:"consumerId"`
			EventIDs   []string `json:"eventIds"`
		}
		if !decode(w, r, &body) {
			return
		}
		if err := h.service.AcknowledgeEvents(r.Context(), body.ConsumerID, body.EventIDs); err != nil {
			h.problem(w, r, err)
			return
		}
		write(w, http.StatusCreated, map[string]any{"consumerId": body.ConsumerID, "eventIds": body.EventIDs})
	})
}

func (h *Handler) createTribe(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string  `json:"name"`
		Description *string `json:"description"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !h.validNamed(w, r, "name", body.Name) {
		return
	}
	h.createValidated(w, r, "tribe", "", toMap(body))
}

func (h *Handler) createSquad(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name    string  `json:"name"`
		Mission *string `json:"mission"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !h.validNamed(w, r, "name", body.Name) {
		return
	}
	h.createValidated(w, r, "squad", chi.URLParam(r, "tribeId"), toMap(body))
}

func (h *Handler) transferSquad(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TribeID string  `json:"tribeId"`
		Reason  *string `json:"reason"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.TribeID == "" {
		h.problem(w, r, fmt.Errorf("%w: tribeId is required", application.ErrInvalid))
		return
	}
	record, err := h.service.TransitionRecord(r.Context(), "squad", chi.URLParam(r, "squadId"), "ACTIVE", toMap(body))
	if err != nil {
		h.problem(w, r, err)
		return
	}
	setLocation(w, resourcePath("squad", record.ParentID, record.ID))
	write(w, http.StatusCreated, record)
}

func (h *Handler) createFitnessTarget(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name              string         `json:"name"`
		Description       *string        `json:"description"`
		Kind              *string        `json:"kind"`
		Criticality       *string        `json:"criticality"`
		ExternalReference map[string]any `json:"externalReference"`
		BusinessContacts  []string       `json:"businessContacts"`
		TechnicalContacts []string       `json:"technicalContacts"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !h.validNamed(w, r, "name", body.Name) {
		return
	}
	h.createValidated(w, r, "fitness-target", chi.URLParam(r, "squadId"), toMap(body))
}

func (h *Handler) transitionFitnessTarget(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Status string  `json:"status"`
		Reason *string `json:"reason"`
	}
	if !decode(w, r, &body) {
		return
	}
	switch body.Status {
	case "ACTIVE", "DEPRECATED", "RETIRED":
	default:
		h.problem(w, r, fmt.Errorf("%w: status must be ACTIVE, DEPRECATED, or RETIRED", application.ErrInvalid))
		return
	}
	record, err := h.service.TransitionRecord(r.Context(), "fitness-target", chi.URLParam(r, "targetId"), body.Status, toMap(body))
	if err != nil {
		h.problem(w, r, err)
		return
	}
	setLocation(w, resourcePath("fitness-target", record.ParentID, record.ID))
	write(w, http.StatusCreated, record)
}

func (h *Handler) createMeasurementSource(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name         string  `json:"name"`
		ProviderType string  `json:"providerType"`
		BaseURL      string  `json:"baseUrl"`
		Description  *string `json:"description"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !h.validNamed(w, r, "name", body.Name) {
		return
	}
	if body.ProviderType != "PROMETHEUS" {
		h.problem(w, r, fmt.Errorf("%w: providerType must be PROMETHEUS", application.ErrInvalid))
		return
	}
	if body.BaseURL == "" {
		h.problem(w, r, fmt.Errorf("%w: baseUrl is required", application.ErrInvalid))
		return
	}
	h.createValidated(w, r, "measurement-source", chi.URLParam(r, "squadId"), toMap(body))
}

func (h *Handler) createMeasurementProducer(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string  `json:"name"`
		Description *string `json:"description"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !h.validNamed(w, r, "name", body.Name) {
		return
	}
	h.createValidated(w, r, "measurement-producer", chi.URLParam(r, "squadId"), toMap(body))
}

func (h *Handler) createEvaluationRequest(w http.ResponseWriter, r *http.Request) {
	var body struct{}
	if !decode(w, r, &body) {
		return
	}
	record, err := h.service.CreateRecord(r.Context(), "evaluation-request", chi.URLParam(r, "fitnessFunctionId"), map[string]any{})
	if err != nil {
		h.problem(w, r, err)
		return
	}
	setLocation(w, resourcePath("evaluation-request", record.ParentID, record.ID))
	write(w, http.StatusAccepted, record)
}

func (h *Handler) createWaiver(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Reason             string     `json:"reason"`
		CriterionKeys      []string   `json:"criterionKeys"`
		Risk               *string    `json:"risk"`
		CompensatingAction *string    `json:"compensatingAction"`
		StartsAt           *time.Time `json:"startsAt"`
		ExpiresAt          *time.Time `json:"expiresAt"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Reason == "" {
		h.problem(w, r, fmt.Errorf("%w: reason is required", application.ErrInvalid))
		return
	}
	if len(body.Reason) > 2000 {
		h.problem(w, r, fmt.Errorf("%w: reason must be at most 2000 characters", application.ErrInvalid))
		return
	}
	h.createValidated(w, r, "waiver", chi.URLParam(r, "fitnessFunctionId"), toMap(body))
}

func (h *Handler) createTemplate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string              `json:"name"`
		Description *string             `json:"description"`
		Definition  *fitness.Definition `json:"definition"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !h.validNamed(w, r, "name", body.Name) {
		return
	}
	h.createValidated(w, r, "fitness-function-template", chi.URLParam(r, "tribeId"), toMap(body))
}

func (h *Handler) adoptTemplate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SquadID   string   `json:"squadId"`
		TargetIDs []string `json:"targetIds"`
		Reason    *string  `json:"reason"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.SquadID == "" {
		h.problem(w, r, fmt.Errorf("%w: squadId is required", application.ErrInvalid))
		return
	}
	h.createValidated(w, r, "template-adoption", chi.URLParam(r, "templateId"), toMap(body))
}

func (h *Handler) createValidated(w http.ResponseWriter, r *http.Request, kind, parentID string, data map[string]any) {
	record, err := h.service.CreateRecord(r.Context(), kind, parentID, data)
	if err != nil {
		h.problem(w, r, err)
		return
	}
	setLocation(w, resourcePath(kind, record.ParentID, record.ID))
	write(w, http.StatusCreated, record)
}

func (h *Handler) validNamed(w http.ResponseWriter, r *http.Request, field, value string) bool {
	if value == "" {
		h.problem(w, r, fmt.Errorf("%w: %s is required", application.ErrInvalid, field))
		return false
	}
	if len(value) > 200 {
		h.problem(w, r, fmt.Errorf("%w: %s must be at most 200 characters", application.ErrInvalid, field))
		return false
	}
	return true
}

func (h *Handler) get(kind, idParam string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		record, err := h.service.GetRecord(r.Context(), kind, chi.URLParam(r, idParam))
		if err != nil {
			h.problem(w, r, err)
			return
		}
		write(w, http.StatusOK, record)
	}
}

func (h *Handler) list(kind, parentParam string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		parentID := ""
		if parentParam != "" {
			parentID = chi.URLParam(r, parentParam)
		}
		records, next, err := h.service.ListRecords(r.Context(), kind, parentID, limit(r), r.URL.Query().Get("cursor"))
		if err != nil {
			h.problem(w, r, err)
			return
		}
		items := make([]any, len(records))
		for i := range records {
			items[i] = records[i]
		}
		write(w, http.StatusOK, page(items, next))
	}
}

func (h *Handler) transition(kind, idParam, status string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body := map[string]any{}
		if r.Body != nil && r.ContentLength != 0 && !decode(w, r, &body) {
			return
		}
		record, err := h.service.TransitionRecord(r.Context(), kind, chi.URLParam(r, idParam), status, body)
		if err != nil {
			h.problem(w, r, err)
			return
		}
		write(w, http.StatusCreated, record)
	}
}

func (h *Handler) createFitnessFunction(w http.ResponseWriter, r *http.Request) {
	var definition fitness.Definition
	if !decode(w, r, &definition) {
		return
	}
	fn, err := h.service.CreateFitnessFunction(r.Context(), chi.URLParam(r, "squadId"), definition)
	if err != nil {
		h.problem(w, r, err)
		return
	}
	setLocation(w, resourcePath("fitness-function", "", fn.ID))
	setETag(w, fn.Revision)
	write(w, http.StatusCreated, fn)
}

func (h *Handler) listFitnessFunctions(w http.ResponseWriter, r *http.Request) {
	functions, next, err := h.service.ListFitnessFunctions(r.Context(), chi.URLParam(r, "squadId"), limit(r), r.URL.Query().Get("cursor"))
	if err != nil {
		h.problem(w, r, err)
		return
	}
	items := make([]any, len(functions))
	for i := range functions {
		items[i] = functions[i]
	}
	write(w, http.StatusOK, page(items, next))
}

func (h *Handler) getFitnessFunction(w http.ResponseWriter, r *http.Request) {
	fn, err := h.service.GetFitnessFunction(r.Context(), chi.URLParam(r, "fitnessFunctionId"))
	if err != nil {
		h.problem(w, r, err)
		return
	}
	setETag(w, fn.Revision)
	write(w, http.StatusOK, fn)
}

func (h *Handler) listFitnessVersions(w http.ResponseWriter, r *http.Request) {
	fn, err := h.service.GetFitnessFunction(r.Context(), chi.URLParam(r, "fitnessFunctionId"))
	if err != nil {
		h.problem(w, r, err)
		return
	}
	items := make([]any, len(fn.Versions))
	for i := range fn.Versions {
		items[i] = fn.Versions[i]
	}
	write(w, http.StatusOK, page(items, ""))
}

func (h *Handler) addFitnessVersion(w http.ResponseWriter, r *http.Request) {
	var definition fitness.Definition
	if !decode(w, r, &definition) {
		return
	}
	revision, ok := ifMatch(r)
	if !ok {
		h.problem(w, r, fmt.Errorf("%w: If-Match must contain the aggregate revision", application.ErrInvalid))
		return
	}
	fn, err := h.service.AddFitnessVersion(r.Context(), chi.URLParam(r, "fitnessFunctionId"), definition, revision)
	if err != nil {
		h.problem(w, r, err)
		return
	}
	setLocation(w, resourcePath("fitness-function", "", fn.ID))
	setETag(w, fn.Revision)
	write(w, http.StatusCreated, fn)
}

func (h *Handler) updateFitnessVersion(w http.ResponseWriter, r *http.Request) {
	var definition fitness.Definition
	if !decode(w, r, &definition) {
		return
	}
	version, vErr := strconv.Atoi(chi.URLParam(r, "version"))
	revision, ok := ifMatch(r)
	if vErr != nil || !ok {
		h.problem(w, r, fmt.Errorf("%w: valid version and If-Match are required", application.ErrInvalid))
		return
	}
	fn, err := h.service.UpdateFitnessVersion(r.Context(), chi.URLParam(r, "fitnessFunctionId"), version, revision, definition)
	if err != nil {
		h.problem(w, r, err)
		return
	}
	setETag(w, fn.Revision)
	write(w, http.StatusOK, fn)
}

func (h *Handler) validateFitnessVersion(w http.ResponseWriter, r *http.Request) {
	fn, err := h.service.GetFitnessFunction(r.Context(), chi.URLParam(r, "fitnessFunctionId"))
	if err != nil {
		h.problem(w, r, err)
		return
	}
	version, _ := strconv.Atoi(chi.URLParam(r, "version"))
	for _, candidate := range fn.Versions {
		if candidate.Number == version {
			targets, _, listErr := h.service.ListRecords(r.Context(), "fitness-target", fn.OwnerSquadID, 200, "")
			owned := make([]string, len(targets))
			for i := range targets {
				owned[i] = targets[i].ID
			}
			if listErr != nil || candidate.Definition.Validate(owned) != nil {
				h.problem(w, r, fmt.Errorf("%w: version is invalid", application.ErrInvalid))
				return
			}
			write(w, http.StatusCreated, map[string]any{"valid": true, "version": version})
			return
		}
	}
	h.problem(w, r, application.ErrNotFound)
}

func (h *Handler) activateFitnessVersion(w http.ResponseWriter, r *http.Request) {
	version, err := strconv.Atoi(chi.URLParam(r, "version"))
	if err != nil {
		h.problem(w, r, fmt.Errorf("%w: invalid version", application.ErrInvalid))
		return
	}
	fn, err := h.service.ActivateFitnessVersion(r.Context(), chi.URLParam(r, "fitnessFunctionId"), version)
	if err != nil {
		h.problem(w, r, err)
		return
	}
	setETag(w, fn.Revision)
	write(w, http.StatusCreated, fn)
}

func (h *Handler) retireFitnessFunction(w http.ResponseWriter, r *http.Request) {
	fn, err := h.service.RetireFitnessFunction(r.Context(), chi.URLParam(r, "fitnessFunctionId"))
	if err != nil {
		h.problem(w, r, err)
		return
	}
	setETag(w, fn.Revision)
	write(w, http.StatusCreated, fn)
}

func (h *Handler) submit(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProducerID             string                `json:"producerId"`
		ExternalRunID          string                `json:"externalRunId"`
		FitnessFunctionVersion int                   `json:"fitnessFunctionVersion"`
		ObservedAt             time.Time             `json:"observedAt"`
		Measurements           []fitness.Measurement `json:"measurements"`
		Evidence               []map[string]any      `json:"evidence"`
		EvaluationRequestID    string                `json:"evaluationRequestId"`
	}
	if !decode(w, r, &body) {
		return
	}
	result, replay, err := h.service.Submit(r.Context(), chi.URLParam(r, "fitnessFunctionId"), application.Submission{
		ProducerID: body.ProducerID, ExternalRunID: body.ExternalRunID,
		FitnessVersion: body.FitnessFunctionVersion, ObservedAt: body.ObservedAt,
		Measurements: body.Measurements, Evidence: body.Evidence, EvaluationRequestID: body.EvaluationRequestID,
	})
	if err != nil {
		h.problem(w, r, err)
		return
	}
	document := evaluationDocument(result)
	document["replayed"] = replay
	write(w, http.StatusCreated, document)
}

func (h *Handler) submitBatch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Items []struct {
			FitnessFunctionID string          `json:"fitnessFunctionId"`
			Submission        json.RawMessage `json:"submission"`
		} `json:"items"`
	}
	if !decode(w, r, &body) {
		return
	}
	items := make([]any, 0, len(body.Items))
	for _, item := range body.Items {
		var submission struct {
			ProducerID             string                `json:"producerId"`
			ExternalRunID          string                `json:"externalRunId"`
			FitnessFunctionVersion int                   `json:"fitnessFunctionVersion"`
			ObservedAt             time.Time             `json:"observedAt"`
			Measurements           []fitness.Measurement `json:"measurements"`
			Evidence               []map[string]any      `json:"evidence"`
		}
		if err := json.Unmarshal(item.Submission, &submission); err != nil {
			items = append(items, map[string]any{"fitnessFunctionId": item.FitnessFunctionID, "status": 400, "error": err.Error()})
			continue
		}
		result, replay, err := h.service.Submit(r.Context(), item.FitnessFunctionID, application.Submission{
			ProducerID: submission.ProducerID, ExternalRunID: submission.ExternalRunID,
			FitnessVersion: submission.FitnessFunctionVersion, ObservedAt: submission.ObservedAt,
			Measurements: submission.Measurements, Evidence: submission.Evidence,
		})
		if err != nil {
			items = append(items, map[string]any{"fitnessFunctionId": item.FitnessFunctionID, "status": statusFor(err), "error": err.Error()})
			continue
		}
		items = append(items, map[string]any{"fitnessFunctionId": item.FitnessFunctionID, "status": 201, "replayed": replay, "evaluation": evaluationDocument(result)})
	}
	write(w, http.StatusMultiStatus, page(items, ""))
}

func (h *Handler) getEvaluation(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetEvaluation(r.Context(), chi.URLParam(r, "evaluationId"))
	if err != nil {
		h.problem(w, r, err)
		return
	}
	write(w, http.StatusOK, evaluationDocument(result))
}

func (h *Handler) listEvaluations(w http.ResponseWriter, r *http.Request) {
	results, next, err := h.service.ListEvaluations(r.Context(), chi.URLParam(r, "fitnessFunctionId"), limit(r), r.URL.Query().Get("cursor"))
	if err != nil {
		h.problem(w, r, err)
		return
	}
	items := make([]any, len(results))
	for i := range results {
		items[i] = evaluationDocument(results[i])
	}
	write(w, http.StatusOK, page(items, next))
}

func (h *Handler) overview(scope, param string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		write(w, http.StatusOK, map[string]any{
			"scope": scope, "scopeId": chi.URLParam(r, param),
			"generatedAt": time.Now().UTC(), "status": "AVAILABLE",
		})
	}
}

func (h *Handler) live(w http.ResponseWriter, _ *http.Request) {
	write(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) ready(w http.ResponseWriter, r *http.Request) {
	if err := h.service.Ready(r.Context()); err != nil {
		w.Header().Set("Retry-After", "5")
		h.problemWithStatus(w, r, err, http.StatusServiceUnavailable)
		return
	}
	write(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) problem(w http.ResponseWriter, r *http.Request, err error) {
	h.problemWithStatus(w, r, err, statusFor(err))
}

func (h *Handler) problemWithStatus(w http.ResponseWriter, r *http.Request, err error, status int) {
	title := http.StatusText(status)
	writeProblem(w, status, map[string]any{
		"type":  "https://polaris.local/problems/" + strings.ToLower(strings.ReplaceAll(title, " ", "-")),
		"title": title, "status": status, "code": problemCode(status), "detail": err.Error(),
		"instance": r.URL.Path, "correlationId": middleware.GetReqID(r.Context()),
	})
}

func statusFor(err error) int {
	switch {
	case errors.Is(err, application.ErrBadRequest):
		return http.StatusBadRequest
	case errors.Is(err, application.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, application.ErrConflict), errors.Is(err, fitness.ErrVersionConflict), errors.Is(err, fitness.ErrInvalidTransition):
		return http.StatusConflict
	case errors.Is(err, application.ErrInvalid), errors.Is(err, fitness.ErrInvalidDefinition):
		return http.StatusUnprocessableEntity
	default:
		return http.StatusInternalServerError
	}
}

func problemCode(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "INVALID_REQUEST"
	case http.StatusNotFound:
		return "RESOURCE_NOT_FOUND"
	case http.StatusConflict:
		return "RESOURCE_CONFLICT"
	case http.StatusUnprocessableEntity:
		return "INVALID_REQUEST"
	default:
		return "INTERNAL_ERROR"
	}
}

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeProblem(w, http.StatusBadRequest, map[string]any{
			"type": "https://polaris.local/problems/bad-request", "title": "Bad Request",
			"status": 400, "code": "INVALID_JSON", "detail": err.Error(),
		})
		return false
	}
	return true
}

func write(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeProblem(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func setLocation(w http.ResponseWriter, path string) {
	if path != "" {
		w.Header().Set("Location", path)
	}
}

func setETag(w http.ResponseWriter, revision int) {
	w.Header().Set("ETag", fmt.Sprintf(`"%d"`, revision))
}

func resourcePath(kind, parentID, id string) string {
	switch kind {
	case "tribe":
		return "/api/v1/tribes/" + id
	case "squad":
		return "/api/v1/squads/" + id
	case "fitness-target":
		return "/api/v1/fitness-targets/" + id
	case "measurement-source":
		return "/api/v1/measurement-sources/" + id
	case "evaluation-request":
		return "/api/v1/evaluation-requests/" + id
	case "waiver":
		return "/api/v1/waivers/" + id
	case "fitness-function":
		return "/api/v1/fitness-functions/" + id
	case "fitness-function-template":
		return "/api/v1/fitness-function-templates/" + id
	case "measurement-producer":
		return "/api/v1/squads/" + parentID + "/measurement-producers"
	case "template-adoption":
		return "/api/v1/fitness-function-templates/" + parentID + "/adoptions"
	default:
		return ""
	}
}

func toMap(value any) map[string]any {
	raw, _ := json.Marshal(value)
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	return result
}

func limit(r *http.Request) int {
	value, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if value < 1 {
		return 50
	}
	if value > 200 {
		return 200
	}
	return value
}

func ifMatch(r *http.Request) (int, bool) {
	value := strings.Trim(r.Header.Get("If-Match"), `"W/ `)
	revision, err := strconv.Atoi(value)
	return revision, err == nil && revision > 0
}

func page(items []any, next string) map[string]any {
	result := map[string]any{"items": items}
	if next != "" && next != "0" {
		result["nextCursor"] = next
	}
	return result
}

func evaluationDocument(result application.EvaluationRecord) map[string]any {
	return map[string]any{
		"evaluationId": result.ID, "fitnessFunctionId": result.FitnessFunctionID,
		"fitnessFunctionVersion": result.FitnessFunctionVersion, "acquisitionMode": result.AcquisitionMode,
		"originId": result.OriginID, "outcome": result.Evaluation.Outcome,
		"disposition": result.Evaluation.Disposition, "observedAt": result.Evaluation.ObservedAt,
		"validUntil": result.Evaluation.ValidUntil, "criterionResults": result.Evaluation.CriterionResults,
		"data": result.Data,
	}
}
