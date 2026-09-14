package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/regenbio/certflow/internal/domain"
	"github.com/regenbio/certflow/internal/mailer"
	"github.com/regenbio/certflow/internal/store"
)

const notificationDeliveryLease = 30 * time.Second

type personalWebhookRequest struct {
	Enabled bool   `json:"enabled"`
	URL     string `json:"url"`
}

func (s *Server) getPersonalWebhook(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.GetPersonalWebhookSettings(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "webhook_settings_unavailable", "could not load webhook settings")
		return
	}
	result := personalWebhookRequest{Enabled: settings.Enabled}
	if settings.EndpointID != "" {
		value, err := s.box.Open("notification_endpoint", personalWebhookKey(actor(r).ID), settings.URLCiphertext)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "webhook_settings_unavailable", "could not load webhook settings")
			return
		}
		result.URL = string(value)
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) updatePersonalWebhook(w http.ResponseWriter, r *http.Request) {
	var input personalWebhookRequest
	if !decodeBody(w, r, &input) {
		return
	}
	input.URL = strings.TrimSpace(input.URL)
	settings, err := s.store.GetPersonalWebhookSettings(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "webhook_settings_unavailable", "could not load webhook settings")
		return
	}
	ciphertext := settings.URLCiphertext
	if input.URL != "" {
		if err := validateWebhookURL(input.URL); err != nil {
			writeError(w, http.StatusUnprocessableEntity, "invalid_webhook_url", err.Error())
			return
		}
		ciphertext, err = s.box.Seal("notification_endpoint", personalWebhookKey(actor(r).ID), []byte(input.URL))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "webhook_settings_save_failed", "could not save webhook settings")
			return
		}
	}
	if input.Enabled && len(ciphertext) == 0 {
		writeError(w, http.StatusUnprocessableEntity, "invalid_webhook_url", "a webhook URL is required when notifications are enabled")
		return
	}
	if err := s.store.SavePersonalWebhookSettings(r.Context(), input.Enabled, ciphertext); err != nil {
		writeError(w, http.StatusInternalServerError, "webhook_settings_save_failed", "could not save webhook settings")
		return
	}
	writeJSON(w, http.StatusOK, personalWebhookRequest{Enabled: input.Enabled, URL: input.URL})
}

func (s *Server) testPersonalWebhook(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.GetPersonalWebhookSettings(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "webhook_settings_unavailable", "could not load webhook settings")
		return
	}
	if !settings.Enabled || settings.EndpointID == "" {
		writeError(w, http.StatusUnprocessableEntity, "webhook_not_configured", "enable and save a webhook before sending a test")
		return
	}
	webhookURL, err := s.box.Open("notification_endpoint", personalWebhookKey(actor(r).ID), settings.URLCiphertext)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "webhook_settings_unavailable", "could not load webhook settings")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	event := domain.RealtimeEvent{
		ID:           0,
		Topic:        "notification.test",
		ResourceType: "notification",
		ResourceID:   settings.EndpointID,
		Status:       "succeeded",
		Payload:      map[string]any{"message": "CertFlow webhook test"},
		CreatedAt:    time.Now().UTC(),
	}
	if err := postWebhook(ctx, string(webhookURL), event); err != nil {
		writeError(w, http.StatusBadGateway, "webhook_delivery_failed", "could not deliver the webhook test")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) runNotificationDeliveries(ctx context.Context, logger *slog.Logger) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		for i := 0; i < 16; i++ {
			delivery, err := s.store.ClaimNotificationDelivery(ctx, notificationDeliveryLease)
			if err != nil {
				if ctx.Err() == nil {
					logger.Warn("claim notification delivery", "error", err)
				}
				break
			}
			if delivery == nil {
				break
			}
			if err := s.deliverNotification(ctx, *delivery); err != nil {
				logger.Warn("deliver notification", "delivery_id", delivery.ID, "channel", delivery.Channel, "error", err)
				if updateErr := s.store.FailNotificationDelivery(context.Background(), delivery.ID, err.Error()); updateErr != nil {
					logger.Error("record notification delivery failure", "delivery_id", delivery.ID, "error", updateErr)
				}
				continue
			}
			if err := s.store.CompleteNotificationDelivery(context.Background(), delivery.ID); err != nil {
				logger.Error("complete notification delivery", "delivery_id", delivery.ID, "error", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Server) deliverNotification(parent context.Context, delivery store.ClaimedNotificationDelivery) error {
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	switch delivery.Channel {
	case "email":
		settings, err := s.loadSMTPSettings(ctx)
		if errors.Is(err, errSMTPNotConfigured) {
			return nil
		}
		if err != nil {
			return err
		}
		return mailer.Send(ctx, settings, delivery.RecipientEmail, notificationSubject(delivery.Event), notificationEmailBody(delivery.Event))
	case "webhook":
		if delivery.WebhookEndpointID == "" || len(delivery.WebhookURLCiphertext) == 0 {
			return nil
		}
		webhookURL, err := s.box.Open("notification_endpoint", personalWebhookKey(delivery.Event.OwnerUserID), delivery.WebhookURLCiphertext)
		if err != nil {
			return fmt.Errorf("decrypt webhook URL: %w", err)
		}
		return postWebhook(ctx, string(webhookURL), delivery.Event)
	default:
		return fmt.Errorf("unsupported notification channel %q", delivery.Channel)
	}
}

func validateWebhookURL(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return errors.New("webhook URL must be a valid HTTPS URL")
	}
	return nil
}

func postWebhook(ctx context.Context, target string, event domain.RealtimeEvent) error {
	if err := validateWebhookURL(target); err != nil {
		return err
	}
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "CertFlow-Webhook/1.0")
	request.Header.Set("X-CertFlow-Event", event.Topic)
	client := &http.Client{
		Timeout: 12 * time.Second,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			return validateWebhookURL(request.URL.String())
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("webhook returned HTTP %d", response.StatusCode)
	}
	return nil
}

func notificationSubject(event domain.RealtimeEvent) string {
	return fmt.Sprintf("CertFlow 通知：%s / %s", event.Topic, event.Status)
}

func notificationEmailBody(event domain.RealtimeEvent) string {
	payload, _ := json.Marshal(event.Payload)
	return fmt.Sprintf("主题：%s\n资源类型：%s\n资源 ID：%s\n状态：%s\n时间：%s\n\n详情：%s", event.Topic, event.ResourceType, event.ResourceID, event.Status, event.CreatedAt.Format(time.RFC3339), string(payload))
}

func personalWebhookKey(userID string) string {
	return "personal-webhook:" + userID
}
