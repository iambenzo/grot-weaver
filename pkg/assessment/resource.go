package assessment

import (
	"cmp"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/iambenzo/otel-semconv-compliance/pkg/finding"
	"github.com/iambenzo/otel-semconv-compliance/pkg/scoring"
)

const (
	MaxRequiredResourceAttributes = 50

	attributeServiceName       = "service.name"
	attributeServiceNamespace  = "service.namespace"
	attributeServiceInstanceID = "service.instance.id"

	presenceLabelPrefix = "semconv_has_"
)

var invalidLabelCharacters = regexp.MustCompile(`[^a-zA-Z0-9_]`)

var DefaultRequiredResourceAttributes = []string{
	attributeServiceName, attributeServiceNamespace, attributeServiceInstanceID, "deployment.environment.name",
}

type PresenceState string

const (
	PresencePresent PresenceState = "present"
	PresenceMissing PresenceState = "missing"
	PresenceUnknown PresenceState = "unknown"
)

type ResourceAttributeCheck struct {
	scoring.Key
	Attribute string        `json:"attribute"`
	State     PresenceState `json:"state"`
	Evidence  string        `json:"evidence"`
}

type observedResource struct {
	keys          map[string]string
	authoritative map[string]bool
	complete      bool
	where         string
	unknownReason string
}

func newObservedResource(where, unknownReason string, complete bool) *observedResource {
	return &observedResource{keys: map[string]string{}, authoritative: map[string]bool{}, complete: complete, where: where, unknownReason: unknownReason}
}

func (o *observedResource) see(key, evidence string) {
	if _, seen := o.keys[key]; !seen {
		o.keys[key] = evidence
	}
}

func (o *observedResource) settle(attribute, evidence string, present bool) {
	o.authoritative[attribute] = true
	if present {
		o.see(attribute, evidence)
	}
}

func (o *observedResource) merge(other *observedResource) {
	for key, evidence := range other.keys {
		o.see(key, evidence)
	}
	for attribute := range other.authoritative {
		o.authoritative[attribute] = true
	}
	if other.complete && !o.complete {
		o.complete, o.where = true, other.where
	}
}

func (o *observedResource) lookup(attribute string) (string, bool) {
	for _, form := range keyForms(attribute) {
		if evidence, seen := o.keys[form]; seen {
			return evidence, true
		}
	}
	return "", false
}

func keyForms(attribute string) []string {
	underscored := strings.ReplaceAll(attribute, ".", "_")
	if underscored == attribute {
		return []string{attribute}
	}
	return []string{attribute, underscored}
}

type resourceCollector struct {
	observed map[scoring.Key]*observedResource
}

func (c *resourceCollector) observe(owner finding.Owner, signal finding.Signal, observed *observedResource) {
	if owner.Kind != finding.OwnerService {
		return
	}
	if c.observed == nil {
		c.observed = map[scoring.Key]*observedResource{}
	}
	key := scoring.Key{Owner: owner, Signal: signal}
	if existing, seen := c.observed[key]; seen {
		existing.merge(observed)
		return
	}
	c.observed[key] = observed
}

func (c *resourceCollector) sortedKeys() []scoring.Key {
	keys := make([]scoring.Key, 0, len(c.observed))
	for key := range c.observed {
		keys = append(keys, key)
	}
	slices.SortFunc(keys, func(a, b scoring.Key) int {
		return cmp.Or(cmp.Compare(a.Owner.Namespace, b.Owner.Namespace), cmp.Compare(a.Owner.Name, b.Owner.Name), cmp.Compare(a.Signal, b.Signal))
	})
	return keys
}

func (c *resourceCollector) checks(required []string, renamedFrom map[string][]string) []ResourceAttributeCheck {
	checks := []ResourceAttributeCheck{}
	for _, key := range c.sortedKeys() {
		for _, attribute := range required {
			state, evidence := c.observed[key].judge(attribute, renamedFrom[attribute])
			checks = append(checks, ResourceAttributeCheck{Key: key, Attribute: attribute, State: state, Evidence: evidence})
		}
	}
	return checks
}

