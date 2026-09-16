package domain

import "time"

// RealtimeEvent is a non-sensitive state transition suitable for browser
// delivery and for future notification-channel consumers.
type RealtimeEvent struct {
	ID           int64     `json:"id"`
	OwnerUserID  string    `json:"-"`
	Topic        string    `json:"topic"`
	ResourceType string    `json:"resourceType"`
	ResourceID   string    `json:"resourceId"`
	Status       string    `json:"status"`
	Payload      any       `json:"payload"`
	CreatedAt    time.Time `json:"createdAt"`
}

type Notification struct {
	RealtimeEvent
	ReadAt *time.Time `json:"readAt"`
}

type Dashboard struct {
	ActiveCertificates int `json:"activeCertificates"`
	ExpiringSoon       int `json:"expiringSoon"`
	RunningJobs        int `json:"runningJobs"`
	FailedExecutions   int `json:"failedExecutions"`
}

// AdminDashboard contains non-sensitive, system-wide operations data. It is
// intentionally separate from Dashboard so a personal workspace can never
// accidentally inherit administrator-wide aggregation semantics.
type AdminDashboard struct {
	Metrics            AdminDashboardMetrics     `json:"metrics"`
	ExecutionTrend     []DashboardExecutionTrend `json:"executionTrend"`
	ExpiryDistribution []DashboardExpiryBucket   `json:"expiryDistribution"`
	AutomationHealth   AdminAutomationHealth     `json:"automationHealth"`
	RiskCertificates   []AdminRiskCertificate    `json:"riskCertificates"`
	FailedExecutions   []AdminFailedExecution    `json:"failedExecutions"`
	ResourceOwners     []AdminResourceOwner      `json:"resourceOwners"`
}

type AdminDashboardMetrics struct {
	ActiveUsers             int     `json:"activeUsers"`
	NewUsers30d             int     `json:"newUsers30d"`
	CertificatesTotal       int     `json:"certificatesTotal"`
	CertificatesIssued      int     `json:"certificatesIssued"`
	CertificatesExpiring7d  int     `json:"certificatesExpiring7d"`
	CertificatesExpiring30d int     `json:"certificatesExpiring30d"`
	JobsQueued              int     `json:"jobsQueued"`
	JobsRunning             int     `json:"jobsRunning"`
	FailedExecutions24h     int     `json:"failedExecutions24h"`
	ExecutionFailureRate30d float64 `json:"executionFailureRate30d"`
	InvalidCloudCredentials int     `json:"invalidCloudCredentials"`
	InvalidDNSAccounts      int     `json:"invalidDNSAccounts"`
	InvalidACMEAccounts     int     `json:"invalidACMEAccounts"`
	SMTPConfigured          bool    `json:"smtpConfigured"`
}

type DashboardExecutionTrend struct {
	Date      string `json:"date"`
	Succeeded int    `json:"succeeded"`
	Failed    int    `json:"failed"`
	Active    int    `json:"active"`
}

type DashboardExpiryBucket struct {
	Bucket string `json:"bucket"`
	Count  int    `json:"count"`
}

type AdminAutomationHealth struct {
	Healthy   int `json:"healthy"`
	Paused    int `json:"paused"`
	Attention int `json:"attention"`
}

type AdminRiskCertificate struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	OwnerEmail string     `json:"ownerEmail"`
	Status     string     `json:"status"`
	NotAfter   *time.Time `json:"notAfter"`
	LastError  string     `json:"lastError"`
}

type AdminFailedExecution struct {
	ID          string     `json:"id"`
	Kind        string     `json:"kind"`
	Certificate string     `json:"certificate"`
	OwnerEmail  string     `json:"ownerEmail"`
	StartedAt   *time.Time `json:"startedAt"`
	ErrorCode   string     `json:"errorCode"`
	Error       string     `json:"error"`
}

type AdminResourceOwner struct {
	UserID              string     `json:"userId"`
	Email               string     `json:"email"`
	CertificateCount    int        `json:"certificateCount"`
	AutomationCount     int        `json:"automationCount"`
	FailedExecutions30d int        `json:"failedExecutions30d"`
	LastActiveAt        *time.Time `json:"lastActiveAt"`
}

type CertificateSummary struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Domains        []string   `json:"domains"`
	Status         string     `json:"status"`
	KeyAlgorithm   string     `json:"keyAlgorithm"`
	ValidationMode string     `json:"validationMode"`
	NotAfter       *time.Time `json:"notAfter"`
	Fingerprint    string     `json:"fingerprint"`
	LastIssuedAt   *time.Time `json:"lastIssuedAt"`
	LastError      string     `json:"lastError"`
	CreatedAt      time.Time  `json:"createdAt"`
}

