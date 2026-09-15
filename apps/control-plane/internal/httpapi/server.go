package httpapi

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/regenbio/certflow/apps/control-plane/internal/alb"
	"github.com/regenbio/certflow/apps/control-plane/internal/aliyunrpc"
	"github.com/regenbio/certflow/apps/control-plane/internal/cloudprovider"
	_ "github.com/regenbio/certflow/apps/control-plane/internal/cloudprovider/aliyun" // Register aliyun provider
	"github.com/regenbio/certflow/apps/control-plane/internal/cryptobox"
	dnsaliyun "github.com/regenbio/certflow/apps/control-plane/internal/dns/aliyun"
	"github.com/regenbio/certflow/apps/control-plane/internal/domain"
	"github.com/regenbio/certflow/apps/control-plane/internal/id"
	"github.com/regenbio/certflow/apps/control-plane/internal/store"
	"golang.org/x/crypto/acme"
)

type Server struct {
	store       *store.Store
	box         *cryptobox.Box
	sessionTTL  time.Duration
	sessionIdle time.Duration
	realtime    *realtimeHub
	streamCtx   context.Context
	stopStreams context.CancelFunc
}

type notificationReadRequest struct {
	IDs []int64 `json:"ids"`
}

func New(s *store.Store, box *cryptobox.Box, sessionDurations ...time.Duration) *Server {
	streamCtx, stopStreams := context.WithCancel(context.Background())
	server := &Server{store: s, box: box, sessionTTL: 8 * time.Hour, sessionIdle: 30 * time.Minute, realtime: newRealtimeHub(), streamCtx: streamCtx, stopStreams: stopStreams}
	if len(sessionDurations) > 0 {
		server.sessionTTL = sessionDurations[0]
	}
	if len(sessionDurations) > 1 {
		server.sessionIdle = sessionDurations[1]
	}
	return server
}

// StopRealtimeStreams releases long-lived SSE handlers before HTTP shutdown
// waits for active requests to drain.
func (s *Server) StopRealtimeStreams() {
	s.stopStreams()
}

func (s *Server) Router() http.Handler {
	router := chi.NewRouter()
	router.Use(requestID)
	router.Use(recoverer)

	router.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Get("/readyz", s.ready)

	router.Route("/api/v1/auth", func(auth chi.Router) {
		auth.Post("/register/request-code", s.requestRegistrationCode)
		auth.Post("/register", s.register)
		auth.Post("/login/request-code", s.requestLoginCode)
		auth.Post("/login/password", s.loginPassword)
		auth.Post("/login/code", s.loginCode)
		auth.Post("/refresh", s.refresh)
		auth.Get("/me", s.authMe)
		auth.Post("/logout", s.logout)
		auth.Post("/change-password", s.changePassword)
	})

	router.Route("/api/v1", func(api chi.Router) {
		api.Use(s.requireAuth)
		api.Get("/events", s.streamEvents)
		api.Get("/notifications", s.listNotifications)
		api.Post("/notifications/read", s.markNotificationsRead)
		api.Get("/profile/webhook", s.getPersonalWebhook)
		api.Put("/profile/webhook", s.updatePersonalWebhook)
		api.Post("/profile/webhook/test", s.testPersonalWebhook)
		api.Get("/profile/sessions", s.listProfileSessions)
		api.Post("/profile/sessions/revoke-others", s.revokeOtherProfileSessions)
		api.Get("/dashboard", s.dashboard)
		api.Get("/cloud-credentials", s.listCloudCredentials)
		api.Post("/cloud-credentials", s.createCloudCredential)
		api.Get("/cloud-credentials/{credentialID}", s.getCloudCredential)
		api.Patch("/cloud-credentials/{credentialID}", s.updateCloudCredential)
		api.Delete("/cloud-credentials/{credentialID}", s.deleteCloudCredential)
		api.Post("/cloud-credentials/{credentialID}/verify", s.verifyCloudCredential)
		api.Post("/cloud-credentials/{credentialID}/enable", s.enableCloudCredential)
		api.Post("/cloud-credentials/{credentialID}/disable", s.disableCloudCredential)
		api.Get("/acme-accounts", s.listACMEAccounts)
		api.Post("/acme-accounts", s.createACMEAccount)
		api.Get("/acme-accounts/{accountID}", s.getACMEAccount)
		api.Patch("/acme-accounts/{accountID}", s.updateACMEAccount)
		api.Delete("/acme-accounts/{accountID}", s.deleteACMEAccount)
		api.Post("/acme-accounts/{accountID}/verify", s.verifyACMEAccount)
		api.Get("/dns-accounts", s.listDNSAccounts)
		api.Post("/dns-accounts", s.createDNSAccount)
		api.Get("/dns-accounts/{accountID}", s.getDNSAccount)
		api.Patch("/dns-accounts/{accountID}", s.updateDNSAccount)
		api.Delete("/dns-accounts/{accountID}", s.deleteDNSAccount)
		api.Post("/dns-accounts/{accountID}/verify", s.verifyDNSAccount)
		api.Post("/dns-accounts/{accountID}/enable", s.enableDNSAccount)
		api.Post("/dns-accounts/{accountID}/disable", s.disableDNSAccount)
		api.Get("/cloud-credentials/{credentialID}/alb/regions", s.listALBRegions)
		api.Get("/cloud-credentials/{credentialID}/alb/load-balancers", s.listALBLoadBalancers)
		api.Get("/cloud-credentials/{credentialID}/alb/load-balancers/{loadBalancerID}/listeners", s.listALBListeners)
		api.Get("/cloud-credentials/{credentialID}/dns/zones", s.listDNSZones)
		api.Get("/deployment-targets", s.listDeploymentTargets)
		api.Post("/deployment-targets", s.createDeploymentTarget)
		api.Get("/deployment-targets/{targetID}", s.getDeploymentTarget)
		api.Patch("/deployment-targets/{targetID}", s.updateDeploymentTarget)
		api.Delete("/deployment-targets/{targetID}", s.deleteDeploymentTarget)
		api.Get("/certificate-deployments", s.listCertificateDeployments)
		api.Post("/certificate-deployments", s.createCertificateDeployment)
		api.Post("/certificate-deployments/{deploymentID}/run", s.runCertificateDeployment)
		api.Post("/certificate-deployments/{deploymentID}/deploy", s.runCertificateDeployment)
		api.Post("/certificates/{certificateID}/deployments", s.createCertificateDeploymentForCertificate)
		api.Get("/automations", s.listAutomations)
		api.Post("/automations", s.createAutomation)
		api.Get("/automations/{automationID}/runs", s.listAutomationRuns)
		api.Get("/automations/{automationID}", s.getAutomation)
		api.Patch("/automations/{automationID}", s.updateAutomation)
		api.Delete("/automations/{automationID}", s.deleteAutomation)
		api.Post("/automations/{automationID}/run", s.runAutomation)
		api.Get("/certificates", s.listCertificates)
		api.Post("/certificates", s.createCertificate)
		api.Get("/certificates/{certificateID}", s.getCertificate)
		api.Patch("/certificates/{certificateID}", s.updateCertificate)
		api.Delete("/certificates/{certificateID}", s.deleteCertificate)
		api.Post("/certificates/{certificateID}/issue", s.queueCertificateIssue)
		api.Get("/certificates/{certificateID}/versions", s.listCertificateVersions)
		api.Get("/certificates/{certificateID}/relations", s.getCertificateRelations)
		api.Get("/certificates/{certificateID}/manual-challenge", s.getManualChallenge)
		api.Get("/certificates/{certificateID}/manual-challenge/check", s.checkManualChallengeDNS)
		api.Post("/certificates/{certificateID}/manual-challenge/continue", s.continueManualChallenge)
		api.Get("/executions", s.listExecutions)
		api.Get("/users", s.listUsers)
		api.Post("/users/{userID}/disable", s.disableUser)
		api.Post("/users/{userID}/enable", s.enableUser)
		api.Get("/settings/smtp", s.getSMTPSettings)
		api.Put("/settings/smtp", s.updateSMTPSettings)
		api.Post("/settings/smtp/test", s.testSMTPSettings)
	})

	return router
}

func (s *Server) listCloudCredentials(w http.ResponseWriter, r *http.Request) {
	credentials, err := s.store.ListCloudCredentials(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "cloud_credentials_unavailable", "could not load cloud credentials")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": credentials})
}

