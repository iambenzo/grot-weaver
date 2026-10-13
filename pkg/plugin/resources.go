package plugin

import (
	"encoding/json"
	"net/http"
)

func (a *App) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /catalogue", a.handleCatalogue)
	mux.HandleFunc("GET /catalogue/name-forms", a.handleNameForms)
	mux.HandleFunc("POST /score", a.handleScore)
}

func (a *App) handleCatalogue(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.catalogue.Summary())
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
