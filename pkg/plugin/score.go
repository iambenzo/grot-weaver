package plugin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/iambenzo/otel-semconv-compliance/pkg/assessment"
	"github.com/iambenzo/otel-semconv-compliance/pkg/scoring"
)

const maxScoreRequestBytes = 16 << 20

type scoreRequest struct {
	Inventory      assessment.Inventory `json:"inventory"`
	VolumeWeighted bool                 `json:"volume_weighted"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func (a *App) handleScore(w http.ResponseWriter, req *http.Request) {
	decoder := json.NewDecoder(http.MaxBytesReader(w, req.Body, maxScoreRequestBytes))
	decoder.DisallowUnknownFields()
	var request scoreRequest
	if err := decoder.Decode(&request); err != nil {
		writeJSON(w, decodeStatus(err), errorResponse{Error: "decode request: " + err.Error()})
		return
	}
	if err := request.Inventory.Validate(); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: err.Error()})
		return
	}
	result := a.assessor.Assess(request.Inventory, scoring.Options{VolumeWeighted: request.VolumeWeighted})
	writeJSON(w, http.StatusOK, result)
}

func decodeStatus(err error) int {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return http.StatusRequestEntityTooLarge
	}
	return http.StatusBadRequest
}
