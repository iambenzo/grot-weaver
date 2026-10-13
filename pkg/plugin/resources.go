package plugin

import (
	"encoding/json"
	"net/http"
)

func (a *App) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /catalogue", a.handleCatalogue)
	mux.HandleFunc("GET /catalogue/name-forms", a.handleNameForms)
	mux.HandleFunc("GET /catalogue/span-groups", a.handleSpanGroups)
	mux.HandleFunc("POST /catalogue/metric-matches", a.handleMetricMatches)
	mux.HandleFunc("POST /score", a.handleScore)
	mux.HandleFunc("POST /fix-snippet", a.handleFixSnippet)
}

func (a *App) handleCatalogue(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.catalogue.Summary())
}

func (a *App) handleSpanGroups(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.catalogue.SpanGroupRules())
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	encoded, err := json.Marshal(body)
	if err != nil {
		http.Error(w, "encode response", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(encoded)
}
