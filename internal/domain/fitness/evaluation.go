package fitness

import (
	"fmt"
	"math"
	"time"
)

type Outcome string

const (
	Pass        Outcome = "PASS"
	WarnOutcome Outcome = "WARN"
	Fail        Outcome = "FAIL"
	Error       Outcome = "ERROR"
)

type Disposition string

const (
	Accepted          Disposition = "ACCEPTED"
	AttentionRequired Disposition = "ATTENTION_REQUIRED"
	Blocked           Disposition = "BLOCKED"
	Waived            Disposition = "WAIVED"
)

type Measurement struct {
	CriterionKey string    `json:"criterionKey"`
	Value        float64   `json:"value"`
	Unit         string    `json:"unit"`
	ObservedAt   time.Time `json:"observedAt"`
}

type CriterionResult struct {
	CriterionKey string  `json:"criterionKey"`
	Value        float64 `json:"value"`
	Unit         string  `json:"unit"`
	Outcome      Outcome `json:"outcome"`
}

type Evaluation struct {
	Outcome          Outcome           `json:"outcome"`
	Disposition      Disposition       `json:"disposition"`
	CriterionResults []CriterionResult `json:"criterionResults"`
	ObservedAt       time.Time         `json:"observedAt"`
	ValidUntil       time.Time         `json:"validUntil"`
}

func Evaluate(def Definition, measurements []Measurement, waived bool) (Evaluation, error) {
	byKey := map[string]Measurement{}
	var observedAt time.Time
	for _, measurement := range measurements {
		if !finite(measurement.Value) {
			return Evaluation{}, fmt.Errorf("measurement %q is not finite", measurement.CriterionKey)
		}
		if _, exists := byKey[measurement.CriterionKey]; exists {
			return Evaluation{}, fmt.Errorf("duplicate measurement %q", measurement.CriterionKey)
		}
		byKey[measurement.CriterionKey] = measurement
		if measurement.ObservedAt.After(observedAt) {
			observedAt = measurement.ObservedAt
		}
	}
	results := make([]CriterionResult, 0, len(def.Criteria))
	overall := Pass
	for _, criterion := range def.Criteria {
		measurement, ok := byKey[criterion.Key]
		if !ok {
			if criterion.Required {
				return Evaluation{}, fmt.Errorf("required measurement %q is missing", criterion.Key)
			}
			continue
		}
		if measurement.Unit != criterion.Unit {
			return Evaluation{}, fmt.Errorf("measurement %q unit mismatch", criterion.Key)
		}
		outcome := Pass
		if compare(measurement.Value, criterion.FailureComparison, criterion.FailureValue) {
			outcome = Fail
			overall = Fail
		} else if criterion.WarningValue != nil && compare(measurement.Value, criterion.WarningComparison, *criterion.WarningValue) {
			outcome = WarnOutcome
			if overall == Pass {
				overall = WarnOutcome
			}
		}
		results = append(results, CriterionResult{CriterionKey: criterion.Key, Value: measurement.Value, Unit: measurement.Unit, Outcome: outcome})
	}
	disposition := dispositionFor(def.Enforcement, overall, waived)
	return Evaluation{
		Outcome: overall, Disposition: disposition, CriterionResults: results,
		ObservedAt: observedAt, ValidUntil: observedAt.Add(time.Duration(def.FreshnessSecond) * time.Second),
	}, nil
}

func dispositionFor(enforcement Enforcement, outcome Outcome, waived bool) Disposition {
	if waived && outcome == Fail {
		return Waived
	}
	switch enforcement {
	case Observe:
		return Accepted
	case Warn:
		if outcome == Pass {
			return Accepted
		}
		return AttentionRequired
	case Block:
		if outcome == Fail || outcome == Error {
			return Blocked
		}
		if outcome == WarnOutcome {
			return AttentionRequired
		}
		return Accepted
	default:
		return AttentionRequired
	}
}

func compare(actual float64, comparison Comparison, threshold float64) bool {
	switch comparison {
	case GreaterThan:
		return actual > threshold
	case GreaterThanOrEqual:
		return actual >= threshold
	case LessThan:
		return actual < threshold
	case LessThanOrEqual:
		return actual <= threshold
	case Equal:
		return math.Abs(actual-threshold) <= 1e-9
	case NotEqual:
		return math.Abs(actual-threshold) > 1e-9
	default:
		return false
	}
}
