package fitness

import (
	"math"
	"strings"
	"testing"
	"time"
)

func TestEvaluationOutcomesAndDispositions(t *testing.T) {
	now := time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)
	d := validDefinition()
	for _, tc := range []struct {
		name        string
		value       float64
		enforcement Enforcement
		waived      bool
		outcome     Outcome
		disposition Disposition
	}{
		{"pass", 10, Block, false, Pass, Accepted},
		{"warning", 80, Warn, false, WarnOutcome, AttentionRequired},
		{"failure", 95, Block, false, Fail, Blocked},
		{"waived", 95, Block, true, Fail, Waived},
		{"observe", 95, Observe, false, Fail, Accepted},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d.Enforcement = tc.enforcement
			got, err := Evaluate(d, []Measurement{{CriterionKey: "error_rate", Value: tc.value, Unit: "percent", ObservedAt: now}}, tc.waived)
			if err != nil {
				t.Fatal(err)
			}
			if got.Outcome != tc.outcome || got.Disposition != tc.disposition || !got.ValidUntil.Equal(now.Add(300*time.Second)) {
				t.Fatalf("unexpected evaluation: %#v", got)
			}
		})
	}
}

func TestEvaluationRejectsBadMeasurements(t *testing.T) {
	now := time.Now()
	d := validDefinition()
	tests := map[string][]Measurement{
		"non-finite": {{CriterionKey: "error_rate", Value: math.NaN(), Unit: "percent", ObservedAt: now}},
		"duplicate": {
			{CriterionKey: "error_rate", Value: 1, Unit: "percent", ObservedAt: now},
			{CriterionKey: "error_rate", Value: 2, Unit: "percent", ObservedAt: now},
		},
		"missing": nil,
		"unit":    {{CriterionKey: "error_rate", Value: 1, Unit: "seconds", ObservedAt: now}},
	}
	for name, measurements := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := Evaluate(d, measurements, false); err == nil {
				t.Fatal("expected error")
			}
		})
	}
	d.Criteria[0].Required = false
	if result, err := Evaluate(d, nil, false); err != nil || len(result.CriterionResults) != 0 {
		t.Fatalf("optional criterion should be skipped: %#v %v", result, err)
	}
}

func TestAllComparisonsAndDispositionFallbacks(t *testing.T) {
	tests := []struct {
		comparison Comparison
		actual     float64
		threshold  float64
		want       bool
	}{
		{GreaterThan, 2, 1, true}, {GreaterThanOrEqual, 1, 1, true},
		{LessThan, 1, 2, true}, {LessThanOrEqual, 1, 1, true},
		{Equal, 1, 1 + 1e-10, true}, {NotEqual, 1, 2, true},
		{"UNKNOWN", 1, 1, false},
	}
	for _, tc := range tests {
		if got := compare(tc.actual, tc.comparison, tc.threshold); got != tc.want {
			t.Fatalf("%s comparison = %v", tc.comparison, got)
		}
	}
	if dispositionFor(Block, Error, false) != Blocked ||
		dispositionFor(Block, WarnOutcome, false) != AttentionRequired ||
		dispositionFor("OTHER", Pass, false) != AttentionRequired {
		t.Fatal("unexpected disposition fallback")
	}
	if !strings.Contains(ErrInvalidDefinition.Error(), "invalid") {
		t.Fatal("sentinel unexpectedly changed")
	}
}

func TestComparisonBoundaries(t *testing.T) {
	tests := []struct {
		comparison Comparison
		actual     float64
		threshold  float64
		want       bool
	}{
		{GreaterThan, 1, 1, false},
		{GreaterThanOrEqual, 1, 1, true},
		{LessThan, 1, 1, false},
		{LessThanOrEqual, 1, 1, true},
		{Equal, 2, 2, true},
		{Equal, 0, 1e-9, true},
		{NotEqual, 0, 1e-9, false},
		{NotEqual, 2, 2, false},
	}
	for _, tc := range tests {
		if got := compare(tc.actual, tc.comparison, tc.threshold); got != tc.want {
			t.Fatalf("%s(%v, %v) = %v, want %v", tc.comparison, tc.actual, tc.threshold, got, tc.want)
		}
	}
}