func (s *Server) createCloudCredential(w http.ResponseWriter, r *http.Request) {
	var input domain.CreateCloudCredentialInput
	if !decodeBody(w, r, &input) {
		return
	}

	// Support backward compatibility: if legacy fields are provided, use them
	if input.AccessKeyID != "" || input.AccessKeySecret != "" {
		input.Provider = "aliyun"
		input.Credentials = cloudprovider.ParseCredentialsFromLegacyFields(input.AccessKeyID, input.AccessKeySecret)
	}

	if err := validateCloudCredential(input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_cloud_credential", err.Error())
		return
	}

	// Get provider instance
	provider, err := cloudprovider.Get(input.Provider)
	if err != nil {
		writeError(w, http.StatusBadRequest, "unsupported_provider", fmt.Sprintf("cloud provider %s is not supported", input.Provider))
		return
	}

	// Marshal credentials from map to provider-specific format
	payload, credentials, err := cloudprovider.MarshalCredentialsFromMap(input.Provider, input.Credentials)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_credentials", err.Error())
		return
	}

	// Validate credentials
	if err := provider.ValidateCredentials(r.Context(), credentials); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_credentials", err.Error())
		return
	}
	if err := provider.VerifyCredentials(r.Context(), credentials); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_verification_failed", safeProviderError(err))
		return
	}

	// The AccessKey ID is non-secret metadata. Persist it independently so the UI
	// can identify a credential without ever decrypting or exposing its secret.
	accessKeyID := provider.GetCredentialIdentifier(credentials)
	hint := provider.GetCredentialHint(credentials)

	// Encrypt credentials
	credentialID := id.New()
	versionID := id.New()
	ciphertext, err := s.box.Seal("cloud_credential_version", versionID, payload)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "credential_encrypt_failed", "could not protect cloud credential")
		return
	}

	// Save to database
	if err := s.store.CreateCloudCredential(r.Context(), credentialID, versionID, input, accessKeyID, hint, ciphertext); err != nil {
		writeError(w, http.StatusInternalServerError, "cloud_credential_create_failed", "could not create cloud credential")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"id": credentialID})
}

func (s *Server) getCloudCredential(w http.ResponseWriter, r *http.Request) {
	credential, err := s.store.GetCloudCredential(r.Context(), chi.URLParam(r, "credentialID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "cloud_credential_not_found", "cloud credential was not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "cloud_credential_unavailable", "could not load cloud credential")
		return
	}
	writeJSON(w, http.StatusOK, credential)
}

func (s *Server) updateCloudCredential(w http.ResponseWriter, r *http.Request) {
	var input domain.CreateCloudCredentialInput
	if !decodeBody(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Name) == "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid_cloud_credential", "name is required")
		return
	}

	// Access keys are immutable. A credential rotation must be performed by
	// removing all references, deleting the old credential, and creating a new
	// one so every dependent resource has an explicit owner and audit trail.
	if input.AccessKeyID != "" || input.AccessKeySecret != "" || len(input.Credentials) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_immutable", "AccessKey ID and Secret cannot be modified; delete the credential and create a new one")
		return
	}

	if err := s.store.UpdateCloudCredential(r.Context(), chi.URLParam(r, "credentialID"), "", input, "", "", nil); err != nil {
		writeResourceUpdateError(w, err, "cloud credential")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteCloudCredential(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteCloudCredential(r.Context(), chi.URLParam(r, "credentialID")); err != nil {
		writeResourceDeleteError(w, err, "cloud credential")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) verifyCloudCredential(w http.ResponseWriter, r *http.Request) {
	credentialID := chi.URLParam(r, "credentialID")
	provider, credentials, _, err := s.loadCloudProviderCredentials(r.Context(), credentialID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "cloud_credential_not_found", "cloud credential was not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_unavailable", "cloud credential is unavailable")
		return
	}
	s.emitVerificationEvent(r, "cloud_credential", credentialID, "cloud_credential_verify", "running", nil)
	if err := provider.VerifyCredentials(r.Context(), credentials); err != nil {
		_, _ = s.store.RecordCloudCredentialVerification(r.Context(), credentialID, false, err.Error())
		s.emitVerificationEvent(r, "cloud_credential", credentialID, "cloud_credential_verify", "failed", map[string]any{"error": safeProviderError(err)})
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_verification_failed", safeProviderError(err))
		return
	}
	status, err := s.store.RecordCloudCredentialVerification(r.Context(), credentialID, true, "")
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "cloud_credential_not_found", "cloud credential was not found")
		return
	}
	if err != nil {
		s.emitVerificationEvent(r, "cloud_credential", credentialID, "cloud_credential_verify", "failed", nil)
		writeError(w, http.StatusInternalServerError, "cloud_credential_verification_save_failed", "could not save cloud credential verification")
		return
	}
	s.emitVerificationEvent(r, "cloud_credential", credentialID, "cloud_credential_verify", "succeeded", nil)
	writeJSON(w, http.StatusOK, map[string]any{"status": status, "verified": true})
}

// emitVerificationEvent is best effort: verification results must not be
// turned into API failures just because an optional realtime notification
// could not be persisted.
func (s *Server) emitVerificationEvent(r *http.Request, resourceType, resourceID, operation, status string, details map[string]any) {
	payload := map[string]any{
		"operation":    operation,
		"resourceType": resourceType,
		"resourceId":   resourceID,
	}
	for key, value := range details {
		payload[key] = value
	}
	if err := s.store.EmitRealtimeEvent(r.Context(), actor(r).ID, "verification.status", resourceType, resourceID, status, payload); err != nil {
		slog.Error("emit verification realtime event", "resource_type", resourceType, "resource_id", resourceID, "status", status, "error", err)
	}
}

func (s *Server) enableCloudCredential(w http.ResponseWriter, r *http.Request) {
	credentialID := chi.URLParam(r, "credentialID")
	provider, credentials, _, err := s.loadCloudProviderCredentials(r.Context(), credentialID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "cloud_credential_not_found", "cloud credential was not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_unavailable", "cloud credential is unavailable")
		return
	}
	if err := provider.VerifyCredentials(r.Context(), credentials); err != nil {
		_, _ = s.store.RecordCloudCredentialVerification(r.Context(), credentialID, false, err.Error())
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_verification_failed", safeProviderError(err))
		return
	}
	if err := s.store.SetCloudCredentialStatus(r.Context(), credentialID, "active"); err != nil {
		writeResourceUpdateError(w, err, "cloud credential")
		return
	}
	_, _ = s.store.RecordCloudCredentialVerification(r.Context(), credentialID, true, "")
	writeJSON(w, http.StatusOK, map[string]any{"status": "active", "verified": true})
}

func (s *Server) disableCloudCredential(w http.ResponseWriter, r *http.Request) {
	if err := s.store.SetCloudCredentialStatus(r.Context(), chi.URLParam(r, "credentialID"), "disabled"); err != nil {
		writeResourceUpdateError(w, err, "cloud credential")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "disabled"})
}

func (s *Server) listACMEAccounts(w http.ResponseWriter, r *http.Request) {
	accounts, err := s.store.ListACMEAccounts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "acme_accounts_unavailable", "could not load ACME accounts")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": accounts})
}

func (s *Server) createACMEAccount(w http.ResponseWriter, r *http.Request) {
	var input domain.CreateACMEAccountInput
	if !decodeBody(w, r, &input) {
		return
	}
	if input.PrivateKeyAlgorithm == "" {
		input.PrivateKeyAlgorithm = "ecdsa_p256"
	}
	if input.DirectoryURL == "" {
		input.DirectoryURL = "https://acme-v02.api.letsencrypt.org/directory"
	}
	if err := validateACMEAccount(input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_acme_account", err.Error())
		return
	}

	// Account keys are supplied explicitly so operators retain control of the
	// ACME account identity. The key is encrypted immediately and never echoed.
	if strings.TrimSpace(input.PrivateKey) == "" {
		writeError(w, http.StatusUnprocessableEntity, "acme_private_key_required", "ACME account private key PEM is required")
		return
	}
	input.PrivateKey = strings.TrimSpace(input.PrivateKey)
	accountURL, err := verifyACMEAccountKey(r.Context(), input.DirectoryURL, input.Email, input.PrivateKey, "")
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "acme_account_verification_failed", sanitizeACMEError(err))
		return
	}

	accountID := id.New()
	ciphertext, err := s.box.Seal("acme_account", accountID, []byte(input.PrivateKey))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "acme_key_encrypt_failed", "could not protect ACME account key")
		return
	}
	if err := s.store.CreateACMEAccount(r.Context(), accountID, input, ciphertext, accountURL); err != nil {
		writeError(w, http.StatusInternalServerError, "acme_account_create_failed", "could not create ACME account")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": accountID})
}

