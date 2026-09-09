package httpapi

import (
	"context"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/regenbio/certflow/internal/alb"
	"github.com/regenbio/certflow/internal/aliyunrpc"
	"github.com/regenbio/certflow/internal/cryptobox"
	"github.com/regenbio/certflow/internal/domain"
	"github.com/regenbio/certflow/internal/id"
	"github.com/regenbio/certflow/internal/store"
)

type Server struct {
	store *store.Store
	box   *cryptobox.Box
}

func New(s *store.Store, box *cryptobox.Box) *Server {
	return &Server{store: s, box: box}
}

func (s *Server) Router() http.Handler {
	router := chi.NewRouter()
	router.Use(requestID)
	router.Use(recoverer)

	router.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Get("/readyz", s.ready)

	router.Route("/api/v1", func(api chi.Router) {
		api.Get("/dashboard", s.dashboard)
		api.Get("/cloud-credentials", s.listCloudCredentials)
		api.Post("/cloud-credentials", s.createCloudCredential)
		api.Get("/acme-accounts", s.listACMEAccounts)
		api.Post("/acme-accounts", s.createACMEAccount)
		api.Get("/dns-accounts", s.listDNSAccounts)
		api.Post("/dns-accounts", s.createDNSAccount)
		api.Get("/cloud-credentials/{credentialID}/alb/regions", s.listALBRegions)
		api.Get("/cloud-credentials/{credentialID}/alb/load-balancers", s.listALBLoadBalancers)
		api.Get("/cloud-credentials/{credentialID}/alb/load-balancers/{loadBalancerID}/listeners", s.listALBListeners)
		api.Get("/deployment-targets", s.listDeploymentTargets)
		api.Post("/deployment-targets", s.createDeploymentTarget)
		api.Get("/certificate-deployments", s.listCertificateDeployments)
		api.Post("/certificate-deployments", s.createCertificateDeployment)
		api.Post("/certificate-deployments/{deploymentID}/run", s.runCertificateDeployment)
		api.Post("/certificate-deployments/{deploymentID}/deploy", s.runCertificateDeployment)
		api.Post("/certificates/{certificateID}/deployments", s.createCertificateDeploymentForCertificate)
		api.Get("/certificates", s.listCertificates)
		api.Post("/certificates", s.createCertificate)
		api.Get("/certificates/{certificateID}/manual-challenge", s.getManualChallenge)
		api.Post("/certificates/{certificateID}/manual-challenge/continue", s.continueManualChallenge)
		api.Get("/executions", s.listExecutions)
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
	if err := validateCloudCredential(input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_cloud_credential", err.Error())
		return
	}

	credentialID := id.New()
	versionID := id.New()
	payload, err := json.Marshal(map[string]string{"access_key_id": strings.TrimSpace(input.AccessKeyID), "access_key_secret": input.AccessKeySecret})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "credential_encode_failed", "could not encode cloud credential")
		return
	}
	ciphertext, err := s.box.Seal("cloud_credential_version", versionID, payload)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "credential_encrypt_failed", "could not protect cloud credential")
		return
	}
	if err := s.store.CreateCloudCredential(r.Context(), credentialID, versionID, input, credentialHint(input.AccessKeyID), ciphertext); err != nil {
		writeError(w, http.StatusInternalServerError, "cloud_credential_create_failed", "could not create cloud credential")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": credentialID})
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

	accountID := id.New()
	ciphertext, err := s.box.Seal("acme_account", accountID, []byte(input.PrivateKey))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "acme_key_encrypt_failed", "could not protect ACME account key")
		return
	}
	if err := s.store.CreateACMEAccount(r.Context(), accountID, input, ciphertext); err != nil {
		writeError(w, http.StatusInternalServerError, "acme_account_create_failed", "could not create ACME account")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": accountID})
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
	if err := validateDNSAccount(input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_dns_account", err.Error())
		return
	}

	accountID := id.New()
	if err := s.store.CreateDNSAccount(r.Context(), accountID, input); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "dns_account_create_failed", "cloud credential is unavailable")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": accountID})
}

func (s *Server) listALBRegions(w http.ResponseWriter, r *http.Request) {
	credentials, ok := s.albCredentials(w, r)
	if !ok {
		return
	}
	regions, err := alb.New().ListRegions(r.Context(), credentials)
	if err != nil {
		writeAliyunError(w, err)
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
		writeAliyunError(w, err)
		return
	}
	listeners, err := alb.New().ListListeners(r.Context(), credentials, regionID, loadBalancerID)
	if err != nil {
		writeAliyunError(w, err)
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
		writeAliyunError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": items})
}

func (s *Server) listDeploymentTargets(w http.ResponseWriter, r *http.Request) {
	targets, err := s.store.ListDeploymentTargets(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "deployment_targets_unavailable", "could not load deployment targets")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": targets})
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

func (s *Server) albCredentials(w http.ResponseWriter, r *http.Request) (alb.Credentials, bool) {
	return s.albCredentialsForID(w, r, chi.URLParam(r, "credentialID"))
}

func (s *Server) albCredentialsForID(w http.ResponseWriter, r *http.Request, credentialID string) (alb.Credentials, bool) {
	material, err := s.store.LoadCloudCredentialMaterial(r.Context(), credentialID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "cloud_credential_not_found", "cloud credential was not found")
		return alb.Credentials{}, false
	}
	if err != nil || material.Status != "active" {
		writeError(w, http.StatusUnprocessableEntity, "cloud_credential_unavailable", "cloud credential is unavailable")
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

func writeAliyunError(w http.ResponseWriter, err error) {
	var provider *aliyunrpc.Error
	if errors.As(err, &provider) {
		writeError(w, http.StatusUnprocessableEntity, "aliyun_"+provider.Code, provider.Message)
		return
	}
	writeError(w, http.StatusBadGateway, "aliyun_unavailable", "Aliyun API is unavailable")
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
	if strings.TrimSpace(input.AccessKeyID) == "" || strings.TrimSpace(input.AccessKeySecret) == "" {
		return errors.New("access key ID and secret are required")
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
	if block, _ := pem.Decode([]byte(input.PrivateKey)); block == nil {
		return errors.New("private key must be PEM encoded")
	}
	if input.PrivateKeyAlgorithm != "rsa_2048" && input.PrivateKeyAlgorithm != "rsa_4096" && input.PrivateKeyAlgorithm != "ecdsa_p256" && input.PrivateKeyAlgorithm != "ecdsa_p384" {
		return errors.New("private key algorithm is invalid")
	}
	return nil
}

func validateDNSAccount(input domain.CreateDNSAccountInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return errors.New("name is required")
	}
	if strings.TrimSpace(input.CloudCredentialID) == "" {
		return errors.New("cloud credential is required")
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
