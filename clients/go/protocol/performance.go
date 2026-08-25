package protocol

import (
	"fmt"
	"time"
)

// ClientPerformanceMetrics is the debug-only semantic transport telemetry a
// Go probe can observe without guessing about its framework or the driver.
//
// Nil averages are intentional: the client receives semantic snapshots, not
// the framework's pre-normalized event stream, and it cannot know whether the
// render marker returned to its caller later reached the PTY.
type ClientPerformanceMetrics struct {
	Enabled                      bool     `json:"enabled"`
	FullSnapshots                int64    `json:"fullSnapshots"`
	SemanticBytes                int64    `json:"semanticBytes"`
	SemanticNodes                int64    `json:"semanticNodes"`
	UnknownFrameworkNodes        int64    `json:"unknownFrameworkNodes"`
	DroppedEvents                int64    `json:"droppedEvents"`
	MarkerRequests               int64    `json:"markerRequests"`
	SerializationMicroseconds    float64  `json:"serializationMicroseconds"`
	AverageBytesPerFrame         *float64 `json:"averageBytesPerFrame"`
	AverageSemanticNodesPerFrame *float64 `json:"averageSemanticNodesPerFrame"`
	AverageUnknownNodesPerFrame  *float64 `json:"averageUnknownFrameworkNodesPerFrame"`
	AverageSerializationPerFrame *float64 `json:"averageSerializationMicrosecondsPerFrame"`
	ProbeEventsPerFrame          *float64 `json:"probeEventsPerFrame"`
	CoalescedEvents              int64    `json:"coalescedEvents"`
	RenderCorrelationRate        *float64 `json:"renderCorrelationRate"`
	ParentNormalizationPerFrame  *float64 `json:"parentNormalizationMicrosecondsPerFrame"`
}

type clientPerformanceCounters struct {
	semanticBytes         int64
	semanticNodes         int64
	unknownFrameworkNodes int64
	droppedEvents         int64
	markerRequests        int64
	serialization         time.Duration
}

// PerformanceMetrics returns a value snapshot safe to retain after Close.
// Collection is enabled only when Options.Debug is non-nil, so ordinary probe
// publications do not pay for timers or scans used solely for diagnostics.
func (c *Client) PerformanceMetrics() ClientPerformanceMetrics {
	c.mu.Lock()
	defer c.mu.Unlock()
	enabled := c.options.Debug != nil
	result := ClientPerformanceMetrics{
		Enabled:                   enabled,
		FullSnapshots:             c.snapsSent,
		SemanticBytes:             c.performance.semanticBytes,
		SemanticNodes:             c.performance.semanticNodes,
		UnknownFrameworkNodes:     c.performance.unknownFrameworkNodes,
		DroppedEvents:             c.performance.droppedEvents,
		MarkerRequests:            c.performance.markerRequests,
		SerializationMicroseconds: float64(c.performance.serialization.Nanoseconds()) / 1_000,
		// The Go protocol client never coalesces publications. A framework
		// probe that owns a queue must add its own coalescing counter.
		CoalescedEvents: 0,
	}
	if !enabled {
		return result
	}
	frames := c.snapsSent
	if frames > 0 {
		result.AverageBytesPerFrame = floatPointer(float64(result.SemanticBytes) / float64(frames))
		result.AverageSemanticNodesPerFrame = floatPointer(float64(result.SemanticNodes) / float64(frames))
		result.AverageUnknownNodesPerFrame = floatPointer(float64(result.UnknownFrameworkNodes) / float64(frames))
		result.AverageSerializationPerFrame = floatPointer(result.SerializationMicroseconds / float64(frames))
	}
	return result
}

func floatPointer(value float64) *float64 { return &value }

func (c *Client) performanceDrop() {
	if c.options.Debug == nil {
		return
	}
	c.mu.Lock()
	c.performance.droppedEvents++
	dropped := c.performance.droppedEvents
	c.mu.Unlock()
	c.options.Debug.Line("io", fmt.Sprintf("performance_drop total=%d", dropped))
}

func (c *Client) performancePublication(snapshot *Snapshot, bytes int, serialization time.Duration) {
	if c.options.Debug == nil {
		return
	}
	unknown := 0
	for _, node := range snapshot.Nodes {
		if node.Role == RoleGeneric {
			unknown++
		}
	}
	c.mu.Lock()
	c.performance.semanticBytes += int64(bytes)
	c.performance.semanticNodes += int64(len(snapshot.Nodes))
	c.performance.unknownFrameworkNodes += int64(unknown)
	c.performance.serialization += serialization
	c.mu.Unlock()
	c.options.Debug.Line("io", fmt.Sprintf(
		"performance r%d bytes=%d nodes=%d unknown=%d serialization_us=%.3f",
		snapshot.Revision,
		bytes,
		len(snapshot.Nodes),
		unknown,
		float64(serialization.Nanoseconds())/1_000,
	))
}

func (c *Client) performanceMarker() {
	if c.options.Debug == nil {
		return
	}
	c.mu.Lock()
	c.performance.markerRequests++
	c.mu.Unlock()
}
