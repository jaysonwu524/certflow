// Package aliyun implements the restricted DNS capabilities CertFlow needs
// against Aliyun's DNS RPC API.
package aliyun

import (
	"context"
	"crypto/hmac"
	"crypto/sha1" // Aliyun's RPC API requires HMAC-SHA1 signatures.
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/regenbio/certflow/apps/control-plane/internal/id"
)

const defaultEndpoint = "https://alidns.aliyuncs.com/"

type Credentials struct {
	AccessKeyID     string
	AccessKeySecret string
}

type Client struct {
	endpoint   string
	httpClient *http.Client
	now        func() time.Time
	nonce      func() string
}

func New() *Client {
	return NewWithEndpoint(defaultEndpoint, http.DefaultClient)
}

// NewWithEndpoint exists for integration tests and private Aliyun-compatible
// endpoints. Production callers should use New.
func NewWithEndpoint(endpoint string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{
		endpoint:   endpoint,
		httpClient: httpClient,
		now:        time.Now,
		nonce:      id.New,
	}
}

type ZoneRef struct {
	Name string
}

type Zone struct {
	Name string `json:"name"`
}

// ListZones returns all DNS domains visible to the configured Aliyun
// credentials. The result is used to build the DNS account allowlist; the
// allowlist is still enforced independently during certificate issuance.
func (c *Client) ListZones(ctx context.Context, credentials Credentials) ([]Zone, error) {
	const pageSize = 100
	zones := make([]Zone, 0)
	for pageNumber := 1; ; pageNumber++ {
		var response describeDomainListResponse
		if err := c.call(ctx, credentials, "DescribeDomains", url.Values{
			"PageNumber": {fmt.Sprintf("%d", pageNumber)},
			"PageSize":   {fmt.Sprintf("%d", pageSize)},
		}, &response); err != nil {
			return nil, err
		}
		for _, domain := range response.Domains.Domain {
			name := normalizeName(domain.DomainName)
			if name != "" {
				zones = append(zones, Zone{Name: name})
			}
		}
		if len(response.Domains.Domain) == 0 || len(response.Domains.Domain) < pageSize || (response.Domains.TotalCount > 0 && len(zones) >= response.Domains.TotalCount) {
			break
		}
	}
	sort.Slice(zones, func(i, j int) bool { return zones[i].Name < zones[j].Name })
	return zones, nil
}

type RecordRef struct {
	Zone     string
	RecordID string
	FQDN     string
	Value    string
	// Reused records predate this issuance attempt and must never be removed by it.
	Reused bool
}

// ListTXT returns TXT records for an exact relative name. It is intended for
// diagnostics and conservative orphan cleanup; callers must still verify the
// value before deleting a record.
func (c *Client) ListTXT(ctx context.Context, credentials Credentials, zone ZoneRef, fqdn string) ([]RecordRef, error) {
	rr, err := relativeRecordName(normalizeName(fqdn), normalizeName(zone.Name))
	if err != nil {
		return nil, err
	}
	var response describeDomainRecordsResponse
	if err := c.call(ctx, credentials, "DescribeDomainRecords", url.Values{
		"DomainName":  {normalizeName(zone.Name)},
		"RRKeyWord":   {rr},
		"TypeKeyWord": {"TXT"},
		"PageSize":    {"100"},
	}, &response); err != nil {
		return nil, err
	}
	items := make([]RecordRef, 0, len(response.DomainRecords.Record))
	for _, item := range response.DomainRecords.Record {
		itemID := item.RecordID
		if itemID == "" {
			itemID = item.DomainRecordID
		}
		items = append(items, RecordRef{Zone: normalizeName(zone.Name), RecordID: itemID, FQDN: normalizeName(fqdn), Value: item.Value})
	}
	return items, nil
}

