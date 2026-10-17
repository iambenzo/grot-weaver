package plugin

import (
	"compress/gzip"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/iambenzo/otel-semconv-compliance/pkg/assessment"
	"github.com/iambenzo/otel-semconv-compliance/pkg/scoring"
)

const (
	maxScoreRequestBytes        = 16 << 20
	maxDecodedScoreRequestBytes = 128 << 20
	gzipEncoding                = "gzip"
)

type scoreRequest struct {
	Inventory      assessment.Inventory `json:"inventory"`
	VolumeWeighted bool                 `json:"volume_weighted"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func (a *App) handleScore(w http.ResponseWriter, req *http.Request) {
	body, err := scoreBody(w, req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "decode request: " + err.Error()})
		return
	}
	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	var request scoreRequest
	if err := decoder.Decode(&request); err != nil {
		writeJSON(w, decodeStatus(err), errorResponse{Error: "decode request: " + err.Error()})
		return
	}
	if err := requireEnd(decoder); err != nil {
		writeJSON(w, decodeStatus(err), errorResponse{Error: "decode request: " + err.Error()})
		return
	}
	if err := request.Inventory.Validate(); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: err.Error()})
		return
	}
	result := a.assessor.Assess(request.Inventory, scoring.Options{VolumeWeighted: request.VolumeWeighted})
	writeCompressibleJSON(w, req, http.StatusOK, result)
}

func scoreBody(w http.ResponseWriter, req *http.Request) (io.Reader, error) {
	wire := http.MaxBytesReader(w, req.Body, maxScoreRequestBytes)
	if !strings.EqualFold(strings.TrimSpace(req.Header.Get("Content-Encoding")), gzipEncoding) {
		return wire, nil
	}
	unzipped, err := gzip.NewReader(wire)
	if err != nil {
		return nil, err
	}
	return http.MaxBytesReader(w, io.NopCloser(unzipped), maxDecodedScoreRequestBytes), nil
}

func requireEnd(decoder *json.Decoder) error {
	var extra json.RawMessage
	err := decoder.Decode(&extra)
	if err == io.EOF {
		return nil
	}
	if err != nil {
		return err
	}
	return errors.New("unexpected data after the request body")
}

func acceptsGzip(header string) bool {
	wildcard := false
	for _, coding := range strings.Split(header, ",") {
		name, params, _ := strings.Cut(coding, ";")
		name = strings.TrimSpace(name)
		if strings.EqualFold(name, gzipEncoding) {
			return quality(params) > 0
		}
		if name == "*" {
			wildcard = quality(params) > 0
		}
	}
	return wildcard
}

func quality(params string) float64 {
	for _, param := range strings.Split(params, ";") {
		key, value, _ := strings.Cut(strings.TrimSpace(param), "=")
		if !strings.EqualFold(strings.TrimSpace(key), "q") {
			continue
		}
		parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err != nil {
			return 0
		}
		return parsed
	}
	return 1
}

func writeCompressibleJSON(w http.ResponseWriter, req *http.Request, status int, body any) {
	w.Header().Add("Vary", "Accept-Encoding")
	if !acceptsGzip(req.Header.Get("Accept-Encoding")) {
		writeJSON(w, status, body)
		return
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		http.Error(w, "encode response", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Encoding", gzipEncoding)
	w.WriteHeader(status)
	zipped := gzip.NewWriter(w)
	_, _ = zipped.Write(encoded)
	_ = zipped.Close()
}

func decodeStatus(err error) int {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return http.StatusRequestEntityTooLarge
	}
	return http.StatusBadRequest
}