func (s *Server) getACMEAccount(w http.ResponseWriter, r *http.Request) {
	account, err := s.store.GetACMEAccount(r.Context(), chi.URLParam(r, "accountID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "acme_account_not_found", "ACME account was not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "acme_account_unavailable", "could not load ACME account")
		return
	}
	writeJSON(w, http.StatusOK, account)
}

func (s *Server) updateACMEAccount(w http.ResponseWriter, r *http.Request) {
	var input domain.CreateACMEAccountInput
	if !decodeBody(w, r, &input) {
		return
	}
	if input.PrivateKeyAlgorithm == "" {
		input.PrivateKeyAlgorithm = "ecdsa_p256"
	}
	if err := validateACMEAccount(input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_acme_account", err.Error())
		return
	}
	accountID := chi.URLParam(r, "accountID")
	material, err := s.store.LoadACMEAccountMaterial(r.Context(), accountID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "acme_account_not_found", "ACME account was not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "acme_account_unavailable", "could not load ACME account")
		return
	}
	privateKey := strings.TrimSpace(input.PrivateKey)
	if privateKey == "" {
		privateKeyBytes, openErr := s.box.Open("acme_account", accountID, material.PrivateKey)
		if openErr != nil {
			writeError(w, http.StatusInternalServerError, "acme_key_unavailable", "could not decrypt the ACME account key")
			return
		}
		privateKey = string(privateKeyBytes)
	}
	accountURL := material.AccountURL
	if input.DirectoryURL != material.DirectoryURL || strings.TrimSpace(input.PrivateKey) != "" {
		accountURL = ""
	}
	verifiedURL, verifyErr := verifyACMEAccountKey(r.Context(), input.DirectoryURL, input.Email, privateKey, accountURL)
	if verifyErr != nil {
		_ = s.store.SetACMEAccountVerification(r.Context(), accountID, "error", sanitizeACMEError(verifyErr), "")
		writeError(w, http.StatusUnprocessableEntity, "acme_account_verification_failed", sanitizeACMEError(verifyErr))
		return
	}
	if verifiedURL != "" {
		accountURL = verifiedURL
	}
	var ciphertext []byte
	if strings.TrimSpace(input.PrivateKey) != "" {
		var err error
		ciphertext, err = s.box.Seal("acme_account", accountID, []byte(strings.TrimSpace(input.PrivateKey)))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "acme_key_encrypt_failed", "could not protect ACME account key")
			return
		}
	}
	if err := s.store.UpdateACMEAccount(r.Context(), accountID, input, ciphertext, accountURL); err != nil {
		writeResourceUpdateError(w, err, "ACME account")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) verifyACMEAccount(w http.ResponseWriter, r *http.Request) {
	accountID := chi.URLParam(r, "accountID")
	material, err := s.store.LoadACMEAccountMaterial(r.Context(), accountID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "acme_account_not_found", "ACME account was not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "acme_account_unavailable", "could not load ACME account")
		return
	}
	s.emitVerificationEvent(r, "acme_account", accountID, "acme_account_verify", "running", nil)
	privateKey, err := s.box.Open("acme_account", accountID, material.PrivateKey)
	if err != nil {
		s.emitVerificationEvent(r, "acme_account", accountID, "acme_account_verify", "failed", nil)
		writeError(w, http.StatusInternalServerError, "acme_key_unavailable", "could not decrypt the ACME account key")
		return
	}
	accountURL, err := verifyACMEAccountKey(r.Context(), material.DirectoryURL, material.Email, string(privateKey), material.AccountURL)
	if err != nil {
		_ = s.store.SetACMEAccountVerification(r.Context(), accountID, "error", sanitizeACMEError(err), "")
		s.emitVerificationEvent(r, "acme_account", accountID, "acme_account_verify", "failed", map[string]any{"error": sanitizeACMEError(err)})
		writeError(w, http.StatusUnprocessableEntity, "acme_account_verification_failed", sanitizeACMEError(err))
		return
	}
	if err := s.store.SetACMEAccountVerification(r.Context(), accountID, "active", "", accountURL); err != nil {
		s.emitVerificationEvent(r, "acme_account", accountID, "acme_account_verify", "failed", nil)
		writeError(w, http.StatusInternalServerError, "acme_account_update_failed", "could not save ACME account verification")
		return
	}
	s.emitVerificationEvent(r, "acme_account", accountID, "acme_account_verify", "succeeded", nil)
	writeJSON(w, http.StatusOK, map[string]any{"verified": true, "accountUrl": accountURL})
}

func verifyACMEAccountKey(parent context.Context, directoryURL, email, privateKeyPEM, accountURL string) (string, error) {
	signer, err := parseSigner([]byte(privateKeyPEM))
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(parent, 45*time.Second)
	defer cancel()
	client := &acme.Client{Key: signer, DirectoryURL: directoryURL}
	if accountURL != "" {
		account, getErr := client.GetReg(ctx, accountURL)
		if getErr == nil && account != nil && account.URI != "" {
			return account.URI, nil
		}
	}
	account, err := client.Register(ctx, &acme.Account{Contact: []string{"mailto:" + email}}, acme.AcceptTOS)
	if err != nil {
		return "", err
	}
	if account == nil || account.URI == "" {
		return "", errors.New("ACME provider returned an empty account URL")
	}
	return account.URI, nil
}

func sanitizeACMEError(err error) string {
	message := strings.TrimSpace(err.Error())
	if message == "" {
		return "ACME account verification failed"
	}
	if len(message) > 500 {
		return message[:500]
	}
	return message
}

func parseSigner(privateKeyPEM []byte) (crypto.Signer, error) {
	remaining := privateKeyPEM
	for {
		block, rest := pem.Decode(remaining)
		if block == nil {
			break
		}
		remaining = rest
		if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
			switch key := key.(type) {
			case *rsa.PrivateKey:
				return key, nil
			case *ecdsa.PrivateKey:
				return key, nil
			}
		}
		if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
			return key, nil
		}
		if key, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
			return key, nil
		}
	}
	return nil, errors.New("unsupported private key encoding")
}

func (s *Server) deleteACMEAccount(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteACMEAccount(r.Context(), chi.URLParam(r, "accountID")); err != nil {
		writeResourceDeleteError(w, err, "ACME account")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listDNSAccounts(w http.ResponseWriter, r *http.Request) {
	accounts, err := s.store.ListDNSAccounts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "dns_accounts_unavailable", "could not load DNS accounts")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": accounts})
}

func (s *Server) createDNSAccount(w http.ResponseWriter, r *http.Request) {
	var input domain.CreateDNSAccountInput
	if !decodeBody(w, r, &input) {
		return
	}
	input.AllowedZones = normalizeZones(input.AllowedZones)
	input.Description = strings.TrimSpace(input.Description)
	if err := validateDNSAccount(input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_dns_account", err.Error())
		return
	}
	provider, credentials, _, ok := s.dnsProviderForID(w, r, input.CloudCredentialID)
	if !ok {
		return
	}
	available, err := provider.ListZones(r.Context(), credentials)
	if err != nil {
		writeDNSProviderError(w, err)
		return
	}
	if invalid := invalidDNSZones(available, input.AllowedZones); len(invalid) > 0 {
		writeErrorWithDetails(w, http.StatusUnprocessableEntity, "dns_zone_not_managed", "one or more selected zones are not managed by the cloud credential", map[string]any{"invalidZones": invalid})
		return
	}
	if err := verifyDNSZones(r.Context(), provider, credentials, available, input.AllowedZones); err != nil {
		writeDNSProviderError(w, err)
		return
	}

	accountID := id.New()
	if err := s.store.CreateDNSAccount(r.Context(), accountID, input); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusUnprocessableEntity, "dns_account_create_failed", "cloud credential is unavailable")
		} else {
			writeError(w, http.StatusUnprocessableEntity, "dns_account_create_failed", "could not create DNS account")
		}
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": accountID})
}

func (s *Server) getDNSAccount(w http.ResponseWriter, r *http.Request) {
	account, err := s.store.GetDNSAccount(r.Context(), chi.URLParam(r, "accountID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "dns_account_not_found", "DNS account was not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "dns_account_unavailable", "could not load DNS account")
		return
	}
	writeJSON(w, http.StatusOK, account)
}

