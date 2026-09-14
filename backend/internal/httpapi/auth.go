package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/regenbio/certflow/internal/mailer"
	"github.com/regenbio/certflow/internal/store"
)

const (
	accessCookieName  = "certflow_session"
	refreshCookieName = "certflow_refresh"
	refreshTokenTTL   = 30 * 24 * time.Hour
)

type authContextKey struct{}
type authRequest struct {
	Email      string `json:"email"`
	Password   string `json:"password"`
	Code       string `json:"code"`
	RememberMe bool   `json:"rememberMe"`
}
type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, err := s.currentUser(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "authentication_required", "please sign in to continue")
			return
		}
		ctx := context.WithValue(r.Context(), authContextKey{}, user)
		next.ServeHTTP(w, r.WithContext(store.WithActor(ctx, store.Actor{ID: user.ID, Email: user.Email, Role: user.Role})))
	})
}

func (s *Server) currentUser(r *http.Request) (store.User, error) {
	cookie, err := r.Cookie(accessCookieName)
	if err != nil || cookie.Value == "" {
		return store.User{}, pgx.ErrNoRows
	}
	return s.store.SessionUser(r.Context(), cookie.Value, s.sessionIdle)
}

func actor(r *http.Request) store.Actor {
	user, _ := r.Context().Value(authContextKey{}).(store.User)
	return store.Actor{ID: user.ID, Email: user.Email, Role: user.Role}
}
func requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if actor(r).Role != "admin" {
		writeError(w, http.StatusForbidden, "admin_required", "administrator permission is required")
		return false
	}
	return true
}

func (s *Server) requestRegistrationCode(w http.ResponseWriter, r *http.Request) {
	var input authRequest
	if !decodeBody(w, r, &input) {
		return
	}
	if !validEmail(input.Email) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_email", "a valid email address is required")
		return
	}
	if err := s.sendVerificationCode(r.Context(), input.Email, "register"); err != nil {
		s.writeMailError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "sent"})
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var input authRequest
	if !decodeBody(w, r, &input) {
		return
	}
	if !validEmail(input.Email) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_email", "a valid email address is required")
		return
	}
	if err := validatePassword(input.Password); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_password", err.Error())
		return
	}
	if err := s.store.ConsumeVerificationCode(r.Context(), input.Email, "register", input.Code); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_code", "verification code is invalid or expired")
		return
	}
	user, err := s.store.CreateUser(r.Context(), input.Email, input.Password)
	if err != nil {
		writeError(w, http.StatusConflict, "registration_failed", "this email is already registered")
		return
	}
	s.createLoginSession(w, r, user, false)
}

func (s *Server) requestLoginCode(w http.ResponseWriter, r *http.Request) {
	var input authRequest
	if !decodeBody(w, r, &input) {
		return
	}
	if !validEmail(input.Email) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_email", "a valid email address is required")
		return
	}
	if err := s.sendVerificationCode(r.Context(), input.Email, "login"); err != nil {
		s.writeMailError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "sent"})
}

func (s *Server) loginPassword(w http.ResponseWriter, r *http.Request) {
	var input authRequest
	if !decodeBody(w, r, &input) {
		return
	}
	user, err := s.store.AuthenticatePassword(r.Context(), input.Email, input.Password)
	if err != nil {
		s.writeLoginError(w, err)
		return
	}
	s.createLoginSession(w, r, user, input.RememberMe)
}
func (s *Server) loginCode(w http.ResponseWriter, r *http.Request) {
	var input authRequest
	if !decodeBody(w, r, &input) {
		return
	}
	if err := s.store.ConsumeVerificationCode(r.Context(), input.Email, "login", input.Code); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_code", "verification code is invalid or expired")
		return
	}
	user, err := s.store.AuthenticateCode(r.Context(), input.Email)
	if err != nil {
		s.writeLoginError(w, err)
		return
	}
	s.createLoginSession(w, r, user, input.RememberMe)
}

func (s *Server) authMe(w http.ResponseWriter, r *http.Request) {
	user, err := s.currentUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required", "please sign in to continue")
		return
	}
	writeJSON(w, http.StatusOK, user)
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(accessCookieName); err == nil {
		_ = s.store.RevokeSession(r.Context(), cookie.Value)
	}
	if cookie, err := r.Cookie(refreshCookieName); err == nil {
		_ = s.store.RevokeRefreshToken(r.Context(), cookie.Value)
	}
	s.clearSessionCookie(w)
	s.clearRefreshCookie(w)
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	user, err := s.currentUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required", "please sign in to continue")
		return
	}
	var input changePasswordRequest
	if !decodeBody(w, r, &input) {
		return
	}
	if err := validatePassword(input.NewPassword); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_password", err.Error())
		return
	}
	if err := s.store.ChangePassword(r.Context(), user.ID, input.CurrentPassword, input.NewPassword, true); err != nil {
		s.writeLoginError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) createLoginSession(w http.ResponseWriter, r *http.Request, user store.User, rememberMe bool) {
	session, err := s.store.CreateSession(r.Context(), user, s.sessionTTL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "session_create_failed", "could not create a session")
		return
	}
	accessCookie := &http.Cookie{Name: accessCookieName, Value: session.Token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil}
	if rememberMe {
		accessCookie.Expires = session.ExpiresAt
		accessCookie.MaxAge = int(s.sessionTTL.Seconds())
	}
	http.SetCookie(w, accessCookie)
	refresh, err := s.store.CreateRefreshToken(r.Context(), user, refreshTokenTTL, rememberMe)
	if err != nil {
		_ = s.store.RevokeSession(r.Context(), session.Token)
		clearCookie(w, accessCookieName)
		writeError(w, http.StatusInternalServerError, "refresh_token_create_failed", "could not create a refresh token")
		return
	}
	s.setRefreshCookie(w, r, refresh)
	writeJSON(w, http.StatusOK, user)
}
func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	clearCookie(w, accessCookieName)
}

