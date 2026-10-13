package plugin

import (
	"encoding/json"
	"net/http"
)

const (
	maxMatchRequestBytes = 8 << 20
	maxMatchNames        = 100000
)

type metricMatchesRequest struct {
	Names []string `json:"names"`
}

type metricMatchesResponse struct {
	NeedsLabels []string `json:"needs_labels"`
}

func (a *App) handleMetricMatches(w http.ResponseWriter, req *http.Request) {
	decoder := json.NewDecoder(http.MaxBytesReader(w, req.Body, maxMatchRequestBytes))
	decoder.DisallowUnknownFields()
	var request metricMatchesRequest
	if err := decoder.Decode(&request); err != nil {
		writeJSON(w, decodeStatus(err), errorResponse{Error: "decode request: " + err.Error()})
		return
	}
	if len(request.Names) > maxMatchNames {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "too many names"})
		return
	}
	response := metricMatchesResponse{NeedsLabels: []string{}}
	for _, name := range request.Names {
		if a.metricIndex.Match(name).Matched {
			response.NeedsLabels = append(response.NeedsLabels, name)
			continue
		}
		if _, near := a.metricIndex.NearMiss(name); near {
			response.NeedsLabels = append(response.NeedsLabels, name)
		}
	}
	writeJSON(w, http.StatusOK, response)
}
