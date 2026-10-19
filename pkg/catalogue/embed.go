package catalogue

import "embed"

//go:embed data/*.json
var embeddedData embed.FS

func LoadEmbedded() (*Catalogue, error) {
	return Load(func(name string) ([]byte, error) {
		return embeddedData.ReadFile("data/" + name)
	})
}