// CertificateDetail extends the list projection with editable certificate
// configuration. Sensitive material is intentionally never returned.
type CertificateDetail struct {
	CertificateSummary
	AcmeAccountID       string `json:"acmeAccountId"`
	DefaultDNSAccountID string `json:"defaultDnsAccountId"`
	RenewBeforeDays     int    `json:"renewBeforeDays"`
}

// CertificateVersionSummary is safe metadata for a historical issued version.
// It intentionally omits encrypted certificate and private-key material.
type CertificateVersionSummary struct {
	ID               string     `json:"id"`
	SerialNumber     string     `json:"serialNumber"`
	Fingerprint      string     `json:"fingerprint"`
	NotBefore        time.Time  `json:"notBefore"`
	NotAfter         time.Time  `json:"notAfter"`
	IssuedAt         time.Time  `json:"issuedAt"`
	RevokedAt        *time.Time `json:"revokedAt"`
	RevocationReason string     `json:"revocationReason"`
	IsCurrent        bool       `json:"isCurrent"`
}

type CertificateResourceReference struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

type CertificateAutomationReference struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	ActionType string `json:"actionType"`
	Enabled    bool   `json:"enabled"`
	LastStatus string `json:"lastStatus"`
}

type CertificateDeploymentReference struct {
	ID             string     `json:"id"`
	TargetID       string     `json:"targetId"`
	TargetName     string     `json:"targetName"`
	Enabled        bool       `json:"enabled"`
	AutoDeploy     bool       `json:"autoDeploy"`
	LastDeployedAt *time.Time `json:"lastDeployedAt"`
	LastError      string     `json:"lastError"`
}

type CertificateRelations struct {
	ACMEAccount *CertificateResourceReference    `json:"acmeAccount"`
	DNSAccount  *CertificateResourceReference    `json:"dnsAccount"`
	Automations []CertificateAutomationReference `json:"automations"`
	Deployments []CertificateDeploymentReference `json:"deployments"`
}

// ManualDNSCheck reports what the resolver can observe before the operator
// asks ACME to validate the DNS-01 records. It is advisory, not ACME proof.
type ManualDNSCheck struct {
	FQDN     string   `json:"fqdn"`
	Expected string   `json:"expected"`
	Observed []string `json:"observed"`
	Matched  bool     `json:"matched"`
	Error    string   `json:"error"`
}

type ExecutionSummary struct {
	ID          string     `json:"id"`
	Kind        string     `json:"kind"`
	Status      string     `json:"status"`
	Trigger     string     `json:"trigger"`
	Certificate string     `json:"certificate"`
	Target      string     `json:"target"`
	StartedAt   *time.Time `json:"startedAt"`
	FinishedAt  *time.Time `json:"finishedAt"`
	ErrorCode   string     `json:"errorCode"`
	Error       string     `json:"error"`
}

type CreateCertificateInput struct {
	Name                string   `json:"name"`
	AcmeAccountID       string   `json:"acmeAccountId"`
	DefaultDNSAccountID string   `json:"defaultDnsAccountId"`
	Domains             []string `json:"domains"`
	KeyAlgorithm        string   `json:"keyAlgorithm"`
	RenewBeforeDays     int      `json:"renewBeforeDays"`
	ValidationMode      string   `json:"validationMode"`
}

type CloudCredentialSummary struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Description    string     `json:"description"`
	Provider       string     `json:"provider"`
	AccessKeyID    string     `json:"accessKeyId"`
	CredentialHint string     `json:"credentialHint"`
	Status         string     `json:"status"`
	LastVerifiedAt *time.Time `json:"lastVerifiedAt"`
	LastError      string     `json:"lastError"`
	CreatedAt      time.Time  `json:"createdAt"`
}

type CreateCloudCredentialInput struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Provider    string                 `json:"provider"`    // Cloud provider: aliyun, aws, tencentcloud, etc.
	Credentials map[string]interface{} `json:"credentials"` // Provider-specific credentials
	// Legacy wire fields are accepted for compatibility with earlier Console clients.
	// New callers must use the provider-specific Credentials map.
	AccessKeyID     string `json:"accessKeyId,omitempty"`
	AccessKeySecret string `json:"accessKeySecret,omitempty"`
}

type ACMEAccountSummary struct {
	ID                  string     `json:"id"`
	Name                string     `json:"name"`
	DirectoryURL        string     `json:"directoryUrl"`
	AccountURL          string     `json:"accountUrl"`
	Email               string     `json:"email"`
	PrivateKeyAlgorithm string     `json:"privateKeyAlgorithm"`
	Status              string     `json:"status"`
	LastVerifiedAt      *time.Time `json:"lastVerifiedAt"`
	LastError           string     `json:"lastError"`
	CertificateCount    int        `json:"certificateCount"`
	AutomationCount     int        `json:"automationCount"`
	CreatedAt           time.Time  `json:"createdAt"`
}

