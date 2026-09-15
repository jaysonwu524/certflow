package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/regenbio/certflow/apps/control-plane/internal/id"
	"golang.org/x/crypto/bcrypt"
)

const maxCodeAttempts = 5

type actorContextKey struct{}

func WithActor(ctx context.Context, actor Actor) context.Context {
	return context.WithValue(ctx, actorContextKey{}, actor)
}

func ownerID(ctx context.Context) string {
	actor, _ := ctx.Value(actorContextKey{}).(Actor)
	if actor.Role == "user" {
		return actor.ID
	}
	return ""
}

func actorID(ctx context.Context) string {
	actor, _ := ctx.Value(actorContextKey{}).(Actor)
	return actor.ID
}

func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func (s *Store) EnsureBootstrapAdmin(ctx context.Context, email, password string) (string, error) {
	email = NormalizeEmail(email)
	if email == "" {
		email = "admin@localhost"
	}
	if password == "" {
		password = "admin"
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var adminID string
	err = tx.QueryRow(ctx, `SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`).Scan(&adminID)
	if err == pgx.ErrNoRows {
		hash, hashErr := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if hashErr != nil {
			return "", fmt.Errorf("hash bootstrap admin password: %w", hashErr)
		}
		adminID = id.New()
		if _, err = tx.Exec(ctx, `INSERT INTO users (id, email, password_hash, role, status, must_change_password, email_verified_at) VALUES ($1, $2, $3, 'admin', 'active', true, now())`, adminID, email, string(hash)); err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	}

	// Existing installations predate ownership. Preserve their data and assign it
	// once to the bootstrap administrator without changing any user-created rows.
	for _, table := range []string{"acme_accounts", "cloud_credentials", "dns_accounts", "certificates", "deployment_targets", "certificate_deployments", "automation_tasks", "notification_endpoints"} {
		if _, err := tx.Exec(ctx, `UPDATE `+table+` SET owner_user_id = $1 WHERE owner_user_id IS NULL`, adminID); err != nil {
			return "", fmt.Errorf("assign legacy %s ownership: %w", table, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return adminID, nil
}

func (s *Store) CreateUser(ctx context.Context, email, password string) (User, error) {
	email = NormalizeEmail(email)
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}
	user := User{ID: id.New(), Email: email, Role: "user", Status: "active", CreatedAt: time.Now().UTC()}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO users (id, email, password_hash, role, status, email_verified_at, created_at, updated_at)
		VALUES ($1, $2, $3, 'user', 'active', now(), $4, $4)
		RETURNING created_at
	`, user.ID, user.Email, string(hash), user.CreatedAt).Scan(&user.CreatedAt)
	return user, err
}

func (s *Store) CreateVerificationCode(ctx context.Context, email, purpose string) (string, error) {
	email = NormalizeEmail(email)
	var lastCreatedAt time.Time
	if err := s.pool.QueryRow(ctx, `
		SELECT created_at FROM email_verification_codes
		WHERE email = $1 AND purpose = $2
		ORDER BY created_at DESC LIMIT 1
	`, email, purpose).Scan(&lastCreatedAt); err == nil && time.Since(lastCreatedAt) < time.Minute {
		return "", ErrVerificationRateLimited
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	code, err := randomCode()
	if err != nil {
		return "", err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE email_verification_codes SET consumed_at = now()
		WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL
	`, email, purpose)
	if err != nil {
		return "", err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO email_verification_codes (id, email, purpose, code_hash, expires_at)
		VALUES ($1, $2, $3, $4, now() + interval '10 minutes')
	`, id.New(), email, purpose, string(hash))
	return code, err
}

func (s *Store) ConsumeVerificationCode(ctx context.Context, email, purpose, code string) error {
	email = NormalizeEmail(email)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var codeID, codeHash string
	var expiresAt time.Time
	var attempts int
	err = tx.QueryRow(ctx, `
		SELECT id, code_hash, expires_at, attempts FROM email_verification_codes
		WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL
		ORDER BY created_at DESC LIMIT 1 FOR UPDATE
	`, email, purpose).Scan(&codeID, &codeHash, &expiresAt, &attempts)
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrInvalidCode
		}
		return err
	}
	if attempts >= maxCodeAttempts || time.Now().After(expiresAt) {
		_, _ = tx.Exec(ctx, `UPDATE email_verification_codes SET consumed_at = now() WHERE id = $1`, codeID)
		return ErrInvalidCode
	}
	if bcrypt.CompareHashAndPassword([]byte(codeHash), []byte(strings.TrimSpace(code))) != nil {
		_, err = tx.Exec(ctx, `UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = $1`, codeID)
		if err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		return ErrInvalidCode
	}
	_, err = tx.Exec(ctx, `UPDATE email_verification_codes SET consumed_at = now() WHERE id = $1`, codeID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

var (
	ErrInvalidCode             = fmt.Errorf("verification code is invalid or expired")
	ErrVerificationRateLimited = fmt.Errorf("verification code was requested too recently")
	ErrInvalidCredentials      = fmt.Errorf("email or password is incorrect")
	ErrAccountDisabled         = fmt.Errorf("account is disabled")
	ErrAccountLocked           = fmt.Errorf("account is temporarily locked")
)

func (s *Store) AuthenticatePassword(ctx context.Context, email, password string) (User, error) {
	email = NormalizeEmail(email)
	var user User
	var hash string
	var lockedUntil *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, password_hash, role, status, must_change_password, last_login_at, created_at, locked_until
		FROM users WHERE email = $1 AND deleted_at IS NULL
	`, email).Scan(&user.ID, &user.Email, &hash, &user.Role, &user.Status, &user.MustChangePassword, &user.LastLoginAt, &user.CreatedAt, &lockedUntil)
	if err != nil {
		if err == pgx.ErrNoRows {
			return User{}, ErrInvalidCredentials
		}
		return User{}, err
	}
	if user.Status != "active" {
		return User{}, ErrAccountDisabled
	}
	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		return User{}, ErrAccountLocked
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		_, _ = s.pool.Exec(ctx, `UPDATE users SET failed_login_attempts = failed_login_attempts + 1, locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END, updated_at = now() WHERE id = $1`, user.ID)
		return User{}, ErrInvalidCredentials
	}
	_, err = s.pool.Exec(ctx, `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now(), updated_at = now() WHERE id = $1`, user.ID)
	return user, err
}

func (s *Store) AuthenticateCode(ctx context.Context, email string) (User, error) {
	email = NormalizeEmail(email)
	var user User
	err := s.pool.QueryRow(ctx, `SELECT id, email, role, status, must_change_password, last_login_at, created_at FROM users WHERE email = $1 AND deleted_at IS NULL`, email).Scan(&user.ID, &user.Email, &user.Role, &user.Status, &user.MustChangePassword, &user.LastLoginAt, &user.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return User{}, ErrInvalidCredentials
		}
		return User{}, err
	}
	if user.Status != "active" {
		return User{}, ErrAccountDisabled
	}
	_, err = s.pool.Exec(ctx, `UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`, user.ID)
	return user, err
}

