package store

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"time"
)

// AuditEvent is intentionally metadata-only. Request bodies are never stored,
// which prevents credentials and private keys from entering the audit trail.
type AuditEvent struct {
	ActorSubject string
	Action       string
	ResourceType string
	ResourceID   string
	RequestID    string
	SourceIP     string
	Summary      map[string]any
}

func (s *Store) RecordAuditEvent(ctx context.Context, event AuditEvent) error {
	if strings.TrimSpace(event.ActorSubject) == "" || strings.TrimSpace(event.Action) == "" {
		return fmt.Errorf("audit actor and action are required")
	}
	if event.Summary == nil {
		event.Summary = map[string]any{}
	}
	summary, err := json.Marshal(event.Summary)
	if err != nil {
		return fmt.Errorf("encode audit summary: %w", err)
	}
	var sourceIP any
	if parsed := net.ParseIP(strings.TrimSpace(event.SourceIP)); parsed != nil {
		sourceIP = parsed.String()
	}
	if len(event.RequestID) > 128 {
		event.RequestID = event.RequestID[:128]
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO audit_events (id, actor_subject, action, resource_type, resource_id, request_id, source_ip, summary, created_at)
		VALUES ($1, $2, $3, $4, NULLIF($5, '')::uuid, $6, $7, $8::jsonb, $9)
	`, newAuditID(), event.ActorSubject, event.Action, event.ResourceType, event.ResourceID, event.RequestID, sourceIP, summary, time.Now().UTC())
	return err
}

// Kept local to avoid coupling audit persistence to public resource ID helpers.
func newAuditID() string {
	// UUID generation is delegated to the existing package through the store's
	// ID helper in the implementation file to keep this file dependency-light.
	return newUUID()
}
