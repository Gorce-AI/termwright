// Package evidence registers application-owned production pointer routers.
package evidence

import (
	"fmt"
	"sync"

	"github.com/gorce-ai/termwright/clients/go/protocol"
)

// Context identifies the exact semantic revision being collected.
type Context struct {
	SessionID     string
	Revision      int64
	Columns, Rows int
}

// Observation is an authoritative pointer-region and optional router observation.
type Observation struct {
	PointerRegions []protocol.ProviderPointerRegion
	HitTest        func(column, row int) string
}

// Provider is an application evidence producer. Method is native or declared.
// Pointer-regions and hit-test may be supplied together or by two independent
// providers; each capability has exactly one frozen owner per session.
type Provider struct {
	ID, Version, Method string
	Capabilities        []string
	Observe             func(Context) (Observation, error)
}

type entry struct {
	provider Provider
	active   bool
}

// Registry is reusable across sequential sessions and isolated across applications.
type Registry struct {
	mu      sync.Mutex
	active  int
	entries map[string]*entry
}

// NewRegistry creates an empty application-scoped registry.
func NewRegistry() *Registry { return &Registry{entries: map[string]*entry{}} }

var defaultRegistry = NewRegistry()

// DefaultRegistry is the process-wide registry consumed by zero-config
// framework probes. Applications register before their first rendered frame.
func DefaultRegistry() *Registry { return defaultRegistry }

// RegisterPointerEvidenceProvider registers a production pointer router for
// the process's next negotiated Termwright session.
func RegisterPointerEvidenceProvider(provider Provider) (*Handle, error) {
	return defaultRegistry.Register(provider)
}

// Handle controls provider lifetime.
type Handle struct {
	once    sync.Once
	dispose func()
}

func (h *Handle) Close() { h.once.Do(h.dispose) }

// Register adds a provider before any active session freezes the registry.
func (r *Registry) Register(provider Provider) (*Handle, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.active > 0 {
		return nil, fmt.Errorf("termwright evidence: provider %s registered after contract freeze", provider.ID)
	}
	if provider.ID == "" || provider.Version == "" || (provider.Method != "native" && provider.Method != "declared") {
		return nil, fmt.Errorf("termwright evidence: invalid provider declaration")
	}
	if _, exists := r.entries[provider.ID]; exists {
		return nil, fmt.Errorf("termwright evidence: duplicate provider %s", provider.ID)
	}
	if err := validateCapabilities(provider.Capabilities); err != nil {
		return nil, err
	}
	for _, existing := range r.entries {
		for _, capability := range provider.Capabilities {
			if has(existing.provider.Capabilities, capability) {
				return nil, fmt.Errorf("termwright evidence: competing %s providers", capability)
			}
		}
	}
	provider.Capabilities = append([]string(nil), provider.Capabilities...)
	e := &entry{provider: provider, active: true}
	r.entries[provider.ID] = e
	return &Handle{dispose: func() { r.mu.Lock(); defer r.mu.Unlock(); e.active = false; delete(r.entries, provider.ID) }}, nil
}

func validateCapabilities(values []string) error {
	if len(values) == 0 {
		return fmt.Errorf("termwright evidence: provider must declare at least one capability")
	}
	seen := map[string]bool{}
	for _, value := range values {
		if value != "pointer-regions" && value != "hit-test" {
			return fmt.Errorf("termwright evidence: unknown capability %q", value)
		}
		if seen[value] {
			return fmt.Errorf("termwright evidence: duplicate capability %q", value)
		}
		seen[value] = true
	}
	return nil
}

