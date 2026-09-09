// Package aliyunrpc implements the signed RPC transport shared by Aliyun APIs.
package aliyunrpc

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/regenbio/certflow/internal/id"
)

type Credentials struct {
	AccessKeyID     string
	AccessKeySecret string
}

type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

type Client struct {
	httpClient *http.Client
	now        func() time.Time
	nonce      func() string
}

func New(httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{httpClient: httpClient, now: time.Now, nonce: id.New}
}

// Call sends a signed Aliyun RPC request. Provider messages are returned only
// after stripping whitespace so callers can map them to stable public errors.
func (c *Client) Call(ctx context.Context, endpoint, version, action string, credentials Credentials, params url.Values, target any) error {
	if strings.TrimSpace(credentials.AccessKeyID) == "" || strings.TrimSpace(credentials.AccessKeySecret) == "" {
		return &Error{Code: "credentials_missing", Message: "Aliyun credentials are missing"}
	}
	values := make(url.Values, len(params)+8)
	for key, input := range params {
		values[key] = append([]string(nil), input...)
	}
	values.Set("Action", action)
	values.Set("Format", "JSON")
	values.Set("Version", version)
	values.Set("AccessKeyId", credentials.AccessKeyID)
	values.Set("SignatureMethod", "HMAC-SHA1")
	values.Set("SignatureVersion", "1.0")
	values.Set("SignatureNonce", c.nonce())
	values.Set("Timestamp", c.now().UTC().Format("2006-01-02T15:04:05Z"))
	values.Set("Signature", sign(values, credentials.AccessKeySecret))

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return fmt.Errorf("create Aliyun request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := c.httpClient.Do(req)
	if err != nil {
		return &Error{Code: "api_unavailable", Message: "Aliyun API request failed"}
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return &Error{Code: "api_unavailable", Message: "could not read Aliyun API response"}
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		var provider struct {
			Code    string `json:"Code"`
			Message string `json:"Message"`
		}
		_ = json.Unmarshal(body, &provider)
		if provider.Code == "" {
			provider.Code = "api_error"
		}
		return &Error{Code: strings.ToLower(provider.Code), Message: safeMessage(provider.Message)}
	}
	if target == nil {
		return nil
	}
	if err := json.Unmarshal(body, target); err != nil {
		return &Error{Code: "invalid_provider_response", Message: "Aliyun API returned an invalid response"}
	}
	return nil
}

func sign(values url.Values, secret string) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		if key != "Signature" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		items := append([]string(nil), values[key]...)
		sort.Strings(items)
		for _, value := range items {
			parts = append(parts, encode(key)+"="+encode(value))
		}
	}
	mac := hmac.New(sha1.New, []byte(secret+"&"))
	_, _ = mac.Write([]byte("POST&%2F&" + encode(strings.Join(parts, "&"))))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func encode(value string) string { return strings.ReplaceAll(url.QueryEscape(value), "+", "%20") }

func safeMessage(message string) string {
	message = strings.Join(strings.Fields(message), " ")
	if message == "" {
		return "Aliyun API request failed"
	}
	if len(message) > 300 {
		return message[:300]
	}
	return message
}