func (o *observedResource) judge(attribute string, deprecatedNames []string) (PresenceState, string) {
	if evidence, present := o.lookup(attribute); present {
		return PresencePresent, evidence
	}
	if !o.complete && !o.authoritative[attribute] {
		return PresenceUnknown, o.unknownReason
	}
	for _, deprecated := range deprecatedNames {
		if _, present := o.lookup(deprecated); present {
			return PresenceMissing, fmt.Sprintf("only the deprecated %s was found in %s", deprecated, o.where)
		}
	}
	return PresenceMissing, "not found in " + o.where
}

func (o *observedResource) judgeAny(names []string) PresenceState {
	if slices.ContainsFunc(names, o.has) {
		return PresencePresent
	}
	if o.complete || !slices.ContainsFunc(names, o.unsettled) {
		return PresenceMissing
	}
	return PresenceUnknown
}

func (o *observedResource) has(name string) bool {
	_, present := o.lookup(name)
	return present
}

func (o *observedResource) unsettled(name string) bool {
	return !o.authoritative[name]
}

func presenceChecks(checks []ResourceAttributeCheck) []scoring.PresenceCheck {
	presence := make([]scoring.PresenceCheck, 0, len(checks))
	for _, check := range checks {
		if check.State == PresenceUnknown {
			continue
		}
		presence = append(presence, scoring.PresenceCheck{Owner: check.Owner, Signal: check.Signal, Present: check.State == PresencePresent})
	}
	return presence
}

func (inv Inventory) RequiredAttributes() []string {
	if inv.RequiredResourceAttributes == nil {
		return DefaultRequiredResourceAttributes
	}
	return inv.RequiredResourceAttributes
}

func validateRequiredAttributes(attributes []string) error {
	if len(attributes) > MaxRequiredResourceAttributes {
		return fmt.Errorf("%w: %d required resource attributes exceeds %d", ErrInvalidInventory, len(attributes), MaxRequiredResourceAttributes)
	}
	for _, attribute := range attributes {
		if attribute == "" || len(attribute) > MaxNameLength {
			return fmt.Errorf("%w: empty or overlong required resource attribute", ErrInvalidInventory)
		}
	}
	return nil
}

func traceResource(service TraceService) *observedResource {
	observed := newObservedResource("the trace resource attributes", "no trace resource attributes were collected", len(service.ResourceKeys) > 0)
	observed.settle(attributeServiceName, "service.name resource attribute", service.ServiceName != "")
	observed.settle(attributeServiceNamespace, "service.namespace resource attribute", service.ServiceNamespace != "")
	for _, key := range service.ResourceKeys {
		observed.see(key.Key, key.Key+" resource attribute")
	}
	return observed
}

func metricResource(owner finding.Owner, labels, target map[string]string, checkedOnSeries []string) *observedResource {
	observed := newObservedResource("the series labels and target_info", "not promoted to series labels and no target_info series for this service", target != nil)
	observed.settle(attributeServiceName, "job or service_name label", true)
	observed.settle(attributeServiceNamespace, "job prefix or service_namespace label", owner.Namespace != "" || labels["service_namespace"] != "")
	for _, attribute := range checkedOnSeries {
		label := promLabelName(attribute)
		observed.settle(attribute, label+" label on series", labels[presenceLabelPrefix+label] != "")
	}
	if target == nil {
		return observed
	}
	if target["instance"] != "" {
		observed.see(attributeServiceInstanceID, "instance label")
	}
	for key, value := range target {
		if value != "" {
			observed.see(key, key+" label on target_info")
		}
	}
	return observed
}

func promLabelName(attribute string) string {
	return invalidLabelCharacters.ReplaceAllString(attribute, "_")
}

func logResource(service LogService) *observedResource {
	complete := service.KeysMethod == MethodDetectedFields || service.SampledLines > 0
	observed := newObservedResource("the log stream labels and structured metadata", "no log lines were sampled for this service", complete)
	observed.settle(attributeServiceName, "service_name stream label", true)
	observed.settle(attributeServiceNamespace, "service_namespace label", service.ServiceNamespace != "")
	for _, key := range service.StreamLabels {
		observed.see(key, key+" stream label")
	}
	for _, key := range service.MetadataKeys {
		observed.see(key, key+" structured metadata")
	}
	return observed
}
