package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/regenbio/certflow/apps/control-plane/internal/mailer"
	"github.com/regenbio/certflow/apps/control-plane/internal/store"
)

type smtpSettingsRequest struct {
	Host        string               `json:"host"`
	Port        int                  `json:"port"`
	Username    string               `json:"username"`
	Password    string               `json:"password"`
	Auth        bool                 `json:"auth"`
	EncryptType string               `json:"encryptType"`
	EncryptPort int                  `json:"encryptPort"`
	FromEmail   string               `json:"fromEmail"`
	FromName    string               `json:"fromName"`
	SMTP        *smtpSettingsRequest `json:"smtp"`
}

func (s *Server) getSMTPSettings(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	settings, err := s.loadSMTPSettings(r.Context())
	if errors.Is(err, errSMTPNotConfigured) {
		writeJSON(w, http.StatusOK, map[string]any{"configured": false})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "smtp_settings_unavailable", "could not load SMTP settings")
		return
	}
	settings.Password = ""
	writeJSON(w, http.StatusOK, map[string]any{"configured": true, "settings": settings, "smtp": settings})
}

func (s *Server) updateSMTPSettings(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var input smtpSettingsRequest
	if !decodeBody(w, r, &input) {
		return
	}
	if input.SMTP != nil {
		input = *input.SMTP
	}
	existing, _ := s.loadSMTPSettings(r.Context())
	if strings.TrimSpace(input.Password) == "" {
		input.Password = existing.Password
	}
	fromEmail := store.NormalizeEmail(input.FromEmail)
	if fromEmail == "" {
		fromEmail = store.NormalizeEmail(input.Username)
	}
	settings := store.SMTPSettings{Host: strings.TrimSpace(input.Host), Port: input.Port, Username: strings.TrimSpace(input.Username), Password: input.Password, Auth: input.Auth, EncryptType: strings.ToUpper(strings.TrimSpace(input.EncryptType)), EncryptPort: input.EncryptPort, FromEmail: fromEmail, FromName: strings.TrimSpace(input.FromName)}
	if settings.EncryptType == "" {
		settings.EncryptType = "STARTTLS"
	}
	if settings.EncryptPort == 0 {
		settings.EncryptPort = settings.Port
	}
	if settings.Host == "" || settings.Port < 1 || settings.Port > 65535 || settings.EncryptPort < 1 || settings.EncryptPort > 65535 || !validEmail(settings.FromEmail) || (settings.EncryptType != "STARTTLS" && settings.EncryptType != "SSL" && settings.EncryptType != "NONE") || (settings.Auth && (settings.Username == "" || settings.Password == "")) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_smtp_settings", "host, ports, sender email, encryption, and authentication settings are invalid")
		return
	}
	if err := mailer.ValidateSettings(settings); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_smtp_settings", err.Error())
		return
	}
	payload, err := json.Marshal(settings)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "smtp_settings_save_failed", "could not save SMTP settings")
		return
	}
	ciphertext, err := s.box.Seal("system_setting", "smtp", payload)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "smtp_settings_save_failed", "could not save SMTP settings")
		return
	}
	if err := s.store.SetSystemSetting(r.Context(), "smtp", ciphertext); err != nil {
		writeError(w, http.StatusInternalServerError, "smtp_settings_save_failed", "could not save SMTP settings")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"configured": true})
}

func (s *Server) testSMTPSettings(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	settings, err := s.loadSMTPSettings(r.Context())
	if err != nil {
		s.writeMailError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err := mailer.Send(ctx, settings, actor(r).Email, "CertFlow SMTP 测试邮件", "这是一封来自 CertFlow 的 SMTP 测试邮件。"); err != nil {
		s.writeMailError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "users_unavailable", "could not load users")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": users})
}

func (s *Server) disableUser(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	userID := r.PathValue("userID")
	if actor(r).ID == userID {
		writeError(w, http.StatusUnprocessableEntity, "invalid_user_status", "you cannot disable your own account")
		return
	}
	if err := s.store.SetUserStatus(r.Context(), userID, "disabled"); err != nil {
		writeError(w, http.StatusInternalServerError, "user_update_failed", "could not update user")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) enableUser(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	if err := s.store.SetUserStatus(r.Context(), r.PathValue("userID"), "active"); err != nil {
		writeError(w, http.StatusInternalServerError, "user_update_failed", "could not update user")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
