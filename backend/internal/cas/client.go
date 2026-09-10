// Package cas uploads user certificates to Aliyun Certificate Management Service.
package cas

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"

	"github.com/regenbio/certflow/internal/aliyunrpc"
)

const endpoint = "https://cas.aliyuncs.com/"
const apiVersion = "2020-04-07"

type Client struct{ rpc *aliyunrpc.Client }
type Credentials = aliyunrpc.Credentials

func New() *Client { return &Client{rpc: aliyunrpc.New(nil)} }

func (c *Client) UploadUserCertificate(ctx context.Context, credentials Credentials, name string, certificatePEM, privateKeyPEM string) (string, error) {
	var response struct {
		CertID json.RawMessage `json:"CertId"`
	}
	err := c.rpc.Call(ctx, endpoint, apiVersion, "UploadUserCertificate", credentials, url.Values{"Name": {name}, "Cert": {certificatePEM}, "Key": {privateKeyPEM}}, &response)
	if err != nil {
		return "", err
	}
	return parseCertificateID(response.CertID)
}

func parseCertificateID(raw json.RawMessage) (string, error) {
	if len(raw) == 0 {
		return "", nil
	}
	var id string
	if err := json.Unmarshal(raw, &id); err == nil {
		return id, nil
	}
	var number json.Number
	if err := json.Unmarshal(raw, &number); err != nil {
		return "", fmt.Errorf("invalid Aliyun certificate id")
	}
	return number.String(), nil
}
