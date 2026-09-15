package store

import "testing"

func TestNormalizeEmail(t *testing.T) {
	if got := NormalizeEmail("  Admin@Example.COM "); got != "admin@example.com" {
		t.Fatalf("NormalizeEmail() = %q", got)
	}
}

func TestCertificateDomainsWithinZones(t *testing.T) {
	if !certificateDomainsWithinZones([]string{"example.com", "*.api.example.com"}, []string{"example.com", "api.example.com"}) {
		t.Fatal("expected SANs to be covered by the configured zones")
	}
	if certificateDomainsWithinZones([]string{"outside.test"}, []string{"example.com"}) {
		t.Fatal("expected an outside domain to be rejected")
	}
}

func TestActorOwnershipScope(t *testing.T) {
	ctx := WithActor(t.Context(), Actor{ID: "00000000-0000-0000-0000-000000000001", Role: "user"})
	if got := ownerID(ctx); got == "" {
		t.Fatal("user scope must contain user ID")
	}
	if got := actorID(ctx); got == "" {
		t.Fatal("writer identity must contain user ID")
	}
	adminCtx := WithActor(t.Context(), Actor{ID: "00000000-0000-0000-0000-000000000002", Role: "admin"})
	if got := ownerID(adminCtx); got != "" {
		t.Fatalf("admin scope = %q, want unrestricted", got)
	}
	if got := actorID(adminCtx); got == "" {
		t.Fatal("admin writes must retain an owner ID")
	}
}
