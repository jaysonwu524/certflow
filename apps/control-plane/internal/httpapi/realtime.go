package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/regenbio/certflow/apps/control-plane/internal/domain"
	"github.com/regenbio/certflow/apps/control-plane/internal/store"
)

const realtimeHeartbeatInterval = 20 * time.Second
const realtimeRetention = 30 * 24 * time.Hour

type realtimeSubscriber struct {
	actor  store.Actor
	events chan domain.RealtimeEvent
}

// realtimeHub is intentionally process-local. PostgreSQL LISTEN/NOTIFY fans
// database events into every API instance, while the hub handles its local SSE
// connections without polling once per browser.
type realtimeHub struct {
	mu          sync.RWMutex
	nextID      uint64
	subscribers map[uint64]realtimeSubscriber
}

func newRealtimeHub() *realtimeHub {
	return &realtimeHub{subscribers: make(map[uint64]realtimeSubscriber)}
}

func (h *realtimeHub) subscribe(actor store.Actor) (<-chan domain.RealtimeEvent, func()) {
	h.mu.Lock()
	id := h.nextID
	h.nextID++
	channel := make(chan domain.RealtimeEvent, 32)
	h.subscribers[id] = realtimeSubscriber{actor: actor, events: channel}
	h.mu.Unlock()
	return channel, func() {
		h.mu.Lock()
		delete(h.subscribers, id)
		h.mu.Unlock()
	}
}

func (h *realtimeHub) publish(event domain.RealtimeEvent) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, subscriber := range h.subscribers {
		if subscriber.actor.Role != "admin" && subscriber.actor.ID != event.OwnerUserID {
			continue
		}
		select {
		case subscriber.events <- event:
		default:
			// The browser can replay from its cursor after reconnecting. Never let
			// an inactive SSE client stall database event delivery for other users.
		}
	}
}

func (s *Server) RunRealtime(ctx context.Context, logger *slog.Logger) {
	go s.pruneRealtimeEvents(ctx, logger)
	go s.runNotificationDeliveries(ctx, logger)
	for {
		err := s.store.ListenRealtimeEvents(ctx, s.realtime.publish)
		if ctx.Err() != nil {
			return
		}
		logger.Warn("realtime event relay disconnected", "error", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func (s *Server) pruneRealtimeEvents(ctx context.Context, logger *slog.Logger) {
	prune := func() {
		cleanupCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		if _, err := s.store.PruneRealtimeEvents(cleanupCtx, time.Now().Add(-realtimeRetention)); err != nil && cleanupCtx.Err() == nil {
			logger.Warn("prune realtime events", "error", err)
		}
	}
	prune()
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			prune()
		}
	}
}

func (s *Server) streamEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming_unsupported", "response streaming is not supported")
		return
	}
	actor := actor(r)
	cursor := eventCursor(r)
	events, unsubscribe := s.realtime.subscribe(actor)
	defer unsubscribe()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	if cursor > 0 {
		pending, err := s.store.ListRealtimeEvents(r.Context(), cursor, 100)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "realtime_events_unavailable", "could not load realtime events")
			return
		}
		for _, event := range pending {
			if event.ID > cursor {
				writeRealtimeEvent(w, event)
				cursor = event.ID
			}
		}
	} else {
		latest, err := s.store.LatestRealtimeEventID(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "realtime_events_unavailable", "could not initialize realtime events")
			return
		}
		cursor = latest
	}
	_, _ = fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	heartbeat := time.NewTicker(realtimeHeartbeatInterval)
	defer heartbeat.Stop()
	for {
		select {
		case <-s.streamCtx.Done():
			return
		case <-r.Context().Done():
			return
		case event := <-events:
			if event.ID <= cursor {
				continue
			}
			writeRealtimeEvent(w, event)
			cursor = event.ID
			flusher.Flush()
		case <-heartbeat.C:
			_, _ = fmt.Fprint(w, ": heartbeat\n\n")
			flusher.Flush()
		}
	}
}

func eventCursor(r *http.Request) int64 {
	value := r.Header.Get("Last-Event-ID")
	if value == "" {
		value = r.URL.Query().Get("after")
	}
	cursor, err := strconv.ParseInt(value, 10, 64)
	if err != nil || cursor < 0 {
		return 0
	}
	return cursor
}

func writeRealtimeEvent(w http.ResponseWriter, event domain.RealtimeEvent) {
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}
	_, _ = fmt.Fprintf(w, "id: %d\nevent: update\ndata: %s\n\n", event.ID, payload)
}
