// Package aliyun implements the cloudprovider interfaces for Alibaba Cloud.
package aliyun

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/regenbio/certflow/internal/alb"
	"github.com/regenbio/certflow/internal/aliyunrpc"
	"github.com/regenbio/certflow/internal/cas"
	"github.com/regenbio/certflow/internal/cloudprovider"
	dnsaliyun "github.com/regenbio/certflow/internal/dns/aliyun"
	"github.com/regenbio/certflow/internal/id"
)

// Provider implements cloudprovider interfaces for Alibaba Cloud.
type Provider struct {
	albClient *alb.Client
	casClient *cas.Client
	dnsClient *dnsaliyun.Client
	stsClient *aliyunrpc.Client
}

var (
	_ cloudprovider.DNSProvider               = (*Provider)(nil)
	_ cloudprovider.CertificateUploadProvider = (*Provider)(nil)
	_ cloudprovider.CertificateLookupProvider = (*Provider)(nil)
	_ cloudprovider.LoadBalancerProvider      = (*Provider)(nil)
)

// New creates a new Aliyun provider instance.
func New() *Provider {
	return &Provider{
		albClient: alb.New(),
		casClient: cas.New(),
		dnsClient: dnsaliyun.New(),
		stsClient: aliyunrpc.New(nil),
	}
}

// Name returns the provider name.
func (p *Provider) Name() string {
	return "aliyun"
}

// Credentials represents Aliyun access credentials.
type Credentials struct {
	AccessKeyID     string `json:"access_key_id"`
	AccessKeySecret string `json:"access_key_secret"`
}

// Provider returns the provider name.
func (c Credentials) Provider() string {
	return "aliyun"
}

// Marshal serializes credentials to JSON.
func (c Credentials) Marshal() ([]byte, error) {
	return json.Marshal(c)
}

// UnmarshalCredentials deserializes Aliyun credentials from JSON.
func decodeCredentials(data []byte) (Credentials, error) {
	var cred Credentials
	if err := json.Unmarshal(data, &cred); err != nil {
		return Credentials{}, fmt.Errorf("unmarshal aliyun credentials: %w", err)
	}
	return cred, nil
}

// CredentialsFromMap converts API input into the provider's typed credential.
func (p *Provider) CredentialsFromMap(values map[string]interface{}) (cloudprovider.Credentials, error) {
	accessKeyID := stringValue(values, "access_key_id", "accessKeyId")
	accessKeySecret := stringValue(values, "access_key_secret", "accessKeySecret")
	credentials := Credentials{AccessKeyID: accessKeyID, AccessKeySecret: accessKeySecret}
	if err := p.ValidateCredentials(context.Background(), credentials); err != nil {
		return nil, err
	}
	return credentials, nil
}

// UnmarshalCredentials restores encrypted credential JSON for a worker.
func (p *Provider) UnmarshalCredentials(data []byte) (cloudprovider.Credentials, error) {
	credentials, err := decodeCredentials(data)
	if err != nil {
		return nil, err
	}
	if err := p.ValidateCredentials(context.Background(), credentials); err != nil {
		return nil, err
	}
	return credentials, nil
}

