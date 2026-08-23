package migrations

import "embed"

// Files contains the versioned PostgreSQL schema used by the API and worker.
//
//go:embed *.sql
var Files embed.FS
