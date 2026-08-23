package api

import _ "embed"

// OpenAPI is the exact contract used to generate the transport types.
//
//go:embed openapi.yaml
var OpenAPI []byte
