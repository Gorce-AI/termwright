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

// PointerObservation is authoritative pointer evidence for one revision.
type PointerObservation struct {
	PointerRegions []protocol.ProviderPointerRegion
	HitTest        func(column, row int) string
}

// PointerProvider exposes only production pointer ownership/routing facts.
type PointerProvider struct {
	ID, Version, Method string
	Capabilities        []string
	Observe             func(Context) (PointerObservation, error)
}

// ActionStrategyProvider exposes data-only production keyboard recipes.
type ActionStrategyProvider struct {
	ID, Version, Method string
	Observe             func(Context) ([]protocol.ProviderActionRecipes, error)
}

// FocusProvider exposes the application's production focus-manager result.
// A nil recipient means authoritatively that no semantic node is focused.
type FocusProvider struct {
	ID, Version, Method string
	Observe             func(Context) (*string, error)
}

// ScrollProvider exposes the application's production viewport model.
type ScrollProvider struct {
	ID, Version, Method string
	Observe             func(Context) ([]protocol.ProviderScrollState, error)
}

// PaintProvider exposes the application's production paint attribution.
type PaintProvider struct {
	ID, Version, Method string
	Observe             func(Context) ([]protocol.ProviderPaintedRegion, error)
}

// InputModeProvider exposes the application's production terminal parser configuration.
type InputModeProvider struct {
	ID, Version, Method string
	Observe             func(Context) (protocol.ProviderTerminalInputModes, error)
}

type provider struct {
	ID, Version, Method string
	Capabilities        []string
	Observe             func(Context) (observation, error)
}

type observation struct {
	PointerRegions []protocol.ProviderPointerRegion
	HitTest        func(column, row int) string
	ActionRecipes  *[]protocol.ProviderActionRecipes
	FocusRecipient **string
	ScrollStates   *[]protocol.ProviderScrollState
	PaintedRegions *[]protocol.ProviderPaintedRegion
	InputModes     *protocol.ProviderTerminalInputModes
}