// ResolveZone selects the most-specific configured zone that contains fqdn,
// then verifies that the caller can enumerate that exact Aliyun DNS zone.
func (c *Client) ResolveZone(ctx context.Context, credentials Credentials, allowedZones []string, fqdn string) (ZoneRef, error) {
	fqdn = normalizeName(fqdn)
	zone := ""
	for _, candidate := range allowedZones {
		candidate = normalizeName(candidate)
		if candidate == "" || !isWithinZone(fqdn, candidate) {
			continue
		}
		if len(candidate) > len(zone) {
			zone = candidate
		}
	}
	if zone == "" {
		return ZoneRef{}, &Error{Code: "zone_not_allowed", Message: "DNS name is outside the configured allowed zones"}
	}

	var response describeDomainRecordsResponse
	if err := c.call(ctx, credentials, "DescribeDomainRecords", url.Values{
		"DomainName": {zone},
		"PageSize":   {"1"},
	}, &response); err != nil {
		return ZoneRef{}, err
	}
	return ZoneRef{Name: zone}, nil
}

func (c *Client) PresentTXT(ctx context.Context, credentials Credentials, zone ZoneRef, fqdn, value string) (RecordRef, error) {
	fqdn = normalizeName(fqdn)
	if zone.Name == "" || !isWithinZone(fqdn, zone.Name) {
		return RecordRef{}, &Error{Code: "zone_mismatch", Message: "DNS name is outside the resolved zone"}
	}
	if strings.TrimSpace(value) == "" {
		return RecordRef{}, &Error{Code: "invalid_txt_value", Message: "DNS TXT value is required"}
	}
	existing, err := c.ListTXT(ctx, credentials, zone, fqdn)
	if err != nil {
		return RecordRef{}, err
	}
	for _, record := range existing {
		if record.Value == value {
			record.Reused = true
			return record, nil
		}
	}
	rr, err := relativeRecordName(fqdn, zone.Name)
	if err != nil {
		return RecordRef{}, err
	}

	var response addDomainRecordResponse
	if err := c.call(ctx, credentials, "AddDomainRecord", url.Values{
		"DomainName": {zone.Name},
		"RR":         {rr},
		"Type":       {"TXT"},
		"Value":      {value},
	}, &response); err != nil {
		return RecordRef{}, err
	}
	recordID := response.RecordID
	if recordID == "" {
		recordID = response.DomainRecordID
	}
	if recordID == "" {
		return RecordRef{}, &Error{Code: "invalid_provider_response", Message: "Aliyun DNS did not return a record ID"}
	}
	return RecordRef{Zone: zone.Name, RecordID: recordID, FQDN: fqdn, Value: value}, nil
}

// CleanupTXT re-reads the provider's record before deletion. A record changed
// or replaced after creation is intentionally left intact for an operator.
func (c *Client) CleanupTXT(ctx context.Context, credentials Credentials, record RecordRef) error {
	if record.Reused {
		return nil
	}
	if record.Zone == "" || record.RecordID == "" || record.FQDN == "" || record.Value == "" {
		return &Error{Code: "invalid_record_reference", Message: "DNS record reference is incomplete"}
	}
	rr, err := relativeRecordName(normalizeName(record.FQDN), normalizeName(record.Zone))
	if err != nil {
		return err
	}

	var records describeDomainRecordsResponse
	if err := c.call(ctx, credentials, "DescribeDomainRecords", url.Values{
		"DomainName":  {record.Zone},
		"RRKeyWord":   {rr},
		"TypeKeyWord": {"TXT"},
		"PageSize":    {"100"},
	}, &records); err != nil {
		return err
	}
	matched := false
	for _, item := range records.DomainRecords.Record {
		itemID := item.RecordID
		if itemID == "" {
			itemID = item.DomainRecordID
		}
		if itemID == record.RecordID && item.RR == rr && item.Type == "TXT" && item.Value == record.Value {
			matched = true
			break
		}
	}
	if !matched {
		return &Error{Code: "record_not_owned", Message: "DNS record no longer matches the record created by this execution"}
	}
	return c.call(ctx, credentials, "DeleteDomainRecord", url.Values{"RecordId": {record.RecordID}}, nil)
}

type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

