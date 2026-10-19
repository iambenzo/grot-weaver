package plugin

import (
	"encoding/json"
	"net/http"

	"github.com/iambenzo/grot-weaver/pkg/product"
)

func (a *App) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /catalogue", a.handleCatalogue)
	mux.HandleFunc("GET /catalogue/name-forms", a.handleNameForms)
	mux.HandleFunc("GET /catalogue/span-groups", a.handleSpanGroups)
	mux.HandleFunc("GET /catalogue/renamed-attributes", a.handleRenamedAttributes)
	mux.HandleFunc("GET /products", a.handleProducts)
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

func (a *App) handleRenamedAttributes(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.catalogue.RenamedFrom())
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

func (a *App) handleProducts(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, product.Products)
}
