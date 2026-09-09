package domain

import "time"

type Dashboard struct {
	ActiveCertificates int `json:"activeCertificates"`
	ExpiringSoon       int `json:"expiringSoon"`
	RunningJobs        int `json:"runningJobs"`
	FailedExecutions   int `json:"failedExecutions"`
}

type CertificateSummary struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Domains        []string   `json:"domains"`
	Status         string     `json:"status"`
	KeyAlgorithm   string     `json:"keyAlgorithm"`
	ValidationMode string     `json:"validationMode"`
	RenewEnabled   bool       `json:"renewEnabled"`
	NotAfter       *time.Time `json:"notAfter"`
	Fingerprint    string     `json:"fingerprint"`
	LastIssuedAt   *time.Time `json:"lastIssuedAt"`
	LastError      string     `json:"lastError"`
	CreatedAt      time.Time  `json:"createdAt"`
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
	Error       string     `json:"error"`
}

type CreateCertificateInput struct {
	Name                string   `json:"name"`
	AcmeAccountID       string   `json:"acmeAccountId"`
	DefaultDNSAccountID string   `json:"defaultDnsAccountId"`
	Domains             []string `json:"domains"`
	KeyAlgorithm        string   `json:"keyAlgorithm"`
	RenewEnabled        bool     `json:"renewEnabled"`
	RenewBeforeDays     int      `json:"renewBeforeDays"`
	ValidationMode      string   `json:"validationMode"`
}

type CloudCredentialSummary struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Provider       string     `json:"provider"`
	CredentialHint string     `json:"credentialHint"`
	Status         string     `json:"status"`
	LastVerifiedAt *time.Time `json:"lastVerifiedAt"`
	CreatedAt      time.Time  `json:"createdAt"`
}

type CreateCloudCredentialInput struct {
	Name            string `json:"name"`
	AccessKeyID     string `json:"accessKeyId"`
	AccessKeySecret string `json:"accessKeySecret"`
}

type ACMEAccountSummary struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	DirectoryURL string    `json:"directoryUrl"`
	Email        string    `json:"email"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
}

type CreateACMEAccountInput struct {
	Name                string `json:"name"`
	DirectoryURL        string `json:"directoryUrl"`
	Email               string `json:"email"`
	PrivateKey          string `json:"privateKey"`
	PrivateKeyAlgorithm string `json:"privateKeyAlgorithm"`
}

type DNSAccountSummary struct {
	ID                string     `json:"id"`
	Name              string     `json:"name"`
	Provider          string     `json:"provider"`
	CloudCredentialID string     `json:"cloudCredentialId"`
	AllowedZones      []string   `json:"allowedZones"`
	Status            string     `json:"status"`
	LastVerifiedAt    *time.Time `json:"lastVerifiedAt"`
	CreatedAt         time.Time  `json:"createdAt"`
}

type CreateDNSAccountInput struct {
	Name              string   `json:"name"`
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
