package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLocalizedErrorResponseUsesRequestedLocale(t *testing.T) {
	handler := localizeErrors(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusUnauthorized, "authentication_required", "please sign in to continue")
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/certificates", nil)
	request.Header.Set("X-CertFlow-Locale", "zh-CN")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	if got := recorder.Header().Get("Content-Language"); got != localeChinese {
		t.Fatalf("Content-Language = %q, want %q", got, localeChinese)
	}
	if body := recorder.Body.String(); !strings.Contains(body, "请先登录后再继续") || !strings.Contains(body, "authentication_required") {
		t.Fatalf("localized response = %s", body)
	}
}

func TestLocalizedErrorResponseKeepsEnglishFallback(t *testing.T) {
	handler := localizeErrors(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_certificate", "certificate configuration is invalid")
	}))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/certificates", nil)
	request.Header.Set("Accept-Language", "en-US,en;q=0.9")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if got := recorder.Header().Get("Content-Language"); got != "en" {
		t.Fatalf("Content-Language = %q, want en", got)
	}
	if body := recorder.Body.String(); !strings.Contains(body, "certificate configuration is invalid") {
		t.Fatalf("English response = %s", body)
	}
}
