// Package probehost is the dependency-neutral rendezvous between an
// application-facing framework adapter and an add-only compilation unit.
package probehost

import (
	"errors"
	"fmt"
)

// Provider attaches one framework instance and returns an idempotent drain.
// Values stay opaque here so this package never imports a framework and can be
// imported from both sides without a cycle.
type Provider func(application, root any) (func(), error)

// Fixed slots keep dormant instrumented binaries allocation-free. Add a slot
// deliberately when a framework adopts this seam; dynamic registration would
// allocate a map before main even when no probe session exists.
var tviewProvider Provider

// Register installs the compiler-injected implementation. Duplicate owners
// are a build error in spirit, so fail immediately instead of selecting one.
func Register(framework string, provider Provider) {
	if framework == "" || provider == nil {
		panic("termwright probehost: invalid provider registration")
	}
	if framework != "tview" {
		panic("termwright probehost: unknown framework " + framework)
	}
	if tviewProvider != nil {
		panic("termwright probehost: duplicate provider for " + framework)
	}
	tviewProvider = provider
}

// Attach fails closed when a Termwright-controlled build omitted its promised
// compiler unit. A silently raw run would make semantic tests green on less UI.
func Attach(framework string, application, root any) (func(), error) {
	var provider Provider
	if framework == "tview" {
		provider = tviewProvider
	}
	if provider == nil {
		return nil, fmt.Errorf("termwright probehost: %s compiler injection was not applied", framework)
	}
	cleanup, err := provider(application, root)
	if err != nil {
		return nil, err
	}
	if cleanup == nil {
		return nil, errors.New("termwright probehost: provider returned no lifecycle drain")
	}
	return cleanup, nil
}
