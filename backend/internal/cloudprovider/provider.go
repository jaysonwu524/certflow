// Package cloudprovider defines the strategy pattern interfaces for multi-cloud support.
package cloudprovider

import "context"

// Provider defines the base capabilities of a cloud platform provider.
type Provider interface {
	// Name returns the provider name (aliyun, aws, tencentcloud, etc.)
	Name() string

	// ValidateCredentials validates credential format and availability
	ValidateCredentials(ctx context.Context, credentials Credentials) error

	// VerifyCredentials performs a live provider call to confirm that the
	// credentials are authentic and usable before an external operation starts.
	VerifyCredentials(ctx context.Context, credentials Credentials) error

	// GetCredentialHint returns a hint for the credential (e.g., first 4 chars of access key)
	GetCredentialHint(credentials Credentials) string

	// GetCredentialIdentifier returns a non-secret identifier suitable for UI
	// display and resource lookup (for example, an AccessKey ID).
	GetCredentialIdentifier(credentials Credentials) string

	// CredentialsFromMap validates request input and converts it into the
	// provider's typed credential value before encrypted persistence.
	CredentialsFromMap(values map[string]interface{}) (Credentials, error)

	// UnmarshalCredentials restores a provider-specific credential from its
	// encrypted JSON payload for a worker operation.
	UnmarshalCredentials(data []byte) (Credentials, error)
}

// Credentials is the unified credential interface.
type Credentials interface {
	// Provider returns the provider name this credential belongs to
	Provider() string

	// Marshal serializes credentials to JSON (for encrypted storage)
	Marshal() ([]byte, error)
}

// DNSProvider defines DNS operation capabilities.
type DNSProvider interface {
	Provider

	// CreateDNSRecord creates a DNS record (for ACME DNS-01 validation)
	CreateDNSRecord(ctx context.Context, credentials Credentials, zone, name, recordType, value string, ttl int) error

	// DeleteDNSRecord deletes a DNS record
	DeleteDNSRecord(ctx context.Context, credentials Credentials, zone, name, recordType string) error

	// ListZones lists available DNS zones
	ListZones(ctx context.Context, credentials Credentials) ([]DNSZone, error)

	// VerifyDNSAccess performs a least-privilege write/delete check in the
	// supplied zone. Providers must use a unique temporary TXT record and
	// remove only the record created by this check.
	VerifyDNSAccess(ctx context.Context, credentials Credentials, zone DNSZone) error
}

// DNSZone represents a DNS zone.
type DNSZone struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// CertificateUploadProvider defines certificate upload capabilities.
type CertificateUploadProvider interface {
	Provider

	// UploadCertificate uploads a certificate to the cloud platform certificate management service
	UploadCertificate(ctx context.Context, credentials Credentials, req UploadCertificateRequest) (string, error)
}

// CertificateLookupProvider verifies a provider-side certificate before a
// previously stored remote ID is reused by an upload or deployment task.
type CertificateLookupProvider interface {
	Provider

	CertificateExists(ctx context.Context, credentials Credentials, certificateID string) (bool, error)
}

// UploadCertificateRequest contains certificate upload parameters.
type UploadCertificateRequest struct {
	Name           string
	CertificatePEM string
	PrivateKeyPEM  string
	ChainPEM       string
}

// LoadBalancerProvider defines load balancer operation capabilities.
type LoadBalancerProvider interface {
	Provider

	// ListRegions lists available regions
	ListRegions(ctx context.Context, credentials Credentials) ([]Region, error)

	// ListLoadBalancers lists load balancers in a region
	ListLoadBalancers(ctx context.Context, credentials Credentials, regionID string) ([]LoadBalancer, error)

	// ListListeners lists listeners for a load balancer
	ListListeners(ctx context.Context, credentials Credentials, regionID, loadBalancerID string) ([]Listener, error)

	// UpdateListenerCertificate updates the certificate for a listener
	UpdateListenerCertificate(ctx context.Context, credentials Credentials, req UpdateCertificateRequest) error
}

// Region represents a cloud region.
type Region struct {
	ID   string
	Name string
}

// LoadBalancer represents a load balancer instance.
type LoadBalancer struct {
	ID      string
	Name    string
	Status  string
	DNSName string
}

// Listener represents a load balancer listener.
type Listener struct {
	ID          string
	Port        int
	Protocol    string
	Description string
	Status      string
}

// UpdateCertificateRequest contains parameters for updating listener certificate.
type UpdateCertificateRequest struct {
	RegionID       string
	LoadBalancerID string
	ListenerID     string
	CertificateID  string
}