func stringValue(values map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value, ok := values[key].(string); ok {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// ValidateCredentials validates credential format.
func (p *Provider) ValidateCredentials(ctx context.Context, credentials cloudprovider.Credentials) error {
	aliyunCred, ok := credentials.(Credentials)
	if !ok {
		return fmt.Errorf("invalid credential type for aliyun provider")
	}

	if strings.TrimSpace(aliyunCred.AccessKeyID) == "" {
		return fmt.Errorf("access_key_id is required")
	}

	if strings.TrimSpace(aliyunCred.AccessKeySecret) == "" {
		return fmt.Errorf("access_key_secret is required")
	}

	return nil
}

// VerifyCredentials performs a lightweight live STS call. It verifies that
// the AccessKey pair is authentic without requiring DNS, CAS, or ALB-specific
// permissions, which may legitimately differ between credential use cases.
func (p *Provider) VerifyCredentials(ctx context.Context, credentials cloudprovider.Credentials) error {
	aliyunCred, ok := credentials.(Credentials)
	if !ok {
		return fmt.Errorf("invalid credential type for aliyun provider")
	}
	if err := p.ValidateCredentials(ctx, aliyunCred); err != nil {
		return err
	}
	return p.stsClient.Call(ctx, "https://sts.aliyuncs.com/", "2015-04-01", "GetCallerIdentity", toAliyunRPCCredentials(aliyunCred), nil, nil)
}

// GetCredentialHint returns a hint for the credential.
func (p *Provider) GetCredentialHint(credentials cloudprovider.Credentials) string {
	aliyunCred, ok := credentials.(Credentials)
	if !ok || len(aliyunCred.AccessKeyID) <= 4 {
		return ""
	}
	return "****" + aliyunCred.AccessKeyID[len(aliyunCred.AccessKeyID)-4:]
}

// GetCredentialIdentifier returns the AccessKey ID. It is an identifier, not
// a secret, and is safe to display to help users locate a credential.
func (p *Provider) GetCredentialIdentifier(credentials cloudprovider.Credentials) string {
	aliyunCred, ok := credentials.(Credentials)
	if !ok {
		return ""
	}
	return aliyunCred.AccessKeyID
}

// toAliyunRPCCredentials converts to aliyunrpc.Credentials.
func toAliyunRPCCredentials(cred Credentials) aliyunrpc.Credentials {
	return aliyunrpc.Credentials{
		AccessKeyID:     cred.AccessKeyID,
		AccessKeySecret: cred.AccessKeySecret,
	}
}

// toDNSCredentials converts to dns/aliyun.Credentials.
func toDNSCredentials(cred Credentials) dnsaliyun.Credentials {
	return dnsaliyun.Credentials{
		AccessKeyID:     cred.AccessKeyID,
		AccessKeySecret: cred.AccessKeySecret,
	}
}

// --- DNSProvider implementation ---

// CreateDNSRecord creates a DNS record for ACME validation.
func (p *Provider) CreateDNSRecord(ctx context.Context, credentials cloudprovider.Credentials, zone, name, recordType, value string, ttl int) error {
	aliyunCred, ok := credentials.(Credentials)
	if !ok {
		return fmt.Errorf("invalid credential type for aliyun provider")
	}

	zoneRef := dnsaliyun.ZoneRef{Name: zone}
	fqdn := name
	if name != zone && !strings.HasSuffix(name, "."+zone) {
		fqdn = name + "." + zone
	}

	_, err := p.dnsClient.PresentTXT(ctx, toDNSCredentials(aliyunCred), zoneRef, fqdn, value)
	return err
}

// DeleteDNSRecord deletes a DNS record.
func (p *Provider) DeleteDNSRecord(ctx context.Context, credentials cloudprovider.Credentials, zone, name, recordType string) error {
	aliyunCred, ok := credentials.(Credentials)
	if !ok {
		return fmt.Errorf("invalid credential type for aliyun provider")
	}

	zoneRef := dnsaliyun.ZoneRef{Name: zone}
	fqdn := name
	if name != zone && !strings.HasSuffix(name, "."+zone) {
		fqdn = name + "." + zone
	}

	records, err := p.dnsClient.ListTXT(ctx, toDNSCredentials(aliyunCred), zoneRef, fqdn)
	if err != nil {
		return err
	}

	for _, record := range records {
		if err := p.dnsClient.CleanupTXT(ctx, toDNSCredentials(aliyunCred), record); err != nil {
			return err
		}
	}

	return nil
}

// ListZones lists available DNS zones.
func (p *Provider) ListZones(ctx context.Context, credentials cloudprovider.Credentials) ([]cloudprovider.DNSZone, error) {
	aliyunCred, ok := credentials.(Credentials)
	if !ok {
		return nil, fmt.Errorf("invalid credential type for aliyun provider")
	}

	zones, err := p.dnsClient.ListZones(ctx, toDNSCredentials(aliyunCred))
	if err != nil {
		return nil, err
	}

	result := make([]cloudprovider.DNSZone, len(zones))
	for i, z := range zones {
		result[i] = cloudprovider.DNSZone{
			ID:   z.Name,
			Name: z.Name,
		}
	}
	return result, nil
}

// VerifyDNSAccess proves that a credential can write and remove a TXT record
// in the selected zone. The record name and value are unique to this check;
// cleanup re-reads the record and never removes an operator-owned value.
func (p *Provider) VerifyDNSAccess(ctx context.Context, credentials cloudprovider.Credentials, zone cloudprovider.DNSZone) error {
	aliyunCred, ok := credentials.(Credentials)
	if !ok {
		return fmt.Errorf("invalid credential type for aliyun provider")
	}
	zoneName := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(zone.Name)), ".")
	if zoneName == "" {
		return fmt.Errorf("DNS zone is required")
	}
	marker := id.New()
	fqdn := "_certflow-verification-" + marker + "." + zoneName
	record, err := p.dnsClient.PresentTXT(ctx, toDNSCredentials(aliyunCred), dnsaliyun.ZoneRef{Name: zoneName}, fqdn, marker)
	if err != nil {
		return err
	}
	if err := p.dnsClient.CleanupTXT(ctx, toDNSCredentials(aliyunCred), record); err != nil {
		return err
	}
	return nil
}

