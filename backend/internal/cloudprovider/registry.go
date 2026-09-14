package cloudprovider

import (
	"fmt"
	"sync"
)

var (
	registry = make(map[string]ProviderFactory)
	mu       sync.RWMutex
)

// ProviderFactory is a function that creates a new Provider instance.
type ProviderFactory func() Provider

// Register registers a cloud platform provider with the given name.
func Register(name string, factory ProviderFactory) {
	mu.Lock()
	defer mu.Unlock()
	registry[name] = factory
}

// Get retrieves a cloud platform provider instance by name.
func Get(name string) (Provider, error) {
	mu.RLock()
	defer mu.RUnlock()

	factory, ok := registry[name]
	if !ok {
		return nil, fmt.Errorf("cloud provider %s not registered", name)
	}

	return factory(), nil
}

// List returns all registered provider names.
func List() []string {
	mu.RLock()
	defer mu.RUnlock()

	names := make([]string, 0, len(registry))
	for name := range registry {
		names = append(names, name)
	}
	return names
}

// IsRegistered checks if a provider is registered.
func IsRegistered(name string) bool {
	mu.RLock()
	defer mu.RUnlock()
	_, ok := registry[name]
	return ok
}