type CreateACMEAccountInput struct {
	Name                string `json:"name"`
	DirectoryURL        string `json:"directoryUrl"`
	Email               string `json:"email"`
	PrivateKey          string `json:"privateKey"`
	PrivateKeyAlgorithm string `json:"privateKeyAlgorithm"`
}

type DNSAccountSummary struct {
	ID                          string     `json:"id"`
	Name                        string     `json:"name"`
	Description                 string     `json:"description"`
	Provider                    string     `json:"provider"`
	CloudCredentialID           string     `json:"cloudCredentialId"`
	AllowedZones                []string   `json:"allowedZones"`
	Status                      string     `json:"status"`
	LastVerifiedAt              *time.Time `json:"lastVerifiedAt"`
	LastError                   string     `json:"lastError"`
	VerifiedCredentialVersionID string     `json:"verifiedCredentialVersionId"`
	CreatedAt                   time.Time  `json:"createdAt"`
}

type CreateDNSAccountInput struct {
	Name              string   `json:"name"`
	Description       string   `json:"description"`
	CloudCredentialID string   `json:"cloudCredentialId"`
	AllowedZones      []string `json:"allowedZones"`
}

type DeploymentTargetSummary struct {
	ID                string    `json:"id"`
	Name              string    `json:"name"`
	CloudCredentialID string    `json:"cloudCredentialId"`
	RegionID          string    `json:"regionId"`
	LoadBalancerID    string    `json:"loadBalancerId"`
	ListenerID        string    `json:"listenerId"`
	ListenerProtocol  string    `json:"listenerProtocol"`
	Status            string    `json:"status"`
	CreatedAt         time.Time `json:"createdAt"`
}

type CreateDeploymentTargetInput struct {
	Name              string `json:"name"`
	CloudCredentialID string `json:"cloudCredentialId"`
	RegionID          string `json:"regionId"`
	LoadBalancerID    string `json:"loadBalancerId"`
	ListenerID        string `json:"listenerId"`
}

type CertificateDeploymentSummary struct {
	ID             string     `json:"id"`
	CertificateID  string     `json:"certificateId"`
	TargetID       string     `json:"targetId"`
	TargetName     string     `json:"targetName"`
	AutoDeploy     bool       `json:"autoDeploy"`
	Enabled        bool       `json:"enabled"`
	LastDeployedAt *time.Time `json:"lastDeployedAt"`
	LastError      string     `json:"lastError"`
}

type CreateCertificateDeploymentInput struct {
	CertificateID string `json:"certificateId"`
	TargetID      string `json:"targetId"`
	AutoDeploy    bool   `json:"autoDeploy"`
}

type AutomationTaskSummary struct {
	ID                string     `json:"id"`
	Name              string     `json:"name"`
	CertificateID     string     `json:"certificateId"`
	CertificateName   string     `json:"certificateName"`
	ActionType        string     `json:"actionType"`
	IntervalMinutes   int        `json:"intervalMinutes"`
	Enabled           bool       `json:"enabled"`
	NextRunAt         *time.Time `json:"nextRunAt"`
	LastRunAt         *time.Time `json:"lastRunAt"`
	LastStatus        string     `json:"lastStatus"`
	LastError         string     `json:"lastError"`
	TargetCount       int        `json:"targetCount"`
	CloudCredentialID string     `json:"cloudCredentialId"`
	TargetIDs         []string   `json:"targetIds"`
	CreatedAt         time.Time  `json:"createdAt"`
}

type AutomationRunSummary struct {
	ID                   string     `json:"id"`
	AutomationTaskID     string     `json:"automationTaskId"`
	CertificateID        string     `json:"certificateId"`
	CertificateVersionID string     `json:"certificateVersionId"`
	TriggerType          string     `json:"triggerType"`
	Status               string     `json:"status"`
	TotalJobs            int        `json:"totalJobs"`
	SucceededJobs        int        `json:"succeededJobs"`
	FailedJobs           int        `json:"failedJobs"`
	StartedAt            *time.Time `json:"startedAt"`
	FinishedAt           *time.Time `json:"finishedAt"`
	LastError            string     `json:"lastError"`
	CreatedAt            time.Time  `json:"createdAt"`
}

type CreateAutomationTaskInput struct {
	Name                string   `json:"name"`
	CertificateID       string   `json:"certificateId"`
	ActionType          string   `json:"actionType"`
	IntervalMinutes     int      `json:"intervalMinutes"`
	CloudCredentialID   string   `json:"cloudCredentialId"`
	DeploymentTargetIDs []string `json:"deploymentTargetIds"`
	// InlineDeploymentTarget lets the ALB automation form create or reuse a
	// listener target without requiring an operator to leave the task flow.
	InlineDeploymentTarget *CreateDeploymentTargetInput `json:"inlineDeploymentTarget,omitempty"`
	Enabled                bool                         `json:"enabled"`
}