// --- CertificateUploadProvider implementation ---

// UploadCertificate uploads a certificate to Aliyun Certificate Management Service.
func (p *Provider) UploadCertificate(ctx context.Context, credentials cloudprovider.Credentials, req cloudprovider.UploadCertificateRequest) (string, error) {
	aliyunCred, ok := credentials.(Credentials)
	if !ok {
		return "", fmt.Errorf("invalid credential type for aliyun provider")
	}

	// Combine certificate and chain for Aliyun CAS
	fullCert := req.CertificatePEM
	if req.ChainPEM != "" {
		fullCert = req.CertificatePEM + req.ChainPEM
	}

	return p.casClient.UploadUserCertificate(ctx, toAliyunRPCCredentials(aliyunCred), req.Name, fullCert, req.PrivateKeyPEM)
}

func (p *Provider) CertificateExists(ctx context.Context, credentials cloudprovider.Credentials, certificateID string) (bool, error) {
	aliyunCred, ok := credentials.(Credentials)
	if !ok {
		return false, fmt.Errorf("invalid credential type for aliyun provider")
	}
	return p.casClient.UserCertificateExists(ctx, toAliyunRPCCredentials(aliyunCred), certificateID)
}

// --- LoadBalancerProvider implementation ---

// ListRegions lists available Aliyun regions.
func (p *Provider) ListRegions(ctx context.Context, credentials cloudprovider.Credentials) ([]cloudprovider.Region, error) {
	aliyunCred, ok := credentials.(Credentials)
	if !ok {
		return nil, fmt.Errorf("invalid credential type for aliyun provider")
	}

	regions, err := p.albClient.ListRegions(ctx, toAliyunRPCCredentials(aliyunCred))
	if err != nil {
		return nil, err
	}

	result := make([]cloudprovider.Region, len(regions))
	for i, r := range regions {
		result[i] = cloudprovider.Region{
			ID:   r.ID,
			Name: r.Name,
		}
	}
	return result, nil
}

// ListLoadBalancers lists load balancers in a region.
func (p *Provider) ListLoadBalancers(ctx context.Context, credentials cloudprovider.Credentials, regionID string) ([]cloudprovider.LoadBalancer, error) {
	aliyunCred, ok := credentials.(Credentials)
	if !ok {
		return nil, fmt.Errorf("invalid credential type for aliyun provider")
	}

	lbs, err := p.albClient.ListLoadBalancers(ctx, toAliyunRPCCredentials(aliyunCred), regionID)
	if err != nil {
		return nil, err
	}

	result := make([]cloudprovider.LoadBalancer, len(lbs))
	for i, lb := range lbs {
		result[i] = cloudprovider.LoadBalancer{
			ID:      lb.ID,
			Name:    lb.Name,
			Status:  lb.Status,
			DNSName: lb.DNSName,
		}
	}
	return result, nil
}

// ListListeners lists listeners for a load balancer.
func (p *Provider) ListListeners(ctx context.Context, credentials cloudprovider.Credentials, regionID, loadBalancerID string) ([]cloudprovider.Listener, error) {
	aliyunCred, ok := credentials.(Credentials)
	if !ok {
		return nil, fmt.Errorf("invalid credential type for aliyun provider")
	}

	listeners, err := p.albClient.ListListeners(ctx, toAliyunRPCCredentials(aliyunCred), regionID, loadBalancerID)
	if err != nil {
		return nil, err
	}

	result := make([]cloudprovider.Listener, len(listeners))
	for i, l := range listeners {
		result[i] = cloudprovider.Listener{
			ID:          l.ID,
			Port:        l.Port,
			Protocol:    l.Protocol,
			Description: l.Description,
			Status:      l.Status,
		}
	}
	return result, nil
}

// UpdateListenerCertificate updates the certificate for an ALB listener.
func (p *Provider) UpdateListenerCertificate(ctx context.Context, credentials cloudprovider.Credentials, req cloudprovider.UpdateCertificateRequest) error {
	aliyunCred, ok := credentials.(Credentials)
	if !ok {
		return fmt.Errorf("invalid credential type for aliyun provider")
	}

	return p.albClient.ReplaceDefaultCertificate(ctx, toAliyunRPCCredentials(aliyunCred), req.RegionID, req.ListenerID, req.CertificateID)
}