func (s *Store) CreateSession(ctx context.Context, user User, ttl time.Duration, deviceLabel ...string) (Session, error) {
	token, err := randomToken()
	if err != nil {
		return Session{}, err
	}
	session := Session{Token: token, ExpiresAt: time.Now().UTC().Add(ttl), User: user}
	label := "Web browser"
	if len(deviceLabel) > 0 && strings.TrimSpace(deviceLabel[0]) != "" {
		label = strings.TrimSpace(deviceLabel[0])
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, device_label) VALUES ($1, $2, $3, $4, $5)`, id.New(), user.ID, tokenHash(token), session.ExpiresAt, label)
	return session, err
}

func (s *Store) SessionUser(ctx context.Context, token string, idleTTL time.Duration) (User, error) {
	var user User
	var lastSeen time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.email, u.role, u.status, u.must_change_password, u.last_login_at, u.created_at, s.last_seen_at
		FROM auth_sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL
	`, tokenHash(token)).Scan(&user.ID, &user.Email, &user.Role, &user.Status, &user.MustChangePassword, &user.LastLoginAt, &user.CreatedAt, &lastSeen)
	if err != nil {
		return User{}, err
	}
	if user.Status != "active" || time.Since(lastSeen) > idleTTL {
		return User{}, pgx.ErrNoRows
	}
	_, _ = s.pool.Exec(ctx, `UPDATE auth_sessions SET last_seen_at = now() WHERE token_hash = $1`, tokenHash(token))
	return user, nil
}