type entry struct {
	provider provider
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
func RegisterPointerEvidenceProvider(value PointerProvider) (*Handle, error) {
	return defaultRegistry.RegisterPointer(value)
}

// RegisterActionStrategyProvider registers production input recipes.
func RegisterActionStrategyProvider(value ActionStrategyProvider) (*Handle, error) {
	return defaultRegistry.RegisterActionStrategies(value)
}

// RegisterFocusEvidenceProvider registers production focus-manager evidence.
func RegisterFocusEvidenceProvider(value FocusProvider) (*Handle, error) {
	return defaultRegistry.RegisterFocus(value)
}

// RegisterScrollEvidenceProvider registers production application viewport evidence.
func RegisterScrollEvidenceProvider(value ScrollProvider) (*Handle, error) {
	return defaultRegistry.RegisterScroll(value)
}

// RegisterPaintEvidenceProvider registers production paint attribution.
func RegisterPaintEvidenceProvider(value PaintProvider) (*Handle, error) {
	return defaultRegistry.RegisterPaint(value)
}

// RegisterTerminalInputModeEvidenceProvider registers production parser modes.
func RegisterTerminalInputModeEvidenceProvider(value InputModeProvider) (*Handle, error) {
	return defaultRegistry.RegisterInputModes(value)
}

// Handle controls provider lifetime.
type Handle struct {
	once    sync.Once
	dispose func()
}

func (h *Handle) Close() { h.once.Do(h.dispose) }

// RegisterPointer adds a closed pointer provider family before contract freeze.
func (r *Registry) RegisterPointer(value PointerProvider) (*Handle, error) {
	for _, capability := range value.Capabilities {
		if capability != "pointer-regions" && capability != "hit-test" {
			return nil, fmt.Errorf("termwright evidence: pointer provider cannot declare %q", capability)
		}
	}
	return r.register(provider{
		ID: value.ID, Version: value.Version, Method: value.Method,
		Capabilities: value.Capabilities,
		Observe: func(context Context) (observation, error) {
			result, err := value.Observe(context)
			return observation{PointerRegions: result.PointerRegions, HitTest: result.HitTest}, err
		},
	})
}

// RegisterActionStrategies adds a closed physical strategy family.
func (r *Registry) RegisterActionStrategies(value ActionStrategyProvider) (*Handle, error) {
	return r.register(provider{
		ID: value.ID, Version: value.Version, Method: value.Method,
		Capabilities: []string{"action-recipes"},
		Observe: func(context Context) (observation, error) {
			result, err := value.Observe(context)
			if err != nil {
				return observation{}, err
			}
			return observation{ActionRecipes: &result}, nil
		},
	})
}

// RegisterFocus adds a closed focus provider family before contract freeze.
func (r *Registry) RegisterFocus(value FocusProvider) (*Handle, error) {
	return r.register(provider{
		ID: value.ID, Version: value.Version, Method: value.Method,
		Capabilities: []string{"focus-state"},
		Observe: func(context Context) (observation, error) {
			result, err := value.Observe(context)
			if err != nil {
				return observation{}, err
			}
			return observation{FocusRecipient: &result}, nil
		},
	})
}

// RegisterScroll adds a closed scroll provider family before contract freeze.
func (r *Registry) RegisterScroll(value ScrollProvider) (*Handle, error) {
	return r.register(provider{
		ID: value.ID, Version: value.Version, Method: value.Method,
		Capabilities: []string{"scroll-state"},
		Observe: func(context Context) (observation, error) {
			result, err := value.Observe(context)
			if err != nil {
				return observation{}, err
			}
			return observation{ScrollStates: &result}, nil
		},
	})
}

// RegisterPaint adds a closed paint provider family before contract freeze.
func (r *Registry) RegisterPaint(value PaintProvider) (*Handle, error) {
	return r.register(provider{
		ID: value.ID, Version: value.Version, Method: value.Method,
		Capabilities: []string{"painted-regions"},
		Observe: func(context Context) (observation, error) {
			result, err := value.Observe(context)
			if err != nil {
				return observation{}, err
			}
			return observation{PaintedRegions: &result}, nil
		},
	})
}

// RegisterInputModes adds a closed terminal parser mode family before contract freeze.
func (r *Registry) RegisterInputModes(value InputModeProvider) (*Handle, error) {
	return r.register(provider{
		ID: value.ID, Version: value.Version, Method: value.Method,
		Capabilities: []string{"terminal-input-modes"},
		Observe: func(context Context) (observation, error) {
			result, err := value.Observe(context)
			if err != nil {
				return observation{}, err
			}
			return observation{InputModes: &result}, nil
		},
	})
}

func (r *Registry) register(provider provider) (*Handle, error) {
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
		if value != "pointer-regions" && value != "hit-test" && value != "focus-state" && value != "action-recipes" && value != "scroll-state" && value != "painted-regions" && value != "terminal-input-modes" {
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
		if has(p.Capabilities, "action-recipes") && observation.ActionRecipes == nil {
			base.Status = "violation"
			base.Reason = "negotiated action-recipes evidence is unavailable"
			base.Evidence = nil
			result = append(result, base)
			continue
		}
		if !has(p.Capabilities, "action-recipes") && observation.ActionRecipes != nil {
			base.Status = "violation"
			base.Reason = "published action recipes without negotiating action-recipes"
			base.Evidence = nil
			result = append(result, base)
			continue
		}
		if has(p.Capabilities, "focus-state") && observation.FocusRecipient == nil {
			base.Status = "violation"
			base.Reason = "negotiated focus-state evidence is unavailable"
			base.Evidence = nil
			result = append(result, base)
			continue
		}
		if !has(p.Capabilities, "focus-state") && observation.FocusRecipient != nil {
			base.Status = "violation"
			base.Reason = "published focus state without negotiating focus-state"
			base.Evidence = nil
			result = append(result, base)
			continue
		}
		if has(p.Capabilities, "scroll-state") && observation.ScrollStates == nil {
			base.Status = "violation"
			base.Reason = "negotiated scroll-state evidence is unavailable"
			base.Evidence = nil
			result = append(result, base)
			continue
		}
		if !has(p.Capabilities, "scroll-state") && observation.ScrollStates != nil {
			base.Status = "violation"
			base.Reason = "published scroll state without negotiating scroll-state"
			base.Evidence = nil
			result = append(result, base)
			continue
		}
		if has(p.Capabilities, "painted-regions") && observation.PaintedRegions == nil {
			base.Status = "violation"
			base.Reason = "negotiated painted-regions evidence is unavailable"
			base.Evidence = nil
			result = append(result, base)
			continue
		}
		if !has(p.Capabilities, "painted-regions") && observation.PaintedRegions != nil {
			base.Status = "violation"
			base.Reason = "published painted regions without negotiating painted-regions"
			base.Evidence = nil
			result = append(result, base)
			continue
		}
		if has(p.Capabilities, "terminal-input-modes") && observation.InputModes == nil {
			base.Status = "violation"
			base.Reason = "negotiated terminal-input-modes evidence is unavailable"
			base.Evidence = nil
			result = append(result, base)
			continue
		}
		if !has(p.Capabilities, "terminal-input-modes") && observation.InputModes != nil {
			base.Status = "violation"
			base.Reason = "published input modes without negotiating terminal-input-modes"
			base.Evidence = nil
			result = append(result, base)
			continue
		}
		regions := make([]protocol.ProviderPointerRegion, len(observation.PointerRegions))
		copy(regions, observation.PointerRegions)
		base.PointerRegions = &regions
		if observation.ActionRecipes != nil {
			recipes := append([]protocol.ProviderActionRecipes(nil), (*observation.ActionRecipes)...)
			base.ActionRecipes = &recipes
		}
		if observation.FocusRecipient != nil {
			if *observation.FocusRecipient == nil {
				base.FocusState = &protocol.ProviderFocusState{Status: "none"}
			} else {
				base.FocusState = &protocol.ProviderFocusState{Status: "focused", RecipientID: **observation.FocusRecipient}
			}
		}
		if observation.ScrollStates != nil {
			states := append([]protocol.ProviderScrollState(nil), (*observation.ScrollStates)...)
			valid := true
			for _, state := range states {
				if (state.Axis != "vertical" && state.Axis != "horizontal") || state.Offset < 0 || state.Viewport < 0 || state.Extent < 0 || state.Offset+state.Viewport > state.Extent {
					valid = false
					break
				}
			}
			if !valid {
				base.Status = "violation"
				base.Reason = "scroll state must fit inside its extent"
				base.Evidence = nil
				result = append(result, base)
				continue
			}
			base.ScrollStates = &states
		}
		if observation.PaintedRegions != nil {
			regions := append([]protocol.ProviderPaintedRegion(nil), (*observation.PaintedRegions)...)
			base.PaintedRegions = &regions
		}
		if observation.InputModes != nil {
			modes := *observation.InputModes
			if !has([]string{"none", "x10", "vt200", "drag", "any"}, modes.MouseTracking) ||
				!has([]string{"default", "sgr", "urxvt", "utf8"}, modes.MouseEncoding) ||
				!has([]string{"on", "off"}, modes.FocusReporting) {
				base.Status = "violation"
				base.Reason = "terminal input modes contain an invalid value"
				base.Evidence = nil
				result = append(result, base)
				continue
			}
			base.InputModes = &modes
		}
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

func exactGrid(observation observation, columns, rows int, verifyDeclaredRegions bool) (protocol.PointerHitGrid, error) {
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
