package fitness

import (
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"
)

type Lifecycle string

const (
	Draft   Lifecycle = "DRAFT"
	Active  Lifecycle = "ACTIVE"
	Retired Lifecycle = "RETIRED"
)

type VersionState string

const (
	VersionDraft      VersionState = "DRAFT"
	VersionActive     VersionState = "ACTIVE"
	VersionSuperseded VersionState = "SUPERSEDED"
)

type Enforcement string

const (
	Observe Enforcement = "OBSERVE"
	Warn    Enforcement = "WARN"
	Block   Enforcement = "BLOCK"
)

type Comparison string

const (
	GreaterThan        Comparison = "GREATER_THAN"
	GreaterThanOrEqual Comparison = "GREATER_THAN_OR_EQUAL"
	LessThan           Comparison = "LESS_THAN"
	LessThanOrEqual    Comparison = "LESS_THAN_OR_EQUAL"
	Equal              Comparison = "EQUAL"
	NotEqual           Comparison = "NOT_EQUAL"
)

type AcquisitionMode string

const (
	Push AcquisitionMode = "PUSH"
	Pull AcquisitionMode = "PULL"
)

var (
	ErrInvalidDefinition = errors.New("invalid fitness-function definition")
	ErrInvalidTransition = errors.New("invalid lifecycle transition")
	ErrVersionConflict   = errors.New("fitness-function version conflict")
)

type Criterion struct {
	Key               string     `json:"key"`
	Description       string     `json:"description,omitempty"`
	Unit              string     `json:"unit"`
	WarningComparison Comparison `json:"warningComparison,omitempty"`
	WarningValue      *float64   `json:"warningValue,omitempty"`
	FailureComparison Comparison `json:"failureComparison"`
	FailureValue      float64    `json:"failureValue"`
	Required          bool       `json:"required"`
}

type MetricQuery struct {
	CriterionKey   string `json:"criterionKey"`
	Expression     string `json:"expression"`
	Mode           string `json:"mode"`
	LookbackSecond int    `json:"lookbackSeconds,omitempty"`
	StepSecond     int    `json:"stepSeconds,omitempty"`
	Reduction      string `json:"reduction"`
	SeriesPolicy   string `json:"seriesPolicy"`
	Unit           string `json:"unit"`
}

type Acquisition struct {
	Mode                        AcquisitionMode `json:"mode"`
	ProducerID                  string          `json:"producerId,omitempty"`
	MaximumObservationAgeSecond int             `json:"maximumObservationAgeSeconds,omitempty"`
	SourceID                    string          `json:"sourceId,omitempty"`
	Trigger                     string          `json:"trigger,omitempty"`
	IntervalSecond              int             `json:"intervalSeconds,omitempty"`
	TimeoutSecond               int             `json:"timeoutSeconds,omitempty"`
	Queries                     []MetricQuery   `json:"queries,omitempty"`
}

type Definition struct {
	Name            string      `json:"name"`
	Purpose         string      `json:"purpose"`
	Objective       string      `json:"objective"`
	Characteristic  string      `json:"characteristic,omitempty"`
	TargetIDs       []string    `json:"targetIds"`
	Criteria        []Criterion `json:"criteria"`
	Acquisition     Acquisition `json:"acquisition"`
	FreshnessSecond int         `json:"freshnessSeconds"`
	Enforcement     Enforcement `json:"enforcement"`
	ChangeRationale string      `json:"changeRationale,omitempty"`
}

