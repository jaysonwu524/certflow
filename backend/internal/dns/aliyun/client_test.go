package aliyun

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestRelativeRecordName(t *testing.T) {
	tests := []struct {
		fqdn string
		zone string
		want string
	}{
		{"_acme-challenge.example.com", "example.com", "_acme-challenge"},
		{"_acme-challenge.api.example.com", "example.com", "_acme-challenge.api"},
		{"example.com", "example.com", "@"},
	}
	for _, test := range tests {
		got, err := relativeRecordName(test.fqdn, test.zone)
		if err != nil || got != test.want {
			t.Errorf("relativeRecordName(%q, %q) = %q, %v; want %q", test.fqdn, test.zone, got, err, test.want)
		}
	}
	if _, err := relativeRecordName("example.net", "example.com"); err == nil {
		t.Fatal("expected a zone mismatch")
	}
}

func TestSignExcludesExistingSignature(t *testing.T) {
	values := url.Values{
		"Action":      {"DescribeDomainRecords"},
		"AccessKeyId": {"test key"},
		"Signature":   {"old-value"},
	}
	got := sign("POST", values, "test-secret")
	if got == "" || got != sign("POST", values, "test-secret") {
		t.Fatalf("signature is not deterministic: %q", got)
	}
	if strings.Contains(canonicalQuery(values), "Signature") {
		t.Fatal("canonical query must exclude Signature")
	}
}

func TestPresentAndCleanupTXT(t *testing.T) {
	actions := make([]string, 0, 4)
	describes := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		action := r.Form.Get("Action")
		actions = append(actions, action)
		if r.Form.Get("Signature") == "" {
			t.Fatal("request is unsigned")
		}
		switch action {
		case "DescribeDomainRecords":
			describes++
			if describes > 1 {
				_, _ = w.Write([]byte(`{"DomainRecords":{"Record":[{"RecordId":"record-1","RR":"_acme-challenge.api","Type":"TXT","Value":"proof"}]}}`))
				return
			}
			_, _ = w.Write([]byte(`{"DomainRecords":{"Record":[]}}`))
		case "AddDomainRecord":
			if r.Form.Get("DomainName") != "example.com" || r.Form.Get("RR") != "_acme-challenge.api" || r.Form.Get("Type") != "TXT" {
				t.Fatalf("unexpected add request: %#v", r.Form)
			}
			_, _ = w.Write([]byte(`{"DomainRecordId":"record-1"}`))
		case "DeleteDomainRecord":
			if r.Form.Get("RecordId") != "record-1" {
				t.Fatalf("unexpected delete request: %#v", r.Form)
			}
			_, _ = w.Write([]byte(`{"RequestId":"request-1"}`))
		default:
			t.Fatalf("unexpected action: %s", action)
		}
	}))
	defer server.Close()

	client := NewWithEndpoint(server.URL, server.Client())
	client.now = func() time.Time { return time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC) }
	client.nonce = func() string { return "nonce" }
	credentials := Credentials{AccessKeyID: "key", AccessKeySecret: "secret"}
	record, err := client.PresentTXT(context.Background(), credentials, ZoneRef{Name: "example.com"}, "_acme-challenge.api.example.com", "proof")
	if err != nil {
		t.Fatalf("present TXT: %v", err)
	}
	if err := client.CleanupTXT(context.Background(), credentials, record); err != nil {
		t.Fatalf("cleanup TXT: %v", err)
	}
	if strings.Join(actions, ",") != "DescribeDomainRecords,AddDomainRecord,DescribeDomainRecords,DeleteDomainRecord" {
		t.Fatalf("unexpected calls: %v", actions)
	}
}

func TestPresentReusesMatchingTXTWithoutCleanup(t *testing.T) {
	actions := make([]string, 0, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		actions = append(actions, r.Form.Get("Action"))
		if r.Form.Get("Action") != "DescribeDomainRecords" {
			t.Fatalf("unexpected action: %s", r.Form.Get("Action"))
		}
		_, _ = w.Write([]byte(`{"DomainRecords":{"Record":[{"RecordId":"record-1","RR":"_acme-challenge","Type":"TXT","Value":"proof"}]}}`))
	}))
	defer server.Close()

	client := NewWithEndpoint(server.URL, server.Client())
	credentials := Credentials{AccessKeyID: "key", AccessKeySecret: "secret"}
	record, err := client.PresentTXT(context.Background(), credentials, ZoneRef{Name: "example.com"}, "_acme-challenge.example.com", "proof")
	if err != nil {
		t.Fatalf("present TXT: %v", err)
	}
	if !record.Reused || record.RecordID != "record-1" {
		t.Fatalf("expected reused record, got %#v", record)
	}
	if err := client.CleanupTXT(context.Background(), credentials, record); err != nil {
		t.Fatalf("cleanup reused TXT: %v", err)
	}
	if strings.Join(actions, ",") != "DescribeDomainRecords" {
		t.Fatalf("unexpected calls: %v", actions)
	}
}
