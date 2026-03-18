package semantic

import (
	"sync"
	"time"
)

// clockSetter is an interface for test caches that support advancing the clock.
// The in-memory cache implementation should implement this when constructed with a test clock.
type clockSetter interface {
	AdvanceClock(d time.Duration)
}

// testClock is a controllable clock for testing TTL behavior.
type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func newTestClock() *testClock {
	return &testClock{now: time.Date(2026, 3, 18, 0, 0, 0, 0, time.UTC)}
}

func (tc *testClock) Now() time.Time {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	return tc.now
}

func (tc *testClock) Advance(d time.Duration) {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	tc.now = tc.now.Add(d)
}