func (s *Server) updateDNSAccount(w http.ResponseWriter, r *http.Request) {
	var input domain.CreateDNSAccountInput
	if !decodeBody(w, r, &input) {
		return
	}
	input.AllowedZones = normalizeZones(input.AllowedZones)
	input.Description = strings.TrimSpace(input.Description)
	if err := validateDNSAccount(input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_dns_account", err.Error())
		return
	}
	provider, credentials, _, ok := s.dnsProviderForID(w, r, input.CloudCredentialID)
	if !ok {
		return
	}
	available, err := provider.ListZones(r.Context(), credentials)
	if err != nil {
		writeDNSProviderError(w, err)
		return
	}
	if invalid := invalidDNSZones(available, input.AllowedZones); len(invalid) > 0 {
		writeErrorWithDetails(w, http.StatusUnprocessableEntity, "dns_zone_not_managed", "one or more selected zones are not managed by the cloud credential", map[string]any{"invalidZones": invalid})
		return
	}
	if err := verifyDNSZones(r.Context(), provider, credentials, available, input.AllowedZones); err != nil {
		writeDNSProviderError(w, err)
		return
	}
	if err := s.store.UpdateDNSAccount(r.Context(), chi.URLParam(r, "accountID"), input); err != nil {
		writeResourceUpdateError(w, err, "DNS account")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteDNSAccount(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteDNSAccount(r.Context(), chi.URLParam(r, "accountID")); err != nil {
		writeResourceDeleteError(w, err, "DNS account")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) verifyDNSAccount(w http.ResponseWriter, r *http.Request) {
	accountID := chi.URLParam(r, "accountID")
	account, err := s.store.GetDNSAccount(r.Context(), accountID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "dns_account_not_found", "DNS account was not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "dns_account_unavailable", "could not load DNS account")
		return
	}
	s.emitVerificationEvent(r, "dns_account", accountID, "dns_account_verify", "running", nil)
	provider, credentials, material, ok := s.dnsProviderForID(w, r, account.CloudCredentialID)
	if !ok {
		_ = s.store.SetDNSAccountVerification(r.Context(), accountID, "invalid", "the referenced cloud credential is unavailable", "")
		s.emitVerificationEvent(r, "dns_account", accountID, "dns_account_verify", "failed", nil)
		return
	}
	available, err := provider.ListZones(r.Context(), credentials)
	if err == nil {
		if invalid := invalidDNSZones(available, account.AllowedZones); len(invalid) > 0 {
			err = &dnsZoneValidationError{Zones: invalid}
		} else {
			err = verifyDNSZones(r.Context(), provider, credentials, available, account.AllowedZones)
		}
	}
	if err != nil {
		message := safeDNSProviderError(err)
		_ = s.store.SetDNSAccountVerification(r.Context(), accountID, "invalid", message, "")
		if zoneErr, ok := err.(*dnsZoneValidationError); ok {
			s.emitVerificationEvent(r, "dns_account", accountID, "dns_account_verify", "failed", map[string]any{"error": message})
			writeErrorWithDetails(w, http.StatusUnprocessableEntity, "dns_zone_not_managed", message, map[string]any{"invalidZones": zoneErr.Zones})
			return
		}
		s.emitVerificationEvent(r, "dns_account", accountID, "dns_account_verify", "failed", map[string]any{"error": message})
		writeDNSProviderError(w, err)
		return
	}
	if err := s.store.SetDNSAccountVerification(r.Context(), accountID, "active", "", material.VersionID); err != nil {
		s.emitVerificationEvent(r, "dns_account", accountID, "dns_account_verify", "failed", nil)
		writeResourceUpdateError(w, err, "DNS account")
		return
	}
	s.emitVerificationEvent(r, "dns_account", accountID, "dns_account_verify", "succeeded", nil)
	writeJSON(w, http.StatusOK, map[string]any{"status": "active", "verified": true, "lastVerifiedAt": time.Now().UTC()})
}

func (s *Server) enableDNSAccount(w http.ResponseWriter, r *http.Request) {
	// Enabling always performs the same live read/write check as Verify. This
	// prevents an operator from re-enabling a stale or revoked credential.
	s.verifyDNSAccount(w, r)
}

func (s *Server) disableDNSAccount(w http.ResponseWriter, r *http.Request) {
	accountID := chi.URLParam(r, "accountID")
	if err := s.store.SetDNSAccountVerification(r.Context(), accountID, "disabled", "disabled by operator", ""); err != nil {
		writeResourceUpdateError(w, err, "DNS account")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "disabled"})
}

func (s *Server) listALBRegions(w http.ResponseWriter, r *http.Request) {
	credentials, ok := s.albCredentials(w, r)
	if !ok {
		return
	}
	regions, err := alb.New().ListRegions(r.Context(), credentials)
	if err != nil {
		writeALBOperationError(w, err, "describe_regions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": regions})
}

func (s *Server) listALBListeners(w http.ResponseWriter, r *http.Request) {
	regionID := strings.TrimSpace(r.URL.Query().Get("regionId"))
	loadBalancerID := chi.URLParam(r, "loadBalancerID")
	if regionID == "" || loadBalancerID == "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid_alb_query", "region ID and load balancer ID are required")
		return
	}
	credentials, ok := s.albCredentials(w, r)
	if !ok {
		return
	}
	loadBalancer, err := alb.New().GetLoadBalancer(r.Context(), credentials, regionID, loadBalancerID)
	if err != nil {
		writeALBOperationError(w, err, "get_load_balancer")
		return
	}
	listeners, err := alb.New().ListListeners(r.Context(), credentials, regionID, loadBalancerID)
	if err != nil {
		writeALBOperationError(w, err, "list_listeners")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"loadBalancer": loadBalancer, "data": listeners})
}

func (s *Server) listALBLoadBalancers(w http.ResponseWriter, r *http.Request) {
	regionID := strings.TrimSpace(r.URL.Query().Get("regionId"))
	if regionID == "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid_alb_query", "region ID is required")
		return
	}
	credentials, ok := s.albCredentials(w, r)
	if !ok {
		return
	}
	items, err := alb.New().ListLoadBalancers(r.Context(), credentials, regionID)
	if err != nil {
		writeALBOperationError(w, err, "list_load_balancers")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": items})
}

func (s *Server) listDNSZones(w http.ResponseWriter, r *http.Request) {
	provider, credentials, _, ok := s.dnsProviderForID(w, r, chi.URLParam(r, "credentialID"))
	if !ok {
		return
	}
	zones, err := provider.ListZones(r.Context(), credentials)
	if err != nil {
		writeDNSProviderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": zones})
}

func (s *Server) listDeploymentTargets(w http.ResponseWriter, r *http.Request) {
	targets, err := s.store.ListDeploymentTargets(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "deployment_targets_unavailable", "could not load deployment targets")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": targets})
}

// resolveALBListenerProtocol performs a live ALB lookup before persisting an
// inline target. The database transaction can then stay local and atomic while
// CertFlow still rejects stale, foreign, or non-TLS listeners.
func (s *Server) resolveALBListenerProtocol(w http.ResponseWriter, r *http.Request, input domain.CreateDeploymentTargetInput) (string, bool) {
	credentials, ok := s.albCredentialsForID(w, r, input.CloudCredentialID)
	if !ok {
		return "", false
	}
	listeners, err := alb.New().ListListeners(r.Context(), credentials, input.RegionID, input.LoadBalancerID)
	if err != nil {
		writeALBOperationError(w, err, "list_listeners")
		return "", false
	}
	for _, listener := range listeners {
		if listener.ID != input.ListenerID {
			continue
		}
		if listener.Protocol != "HTTPS" && listener.Protocol != "QUIC" {
			writeError(w, http.StatusUnprocessableEntity, "listener_protocol_unsupported", "only HTTPS or QUIC ALB listeners can use certificates")
			return "", false
		}
		return listener.Protocol, true
	}
	writeError(w, http.StatusUnprocessableEntity, "alb_listener_not_found", "the selected listener is not available on this ALB")
	return "", false
}

func (s *Server) createDeploymentTarget(w http.ResponseWriter, r *http.Request) {
	var input domain.CreateDeploymentTargetInput
	if !decodeBody(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.CloudCredentialID) == "" || strings.TrimSpace(input.RegionID) == "" || strings.TrimSpace(input.LoadBalancerID) == "" || strings.TrimSpace(input.ListenerID) == "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid_deployment_target", "name, cloud credential, region, load balancer, and listener are required")
		return
	}
	credentials, ok := s.albCredentialsForID(w, r, input.CloudCredentialID)
	if !ok {
		return
	}
	listeners, err := alb.New().ListListeners(r.Context(), credentials, input.RegionID, input.LoadBalancerID)
	if err != nil {
		writeAliyunError(w, err)
		return
	}
	protocol := ""
	for _, listener := range listeners {
		if listener.ID == input.ListenerID {
			protocol = listener.Protocol
			break
		}
	}
	if protocol != "HTTPS" && protocol != "QUIC" {
		writeError(w, http.StatusUnprocessableEntity, "listener_protocol_unsupported", "only HTTPS or QUIC ALB listeners can use certificates")
		return
	}
	targetID := id.New()
	if err := s.store.CreateDeploymentTarget(r.Context(), targetID, input, protocol); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "deployment_target_create_failed", "cloud credential is unavailable")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": targetID})
}