func (d Definition) Validate(ownerTargetIDs []string) error {
	if strings.TrimSpace(d.Name) == "" || strings.TrimSpace(d.Purpose) == "" || strings.TrimSpace(d.Objective) == "" {
		return fmt.Errorf("%w: name, purpose, and objective are required", ErrInvalidDefinition)
	}
	if len(d.TargetIDs) == 0 || len(d.Criteria) == 0 {
		return fmt.Errorf("%w: at least one target and criterion are required", ErrInvalidDefinition)
	}
	if d.FreshnessSecond < 1 {
		return fmt.Errorf("%w: freshness must be positive", ErrInvalidDefinition)
	}
	if d.Enforcement != Observe && d.Enforcement != Warn && d.Enforcement != Block {
		return fmt.Errorf("%w: unsupported enforcement", ErrInvalidDefinition)
	}
	owned := make(map[string]bool, len(ownerTargetIDs))
	for _, id := range ownerTargetIDs {
		owned[id] = true
	}
	for _, id := range d.TargetIDs {
		if id == "" || !owned[id] {
			return fmt.Errorf("%w: target %q is not owned by squad", ErrInvalidDefinition, id)
		}
	}
	keys := map[string]bool{}
	for _, c := range d.Criteria {
		if err := c.Validate(); err != nil {
			return err
		}
		if keys[c.Key] {
			return fmt.Errorf("%w: duplicate criterion %q", ErrInvalidDefinition, c.Key)
		}
		keys[c.Key] = true
	}
	return d.Acquisition.validate(keys, d.Criteria)
}

func (c Criterion) Validate() error {
	if strings.TrimSpace(c.Key) == "" || strings.TrimSpace(c.Unit) == "" || !finite(c.FailureValue) || !validComparison(c.FailureComparison) {
		return fmt.Errorf("%w: invalid criterion %q", ErrInvalidDefinition, c.Key)
	}
	if (c.WarningComparison == "") != (c.WarningValue == nil) {
		return fmt.Errorf("%w: warning comparison and value must be supplied together", ErrInvalidDefinition)
	}
	if c.WarningValue != nil && (!finite(*c.WarningValue) || !validComparison(c.WarningComparison)) {
		return fmt.Errorf("%w: invalid warning threshold", ErrInvalidDefinition)
	}
	return nil
}

func (a Acquisition) validate(keys map[string]bool, criteria []Criterion) error {
	switch a.Mode {
	case Push:
		if a.ProducerID == "" || a.MaximumObservationAgeSecond < 1 || a.SourceID != "" || len(a.Queries) != 0 {
			return fmt.Errorf("%w: invalid push acquisition", ErrInvalidDefinition)
		}
	case Pull:
		if a.SourceID == "" || a.ProducerID != "" || a.TimeoutSecond < 1 || len(a.Queries) == 0 {
			return fmt.Errorf("%w: invalid pull acquisition", ErrInvalidDefinition)
		}
		if a.Trigger != "SCHEDULED" && a.Trigger != "ON_DEMAND" {
			return fmt.Errorf("%w: invalid pull trigger", ErrInvalidDefinition)
		}
		if a.Trigger == "SCHEDULED" && a.IntervalSecond < 60 {
			return fmt.Errorf("%w: scheduled interval must be at least 60 seconds", ErrInvalidDefinition)
		}
		mapped := map[string]bool{}
		for _, q := range a.Queries {
			if !keys[q.CriterionKey] || strings.TrimSpace(q.Expression) == "" || mapped[q.CriterionKey] {
				return fmt.Errorf("%w: invalid query mapping %q", ErrInvalidDefinition, q.CriterionKey)
			}
			criterion, _ := findCriterion(criteria, q.CriterionKey)
			if q.Unit != criterion.Unit || !validQuery(q) {
				return fmt.Errorf("%w: invalid query for %q", ErrInvalidDefinition, q.CriterionKey)
			}
			mapped[q.CriterionKey] = true
		}
		for _, criterion := range criteria {
			if criterion.Required && !mapped[criterion.Key] {
				return fmt.Errorf("%w: required criterion %q is not mapped", ErrInvalidDefinition, criterion.Key)
			}
		}
	default:
		return fmt.Errorf("%w: unsupported acquisition mode", ErrInvalidDefinition)
	}
	return nil
}

func validQuery(q MetricQuery) bool {
	if q.Mode != "INSTANT" && q.Mode != "RANGE" {
		return false
	}
	if q.Mode == "RANGE" && (q.LookbackSecond < 1 || q.StepSecond < 1) {
		return false
	}
	return slices.Contains([]string{"LAST", "MIN", "MAX", "AVERAGE", "SUM", "COUNT"}, q.Reduction) &&
		slices.Contains([]string{"REQUIRE_SINGLE_SERIES", "REDUCE_ACROSS_SERIES", "ERROR_ON_MULTIPLE_SERIES"}, q.SeriesPolicy)
}

