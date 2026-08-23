package fitness

import (
	"errors"
	"math"
	"testing"
	"time"
)

func validDefinition() Definition {
	warning := 70.0
	return Definition{
		Name: "availability", Purpose: "protect customer journeys", Objective: "remain available",
		TargetIDs: []string{"target-1"}, FreshnessSecond: 300, Enforcement: Block,
		Criteria: []Criterion{{
			Key: "error_rate", Unit: "percent", Required: true,
			WarningComparison: GreaterThan, WarningValue: &warning,
			FailureComparison: GreaterThan, FailureValue: 90,
		}},
		Acquisition: Acquisition{Mode: Push, ProducerID: "producer-1", MaximumObservationAgeSecond: 60},
	}
}

func TestDefinitionValidation(t *testing.T) {
	valid := validDefinition()
	if err := valid.Validate([]string{"target-1"}); err != nil {
		t.Fatalf("valid definition rejected: %v", err)
	}

	tests := map[string]func(*Definition){
		"identity":          func(d *Definition) { d.Name = "" },
		"targets":           func(d *Definition) { d.TargetIDs = nil },
		"freshness":         func(d *Definition) { d.FreshnessSecond = 0 },
		"enforcement":       func(d *Definition) { d.Enforcement = "UNKNOWN" },
		"ownership":         func(d *Definition) { d.TargetIDs = []string{"other"} },
		"criterion":         func(d *Definition) { d.Criteria[0].Key = "" },
		"duplicate":         func(d *Definition) { d.Criteria = append(d.Criteria, d.Criteria[0]) },
		"push":              func(d *Definition) { d.Acquisition.ProducerID = "" },
		"unsupported mode":  func(d *Definition) { d.Acquisition.Mode = "OTHER" },
		"warning pair":      func(d *Definition) { d.Criteria[0].WarningComparison = "" },
		"warning threshold": func(d *Definition) { v := math.NaN(); d.Criteria[0].WarningValue = &v },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			d := validDefinition()
			mutate(&d)
			if !errors.Is(d.Validate([]string{"target-1"}), ErrInvalidDefinition) {
				t.Fatal("expected invalid definition")
			}
		})
	}
}

func TestPullDefinitionValidation(t *testing.T) {
	d := validDefinition()
	d.Acquisition = Acquisition{
		Mode: Pull, SourceID: "source-1", Trigger: "SCHEDULED", IntervalSecond: 60, TimeoutSecond: 5,
		Queries: []MetricQuery{{
			CriterionKey: "error_rate", Expression: "rate(errors[5m])", Mode: "RANGE",
			LookbackSecond: 300, StepSecond: 30, Reduction: "AVERAGE",
			SeriesPolicy: "REDUCE_ACROSS_SERIES", Unit: "percent",
		}},
	}
	if err := d.Validate([]string{"target-1"}); err != nil {
		t.Fatalf("valid pull rejected: %v", err)
	}

	tests := map[string]func(*Definition){
		"source":       func(d *Definition) { d.Acquisition.SourceID = "" },
		"trigger":      func(d *Definition) { d.Acquisition.Trigger = "OTHER" },
		"interval":     func(d *Definition) { d.Acquisition.IntervalSecond = 59 },
		"mapping":      func(d *Definition) { d.Acquisition.Queries[0].CriterionKey = "missing" },
		"duplicate":    func(d *Definition) { d.Acquisition.Queries = append(d.Acquisition.Queries, d.Acquisition.Queries[0]) },
		"unit":         func(d *Definition) { d.Acquisition.Queries[0].Unit = "seconds" },
		"mode":         func(d *Definition) { d.Acquisition.Queries[0].Mode = "OTHER" },
		"range":        func(d *Definition) { d.Acquisition.Queries[0].StepSecond = 0 },
		"reduction":    func(d *Definition) { d.Acquisition.Queries[0].Reduction = "MEDIAN" },
		"seriesPolicy": func(d *Definition) { d.Acquisition.Queries[0].SeriesPolicy = "ANY" },
		"required":     func(d *Definition) { d.Acquisition.Queries = nil },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			candidate := d
			candidate.Criteria = append([]Criterion(nil), d.Criteria...)
			candidate.Acquisition.Queries = append([]MetricQuery(nil), d.Acquisition.Queries...)
			mutate(&candidate)
			if !errors.Is(candidate.Validate([]string{"target-1"}), ErrInvalidDefinition) {
				t.Fatal("expected invalid pull")
			}
		})
	}
}

