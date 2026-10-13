package plugin

import (
	"net/http"
	"slices"
)

type nameFormsResponse struct {
	Version string              `json:"semconv_version"`
	Stored  map[string][]string `json:"stored"`
}

func (a *App) handleNameForms(w http.ResponseWriter, _ *http.Request) {
	stored := a.metricIndex.StoredNames()
	response := nameFormsResponse{
		Version: a.catalogue.Manifest.Semconv.Version,
		Stored:  make(map[string][]string, len(stored)),
	}
	for name, forms := range stored {
		for _, form := range forms {
			if !slices.Contains(response.Stored[name], form.Metric.Name) {
				response.Stored[name] = append(response.Stored[name], form.Metric.Name)
			}
		}
	}
	writeJSON(w, http.StatusOK, response)
}