func (s *Store) RevokeSession(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx, `UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, tokenHash(token))
	return err
}

func (s *Store) ListUserSessions(ctx context.Context, currentToken string) ([]AuthSessionSummary, error) {
	userID := actorID(ctx)
	if userID == "" {
		return nil, errors.New("session owner is missing")
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, device_label, created_at, last_seen_at, expires_at, token_hash = $2
		FROM auth_sessions
		WHERE user_id = $1::uuid AND revoked_at IS NULL AND expires_at > now()
		ORDER BY token_hash = $2 DESC, last_seen_at DESC
	`, userID, tokenHash(currentToken))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sessions := make([]AuthSessionSummary, 0)
	for rows.Next() {
		var session AuthSessionSummary
		if err := rows.Scan(&session.ID, &session.DeviceLabel, &session.CreatedAt, &session.LastSeenAt, &session.ExpiresAt, &session.IsCurrent); err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

// RevokeOtherUserSessions preserves the request's access and refresh credentials
// while invalidating every other signed-in browser for this user.
func (s *Store) RevokeOtherUserSessions(ctx context.Context, currentAccessToken, currentRefreshToken string) (int64, error) {
	userID := actorID(ctx)
	if userID == "" {
		return 0, errors.New("session owner is missing")
	}
	result, err := s.pool.Exec(ctx, `
		UPDATE auth_sessions
		SET revoked_at = now()
		WHERE user_id = $1::uuid AND revoked_at IS NULL AND token_hash <> $2
	`, userID, tokenHash(currentAccessToken))
	if err != nil {
		return 0, err
	}
	if _, err := s.pool.Exec(ctx, `
		UPDATE auth_refresh_tokens
		SET revoked_at = now()
		WHERE user_id = $1::uuid AND revoked_at IS NULL AND token_hash <> $2
	`, userID, tokenHash(currentRefreshToken)); err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

func (s *Store) CreateRefreshToken(ctx context.Context, user User, ttl time.Duration, persistent bool) (RefreshSession, error) {
	token, err := randomToken()
	if err != nil {
		return RefreshSession{}, err
	}
	session := RefreshSession{Token: token, ExpiresAt: time.Now().UTC().Add(ttl), Persistent: persistent, User: user}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO auth_refresh_tokens (id, user_id, token_hash, expires_at, persistent)
		VALUES ($1, $2, $3, $4, $5)
	`, id.New(), user.ID, tokenHash(token), session.ExpiresAt, persistent)
	return session, err
}

// RotateRefreshToken revokes the presented token and atomically issues a new one.
func (s *Store) RotateRefreshToken(ctx context.Context, token string, ttl time.Duration) (RefreshSession, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RefreshSession{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var user User
	var persistent bool
	err = tx.QueryRow(ctx, `
		SELECT u.id, u.email, u.role, u.status, u.must_change_password, u.last_login_at, u.created_at, t.persistent
		FROM auth_refresh_tokens t JOIN users u ON u.id = t.user_id
		WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > now() AND u.deleted_at IS NULL
		FOR UPDATE
	`, tokenHash(token)).Scan(&user.ID, &user.Email, &user.Role, &user.Status, &user.MustChangePassword, &user.LastLoginAt, &user.CreatedAt, &persistent)
	if err != nil {
		return RefreshSession{}, err
	}
	if user.Status != "active" {
		return RefreshSession{}, ErrAccountDisabled
	}
	if _, err := tx.Exec(ctx, `UPDATE auth_refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, tokenHash(token)); err != nil {
		return RefreshSession{}, err
	}
	newToken, err := randomToken()
	if err != nil {
		return RefreshSession{}, err
	}
	session := RefreshSession{Token: newToken, ExpiresAt: time.Now().UTC().Add(ttl), Persistent: persistent, User: user}
	if _, err := tx.Exec(ctx, `
		INSERT INTO auth_refresh_tokens (id, user_id, token_hash, expires_at, persistent)
		VALUES ($1, $2, $3, $4, $5)
	`, id.New(), user.ID, tokenHash(newToken), session.ExpiresAt, persistent); err != nil {
		return RefreshSession{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RefreshSession{}, err
	}
	return session, nil
}

func (s *Store) RevokeRefreshToken(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx, `UPDATE auth_refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, tokenHash(token))
	return err
}

func (s *Store) ChangePassword(ctx context.Context, userID, currentPassword, newPassword string, requireCurrent bool) error {
	var hash string
	if requireCurrent {
		if err := s.pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1 AND status = 'active'`, userID).Scan(&hash); err != nil {
			return err
		}
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte(currentPassword)) != nil {
			return ErrInvalidCredentials
		}
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1`, userID, string(newHash))
	return err
}

func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, email, role, status, must_change_password, last_login_at, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := make([]User, 0)
	for rows.Next() {
		var user User
		if err := rows.Scan(&user.ID, &user.Email, &user.Role, &user.Status, &user.MustChangePassword, &user.LastLoginAt, &user.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (s *Store) SetUserStatus(ctx context.Context, userID, status string) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET status = $2, updated_at = now() WHERE id = $1`, userID, status)
	return err
}

func (s *Store) GetSystemSetting(ctx context.Context, key string) ([]byte, error) {
	var value []byte
	err := s.pool.QueryRow(ctx, `SELECT value_ciphertext FROM system_settings WHERE key = $1`, key).Scan(&value)
	return value, err
}

func (s *Store) SetSystemSetting(ctx context.Context, key string, value []byte) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO system_settings (key, value_ciphertext, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value_ciphertext = EXCLUDED.value_ciphertext, updated_at = now()`, key, value)
	return err
}

func randomCode() (string, error) {
	var raw [4]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", (uint32(raw[0])<<24|uint32(raw[1])<<16|uint32(raw[2])<<8|uint32(raw[3]))%1000000), nil
}
func randomToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}
func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
