package cryptobox

import (
	"encoding/base64"
	"testing"
)

func TestSealAndOpenBindsCiphertextToResource(t *testing.T) {
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	box, err := New(key)
	if err != nil {
		t.Fatalf("create box: %v", err)
	}

	ciphertext, err := box.Seal("cloud_credential_version", "version-1", []byte("secret"))
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	plaintext, err := box.Open("cloud_credential_version", "version-1", ciphertext)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if string(plaintext) != "secret" {
		t.Fatalf("unexpected plaintext: %q", plaintext)
	}

	if _, err := box.Open("cloud_credential_version", "version-2", ciphertext); err == nil {
		t.Fatal("expected decryption to fail for a different resource ID")
	}
}

func TestNewRejectsInvalidKey(t *testing.T) {
	if _, err := New("not-base64"); err == nil {
		t.Fatal("expected invalid key rejection")
	}
}