func (s *Server) getDeploymentTarget(w http.ResponseWriter, r *http.Request) {
	target, err := s.store.GetDeploymentTarget(r.Context(), chi.URLParam(r, "targetID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "deployment_target_not_found", "deployment target was not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "deployment_target_unavailable", "could not load deployment target")
		return
	}
	writeJSON(w, http.StatusOK, target)
}

func (s *Server) updateDeploymentTarget(w http.ResponseWriter, r *http.Request) {
	var input domain.CreateDeploymentTargetInput
	if !decodeBody(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.CloudCredentialID) == "" || strings.TrimSpace(input.RegionID) == "" || strings.TrimSpace(input.LoadBalancerID) == "" || strings.TrimSpace(input.ListenerID) == "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid_deployment_target", "name, cloud credential, region, load balancer, and listener are required")
		return
	}
	credentials, ok := s.albCredentialsForID(w, r, input.CloudCredentialID)
	if !ok {
		return
	}
	listeners, err := alb.New().ListListeners(r.Context(), credentials, input.RegionID, input.LoadBalancerID)
	if err != nil {
		writeAliyunError(w, err)
		return
	}
	protocol := ""
	for _, listener := range listeners {
		if listener.ID == input.ListenerID {
			protocol = listener.Protocol
			break
		}
	}
	if protocol != "HTTPS" && protocol != "QUIC" {
		writeError(w, http.StatusUnprocessableEntity, "listener_protocol_unsupported", "only HTTPS or QUIC ALB listeners can use certificates")
		return
	}
	if err := s.store.UpdateDeploymentTarget(r.Context(), chi.URLParam(r, "targetID"), input, protocol); err != nil {
		writeResourceUpdateError(w, err, "deployment target")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteDeploymentTarget(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteDeploymentTarget(r.Context(), chi.URLParam(r, "targetID")); err != nil {
		writeResourceDeleteError(w, err, "deployment target")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listCertificateDeployments(w http.ResponseWriter, r *http.Request) {
	deployments, err := s.store.ListCertificateDeployments(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "certificate_deployments_unavailable", "could not load certificate deployments")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": deployments})
}

func (s *Server) createCertificateDeployment(w http.ResponseWriter, r *http.Request) {
	var input domain.CreateCertificateDeploymentInput
	if !decodeBody(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.CertificateID) == "" || strings.TrimSpace(input.TargetID) == "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid_certificate_deployment", "certificate and deployment target are required")
		return
	}
	deploymentID := id.New()
	if err := s.store.CreateCertificateDeployment(r.Context(), deploymentID, input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "certificate_deployment_create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": deploymentID})
}

func (s *Server) createCertificateDeploymentForCertificate(w http.ResponseWriter, r *http.Request) {
	var input domain.CreateCertificateDeploymentInput
	if !decodeBody(w, r, &input) {
		return
	}
	input.CertificateID = chi.URLParam(r, "certificateID")
	if strings.TrimSpace(input.TargetID) == "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid_certificate_deployment", "deployment target is required")
		return
	}
	deploymentID := id.New()
	if err := s.store.CreateCertificateDeployment(r.Context(), deploymentID, input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "certificate_deployment_create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": deploymentID})
}

