package cloudprovider

import (
	"fmt"
)

// UnmarshalCredentials deserializes credentials from JSON based on provider type.
func UnmarshalCredentials(provider string, data []byte) (Credentials, error) {
	strategy, err := Get(provider)
	if err != nil {
		return nil, err
	}
	return strategy.UnmarshalCredentials(data)
}

// MarshalCredentialsFromMap converts a generic map to provider-specific credentials and marshals to JSON.
func MarshalCredentialsFromMap(provider string, credentialsMap map[string]interface{}) ([]byte, Credentials, error) {
	strategy, err := Get(provider)
	if err != nil {
		return nil, nil, err
	}
	credentials, err := strategy.CredentialsFromMap(credentialsMap)
	if err != nil {
		return nil, nil, err
	}
	data, err := credentials.Marshal()
	if err != nil {
		return nil, nil, fmt.Errorf("marshal %s credentials: %w", provider, err)
	}
	return data, credentials, nil
}

// ParseCredentialsFromLegacyFields converts legacy accessKeyId/accessKeySecret fields to credentials map.
// This maintains backward compatibility with existing API clients.
func ParseCredentialsFromLegacyFields(accessKeyID, accessKeySecret string) map[string]interface{} {
	return map[string]interface{}{
		"access_key_id":     accessKeyID,
		"access_key_secret": accessKeySecret,
	}
}
