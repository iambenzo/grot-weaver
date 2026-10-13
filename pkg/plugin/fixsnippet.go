package plugin

import (
	"encoding/json"
	"net/http"

	"github.com/iambenzo/otel-semconv-compliance/pkg/fix"
	"github.com/iambenzo/otel-semconv-compliance/pkg/scoring"
)

const maxFixRequestBytes = 1 << 20

type fixSnippetRequest struct {
	Finding scoring.RankedFinding `json:"finding"`
}

type fixSnippetResponse struct {
	PipelineRule fix.PipelineRule `json:"pipeline_rule"`
}

func (a *App) handleFixSnippet(w http.ResponseWriter, req *http.Request) {
	decoder := json.NewDecoder(http.MaxBytesReader(w, req.Body, maxFixRequestBytes))
	decoder.DisallowUnknownFields()
	var request fixSnippetRequest
	if err := decoder.Decode(&request); err != nil {
		writeJSON(w, decodeStatus(err), errorResponse{Error: "decode request: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, fixSnippetResponse{PipelineRule: fix.Rule(request.Finding.Finding, a.catalogue)})
}