func (s *Server) runCertificateDeployment(w http.ResponseWriter, r *http.Request) {
	err := s.store.QueueDeployment(r.Context(), chi.URLParam(r, "deploymentID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusConflict, "deployment_not_ready", "deployment needs an enabled target and an issued certificate")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "deployment_queue_failed", "could not queue deployment")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "queued"})
}

func (s *Server) listAutomations(w http.ResponseWriter, r *http.Request) {
	tasks, err := s.store.ListAutomationTasks(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "automations_unavailable", "could not load automation tasks")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": tasks})
}

func (s *Server) getAutomation(w http.ResponseWriter, r *http.Request) {
	task, err := s.store.GetAutomationTask(r.Context(), chi.URLParam(r, "automationID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "automation_not_found", "automation task was not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "automation_unavailable", "could not load automation task")
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (s *Server) listAutomationRuns(w http.ResponseWriter, r *http.Request) {
	runs, err := s.store.ListAutomationRuns(r.Context(), chi.URLParam(r, "automationID"), 20)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "automation_runs_unavailable", "could not load automation runs")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": runs})
}

func (s *Server) updateAutomation(w http.ResponseWriter, r *http.Request) {
	var input domain.CreateAutomationTaskInput
	if !decodeBody(w, r, &input) {
		return
	}
	input.Name, input.CertificateID = strings.TrimSpace(input.Name), strings.TrimSpace(input.CertificateID)
	if input.IntervalMinutes == 0 {
		input.IntervalMinutes = 60
	}
	if input.InlineDeploymentTarget != nil {
		writeError(w, http.StatusUnprocessableEntity, "inline_target_update_unsupported", "ALB targets are immutable after task creation; select an existing target or create a new task")
		return
	}
	if err := validateAutomation(input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_automation", err.Error())
		return
	}
	if err := s.store.UpdateAutomationTask(r.Context(), chi.URLParam(r, "automationID"), input); err != nil {
		if errors.Is(err, store.ErrAutomationNameExists) {
			writeError(w, http.StatusConflict, "automation_name_exists", "自动化任务名称已存在，请使用其他名称")
			return
		}
		writeResourceUpdateError(w, err, "automation task")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteAutomation(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteAutomationTask(r.Context(), chi.URLParam(r, "automationID")); err != nil {
		writeResourceDeleteError(w, err, "automation task")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) createAutomation(w http.ResponseWriter, r *http.Request) {
	var input domain.CreateAutomationTaskInput
	if !decodeBody(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.CertificateID = strings.TrimSpace(input.CertificateID)
	if input.IntervalMinutes == 0 {
		input.IntervalMinutes = 60
	}
	if input.ActionType == "renew_and_deploy_alb" {
		input.ActionType = "deploy_alb"
	}
	if err := validateAutomation(input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_automation", err.Error())
		return
	}
	taskID := id.New()
	var err error
	if input.InlineDeploymentTarget != nil {
		protocol, ok := s.resolveALBListenerProtocol(w, r, *input.InlineDeploymentTarget)
		if !ok {
			return
		}
		newTargetID := id.New()
		if input.InlineDeploymentTarget.Name == "" {
			input.InlineDeploymentTarget.Name = "ALB " + newTargetID[:8]
		}
		err = s.store.CreateAutomationTaskWithInlineTarget(r.Context(), taskID, newTargetID, input, protocol)
	} else {
		err = s.store.CreateAutomationTask(r.Context(), taskID, input)
	}
	if err != nil {
		if errors.Is(err, store.ErrAutomationNameExists) {
			writeError(w, http.StatusConflict, "automation_name_exists", "自动化任务名称已存在，请使用其他名称")
			return
		}
		writeError(w, http.StatusUnprocessableEntity, "automation_create_failed", err.Error())
		return
	}
	// Creating a task only stores its policy. External work starts when the
	// user explicitly runs it, when a new certificate version is issued, or
	// when the scheduler reaches the first due check.
	writeJSON(w, http.StatusCreated, map[string]string{"id": taskID, "status": "scheduled", "runId": ""})
}

func (s *Server) runAutomation(w http.ResponseWriter, r *http.Request) {
	result, err := s.store.QueueAutomationRun(r.Context(), chi.URLParam(r, "automationID"))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "automation_not_found", "automation task was not found or is disabled")
			return
		}
		if errors.Is(err, store.ErrAutomationRunInProgress) {
			writeError(w, http.StatusConflict, "automation_run_in_progress", "automation task already has a queued or running batch")
			return
		}
		writeError(w, http.StatusInternalServerError, "automation_queue_failed", "could not queue automation task")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": result.Status, "runId": result.ID})
}

func (s *Server) albCredentials(w http.ResponseWriter, r *http.Request) (alb.Credentials, bool) {
	return s.albCredentialsForID(w, r, chi.URLParam(r, "credentialID"))
}

func (s *Server) albCredentialsForID(w http.ResponseWriter, r *http.Request, credentialID string) (alb.Credentials, bool) {
	provider, providerCredentials, material, err := s.loadCloudProviderCredentials(r.Context(), credentialID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "cloud_credential_not_found", "cloud credential was not found")
		return alb.Credentials{}, false
	}
	if err != nil || material.Status != "active" {
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_unavailable", "cloud credential is unavailable")
		return alb.Credentials{}, false
	}
	if err := provider.VerifyCredentials(r.Context(), providerCredentials); err != nil {
		_, _ = s.store.RecordCloudCredentialVerification(r.Context(), credentialID, false, err.Error())
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_verification_failed", safeProviderError(err))
		return alb.Credentials{}, false
	}
	_, _ = s.store.RecordCloudCredentialVerification(r.Context(), credentialID, true, "")
	if material.Provider != "aliyun" {
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_capability_missing", "the selected cloud credential does not support this operation")
		return alb.Credentials{}, false
	}
	payload, err := s.box.Open("cloud_credential_version", material.VersionID, material.CredentialsCiphertext)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_unavailable", "cloud credential is unavailable")
		return alb.Credentials{}, false
	}
	var credentials struct {
		AccessKeyID     string `json:"access_key_id"`
		AccessKeySecret string `json:"access_key_secret"`
	}
	if err := json.Unmarshal(payload, &credentials); err != nil || credentials.AccessKeyID == "" || credentials.AccessKeySecret == "" {
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_invalid", "cloud credential is invalid")
		return alb.Credentials{}, false
	}
	return alb.Credentials{AccessKeyID: credentials.AccessKeyID, AccessKeySecret: credentials.AccessKeySecret}, true
}

func (s *Server) loadCloudProviderCredentials(ctx context.Context, credentialID string) (cloudprovider.Provider, cloudprovider.Credentials, store.CloudCredentialMaterial, error) {
	material, err := s.store.LoadCloudCredentialMaterial(ctx, credentialID)
	if err != nil {
		return nil, nil, material, err
	}
	payload, err := s.box.Open("cloud_credential_version", material.VersionID, material.CredentialsCiphertext)
	if err != nil {
		return nil, nil, material, err
	}
	provider, err := cloudprovider.Get(material.Provider)
	if err != nil {
		return nil, nil, material, err
	}
	credentials, err := provider.UnmarshalCredentials(payload)
	if err != nil {
		return nil, nil, material, err
	}
	return provider, credentials, material, nil
}

func (s *Server) verifyCloudCredentialForOperation(w http.ResponseWriter, r *http.Request, credentialID string) bool {
	provider, credentials, material, err := s.loadCloudProviderCredentials(r.Context(), credentialID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "cloud_credential_not_found", "cloud credential was not found")
		return false
	}
	if err != nil || material.Status != "active" {
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_unavailable", "cloud credential is unavailable")
		return false
	}
	if err := provider.VerifyCredentials(r.Context(), credentials); err != nil {
		_, _ = s.store.RecordCloudCredentialVerification(r.Context(), credentialID, false, err.Error())
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_verification_failed", safeProviderError(err))
		return false
	}
	_, _ = s.store.RecordCloudCredentialVerification(r.Context(), credentialID, true, "")
	return true
}

func safeProviderError(err error) string {
	var providerErr *aliyunrpc.Error
	if errors.As(err, &providerErr) {
		return providerErr.Message
	}
	return "cloud provider rejected the credentials"
}

// dnsZoneValidationError is deliberately small and safe to expose: it only
// contains the operator-selected zone names that the provider did not return.
type dnsZoneValidationError struct {
	Zones []string
}

func (e *dnsZoneValidationError) Error() string {
	return "one or more selected zones are not managed by the cloud credential"
}

func (s *Server) dnsProviderForID(w http.ResponseWriter, r *http.Request, credentialID string) (cloudprovider.DNSProvider, cloudprovider.Credentials, store.CloudCredentialMaterial, bool) {
	provider, credentials, material, err := s.loadCloudProviderCredentials(r.Context(), credentialID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "cloud_credential_not_found", "cloud credential was not found")
		return nil, nil, material, false
	}
	if err != nil || material.Status != "active" {
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_unavailable", "cloud credential is unavailable")
		return nil, nil, material, false
	}
	dnsProvider, ok := provider.(cloudprovider.DNSProvider)
	if !ok {
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_capability_missing", "the selected cloud credential does not support DNS operations")
		return nil, nil, material, false
	}
	if err := provider.VerifyCredentials(r.Context(), credentials); err != nil {
		_, _ = s.store.RecordCloudCredentialVerification(r.Context(), credentialID, false, err.Error())
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_verification_failed", safeProviderError(err))
		return nil, nil, material, false
	}
	_, _ = s.store.RecordCloudCredentialVerification(r.Context(), credentialID, true, "")
	return dnsProvider, credentials, material, true
}

func invalidDNSZones(available []cloudprovider.DNSZone, requested []string) []string {
	managed := make(map[string]struct{}, len(available))
	for _, zone := range available {
		name := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(zone.Name)), ".")
		if name != "" {
			managed[name] = struct{}{}
		}
	}
	invalid := make([]string, 0)
	for _, zone := range requested {
		name := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(zone)), ".")
		if _, ok := managed[name]; !ok {
			invalid = append(invalid, name)
		}
	}
	return invalid
}

func verifyDNSZones(ctx context.Context, provider cloudprovider.DNSProvider, credentials cloudprovider.Credentials, available []cloudprovider.DNSZone, requested []string) error {
	byName := make(map[string]cloudprovider.DNSZone, len(available))
	for _, zone := range available {
		name := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(zone.Name)), ".")
		byName[name] = zone
	}
	for _, selected := range requested {
		name := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(selected)), ".")
		zone, ok := byName[name]
		if !ok {
			return &dnsZoneValidationError{Zones: []string{name}}
		}
		if err := provider.VerifyDNSAccess(ctx, credentials, zone); err != nil {
			return err
		}
	}
	return nil
}

func writeAliyunError(w http.ResponseWriter, err error) {
	var provider *aliyunrpc.Error
	if errors.As(err, &provider) {
		writeError(w, http.StatusUnprocessableEntity, "aliyun_"+provider.Code, provider.Message)
		return
	}
	writeError(w, http.StatusBadGateway, "aliyun_unavailable", "Aliyun API is unavailable")
}

// writeALBOperationError keeps an Aliyun permission failure actionable without
// exposing the signed request or cloud credential.  The provider error code is
// intentionally retained for support, while the UI receives the exact RAM
// action required by the failed operation.
func writeALBOperationError(w http.ResponseWriter, err error, operation string) {
	var provider *aliyunrpc.Error
	if !errors.As(err, &provider) {
		writeError(w, http.StatusBadGateway, "aliyun_unavailable", "Aliyun API is unavailable")
		return
	}

	permission, ok := albOperationPermission(operation)
	if ok && isAliyunPermissionError(provider.Code) {
		writeErrorWithDetails(w, http.StatusForbidden, "aliyun_alb_permission_denied",
			"当前云凭证没有读取阿里云 ALB 资源的权限。请在 RAM 中为该凭证关联的用户或角色授予 "+permission+" 后重试。",
			map[string]any{
				"requiredPermission": permission,
				"operation":          operation,
				"providerCode":       provider.Code,
			})
		return
	}
	writeError(w, http.StatusUnprocessableEntity, "aliyun_"+provider.Code, provider.Message)
}

func albOperationPermission(operation string) (string, bool) {
	switch operation {
	case "describe_regions":
		return "alb:DescribeRegions", true
	case "list_load_balancers":
		return "alb:ListLoadBalancers", true
	case "get_load_balancer":
		return "alb:GetLoadBalancerAttribute", true
	case "list_listeners":
		return "alb:ListListeners", true
	default:
		return "", false
	}
}

func isAliyunPermissionError(code string) bool {
	code = strings.ToLower(strings.TrimSpace(code))
	return strings.Contains(code, "forbidden") ||
		strings.Contains(code, "permission") ||
		strings.Contains(code, "unauthorized") ||
		strings.Contains(code, "accessdenied")
}

