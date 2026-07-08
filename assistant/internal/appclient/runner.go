package appclient

import (
	"context"
	"sync"

	"assistant/internal/agent"
)

type agentRunFunc func(context.Context, agent.OutputSink) error

type agentRunner interface {
	Start(context.Context, string, agent.OutputSink, agentRunFunc)
}

type directAgentRunner struct{}

func (directAgentRunner) Start(ctx context.Context, userID string, sink agent.OutputSink, run agentRunFunc) {
	_ = run(ctx, sink)
}

type userAgentRunner struct {
	mu             sync.Mutex
	jobs           map[string]userAgentJob
	nextGeneration int64
}

type userAgentJob struct {
	cancel     context.CancelFunc
	generation int64
}

func newUserAgentRunner() *userAgentRunner {
	return &userAgentRunner{
		jobs: map[string]userAgentJob{},
	}
}

func (r *userAgentRunner) Start(parentCtx context.Context, userID string, sink agent.OutputSink, run agentRunFunc) {
	if userID == "" {
		userID = "unknown"
	}

	jobCtx, cancel := context.WithCancel(parentCtx)
	r.mu.Lock()
	if previous, ok := r.jobs[userID]; ok {
		previous.cancel()
	}
	r.nextGeneration++
	generation := r.nextGeneration
	r.jobs[userID] = userAgentJob{
		cancel:     cancel,
		generation: generation,
	}
	r.mu.Unlock()

	go func() {
		defer cancel()
		defer r.clear(userID, generation)
		_ = run(jobCtx, userAgentSink{
			runner:     r,
			userID:     userID,
			generation: generation,
			delegate:   sink,
		})
	}()
}

func (r *userAgentRunner) CancelAll() {
	r.mu.Lock()
	jobs := make([]userAgentJob, 0, len(r.jobs))
	for _, job := range r.jobs {
		jobs = append(jobs, job)
	}
	r.jobs = map[string]userAgentJob{}
	r.mu.Unlock()

	for _, job := range jobs {
		job.cancel()
	}
}

func (r *userAgentRunner) clear(userID string, generation int64) {
	r.mu.Lock()
	defer r.mu.Unlock()

	current, ok := r.jobs[userID]
	if ok && current.generation == generation {
		delete(r.jobs, userID)
	}
}

func (r *userAgentRunner) sendIfCurrent(ctx context.Context, userID string, generation int64, delegate agent.OutputSink, content string) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	current, ok := r.jobs[userID]
	if !ok || current.generation != generation {
		return context.Canceled
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	return delegate.SendMarkdown(ctx, content)
}

type userAgentSink struct {
	runner     *userAgentRunner
	delegate   agent.OutputSink
	userID     string
	generation int64
}

func (s userAgentSink) SendMarkdown(ctx context.Context, content string) error {
	return s.runner.sendIfCurrent(ctx, s.userID, s.generation, s.delegate, content)
}
