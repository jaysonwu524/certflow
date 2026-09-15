package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/regenbio/certflow/apps/control-plane/internal/domain"
	"github.com/regenbio/certflow/apps/control-plane/internal/mailer"
	"github.com/regenbio/certflow/apps/control-plane/internal/store"
)

const notificationDeliveryLease = 30 * time.Second

type personalWebhookRequest struct {
	Enabled bool   `json:"enabled"`
	URL     string `json:"url"`
}

type personalWebhookResponse struct {
	Enabled            bool       `json:"enabled"`
	URL                string     `json:"url"`
	EmailConfigured    bool       `json:"emailConfigured"`
	LastDeliveryStatus string     `json:"lastDeliveryStatus"`
	LastDeliveryAt     *time.Time `json:"lastDeliveryAt"`
	LastDeliveryError  string     `json:"lastDeliveryError"`
}

type personalWebhookTestRequest struct {
	URL string `json:"url"`
}

func (s *Server) getPersonalWebhook(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.GetPersonalWebhookSettings(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "webhook_settings_unavailable", "could not load webhook settings")
		return
	}
	result := personalWebhookResponse{
		Enabled:            settings.Enabled,
		LastDeliveryStatus: settings.LastDeliveryStatus,
		LastDeliveryAt:     settings.LastDeliveryAt,
		LastDeliveryError:  settings.LastDeliveryError,
	}
	if _, err := s.loadSMTPSettings(r.Context()); err == nil {
		result.EmailConfigured = true
	}
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
		if err := validateWebhookURL(r.Context(), input.URL); err != nil {
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
	var input personalWebhookTestRequest
	if !decodeBody(w, r, &input) {
		return
	}
	input.URL = strings.TrimSpace(input.URL)
	settings, err := s.store.GetPersonalWebhookSettings(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "webhook_settings_unavailable", "could not load webhook settings")
		return
	}
	target := input.URL
	if target == "" {
		if !settings.Enabled || settings.EndpointID == "" {
			writeError(w, http.StatusUnprocessableEntity, "webhook_not_configured", "provide a webhook URL or enable and save one before sending a test")
			return
		}
		webhookURL, err := s.box.Open("notification_endpoint", personalWebhookKey(actor(r).ID), settings.URLCiphertext)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "webhook_settings_unavailable", "could not load webhook settings")
			return
		}
		target = string(webhookURL)
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
	if err := postWebhook(ctx, target, event); err != nil {
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

func validateWebhookURL(ctx context.Context, value string) error {
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Hostname() == "" {
		return errors.New("webhook URL must be a valid HTTPS URL")
	}
	if port := parsed.Port(); port != "" && port != "443" {
		return errors.New("webhook URL must use HTTPS port 443")
	}
	if net.ParseIP(parsed.Hostname()) != nil {
		return errors.New("webhook URL must use a public hostname")
	}
	return validateWebhookHost(ctx, parsed.Hostname())
}

// validateWebhookHost 与实际拨号使用相同的公网地址约束，避免 Webhook 被用作内网探测入口。
func validateWebhookHost(ctx context.Context, hostname string) error {
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, hostname)
	if err != nil || len(addresses) == 0 {
		return errors.New("webhook hostname could not be resolved")
	}
	for _, address := range addresses {
		if !isPublicWebhookIP(address.IP) {
			return errors.New("webhook hostname must resolve only to public IP addresses")
		}
	}
	return nil
}

func isPublicWebhookIP(ip net.IP) bool {
	address, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	address = address.Unmap()
	if !address.IsGlobalUnicast() || address.IsPrivate() {
		return false
	}
	for _, prefix := range blockedWebhookPrefixes {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}

var blockedWebhookPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"), netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"), netip.MustParsePrefix("::/128"),
	netip.MustParsePrefix("::1/128"), netip.MustParsePrefix("fc00::/7"),
	netip.MustParsePrefix("fe80::/10"), netip.MustParsePrefix("ff00::/8"),
}

func safeWebhookDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	hostname, port, err := net.SplitHostPort(address)
	if err != nil || port != "443" {
		return nil, errors.New("webhook connection must use HTTPS port 443")
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, hostname)
	if err != nil {
		return nil, fmt.Errorf("resolve webhook hostname: %w", err)
	}
	dialer := &net.Dialer{Timeout: 8 * time.Second}
	var lastErr error
	for _, resolved := range addresses {
		if !isPublicWebhookIP(resolved.IP) {
			return nil, errors.New("webhook hostname resolved to a non-public IP address")
		}
		connection, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(resolved.IP.String(), port))
		if dialErr == nil {
			return connection, nil
		}
		lastErr = dialErr
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, errors.New("webhook hostname has no usable public address")
}

func postWebhook(ctx context.Context, target string, event domain.RealtimeEvent) error {
	if err := validateWebhookURL(ctx, target); err != nil {
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
			return validateWebhookURL(request.Context(), request.URL.String())
		},
		Transport: &http.Transport{
			Proxy:                 nil,
			DialContext:           safeWebhookDialContext,
			TLSHandshakeTimeout:   8 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
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
