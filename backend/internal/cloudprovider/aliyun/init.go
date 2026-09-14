package aliyun

import "github.com/regenbio/certflow/internal/cloudprovider"

// Register the provider in its own package. The cloudprovider package remains
// implementation-agnostic, while applications opt in by importing this package.
func init() {
	cloudprovider.Register("aliyun", func() cloudprovider.Provider { return New() })
}
