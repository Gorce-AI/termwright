package protocol

// Limits are the per-session capacity ceilings. Callers may tighten the
// defaults; they can never widen the absolute maxima.
//
// Field names are the wire names, so a Limits value marshals straight into a
// hello-ack payload.
type Limits struct {
	MaxFrameBytes      int `json:"maxFrameBytes"`
	MaxSnapshotBytes   int `json:"maxSnapshotBytes"`
	MaxNodes           int `json:"maxNodes"`
	MaxDepth           int `json:"maxDepth"`
	MaxStringBytes     int `json:"maxStringBytes"`
	MaxRelationTargets int `json:"maxRelationTargets"`
	MaxQueuedFrames    int `json:"maxQueuedFrames"`
	MaxPendingWaiters  int `json:"maxPendingWaiters"`
	MaxSessions        int `json:"maxSessions"`
	// MaxLogRecordBytes bounds one serialised application log record.
	MaxLogRecordBytes int `json:"maxLogRecordBytes"`
	// MaxLogQueue is how many log records the driver buffers per session.
	MaxLogQueue int `json:"maxLogQueue"`
}

// DefaultLimits is what an adapter assumes until hello-ack says otherwise.
var DefaultLimits = Limits{
	MaxFrameBytes:      1 * 1024 * 1024,
	MaxSnapshotBytes:   2 * 1024 * 1024,
	MaxNodes:           5000,
	MaxDepth:           64,
	MaxStringBytes:     16 * 1024,
	MaxRelationTargets: 64,
	MaxQueuedFrames:    32,
	MaxPendingWaiters:  256,
	MaxSessions:        16,
	MaxLogRecordBytes:  32 * 1024,
	MaxLogQueue:        1000,
}

// AbsoluteLimits is the widest configuration any side may accept.
var AbsoluteLimits = Limits{
	MaxFrameBytes:      8 * 1024 * 1024,
	MaxSnapshotBytes:   8 * 1024 * 1024,
	MaxNodes:           50000,
	MaxDepth:           256,
	MaxStringBytes:     256 * 1024,
	MaxRelationTargets: 1024,
	MaxQueuedFrames:    256,
	MaxPendingWaiters:  4096,
	MaxSessions:        128,
	MaxLogRecordBytes:  256 * 1024,
	MaxLogQueue:        10000,
}

// DefaultNegotiationMillis is the window a driver waits for a hello before it
// settles the session as generic (non-semantic).
const DefaultNegotiationMillis = 250
