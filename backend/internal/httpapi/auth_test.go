package httpapi

import "testing"

func TestAuthInputValidation(t *testing.T) {
	if !validEmail(" User@Example.com ") {
		t.Fatal("expected valid email")
	}
	if validEmail("not-an-email") {
		t.Fatal("expected invalid email")
	}
	if err := validatePassword("short"); err == nil {
		t.Fatal("expected short password rejection")
	}
	if err := validatePassword("long-enough-password"); err != nil {
		t.Fatalf("valid password rejected: %v", err)
	}
}