func writeDNSAliyunError(w http.ResponseWriter, err error) {
	var provider *dnsaliyun.Error
	if errors.As(err, &provider) {
		writeError(w, http.StatusUnprocessableEntity, "aliyun_"+provider.Code, provider.Message)
		return
	}
	writeError(w, http.StatusBadGateway, "aliyun_unavailable", "Aliyun DNS API is unavailable")
}

func writeDNSProviderError(w http.ResponseWriter, err error) {
	if zoneErr, ok := err.(*dnsZoneValidationError); ok {
		writeErrorWithDetails(w, http.StatusUnprocessableEntity, "dns_zone_not_managed", zoneErr.Error(), map[string]any{"invalidZones": zoneErr.Zones})
		return
	}
	var dnsErr *dnsaliyun.Error
	if errors.As(err, &dnsErr) {
		writeError(w, http.StatusUnprocessableEntity, "aliyun_"+dnsErr.Code, dnsErr.Message)
		return
	}
	var providerErr *aliyunrpc.Error
	if errors.As(err, &providerErr) {
		writeError(w, http.StatusUnprocessableEntity, "aliyun_"+providerErr.Code, providerErr.Message)
		return
	}
	writeError(w, http.StatusBadGateway, "dns_provider_unavailable", "DNS provider operation failed")
}

func safeDNSProviderError(err error) string {
	if zoneErr, ok := err.(*dnsZoneValidationError); ok {
		return zoneErr.Error()
	}
	var dnsErr *dnsaliyun.Error
	if errors.As(err, &dnsErr) {
		return dnsErr.Message
	}
	var providerErr *aliyunrpc.Error
	if errors.As(err, &providerErr) {
		return providerErr.Message
	}
	return "DNS provider operation failed"
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.store.Ping(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable", "database is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	dashboard, err := s.store.Dashboard(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "dashboard_unavailable", "could not load dashboard")
		return
	}
	writeJSON(w, http.StatusOK, dashboard)
}

func (s *Server) listCertificates(w http.ResponseWriter, r *http.Request) {
	certificates, err := s.store.ListCertificates(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "certificates_unavailable", "could not load certificates")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": certificates})
}

func (s *Server) getCertificate(w http.ResponseWriter, r *http.Request) {
	certificate, err := s.store.GetCertificate(r.Context(), chi.URLParam(r, "certificateID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "certificate_not_found", "certificate was not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "certificate_unavailable", "could not load certificate")
		return
	}
	writeJSON(w, http.StatusOK, certificate)
}

func (s *Server) updateCertificate(w http.ResponseWriter, r *http.Request) {
	var input domain.CreateCertificateInput
	if !decodeBody(w, r, &input) {
		return
	}
	if input.ValidationMode == "" {
		input.ValidationMode = "auto"
	}
	if input.RenewBeforeDays == 0 {
		input.RenewBeforeDays = 30
	}
	if err := validateCertificate(input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_certificate", err.Error())
		return
	}
	if err := s.store.UpdateCertificate(r.Context(), chi.URLParam(r, "certificateID"), input); err != nil {
		if errors.Is(err, store.ErrDNSZoneNotAllowed) {
			writeError(w, http.StatusUnprocessableEntity, "certificate_dns_zone_not_allowed", "one or more certificate domains are outside the DNS account allowlist")
			return
		}
		if errors.Is(err, store.ErrConfigurationUnavailable) {
			writeError(w, http.StatusUnprocessableEntity, "certificate_configuration_unavailable", "ACME or DNS account is inactive or has not passed verification")
			return
		}
		writeResourceUpdateError(w, err, "certificate")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteCertificate(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteCertificate(r.Context(), chi.URLParam(r, "certificateID")); err != nil {
		writeResourceDeleteError(w, err, "certificate")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) queueCertificateIssue(w http.ResponseWriter, r *http.Request) {
	jobID, err := s.store.QueueCertificateIssue(r.Context(), chi.URLParam(r, "certificateID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "certificate_not_found", "certificate was not found")
		return
	}
	if errors.Is(err, store.ErrCertificateJobInProgress) {
		writeError(w, http.StatusConflict, "certificate_issuance_in_progress", "an issuance or renewal is already in progress")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "certificate_issue_queue_failed", "could not queue certificate issuance")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"jobId": jobID, "status": "queued"})
}

func (s *Server) listCertificateVersions(w http.ResponseWriter, r *http.Request) {
	versions, err := s.store.ListCertificateVersions(r.Context(), chi.URLParam(r, "certificateID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "certificate_not_found", "certificate was not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "certificate_versions_unavailable", "could not load certificate versions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": versions})
}

func (s *Server) getCertificateRelations(w http.ResponseWriter, r *http.Request) {
	relations, err := s.store.GetCertificateRelations(r.Context(), chi.URLParam(r, "certificateID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "certificate_not_found", "certificate was not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "certificate_relations_unavailable", "could not load certificate relations")
		return
	}
	writeJSON(w, http.StatusOK, relations)
}

func (s *Server) listNotifications(w http.ResponseWriter, r *http.Request) {
	notifications, err := s.store.ListNotifications(r.Context(), 30)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "notifications_unavailable", "could not load notifications")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": notifications})
}

func (s *Server) markNotificationsRead(w http.ResponseWriter, r *http.Request) {
	var input notificationReadRequest
	if !decodeBody(w, r, &input) {
		return
	}
	if len(input.IDs) > 100 {
		writeError(w, http.StatusUnprocessableEntity, "notification_read_limit", "at most 100 notifications can be updated at once")
		return
	}
	if err := s.store.MarkNotificationsRead(r.Context(), input.IDs); err != nil {
		writeError(w, http.StatusInternalServerError, "notification_read_failed", "could not update notification state")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listExecutions(w http.ResponseWriter, r *http.Request) {
	executions, err := s.store.ListExecutions(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "executions_unavailable", "could not load executions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": executions})
}

func (s *Server) createCertificate(w http.ResponseWriter, r *http.Request) {
	var input domain.CreateCertificateInput
	if !decodeBody(w, r, &input) {
		return
	}
	if input.RenewBeforeDays == 0 {
		input.RenewBeforeDays = 30
	}
	if input.ValidationMode == "" {
		input.ValidationMode = "auto"
	}
	if err := validateCertificate(input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_certificate", err.Error())
		return
	}

	id, err := s.store.CreateCertificate(r.Context(), input)
	if err != nil {
		if errors.Is(err, store.ErrDNSZoneNotAllowed) {
			writeError(w, http.StatusUnprocessableEntity, "certificate_dns_zone_not_allowed", "one or more certificate domains are outside the DNS account allowlist")
			return
		}
		if errors.Is(err, store.ErrConfigurationUnavailable) {
			writeError(w, http.StatusUnprocessableEntity, "certificate_configuration_unavailable", "ACME or DNS account is inactive or has not passed verification")
			return
		}
		writeError(w, http.StatusInternalServerError, "certificate_create_failed", "could not create certificate")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (s *Server) getManualChallenge(w http.ResponseWriter, r *http.Request) {
	challenge, err := s.store.GetManualChallenge(r.Context(), chi.URLParam(r, "certificateID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "manual_challenge_not_found", "no pending manual DNS validation was found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "manual_challenge_unavailable", "could not load manual DNS validation")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"certificateId": challenge.CertificateID,
		"status":        challenge.Status,
		"challenges":    challenge.Challenges,
	})
}

func (s *Server) continueManualChallenge(w http.ResponseWriter, r *http.Request) {
	err := s.store.ApproveManualChallenge(r.Context(), chi.URLParam(r, "certificateID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusConflict, "manual_challenge_not_waiting", "manual DNS validation is not waiting for confirmation")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "manual_challenge_continue_failed", "could not continue manual DNS validation")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "queued"})
}

func (s *Server) checkManualChallengeDNS(w http.ResponseWriter, r *http.Request) {
	challenge, err := s.store.GetManualChallenge(r.Context(), chi.URLParam(r, "certificateID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "manual_challenge_not_found", "no pending manual DNS validation was found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "manual_challenge_unavailable", "could not load manual DNS validation")
		return
	}
	checks := make([]domain.ManualDNSCheck, 0, len(challenge.Challenges))
	for _, item := range challenge.Challenges {
		observed, lookupErr := net.DefaultResolver.LookupTXT(r.Context(), item.FQDN)
		check := domain.ManualDNSCheck{FQDN: item.FQDN, Expected: item.Value, Observed: observed}
		if lookupErr != nil {
			check.Error = lookupErr.Error()
		} else {
			for _, value := range observed {
				if value == item.Value {
					check.Matched = true
					break
				}
			}
		}
		checks = append(checks, check)
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": checks})
}

func decodeBody(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body is invalid")
		return false
	}
	return true
}

func validateCloudCredential(input domain.CreateCloudCredentialInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return errors.New("name is required")
	}

	// Validate provider
	if strings.TrimSpace(input.Provider) == "" {
		return errors.New("provider is required")
	}

	if !cloudprovider.IsRegistered(input.Provider) {
		return fmt.Errorf("unsupported provider: %s", input.Provider)
	}

	// Validate credentials map is not empty
	if len(input.Credentials) == 0 {
		return errors.New("credentials are required")
	}

	return nil
}

func validateACMEAccount(input domain.CreateACMEAccountInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return errors.New("name is required")
	}
	directoryURL, err := url.ParseRequestURI(input.DirectoryURL)
	if err != nil || directoryURL.Scheme != "https" || directoryURL.Host == "" {
		return errors.New("directory URL must be a valid HTTPS URL")
	}
	address, err := mail.ParseAddress(input.Email)
	if err != nil || address.Address != input.Email {
		return errors.New("email is invalid")
	}
	if input.PrivateKeyAlgorithm != "rsa_2048" && input.PrivateKeyAlgorithm != "rsa_4096" && input.PrivateKeyAlgorithm != "ecdsa_p256" && input.PrivateKeyAlgorithm != "ecdsa_p384" {
		return errors.New("private key algorithm is invalid")
	}
	if strings.TrimSpace(input.PrivateKey) != "" {
		if err := validateACMEPrivateKey([]byte(input.PrivateKey)); err != nil {
			return err
		}
	}
	return nil
}

func generateACMEPrivateKey(algorithm string) ([]byte, error) {
	var (
		key any
		err error
	)
	switch algorithm {
	case "ecdsa_p256":
		key, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	case "ecdsa_p384":
		key, err = ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	case "rsa_2048":
		key, err = rsa.GenerateKey(rand.Reader, 2048)
	case "rsa_4096":
		key, err = rsa.GenerateKey(rand.Reader, 4096)
	default:
		return nil, errors.New("private key algorithm is invalid")
	}
	if err != nil {
		return nil, err
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), nil
}

func validateACMEPrivateKey(privateKeyPEM []byte) error {
	remaining := privateKeyPEM
	for {
		block, rest := pem.Decode(remaining)
		if block == nil {
			break
		}
		remaining = rest
		if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
			switch key.(type) {
			case *rsa.PrivateKey, *ecdsa.PrivateKey:
				return nil
			}
		}
		if _, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
			return nil
		}
		if _, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
			return nil
		}
	}
	return errors.New("private key must be a supported PEM-encoded RSA or ECDSA private key")
}

