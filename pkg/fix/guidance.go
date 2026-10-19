package fix

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/iambenzo/grot-weaver/pkg/catalogue"
	"github.com/iambenzo/grot-weaver/pkg/finding"
)

const (
	optInVariable       = "OTEL_SEMCONV_STABILITY_OPT_IN"
	attributeDocsURL    = "https://opentelemetry.io/docs/specs/semconv/registry/attributes/%s/"
	coreModelURL        = "https://github.com/open-telemetry/semantic-conventions/tree/%s/model/%s"
	genAIModelURL       = "https://github.com/open-telemetry/semantic-conventions-genai/tree/%s/model"
	jsHTTPLibrary       = "@opentelemetry/instrumentation-http"
	jsHTTPSource        = "https://github.com/open-telemetry/opentelemetry-js/blob/main/experimental/packages/opentelemetry-instrumentation-http/README.md"
	pythonScopePrefix   = "opentelemetry.instrumentation."
	pythonSource        = "https://github.com/open-telemetry/opentelemetry-python-contrib/blob/main/opentelemetry-instrumentation/src/opentelemetry/instrumentation/_semconv.py"
	pythonStatusSource  = "https://github.com/open-telemetry/opentelemetry-python-contrib/blob/main/instrumentation/README.md"
	semconvMigrationURL = "https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/"
)

var docsSlugs = map[string]string{"hw": "hardware", "oracle": "oracledb"}

var modelSlugs = map[string]string{"hw": "hardware"}

var genAIModelDirs = map[string]bool{"gen-ai": true, "mcp": true, "openai": true}

var httpNamespaces = map[string]bool{"http": true, "url": true, "server": true, "client": true, "network": true, "user_agent": true, "net": true}

var pythonMigrationInstrumentations = map[string]string{
	"aiohttp_client": "http", "aiohttp_server": "http", "asgi": "http", "falcon": "http", "fastapi": "http", "flask": "http",
	"httpx": "http", "pyramid": "http", "requests": "http", "tornado": "http", "urllib": "http", "urllib3": "http", "wsgi": "http",
	"aiopg": "database", "asyncpg": "database", "cassandra": "database", "dbapi": "database", "mysql": "database",
	"mysqlclient": "database", "psycopg": "database", "psycopg2": "database", "pymemcache": "database", "pymongo": "database",
	"pymssql": "database", "pymysql": "database", "redis": "database", "sqlalchemy": "database", "sqlite3": "database",
	"tortoiseorm": "database",
}

type Library struct {
	Name    string `json:"name"`
	Version string `json:"version,omitempty"`
}

type Versions struct {
	Semconv     string
	GenAICommit string
}

type OptIn struct {
	Variable string   `json:"variable"`
	Value    string   `json:"value"`
	Note     string   `json:"note"`
	Sources  []string `json:"sources"`
}

type Guidance struct {
	Library  *Library `json:"library,omitempty"`
	Expected string   `json:"expected,omitempty"`
	DocsURL  string   `json:"docs_url,omitempty"`
	OptIn    *OptIn   `json:"opt_in,omitempty"`
}

func Instrumentation(f finding.Finding, library *Library, versions Versions) Guidance {
	guidance := Guidance{Library: library, Expected: f.Expected}
	if f.Expected != "" {
		guidance.DocsURL = docsURL(f, versions)
	}
	if library != nil {
		guidance.OptIn = optIn(f, *library)
	}
	return guidance
}

func docsURL(f finding.Finding, versions Versions) string {
	root, _, _ := strings.Cut(f.Expected, ".")
	slug := strings.ReplaceAll(root, "_", "-")
	if f.Source == catalogue.SourceGenAI && versions.GenAICommit != "" {
		base := fmt.Sprintf(genAIModelURL, versions.GenAICommit)
		if genAIModelDirs[slug] {
			return base + "/" + slug
		}
		return base
	}
	if f.Signal == finding.SignalMetrics && f.Scope == "" {
		if mapped, ok := modelSlugs[root]; ok {
			slug = mapped
		}
		return fmt.Sprintf(coreModelURL, versions.Semconv, slug)
	}
	if mapped, ok := docsSlugs[root]; ok {
		slug = mapped
	}
	return fmt.Sprintf(attributeDocsURL, slug)
}

func optIn(f finding.Finding, library Library) *OptIn {
	if f.Type != finding.TypeDeprecated || f.Expected == "" {
		return nil
	}
	domain := domainOf(f.Expected)
	if library.Name == jsHTTPLibrary && domain == "http" && versionWithin(library.Version, [3]int{0, 54, 0}, [3]int{0, 220, 0}) {
		return &OptIn{
			Variable: optInVariable,
			Value:    "http/dup",
			Note:     fmt.Sprintf("%s %s supports %s (0.54.0 to 0.220.0). http/dup emits old and stable names together while dashboards move; http emits only the stable names. Later versions emit the stable names by default, so upgrading also fixes this.", library.Name, library.Version, optInVariable),
			Sources:  []string{jsHTTPSource, semconvMigrationURL},
		}
	}
	if instrumentation, ok := strings.CutPrefix(library.Name, pythonScopePrefix); ok {
		if supported := pythonMigrationInstrumentations[instrumentation]; supported != "" && supported == domain {
			return &OptIn{
				Variable: optInVariable,
				Value:    domain + "/dup",
				Note:     fmt.Sprintf("%s is in semconv migration status. %s/dup emits old and stable names together; %s emits only the stable names.", library.Name, domain, domain),
				Sources:  []string{pythonSource, pythonStatusSource, semconvMigrationURL},
			}
		}
	}
	return nil
}

func domainOf(name string) string {
	root, _, _ := strings.Cut(name, ".")
	switch {
	case httpNamespaces[root]:
		return "http"
	case root == "db":
		return "database"
	}
	return ""
}

func versionWithin(version string, lowest, highest [3]int) bool {
	parts, ok := semver(version)
	if !ok {
		return false
	}
	return compare(parts, lowest) >= 0 && compare(parts, highest) <= 0
}

func semver(version string) ([3]int, bool) {
	var parts [3]int
	fields := strings.Split(strings.TrimPrefix(version, "v"), ".")
	if len(fields) != 3 {
		return parts, false
	}
	for index, field := range fields {
		value, err := strconv.Atoi(field)
		if err != nil {
			return parts, false
		}
		parts[index] = value
	}
	return parts, true
}

func compare(a, b [3]int) int {
	for index := range a {
		if a[index] != b[index] {
			return a[index] - b[index]
		}
	}
	return 0
}