func TestFunctionLifecycleAndVersioning(t *testing.T) {
	now := time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)
	if _, err := New("", "squad", validDefinition(), []string{"target-1"}, now); !errors.Is(err, ErrInvalidDefinition) {
		t.Fatal("expected identity validation")
	}
	fn, err := New("fn", "squad", validDefinition(), []string{"target-1"}, now)
	if err != nil || fn.Revision != 1 || fn.Lifecycle != Draft {
		t.Fatalf("unexpected aggregate: %#v %v", fn, err)
	}
	if _, ok := fn.ActiveDefinition(); ok {
		t.Fatal("draft must not have an active definition")
	}
	if _, err = fn.AddVersion(validDefinition(), []string{"target-1"}, 7, now); !errors.Is(err, ErrVersionConflict) {
		t.Fatal("expected revision conflict")
	}
	invalid := validDefinition()
	invalid.Name = ""
	if _, err = fn.AddVersion(invalid, []string{"target-1"}, 1, now); !errors.Is(err, ErrInvalidDefinition) {
		t.Fatal("invalid version accepted")
	}
	number, err := fn.AddVersion(validDefinition(), []string{"target-1"}, 1, now)
	if err != nil || number != 2 {
		t.Fatalf("add version failed: %v", err)
	}
	if err = fn.UpdateDraft(2, 1, validDefinition(), []string{"target-1"}); !errors.Is(err, ErrVersionConflict) {
		t.Fatal("expected update conflict")
	}
	if err = fn.UpdateDraft(2, 2, invalid, []string{"target-1"}); !errors.Is(err, ErrInvalidDefinition) {
		t.Fatal("invalid draft update accepted")
	}
	updated := validDefinition()
	updated.Name = "updated"
	if err = fn.UpdateDraft(2, 2, updated, []string{"target-1"}); err != nil {
		t.Fatal(err)
	}
	if err = fn.Activate(2, now); err != nil {
		t.Fatal(err)
	}
	if active, ok := fn.ActiveDefinition(); !ok || active.Name != "updated" {
		t.Fatal("active definition not selected")
	}
	if err = fn.UpdateDraft(2, fn.Revision, updated, []string{"target-1"}); !errors.Is(err, ErrInvalidTransition) {
		t.Fatal("active version must be immutable")
	}
	if err = fn.Activate(99, now); !errors.Is(err, ErrInvalidTransition) {
		t.Fatal("unknown version activation should fail")
	}
	if err = fn.Retire(); err != nil {
		t.Fatal(err)
	}
	if err = fn.Retire(); !errors.Is(err, ErrInvalidTransition) {
		t.Fatal("double retirement should fail")
	}
	if _, err = fn.AddVersion(updated, []string{"target-1"}, fn.Revision, now); !errors.Is(err, ErrInvalidTransition) {
		t.Fatal("retired aggregate must reject versions")
	}
	if err = fn.Activate(1, now); !errors.Is(err, ErrInvalidTransition) {
		t.Fatal("retired aggregate must reject activation")
	}
	if _, ok := findCriterion(nil, "missing"); ok {
		t.Fatal("missing criterion found")
	}
}

func TestDefinitionLowerBoundaries(t *testing.T) {
	minimal := validDefinition()
	minimal.FreshnessSecond = 1
	minimal.Acquisition.MaximumObservationAgeSecond = 1
	if err := minimal.Validate([]string{"target-1"}); err != nil {
		t.Fatalf("minimal valid push definition rejected: %v", err)
	}

	pull := validDefinition()
	pull.Acquisition = Acquisition{
		Mode: Pull, SourceID: "source", Trigger: "ON_DEMAND", TimeoutSecond: 1,
		Queries: []MetricQuery{{
			CriterionKey: "error_rate", Expression: "errors", Mode: "RANGE",
			LookbackSecond: 1, StepSecond: 1, Reduction: "LAST",
			SeriesPolicy: "REQUIRE_SINGLE_SERIES", Unit: "percent",
		}},
	}
	if err := pull.Validate([]string{"target-1"}); err != nil {
		t.Fatalf("minimal valid pull definition rejected: %v", err)
	}
}

func TestVersionSelectionAndRevisionTracking(t *testing.T) {
	now := time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)
	fn, err := New("fn", "squad", validDefinition(), []string{"target-1"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = fn.AddVersion(validDefinition(), []string{"target-1"}, fn.Revision, now); err != nil {
		t.Fatal(err)
	}

	updated := validDefinition()
	updated.Name = "updated"
	if err = fn.UpdateDraft(2, fn.Revision, updated, []string{"target-1"}); err != nil {
		t.Fatal(err)
	}
	if fn.Versions[0].Definition.Name != "availability" {
		t.Fatalf("update leaked into version 1: %q", fn.Versions[0].Definition.Name)
	}
	if fn.Revision != 3 {
		t.Fatalf("revision after update = %d, want 3", fn.Revision)
	}

	if err = fn.Activate(2, now); err != nil {
		t.Fatal(err)
	}
	if fn.Versions[0].ActivatedAt != nil || fn.Versions[1].ActivatedAt == nil {
		t.Fatal("activation stamped the wrong version")
	}
	if fn.Revision != 4 {
		t.Fatalf("revision after activate = %d, want 4", fn.Revision)
	}

	if err = fn.Retire(); err != nil {
		t.Fatal(err)
	}
	if fn.Revision != 5 {
		t.Fatalf("revision after retire = %d, want 5", fn.Revision)
	}
}