func validateDNSAccount(input domain.CreateDNSAccountInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return errors.New("name is required")
	}
	if strings.TrimSpace(input.CloudCredentialID) == "" {
		return errors.New("cloud credential is required")
	}
	if len(input.Description) > 240 {
		return errors.New("description must be 240 characters or fewer")
	}
	if len(input.AllowedZones) == 0 {
		return errors.New("at least one allowed zone is required")
	}
	for _, zone := range input.AllowedZones {
		if !validZone(zone) {
			return errors.New("allowed zones must be valid non-wildcard domain names")
		}
	}
	return nil
}

func validateAutomation(input domain.CreateAutomationTaskInput) error {
	if input.Name == "" {
		return errors.New("name is required")
	}
	if input.CertificateID == "" {
		return errors.New("certificate is required")
	}
	if input.ActionType != "renew_certificate" && input.ActionType != "upload_ssl" && input.ActionType != "deploy_alb" && input.ActionType != "renew_and_deploy_alb" {
		return errors.New("automation action type is invalid")
	}
	if input.ActionType == "renew_certificate" && (input.IntervalMinutes < 60 || input.IntervalMinutes > 10080) {
		return errors.New("interval must be between 60 minutes and 7 days")
	}
	if input.ActionType == "upload_ssl" && strings.TrimSpace(input.CloudCredentialID) == "" {
		return errors.New("an Aliyun cloud credential is required for certificate upload")
	}
	if input.InlineDeploymentTarget != nil {
		if input.ActionType != "deploy_alb" {
			return errors.New("an inline ALB target is only supported for ALB automation")
		}
		if strings.TrimSpace(input.InlineDeploymentTarget.CloudCredentialID) == "" || strings.TrimSpace(input.InlineDeploymentTarget.RegionID) == "" || strings.TrimSpace(input.InlineDeploymentTarget.LoadBalancerID) == "" || strings.TrimSpace(input.InlineDeploymentTarget.ListenerID) == "" {
			return errors.New("cloud credential, region, load balancer, and listener are required for an ALB target")
		}
	}
	if (input.ActionType == "deploy_alb" || input.ActionType == "renew_and_deploy_alb") && len(input.DeploymentTargetIDs) == 0 && input.InlineDeploymentTarget == nil {
		return errors.New("at least one ALB target is required")
	}
	return nil
}

func normalizeZones(zones []string) []string {
	normalized := make([]string, 0, len(zones))
	seen := make(map[string]struct{})
	for _, zone := range zones {
		zone = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(zone)), ".")
		if zone == "" {
			continue
		}
		if _, exists := seen[zone]; !exists {
			seen[zone] = struct{}{}
			normalized = append(normalized, zone)
		}
	}
	return normalized
}

func validZone(zone string) bool {
	return strings.Contains(zone, ".") && !strings.ContainsAny(zone, "* /\\")
}

func credentialHint(accessKeyID string) string {
	trimmed := strings.TrimSpace(accessKeyID)
	if len(trimmed) <= 4 {
		return "****"
	}
	return "****" + trimmed[len(trimmed)-4:]
}

func validateCertificate(input domain.CreateCertificateInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return errors.New("name is required")
	}
	if len(input.Domains) == 0 {
		return errors.New("at least one domain is required")
	}
	if strings.TrimSpace(input.AcmeAccountID) == "" {
		return errors.New("an ACME account is required")
	}
	if input.ValidationMode != "auto" && input.ValidationMode != "manual" {
		return errors.New("validation mode must be auto or manual")
	}
	if input.ValidationMode == "auto" && strings.TrimSpace(input.DefaultDNSAccountID) == "" {
		return errors.New("a DNS account is required")
	}
	if input.KeyAlgorithm == "" {
		return errors.New("key algorithm is required")
	}
	if input.RenewBeforeDays < 1 || input.RenewBeforeDays > 90 {
		return errors.New("renew before days must be between 1 and 90")
	}
	for _, name := range input.Domains {
		if strings.TrimSpace(name) == "" || strings.Count(name, "*") > 1 || (strings.Contains(name, "*") && !strings.HasPrefix(name, "*.")) {
			return errors.New("domains must be valid FQDNs or single-label wildcards")
		}
	}
	return nil
}

func requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = id.New()
		}
		w.Header().Set("X-Request-ID", requestID)
		next.ServeHTTP(w, r)
	})
}

func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recover() != nil {
				writeError(w, http.StatusInternalServerError, "internal_error", "unexpected server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"code": code, "message": message})
}

func writeErrorWithDetails(w http.ResponseWriter, status int, code, message string, details map[string]any) {
	payload := map[string]any{"code": code, "message": message}
	for key, value := range details {
		payload[key] = value
	}
	writeJSON(w, status, payload)
}

func writeResourceUpdateError(w http.ResponseWriter, err error, resource string) {
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "resource_not_found", resource+" was not found")
		return
	}
	writeError(w, http.StatusInternalServerError, "resource_update_failed", "could not update "+resource)
}

func writeResourceDeleteError(w http.ResponseWriter, err error, resource string) {
	if errors.Is(err, store.ErrResourceInUse) {
		payload := map[string]any{"code": "resource_in_use", "message": resource + " is still referenced by an active configuration"}
		var inUse *store.ResourceInUseError
		if errors.As(err, &inUse) {
			payload["references"] = inUse.References
			payload["referenceCount"] = inUse.Total()
		}
		writeJSON(w, http.StatusConflict, payload)
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "resource_not_found", resource+" was not found")
		return
	}
	writeError(w, http.StatusInternalServerError, "resource_delete_failed", "could not delete "+resource)
}
