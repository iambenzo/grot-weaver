package assessment

import (
	"fmt"
	"path"
	"slices"

	"github.com/iambenzo/otel-semconv-compliance/pkg/nameindex"
)

const (
	MaxMetricNames      = 100000
	MaxOwnersPerSource  = 200000
	MaxTargetInfoSeries = 50000
	MaxLabelsPerSet     = 500
)

type MetricDatasource struct {
	UID        string              `json:"uid"`
	Names      []string            `json:"names"`
	TargetInfo []map[string]string `json:"target_info"`
	Owners     []MetricOwner       `json:"owners"`
	LabelKeys  []OwnerLabelKeys    `json:"label_keys"`

	StrategyOverride nameindex.Strategy `json:"strategy_override,omitempty"`
}

type OwnerLabelKeys struct {
	Metric   string            `json:"metric"`
	Selector map[string]string `json:"selector"`
	Keys     []string          `json:"keys"`
}

type MetricOwner struct {
	Metric string            `json:"metric"`
	Labels map[string]string `json:"labels"`
	Series float64           `json:"series"`
}

type ReclassificationAction string

const (
	ActionExclude  ReclassificationAction = "exclude"
	ActionPipeline ReclassificationAction = "pipeline"
)

type ReclassificationRule struct {
	Pattern string                 `json:"pattern"`
	Action  ReclassificationAction `json:"action"`
}

var DefaultReclassification = []ReclassificationRule{
	{Pattern: "*:*", Action: ActionExclude},
	{Pattern: "traces_spanmetrics_*", Action: ActionExclude},
	{Pattern: "traces_service_graph_*", Action: ActionExclude},
	{Pattern: "traces_target_info", Action: ActionExclude},
	{Pattern: "target_info", Action: ActionExclude},
	{Pattern: "up", Action: ActionExclude},
	{Pattern: "scrape_*", Action: ActionExclude},
	{Pattern: "otelcol_*", Action: ActionPipeline},
	{Pattern: "otelcol.*", Action: ActionPipeline},
	{Pattern: "alloy_*", Action: ActionPipeline},
	{Pattern: "alloy.*", Action: ActionPipeline},
}

func Reclassify(metric string, rules []ReclassificationRule) (ReclassificationAction, bool) {
	for _, rule := range rules {
		if matched, _ := path.Match(rule.Pattern, metric); matched {
			return rule.Action, true
		}
	}
	return "", false
}

func validateReclassification(rules []ReclassificationRule) error {
	for _, rule := range rules {
		if _, err := path.Match(rule.Pattern, ""); err != nil {
			return fmt.Errorf("%w: reclassification pattern %q: %v", ErrInvalidInventory, rule.Pattern, err)
		}
		if rule.Action != ActionExclude && rule.Action != ActionPipeline {
			return fmt.Errorf("%w: reclassification action %q", ErrInvalidInventory, rule.Action)
		}
	}
	return nil
}

func (d MetricDatasource) validate() error {
	if d.UID == "" {
		return fmt.Errorf("%w: metric datasource without uid", ErrInvalidInventory)
	}
	if d.StrategyOverride != "" && !slices.Contains(nameindex.Strategies, d.StrategyOverride) {
		return fmt.Errorf("%w: unknown translation strategy %q", ErrInvalidInventory, d.StrategyOverride)
	}
	if len(d.Names) > MaxMetricNames || len(d.Owners) > MaxOwnersPerSource || len(d.TargetInfo) > MaxTargetInfoSeries {
		return fmt.Errorf("%w: metric datasource %s exceeds size limits", ErrInvalidInventory, d.UID)
	}
	for _, name := range d.Names {
		if name == "" || len(name) > MaxNameLength {
			return fmt.Errorf("%w: datasource %s has an empty or overlong metric name", ErrInvalidInventory, d.UID)
		}
	}
	for _, labels := range d.TargetInfo {
		if err := validateLabels(labels); err != nil {
			return fmt.Errorf("datasource %s target_info: %w", d.UID, err)
		}
	}
	if len(d.LabelKeys) > MaxOwnersPerSource {
		return fmt.Errorf("%w: metric datasource %s has too many label key sets", ErrInvalidInventory, d.UID)
	}
	for _, set := range d.LabelKeys {
		if set.Metric == "" || len(set.Keys) > MaxLabelsPerSet {
			return fmt.Errorf("%w: datasource %s has a malformed label key set", ErrInvalidInventory, d.UID)
		}
		if err := validateLabels(set.Selector); err != nil {
			return fmt.Errorf("datasource %s label keys of %s: %w", d.UID, set.Metric, err)
		}
		for _, key := range set.Keys {
			if key == "" || len(key) > MaxNameLength {
				return fmt.Errorf("%w: datasource %s has an empty or overlong label key", ErrInvalidInventory, d.UID)
			}
		}
	}
	for _, owner := range d.Owners {
		if owner.Metric == "" || owner.Series < 0 {
			return fmt.Errorf("%w: datasource %s has a malformed owner row", ErrInvalidInventory, d.UID)
		}
		if err := validateLabels(owner.Labels); err != nil {
			return fmt.Errorf("datasource %s owner of %s: %w", d.UID, owner.Metric, err)
		}
	}
	return nil
}

func validateLabels(labels map[string]string) error {
	if len(labels) > MaxLabelsPerSet {
		return fmt.Errorf("%w: label set has %d labels, limit %d", ErrInvalidInventory, len(labels), MaxLabelsPerSet)
	}
	for key, value := range labels {
		if key == "" || len(key) > MaxNameLength || len(value) > 4*MaxNameLength {
			return fmt.Errorf("%w: empty or overlong label", ErrInvalidInventory)
		}
	}
	return nil
}