func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(refreshCookieName)
	if err != nil || cookie.Value == "" {
		s.clearSessionCookie(w)
		s.clearRefreshCookie(w)
		writeError(w, http.StatusUnauthorized, "refresh_token_missing", "refresh token is missing or expired")
		return
	}
	refresh, err := s.store.RotateRefreshToken(r.Context(), cookie.Value, refreshTokenTTL)
	if err != nil {
		s.clearSessionCookie(w)
		s.clearRefreshCookie(w)
		writeError(w, http.StatusUnauthorized, "refresh_token_invalid", "refresh token is invalid or expired")
		return
	}
	access, err := s.store.CreateSession(r.Context(), refresh.User, s.sessionTTL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "session_create_failed", "could not create a session")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: accessCookieName, Value: access.Token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil, Expires: access.ExpiresAt, MaxAge: int(s.sessionTTL.Seconds())})
	s.setRefreshCookie(w, r, refresh)
	writeJSON(w, http.StatusOK, refresh.User)
}

func (s *Server) setRefreshCookie(w http.ResponseWriter, r *http.Request, session store.RefreshSession) {
	cookie := &http.Cookie{Name: refreshCookieName, Value: session.Token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil}
	if session.Persistent {
		cookie.Expires = session.ExpiresAt
		cookie.MaxAge = int(time.Until(session.ExpiresAt).Seconds())
	}
	http.SetCookie(w, cookie)
}

func (s *Server) clearRefreshCookie(w http.ResponseWriter) { clearCookie(w, refreshCookieName) }

func clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1, Expires: time.Unix(1, 0)})
}

func (s *Server) sendVerificationCode(ctx context.Context, email, purpose string) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	settings, err := s.loadSMTPSettings(ctx)
	if err != nil {
		return err
	}
	code, err := s.store.CreateVerificationCode(ctx, email, purpose)
	if err != nil {
		return err
	}
	subject := "CertFlow 登录验证码"
	action := "登录"
	if purpose == "register" {
		subject = "CertFlow 注册验证码"
		action = "注册"
	}
	return mailer.Send(ctx, settings, store.NormalizeEmail(email), subject, fmt.Sprintf("你的 CertFlow %s验证码是：%s\n\n验证码 10 分钟内有效，请勿将验证码提供给他人。", action, code))
}
func (s *Server) loadSMTPSettings(ctx context.Context) (store.SMTPSettings, error) {
	ciphertext, err := s.store.GetSystemSetting(ctx, "smtp")
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.SMTPSettings{}, errSMTPNotConfigured
		}
		return store.SMTPSettings{}, err
	}
	payload, err := s.box.Open("system_setting", "smtp", ciphertext)
	if err != nil {
		return store.SMTPSettings{}, err
	}
	var settings store.SMTPSettings
	if err := json.Unmarshal(payload, &settings); err != nil {
		return store.SMTPSettings{}, err
	}
	if settings.Host == "" || settings.Port == 0 || settings.FromEmail == "" {
		return store.SMTPSettings{}, errSMTPNotConfigured
	}
	return settings, nil
}

var errSMTPNotConfigured = errors.New("smtp is not configured")

func (s *Server) writeMailError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrVerificationRateLimited) {
		writeError(w, http.StatusTooManyRequests, "verification_rate_limited", "please wait one minute before requesting another code")
		return
	}
	if errors.Is(err, errSMTPNotConfigured) {
		writeError(w, http.StatusServiceUnavailable, "smtp_not_configured", "email service has not been configured by an administrator")
		return
	}
	if errors.Is(err, mailer.ErrImplicitTLSRequired) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_smtp_settings", err.Error())
		return
	}
	writeError(w, http.StatusBadGateway, "email_delivery_failed", "could not send the verification email")
}
func (s *Server) writeLoginError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrAccountDisabled):
		writeError(w, http.StatusForbidden, "account_disabled", "this account is disabled")
	case errors.Is(err, store.ErrAccountLocked):
		writeError(w, http.StatusTooManyRequests, "account_locked", "this account is temporarily locked")
	default:
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "email or password is incorrect")
	}
}
func validEmail(email string) bool {
	parsed, err := mail.ParseAddress(store.NormalizeEmail(email))
	return err == nil && parsed.Address == store.NormalizeEmail(email)
}
func validatePassword(password string) error {
	if len(password) < 8 {
		return errors.New("password must be at least 8 characters")
	}
	if len(password) > 256 {
		return errors.New("password is too long")
	}
	return nil
}
