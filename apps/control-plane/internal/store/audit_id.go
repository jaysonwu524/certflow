package store

import "github.com/regenbio/certflow/apps/control-plane/internal/id"

func newUUID() string { return id.New() }
