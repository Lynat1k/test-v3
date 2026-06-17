package admin

import "sync"

type RingBuffer struct {
	mu    sync.RWMutex
	buf   []string
	size  int
	start int
	count int
}

func NewRingBuffer(size int) *RingBuffer {
	return &RingBuffer{
		buf:  make([]string, size),
		size: size,
	}
}

func (rb *RingBuffer) Write(s string) {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	rb.buf[(rb.start+rb.count)%rb.size] = s
	if rb.count < rb.size {
		rb.count++
	} else {
		rb.start = (rb.start + 1) % rb.size
	}
}

func (rb *RingBuffer) LastN(n int) []string {
	rb.mu.RLock()
	defer rb.mu.RUnlock()
	if n > rb.count {
		n = rb.count
	}
	result := make([]string, n)
	for i := 0; i < n; i++ {
		idx := (rb.start + rb.count - n + i) % rb.size
		result[i] = rb.buf[idx]
	}
	return result
}