func has(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

type lease struct {
	registry      *Registry
	entries       []*entry
	registrations []protocol.EvidenceProviderRegistration
	once          sync.Once
}

// Freeze implements protocol.EvidenceProviderRegistry.
func (r *Registry) Freeze() (protocol.EvidenceProviderLease, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.active++
	l := &lease{registry: r}
	for _, e := range r.entries {
		l.entries = append(l.entries, e)
		p := e.provider
		l.registrations = append(l.registrations, protocol.EvidenceProviderRegistration{ID: p.ID, Version: p.Version, Method: p.Method, Capabilities: append([]string(nil), p.Capabilities...)})
	}
	return l, nil
}
func (l *lease) Registrations() []protocol.EvidenceProviderRegistration {
	return append([]protocol.EvidenceProviderRegistration(nil), l.registrations...)
}
func (l *lease) Close() {
	l.once.Do(func() { l.registry.mu.Lock(); l.registry.active--; l.registry.mu.Unlock() })
}

func (l *lease) Collect(sessionID string, revision int64, columns, rows int) []protocol.ProviderRevisionEvidence {
	result := make([]protocol.ProviderRevisionEvidence, 0, len(l.entries))
	for _, e := range l.entries {
		p := e.provider
		base := protocol.ProviderRevisionEvidence{ProviderID: p.ID, SessionID: sessionID, Revision: revision}
		l.registry.mu.Lock()
		active := e.active
		l.registry.mu.Unlock()
		if !active {
			base.Status = "lost"
			base.Reason = "provider disposed after negotiation"
			result = append(result, base)
			continue
		}
		observation, err := p.Observe(Context{sessionID, revision, columns, rows})
		if err != nil {
			base.Status = "violation"
			base.Reason = err.Error()
			result = append(result, base)
			continue
		}
		base.Status = "available"
		base.Evidence = &protocol.EvidenceProvenance{Source: "application", Method: p.Method, Strength: "authoritative", ProviderID: p.ID}
		if !has(p.Capabilities, "pointer-regions") && len(observation.PointerRegions) > 0 {
			base.Status = "violation"
			base.Reason = "published pointer regions without negotiating pointer-regions"
			base.Evidence = nil
			result = append(result, base)
			continue
		}
		if !has(p.Capabilities, "hit-test") && observation.HitTest != nil {
			base.Status = "violation"
			base.Reason = "published a hit-test callback without negotiating hit-test"
			base.Evidence = nil
			result = append(result, base)
			continue
		}
		regions := make([]protocol.ProviderPointerRegion, len(observation.PointerRegions))
		copy(regions, observation.PointerRegions)
		base.PointerRegions = &regions
		if has(p.Capabilities, "hit-test") {
			grid, gridErr := exactGrid(observation, columns, rows, has(p.Capabilities, "pointer-regions"))
			if gridErr != nil {
				base.Status = "violation"
				base.Reason = gridErr.Error()
				base.Evidence = nil
				base.PointerRegions = nil
			} else {
				base.HitGrid = &grid
			}
		}
		result = append(result, base)
	}
	return result
}

func exactGrid(observation Observation, columns, rows int, verifyDeclaredRegions bool) (protocol.PointerHitGrid, error) {
	if observation.HitTest == nil {
		return protocol.PointerHitGrid{}, fmt.Errorf("negotiated hit-test callback unavailable")
	}
	if columns*rows > 1_000_000 {
		return protocol.PointerHitGrid{}, fmt.Errorf("hit-test viewport exceeds provider limit")
	}
	declared := map[[2]int]string{}
	for _, region := range observation.PointerRegions {
		for _, span := range region.Spans {
			for col := span.From; col < span.To; col++ {
				key := [2]int{span.Row, col}
				if old := declared[key]; old != "" && old != region.RecipientID {
					return protocol.PointerHitGrid{}, fmt.Errorf("overlapping pointer regions")
				}
				declared[key] = region.RecipientID
			}
		}
	}
	grid := protocol.PointerHitGrid{}
	for row := 0; row < rows; row++ {
		start := -1
		owner := ""
		flush := func(end int) {
			if start >= 0 {
				grid.Regions = append(grid.Regions, protocol.PointerHitRegion{RecipientID: owner, Rect: protocol.Rect{Row: row, Column: start, Width: end - start, Height: 1}})
				start = -1
				owner = ""
			}
		}
		for col := 0; col < columns; col++ {
			actual := observation.HitTest(col, row)
			expected := declared[[2]int{row, col}]
			if verifyDeclaredRegions && actual != expected {
				return protocol.PointerHitGrid{}, fmt.Errorf("production hit test disagrees at %d,%d", col, row)
			}
			if actual == "" {
				flush(col)
			} else if start < 0 {
				start = col
				owner = actual
			} else if owner != actual {
				flush(col)
				start = col
				owner = actual
			}
		}
		flush(columns)
	}
	return grid, nil
}