func validComparison(c Comparison) bool {
	return slices.Contains([]Comparison{GreaterThan, GreaterThanOrEqual, LessThan, LessThanOrEqual, Equal, NotEqual}, c)
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

type Version struct {
	Number      int          `json:"number"`
	State       VersionState `json:"state"`
	Definition  Definition   `json:"definition"`
	CreatedAt   time.Time    `json:"createdAt"`
	ActivatedAt *time.Time   `json:"activatedAt,omitempty"`
}

type Function struct {
	ID            string    `json:"id"`
	OwnerSquadID  string    `json:"ownerSquadId"`
	Lifecycle     Lifecycle `json:"lifecycle"`
	Revision      int       `json:"revision"`
	ActiveVersion int       `json:"activeVersion,omitempty"`
	Versions      []Version `json:"versions"`
}

func New(id, squadID string, definition Definition, ownedTargets []string, now time.Time) (*Function, error) {
	if id == "" || squadID == "" {
		return nil, fmt.Errorf("%w: identity is required", ErrInvalidDefinition)
	}
	if err := definition.Validate(ownedTargets); err != nil {
		return nil, err
	}
	return &Function{
		ID: id, OwnerSquadID: squadID, Lifecycle: Draft, Revision: 1,
		Versions: []Version{{Number: 1, State: VersionDraft, Definition: definition, CreatedAt: now}},
	}, nil
}

func (f *Function) AddVersion(definition Definition, ownedTargets []string, expectedRevision int, now time.Time) (int, error) {
	if f.Lifecycle == Retired {
		return 0, ErrInvalidTransition
	}
	if f.Revision != expectedRevision {
		return 0, ErrVersionConflict
	}
	if err := definition.Validate(ownedTargets); err != nil {
		return 0, err
	}
	number := len(f.Versions) + 1
	f.Versions = append(f.Versions, Version{Number: number, State: VersionDraft, Definition: definition, CreatedAt: now})
	f.Revision++
	return number, nil
}

func (f *Function) UpdateDraft(number, expectedRevision int, definition Definition, ownedTargets []string) error {
	if f.Revision != expectedRevision {
		return ErrVersionConflict
	}
	if err := definition.Validate(ownedTargets); err != nil {
		return err
	}
	v, ok := f.version(number)
	if !ok || v.State != VersionDraft {
		return ErrInvalidTransition
	}
	v.Definition = definition
	f.Revision++
	return nil
}

func (f *Function) Activate(number int, now time.Time) error {
	if f.Lifecycle == Retired {
		return ErrInvalidTransition
	}
	target, ok := f.version(number)
	if !ok || target.State != VersionDraft {
		return ErrInvalidTransition
	}
	if f.ActiveVersion > 0 {
		current, _ := f.version(f.ActiveVersion)
		current.State = VersionSuperseded
	}
	target.State = VersionActive
	target.ActivatedAt = &now
	f.ActiveVersion = number
	f.Lifecycle = Active
	f.Revision++
	return nil
}

func (f *Function) Retire() error {
	if f.Lifecycle == Retired {
		return ErrInvalidTransition
	}
	f.Lifecycle = Retired
	f.Revision++
	return nil
}

func (f *Function) ActiveDefinition() (Definition, bool) {
	v, ok := f.version(f.ActiveVersion)
	if !ok || v.State != VersionActive {
		return Definition{}, false
	}
	return v.Definition, true
}

func (f *Function) version(number int) (*Version, bool) {
	for i := range f.Versions {
		if f.Versions[i].Number == number {
			return &f.Versions[i], true
		}
	}
	return nil, false
}

func findCriterion(criteria []Criterion, key string) (Criterion, bool) {
	for _, criterion := range criteria {
		if criterion.Key == key {
			return criterion, true
		}
	}
	return Criterion{}, false
}
