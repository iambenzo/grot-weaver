package catalogue

import (
	"embed"
	"io/fs"
)

//go:embed data/*.json
var embeddedData embed.FS

func LoadEmbedded() (*Catalogue, error) {
	data, err := fs.Sub(embeddedData, "data")
	if err != nil {
		return nil, err
	}
	return Load(data)
}
