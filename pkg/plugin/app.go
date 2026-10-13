package plugin

import (
	"context"
	"fmt"
	"net/http"
	"sync"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"

	"github.com/iambenzo/otel-semconv-compliance/pkg/assessment"
	"github.com/iambenzo/otel-semconv-compliance/pkg/catalogue"
	"github.com/iambenzo/otel-semconv-compliance/pkg/nameindex"
)

var (
	_ backend.CallResourceHandler   = (*App)(nil)
	_ instancemgmt.InstanceDisposer = (*App)(nil)
	_ backend.CheckHealthHandler    = (*App)(nil)
)

var loadEmbeddedCatalogue = sync.OnceValues(catalogue.LoadEmbedded)

type App struct {
	backend.CallResourceHandler
	catalogue   *catalogue.Catalogue
	metricIndex *nameindex.MetricIndex
	assessor    *assessment.Assessor
}

func NewApp(_ context.Context, _ backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	loaded, err := loadEmbeddedCatalogue()
	if err != nil {
		return nil, fmt.Errorf("load embedded catalogue: %w", err)
	}
	return newApp(loaded), nil
}

func newApp(loaded *catalogue.Catalogue) *App {
	app := &App{
		catalogue:   loaded,
		metricIndex: nameindex.NewMetricIndex(loaded),
		assessor:    assessment.NewAssessor(loaded, nil),
	}
	mux := http.NewServeMux()
	app.registerRoutes(mux)
	app.CallResourceHandler = httpadapter.New(mux)
	return app
}

func (a *App) Dispose() {}

func (a *App) CheckHealth(_ context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	manifest := a.catalogue.Manifest
	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: fmt.Sprintf("catalogue loaded: semconv %s, genai %s", manifest.Semconv.Version, manifest.GenAI.CommittedAt),
	}, nil
}
