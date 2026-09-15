// Package alb provides the small, explicit Aliyun ALB surface CertFlow needs.
package alb

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/regenbio/certflow/apps/control-plane/internal/aliyunrpc"
)

const apiVersion = "2020-06-16"

type Client struct{ rpc *aliyunrpc.Client }
type Credentials = aliyunrpc.Credentials

type Region struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type LoadBalancer struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Status  string `json:"status"`
	DNSName string `json:"dnsName"`
}
type Listener struct {
	ID          string `json:"id"`
	Port        int    `json:"port"`
	Protocol    string `json:"protocol"`
	Description string `json:"description"`
	Status      string `json:"status"`
}

func New() *Client { return &Client{rpc: aliyunrpc.New(nil)} }

func (c *Client) ListRegions(ctx context.Context, credentials Credentials) ([]Region, error) {
	var response struct {
		Regions []struct {
			RegionID  string `json:"RegionId"`
			LocalName string `json:"LocalName"`
		} `json:"Regions"`
	}
	if err := c.rpc.Call(ctx, endpoint("cn-hangzhou"), apiVersion, "DescribeRegions", credentials, nil, &response); err != nil {
		return nil, err
	}
	regions := make([]Region, 0, len(response.Regions))
	for _, region := range response.Regions {
		regions = append(regions, Region{ID: region.RegionID, Name: region.LocalName})
	}
	return regions, nil
}

func (c *Client) GetLoadBalancer(ctx context.Context, credentials Credentials, regionID, loadBalancerID string) (LoadBalancer, error) {
	var response struct {
		LoadBalancerID     string `json:"LoadBalancerId"`
		LoadBalancerName   string `json:"LoadBalancerName"`
		LoadBalancerStatus string `json:"LoadBalancerStatus"`
		DNSName            string `json:"DNSName"`
	}
	if err := c.rpc.Call(ctx, endpoint(regionID), apiVersion, "GetLoadBalancerAttribute", credentials, url.Values{"LoadBalancerId": {loadBalancerID}}, &response); err != nil {
		return LoadBalancer{}, err
	}
	return LoadBalancer{ID: response.LoadBalancerID, Name: response.LoadBalancerName, Status: response.LoadBalancerStatus, DNSName: response.DNSName}, nil
}

func (c *Client) ListLoadBalancers(ctx context.Context, credentials Credentials, regionID string) ([]LoadBalancer, error) {
	var response struct {
		LoadBalancers []struct {
			ID     string `json:"LoadBalancerId"`
			Name   string `json:"LoadBalancerName"`
			Status string `json:"LoadBalancerStatus"`
			DNS    string `json:"DNSName"`
		} `json:"LoadBalancers"`
	}
	if err := c.rpc.Call(ctx, endpoint(regionID), apiVersion, "ListLoadBalancers", credentials, url.Values{"PageSize": {"100"}}, &response); err != nil {
		return nil, err
	}
	items := make([]LoadBalancer, 0, len(response.LoadBalancers))
	for _, item := range response.LoadBalancers {
		items = append(items, LoadBalancer{ID: item.ID, Name: item.Name, Status: item.Status, DNSName: item.DNS})
	}
	return items, nil
}

func (c *Client) ListListeners(ctx context.Context, credentials Credentials, regionID, loadBalancerID string) ([]Listener, error) {
	var response struct {
		Listeners []struct {
			LoadBalancerID      string `json:"LoadBalancerId"`
			ListenerID          string `json:"ListenerId"`
			ListenerPort        int    `json:"ListenerPort"`
			ListenerProtocol    string `json:"ListenerProtocol"`
			ListenerDescription string `json:"ListenerDescription"`
			ListenerStatus      string `json:"ListenerStatus"`
		} `json:"Listeners"`
	}
	// ListListeners currently accepts no reliable flattened list parameter in
	// all ALB regions, so query the region and filter by the requested ALB ID.
	if err := c.rpc.Call(ctx, endpoint(regionID), apiVersion, "ListListeners", credentials, url.Values{"PageSize": {"100"}}, &response); err != nil {
		return nil, err
	}
	listeners := make([]Listener, 0, len(response.Listeners))
	for _, listener := range response.Listeners {
		if listener.LoadBalancerID != loadBalancerID {
			continue
		}
		listeners = append(listeners, Listener{ID: listener.ListenerID, Port: listener.ListenerPort, Protocol: listener.ListenerProtocol, Description: listener.ListenerDescription, Status: listener.ListenerStatus})
	}
	return listeners, nil
}

func (c *Client) ReplaceDefaultCertificate(ctx context.Context, credentials Credentials, regionID, listenerID, certificateID string) error {
	var listener struct {
		ListenerProtocol string `json:"ListenerProtocol"`
		Certificates     []struct {
			CertificateID string `json:"CertificateId"`
			IsDefault     bool   `json:"IsDefault"`
		} `json:"Certificates"`
	}
	if err := c.rpc.Call(ctx, endpoint(regionID), apiVersion, "GetListenerAttribute", credentials, url.Values{"ListenerId": {listenerID}}, &listener); err != nil {
		return err
	}
	if listener.ListenerProtocol != "HTTPS" && listener.ListenerProtocol != "QUIC" {
		return fmt.Errorf("listener does not support certificates")
	}
	params := url.Values{"ListenerId": {listenerID}}
	defaultFound := false
	for index, existing := range listener.Certificates {
		position := fmt.Sprintf("Certificates.%d.", index+1)
		params.Set(position+"CertificateId", existing.CertificateID)
		isDefault := existing.IsDefault
		if existing.IsDefault {
			params.Set(position+"CertificateId", certificateID)
			defaultFound = true
			isDefault = true
		}
		params.Set(position+"IsDefault", fmt.Sprintf("%t", isDefault))
	}
	if !defaultFound {
		params.Set("Certificates.1.CertificateId", certificateID)
		params.Set("Certificates.1.IsDefault", "true")
	}
	return c.rpc.Call(ctx, endpoint(regionID), apiVersion, "UpdateListenerAttribute", credentials, params, nil)
}

func endpoint(regionID string) string {
	return "https://alb." + strings.TrimSpace(regionID) + ".aliyuncs.com/"
}