func (c *Client) call(ctx context.Context, credentials Credentials, action string, params url.Values, target any) error {
	if strings.TrimSpace(credentials.AccessKeyID) == "" || strings.TrimSpace(credentials.AccessKeySecret) == "" {
		return &Error{Code: "credentials_missing", Message: "Aliyun credentials are missing"}
	}
	values := make(url.Values, len(params)+8)
	for key, input := range params {
		values[key] = append([]string(nil), input...)
	}
	values.Set("Action", action)
	values.Set("Format", "JSON")
	values.Set("Version", "2015-01-09")
	values.Set("AccessKeyId", credentials.AccessKeyID)
	values.Set("SignatureMethod", "HMAC-SHA1")
	values.Set("SignatureVersion", "1.0")
	values.Set("SignatureNonce", c.nonce())
	values.Set("Timestamp", c.now().UTC().Format("2006-01-02T15:04:05Z"))
	values.Set("Signature", sign("POST", values, credentials.AccessKeySecret))

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return fmt.Errorf("create Aliyun DNS request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := c.httpClient.Do(req)
	if err != nil {
		return &Error{Code: "dns_api_unavailable", Message: "Aliyun DNS API request failed"}
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return &Error{Code: "dns_api_unavailable", Message: "could not read Aliyun DNS API response"}
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		var apiError struct {
			Code    string `json:"Code"`
			Message string `json:"Message"`
		}
		_ = json.Unmarshal(body, &apiError)
		if apiError.Code == "" {
			apiError.Code = "dns_api_error"
		}
		return &Error{Code: strings.ToLower(apiError.Code), Message: safeProviderMessage(apiError.Message)}
	}
	if target == nil {
		return nil
	}
	if err := json.Unmarshal(body, target); err != nil {
		return &Error{Code: "invalid_provider_response", Message: "Aliyun DNS returned an invalid response"}
	}
	return nil
}

func sign(method string, values url.Values, secret string) string {
	canonical := canonicalQuery(values)
	stringToSign := method + "&%2F&" + percentEncode(canonical)
	mac := hmac.New(sha1.New, []byte(secret+"&"))
	_, _ = mac.Write([]byte(stringToSign))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func canonicalQuery(values url.Values) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		if key != "Signature" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		values := append([]string(nil), values[key]...)
		sort.Strings(values)
		for _, value := range values {
			parts = append(parts, percentEncode(key)+"="+percentEncode(value))
		}
	}
	return strings.Join(parts, "&")
}

func percentEncode(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}

func relativeRecordName(fqdn, zone string) (string, error) {
	if !isWithinZone(fqdn, zone) {
		return "", &Error{Code: "zone_mismatch", Message: "DNS name is outside the resolved zone"}
	}
	if fqdn == zone {
		return "@", nil
	}
	return strings.TrimSuffix(fqdn, "."+zone), nil
}

func isWithinZone(fqdn, zone string) bool {
	return fqdn == zone || strings.HasSuffix(fqdn, "."+zone)
}

func normalizeName(name string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(name)), ".")
}

func safeProviderMessage(message string) string {
	message = strings.TrimSpace(message)
	if message == "" {
		return "Aliyun DNS API rejected the request"
	}
	if len(message) > 300 {
		return message[:300]
	}
	return message
}

type addDomainRecordResponse struct {
	RecordID       string `json:"RecordId"`
	DomainRecordID string `json:"DomainRecordId"`
}

type describeDomainRecordsResponse struct {
	DomainRecords struct {
		Record []struct {
			RecordID       string `json:"RecordId"`
			DomainRecordID string `json:"DomainRecordId"`
			RR             string `json:"RR"`
			Type           string `json:"Type"`
			Value          string `json:"Value"`
		} `json:"Record"`
	} `json:"DomainRecords"`
}

type describeDomainListResponse struct {
	Domains struct {
		Domain []struct {
			DomainName string `json:"DomainName"`
		} `json:"Domain"`
		TotalCount int `json:"TotalCount"`
	} `json:"Domains"`
}
