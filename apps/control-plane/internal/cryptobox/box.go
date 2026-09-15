package cryptobox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
)

const envelopeVersion byte = 1

type Box struct {
	aead cipher.AEAD
}

func New(encodedKey string) (*Box, error) {
	key, err := base64.StdEncoding.DecodeString(encodedKey)
	if err != nil {
		return nil, fmt.Errorf("decode encryption key: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("encryption key must decode to 32 bytes")
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create AES cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create AES-GCM: %w", err)
	}
	return &Box{aead: aead}, nil
}

func (b *Box) Seal(resourceType, resourceID string, plaintext []byte) ([]byte, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generate nonce: %w", err)
	}

	aad := []byte(resourceType + ":" + resourceID)
	ciphertext := b.aead.Seal(nil, nonce, plaintext, aad)
	envelope := make([]byte, 1+len(nonce)+len(ciphertext))
	envelope[0] = envelopeVersion
	copy(envelope[1:], nonce)
	copy(envelope[1+len(nonce):], ciphertext)
	return envelope, nil
}

func (b *Box) Open(resourceType, resourceID string, envelope []byte) ([]byte, error) {
	if len(envelope) < 1+b.aead.NonceSize() || envelope[0] != envelopeVersion {
		return nil, fmt.Errorf("unsupported encryption envelope")
	}
	nonce := envelope[1 : 1+b.aead.NonceSize()]
	ciphertext := envelope[1+b.aead.NonceSize():]
	plaintext, err := b.aead.Open(nil, nonce, ciphertext, []byte(resourceType+":"+resourceID))
	if err != nil {
		return nil, fmt.Errorf("decrypt envelope: %w", err)
	}
	return plaintext, nil
}
