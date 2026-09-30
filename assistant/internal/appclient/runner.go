package appclient

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"assistant/internal/agent"
	"assistant/internal/builtintools"
)

const (
	defaultConversationAgentIdleTimeout = 10 * time.Minute
	conversationStatusInterval          = 3 * time.Second
	maxConversationSequenceWatermarks   = 10_000
)

type agentRunner interface {
	Start(context.Context, string, agent.OutputSink, replyAgent, preparedAgentRun) bool
}

type preparedAgentRun struct {
	Authorization       preparedAuthorization
	ErrorSink           agent.OutputSink
	EventConversationID string
	MessageSeq          int64
	ReplySink           agent.OutputSink
	Request             agent.Request
	Scope               builtintools.Scope
	StatusSender        func(context.Context, string) error
}

type preparedAuthorization struct {
	Authorization builtintools.Authorization
	Candidate     agent.AuthorizationCandidate
	Ref           string
}

type sessionReplyAgent interface {
	NewSession(agent.Request) (*agent.Session, error)
}

type directAgentRunner struct{}

type progressAgentRunner interface {
	RunWithProgress(context.Context, agent.Request, agent.OutputSink, agent.ProgressObserver) error
}

// conversationStatusController owns status sends on one background worker.
// Switch only publishes the latest desired state and cancels an obsolete send.
type conversationStatusController struct {
	ctx      context.Context
	cancel   context.CancelFunc
	sender   func(context.Context, string) error
	interval time.Duration
	wake     chan struct{}
	done     chan struct{}

	mu           sync.Mutex
	desired      string
	stopped      bool
	inFlightStop context.CancelFunc
}

func newConversationStatusController(ctx context.Context, sender func(context.Context, string) error, interval time.Duration) *conversationStatusController {
	workerCtx, cancel := context.WithCancel(ctx)
	c := &conversationStatusController{
		ctx: workerCtx, cancel: cancel, sender: sender, interval: interval,
		wake: make(chan struct{}, 1), done: make(chan struct{}),
	}
	go c.run()
	return c
}

func (c *conversationStatusController) Switch(status string) {
	if c == nil || c.sender == nil || status == "" {
		return
	}
	c.mu.Lock()
	if c.stopped || c.desired == status {
		c.mu.Unlock()
		return
	}
	c.desired = status
	if c.inFlightStop != nil {
		c.inFlightStop()
	}
	c.mu.Unlock()
	select {
	case c.wake <- struct{}{}:
	default:
	}
}

func (c *conversationStatusController) run() {
	defer close(c.done)
	for {
		select {
		case <-c.ctx.Done():
			return
		case <-c.wake:
		}
		for {
			c.mu.Lock()
			if c.stopped {
				c.mu.Unlock()
				return
			}
			status := c.desired
			sendCtx, cancel := context.WithCancel(c.ctx)
			c.inFlightStop = cancel
			c.mu.Unlock()

			startedAt := time.Now()
			_ = c.sender(sendCtx, status)
			cancel()

			c.mu.Lock()
			c.inFlightStop = nil
			changed := c.desired != status
			stopped := c.stopped
			c.mu.Unlock()
			if stopped || c.ctx.Err() != nil {
				return
			}
			if changed {
				select {
				case <-c.wake:
				default:
				}
				continue
			}

			delay := c.interval - time.Since(startedAt)
			if delay < 0 {
				delay = 0
			}
			timer := time.NewTimer(delay)
			select {
			case <-c.ctx.Done():
				if !timer.Stop() {
					<-timer.C
				}
				return
			case <-c.wake:
				if !timer.Stop() {
					<-timer.C
				}
				continue
			case <-timer.C:
				// Repeat the current status. There is only one in-flight send.
			}
		}
	}
}

func (c *conversationStatusController) Stop() {
	if c == nil {
		return
	}
	c.mu.Lock()
	if c.stopped {
		c.mu.Unlock()
		<-c.done
		return
	}
	c.stopped = true
	if c.inFlightStop != nil {
		c.inFlightStop()
	}
	c.mu.Unlock()
	c.cancel()
	select {
	case c.wake <- struct{}{}:
	default:
	}
	<-c.done
}

func phaseStatus(phase agent.Phase) string {
	switch phase {
	case agent.PhaseTool:
		return "正在调用外部工具"
	case agent.PhaseText:
		return "正在生成回复内容"
	default:
		return "正在思考"
	}
}

// startConversationStatusHeartbeat sends at most one status request at a time.
// stop waits for an in-flight send, so no stale status can be emitted after it returns.
func startConversationStatusHeartbeat(ctx context.Context, sender func(context.Context) error, interval time.Duration) func() {
	if sender == nil {
		return func() {}
	}
	heartbeatCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = sender(heartbeatCtx)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-heartbeatCtx.Done():
				return
			case <-ticker.C:
				_ = sender(heartbeatCtx)
			}
		}
	}()
	var once sync.Once
	return func() {
		once.Do(func() {
			cancel()
			<-done
		})
	}
}

func (directAgentRunner) Start(ctx context.Context, key string, sink agent.OutputSink, assistantAgent replyAgent, prepared preparedAgentRun) bool {
	store := newConversationAuthorizationStore()
	prepared.Request.AuthorizationCandidates = store.Add(prepared.Authorization)
	prepared.Scope.AuthorizationResolver = store
	taskSink := &taskOutputSink{delegate: sink, errorSink: prepared.ErrorSink}
	controller := newConversationStatusController(ctx, prepared.StatusSender, conversationStatusInterval)
	defer controller.Stop()
	controller.Switch("正在思考")
	runCtx := builtintools.WithScope(ctx, prepared.Scope)
	var runErr error
	if progressive, ok := assistantAgent.(progressAgentRunner); ok {
		runErr = progressive.RunWithProgress(runCtx, prepared.Request, taskSink, func(phase agent.Phase) {
			controller.Switch(phaseStatus(phase))
		})
	} else {
		runErr = assistantAgent.Run(runCtx, prepared.Request, taskSink)
	}
	controller.Stop()
	if runErr != nil {
		if errors.Is(runErr, context.Canceled) {
			return false
		}
		if errors.Is(runErr, agent.ErrOutputDelivery) {
			log.Printf("agent output delivery failed: %v", runErr)
			return false
		}
		log.Printf("agent reply failed: %v", runErr)
		if taskSink.taskErrorSent {
			return true
		}
		return sendAgentFallback(ctx, taskSink, agent.ProcessingErrorFallback) == nil
	}
	return true
}

type conversationAgentRunner struct {
	ctx              context.Context
	idleTimeout      time.Duration
	maxSessions      int
	mu               sync.Mutex
	jobs             map[string]*conversationAgentJob
	lastSeenSeq      map[string]int64
	lastSeenSeqOrder []string
	waiters          *conversationWaitRegistry
}

type conversationAgentJob struct {
	actorID      string
	actorType    string
	cancel       context.CancelFunc
	ctx          context.Context
	errorSink    agent.OutputSink
	lastActiveAt time.Time
	lastSeenSeq  int64
	pending      []preparedAgentRun
	running      bool
	session      *agent.Session
	sink         agent.OutputSink
	scopeStore   *conversationScopeStore
	statusSender func(context.Context, string) error
	timer        *time.Timer
}

type conversationAgentRunnerOptions struct {
	IdleTimeout time.Duration
	MaxSessions int
}

func newConversationAgentRunner(ctx context.Context, options ...conversationAgentRunnerOptions) *conversationAgentRunner {
	if ctx == nil {
		ctx = context.Background()
	}
	configured := conversationAgentRunnerOptions{IdleTimeout: defaultConversationAgentIdleTimeout, MaxSessions: 1000}
	if len(options) > 0 {
		if options[0].IdleTimeout > 0 {
			configured.IdleTimeout = options[0].IdleTimeout
		}
		if options[0].MaxSessions > 0 {
			configured.MaxSessions = options[0].MaxSessions
		}
	}
	return &conversationAgentRunner{
		ctx:         ctx,
		idleTimeout: configured.IdleTimeout,
		maxSessions: configured.MaxSessions,
		jobs:        map[string]*conversationAgentJob{},
		lastSeenSeq: map[string]int64{},
		waiters:     newConversationWaitRegistry(),
	}
}

func (r *conversationAgentRunner) Start(ctx context.Context, key string, sink agent.OutputSink, assistantAgent replyAgent, prepared preparedAgentRun) bool {
	if key == "" {
		key = "unknown"
	}
	if prepared.ErrorSink == nil {
		prepared.ErrorSink = sink
	}
	prepared.ReplySink = sink
	prepared.Scope.ConversationWaiter = r.waiters
	eventKey := strings.TrimSpace(prepared.EventConversationID)
	if eventKey == "" {
		eventKey = key
	}
	r.mu.Lock()
	if prepared.MessageSeq > 0 && prepared.MessageSeq <= r.lastSeenSeq[eventKey] {
		r.mu.Unlock()
		return true
	}
	sessionAgent, ok := assistantAgent.(sessionReplyAgent)
	if !ok {
		r.mu.Unlock()
		accepted := directAgentRunner{}.Start(ctx, key, sink, assistantAgent, prepared)
		if accepted {
			r.mu.Lock()
			r.recordSequenceLocked(eventKey, prepared.MessageSeq)
			r.mu.Unlock()
		}
		return accepted
	}

	if job, ok := r.jobs[key]; ok {
		if eventKey == key && prepared.MessageSeq > 0 && prepared.MessageSeq <= job.lastSeenSeq {
			r.mu.Unlock()
			return true
		}
		if job.timer != nil {
			job.timer.Stop()
			job.timer = nil
		}
		request := prepared.Request
		request.History = filterHistoryAfterSeq(request.History, job.lastSeenSeq)
		request.AuthorizationCandidates = authorizationCandidatesForTrigger(prepared.Authorization)
		prepared.Request = request
		if job.running && (len(job.pending) > 0 || !job.sameActor(prepared.Authorization)) {
			job.pending = append(job.pending, prepared)
			job.session.RequestYield()
			job.lastActiveAt = time.Now().UTC()
			if eventKey == key && prepared.MessageSeq > job.lastSeenSeq {
				job.lastSeenSeq = prepared.MessageSeq
			}
			r.recordSequenceLocked(eventKey, prepared.MessageSeq)
			r.mu.Unlock()
			return true
		}
		if err := job.session.AppendWithActivation(request, func() {
			job.scopeStore.Activate(prepared.Scope, prepared.Authorization)
		}); err != nil {
			r.mu.Unlock()
			log.Printf("append agent instruction failed: %v", err)
			return sendAgentFallback(ctx, prepared.ErrorSink, agent.ProcessingErrorFallback) == nil
		}
		job.actorType, job.actorID = authorizationActor(prepared.Authorization)
		job.lastActiveAt = time.Now().UTC()
		job.sink = sink
		job.errorSink = prepared.ErrorSink
		job.statusSender = prepared.StatusSender
		if eventKey == key && prepared.MessageSeq > job.lastSeenSeq {
			job.lastSeenSeq = prepared.MessageSeq
		}
		r.recordSequenceLocked(eventKey, prepared.MessageSeq)
		if !job.running {
			job.running = true
			go r.runJob(key, job)
		}
		r.mu.Unlock()
		return true
	}

	if r.activeSessionCountLocked() >= r.maxSessions {
		retiredKey, retiredJob := r.selectOldestIdleJobLocked()
		if retiredJob == nil {
			r.mu.Unlock()
			log.Printf("agent session capacity reached: max=%d", r.maxSessions)
			return r.rejectPreparedRun(ctx, sink, prepared, agent.CapacityErrorFallback)
		}
		delete(r.jobs, retiredKey)
		if retiredJob.timer != nil {
			retiredJob.timer.Stop()
			retiredJob.timer = nil
		}
		retiredJob.cancel()
		retiredJob.session = nil
	}
	jobCtx, cancel := context.WithCancel(r.ctx)
	prepared.Request.AuthorizationCandidates = authorizationCandidatesForTrigger(prepared.Authorization)
	scopeStore := newConversationScopeStore(prepared.Scope, prepared.Authorization)
	session, err := sessionAgent.NewSession(prepared.Request)
	if err != nil {
		r.mu.Unlock()
		cancel()
		log.Printf("create agent session failed: %v", err)
		return r.rejectPreparedRun(ctx, sink, prepared, agent.ProcessingErrorFallback)
	}
	job := &conversationAgentJob{
		actorID:      strings.TrimSpace(prepared.Authorization.Authorization.ActorID),
		actorType:    strings.ToLower(strings.TrimSpace(prepared.Authorization.Authorization.ActorType)),
		cancel:       cancel,
		ctx:          jobCtx,
		errorSink:    prepared.ErrorSink,
		lastActiveAt: time.Now().UTC(),
		running:      true,
		session:      session,
		sink:         sink,
		statusSender: prepared.StatusSender,
		scopeStore:   scopeStore,
	}
	if eventKey == key {
		job.lastSeenSeq = prepared.MessageSeq
	}
	r.jobs[key] = job
	r.recordSequenceLocked(eventKey, prepared.MessageSeq)
	r.mu.Unlock()

	go r.runJob(key, job)
	return true
}

func (r *conversationAgentRunner) ClaimIncomingConversationMessage(conversationID string, seq int64, senderType string, senderID string) bool {
	if r == nil || r.waiters == nil {
		return false
	}
	return r.waiters.Claim(conversationID, seq, senderType, senderID)
}

type conversationWaitRegistry struct {
	mu      sync.Mutex
	waiters map[string]*conversationWaitRegistration
}

type conversationWaitRegistration struct {
	actorID        string
	actorType      string
	afterSeq       int64
	conversationID string
	registry       *conversationWaitRegistry
	closed         bool
}

func newConversationWaitRegistry() *conversationWaitRegistry {
	return &conversationWaitRegistry{waiters: map[string]*conversationWaitRegistration{}}
}

func (r *conversationWaitRegistry) RegisterConversationWait(conversationID string, afterSeq int64, actorType string, actorID string) (builtintools.ConversationWaitRegistration, error) {
	conversationID = strings.TrimSpace(conversationID)
	actorType = strings.ToLower(strings.TrimSpace(actorType))
	actorID = strings.TrimSpace(actorID)
	if conversationID == "" || afterSeq <= 0 {
		return nil, fmt.Errorf("conversation waiter requires conversation_id and after_seq")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.waiters[conversationID]; exists {
		return nil, fmt.Errorf("conversation %q already has an active reply waiter", conversationID)
	}
	registration := &conversationWaitRegistration{
		actorID:        actorID,
		actorType:      actorType,
		afterSeq:       afterSeq,
		conversationID: conversationID,
		registry:       r,
	}
	r.waiters[conversationID] = registration
	return registration, nil
}

func (r *conversationWaitRegistry) Claim(conversationID string, seq int64, senderType string, senderID string) bool {
	if r == nil || seq <= 0 {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	waiter := r.waiters[strings.TrimSpace(conversationID)]
	if waiter == nil || seq <= waiter.afterSeq {
		return false
	}
	senderType = strings.ToLower(strings.TrimSpace(senderType))
	senderID = strings.TrimSpace(senderID)
	if senderType != "user" && senderType != "app" {
		return false
	}
	if waiter.actorType != "" && waiter.actorID != "" && senderType == waiter.actorType && senderID == waiter.actorID {
		return false
	}
	return true
}

func (r *conversationWaitRegistration) Close() {
	if r == nil || r.registry == nil {
		return
	}
	r.registry.mu.Lock()
	defer r.registry.mu.Unlock()
	if r.closed {
		return
	}
	r.closed = true
	if r.registry.waiters[r.conversationID] == r {
		delete(r.registry.waiters, r.conversationID)
	}
}

func (r *conversationAgentRunner) recordSequenceLocked(key string, seq int64) {
	if seq <= 0 || seq <= r.lastSeenSeq[key] {
		return
	}
	if _, exists := r.lastSeenSeq[key]; !exists {
		r.lastSeenSeqOrder = append(r.lastSeenSeqOrder, key)
	}
	r.lastSeenSeq[key] = seq
	for len(r.lastSeenSeqOrder) > maxConversationSequenceWatermarks {
		oldest := r.lastSeenSeqOrder[0]
		r.lastSeenSeqOrder = r.lastSeenSeqOrder[1:]
		delete(r.lastSeenSeq, oldest)
	}
}

func (r *conversationAgentRunner) CancelAll() {
	r.mu.Lock()
	jobs := make([]*conversationAgentJob, 0, len(r.jobs))
	for _, job := range r.jobs {
		jobs = append(jobs, job)
	}
	r.jobs = map[string]*conversationAgentJob{}
	r.mu.Unlock()

	for _, job := range jobs {
		if job.timer != nil {
			job.timer.Stop()
		}
		job.cancel()
	}
}

func (r *conversationAgentRunner) runJob(key string, job *conversationAgentJob) {
	for {
		r.mu.Lock()
		current, ok := r.jobs[key]
		if !ok || current != job {
			r.mu.Unlock()
			return
		}
		replySink := job.sink
		errorSink := job.errorSink
		statusSender := job.statusSender
		r.mu.Unlock()

		taskSink := &conversationAgentSink{
			delegate:  replySink,
			errorSink: errorSink,
			job:       job,
			key:       key,
			runner:    r,
		}
		controller := newConversationStatusController(job.ctx, statusSender, conversationStatusInterval)
		controller.Switch("正在思考")
		err := job.session.RunCycleWithProgress(
			builtintools.WithScopeProvider(job.ctx, job.scopeStore),
			taskSink,
			func(phase agent.Phase) { controller.Switch(phaseStatus(phase)) },
		)
		controller.Stop()
		if err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("agent reply failed: %v", err)
			if !taskSink.taskErrorSent && !errors.Is(err, agent.ErrOutputDelivery) {
				_ = sendAgentFallback(job.ctx, taskSink, agent.ProcessingErrorFallback)
			}
		}

		r.mu.Lock()
		current, ok = r.jobs[key]
		if !ok || current != job {
			r.mu.Unlock()
			return
		}
		if job.ctx.Err() == nil && job.session.HasPending() {
			r.mu.Unlock()
			continue
		}
		var failedAppends []preparedAgentRun
		if job.ctx.Err() == nil && len(job.pending) > 0 {
			batchEnd := 1
			for batchEnd < len(job.pending) && sameAuthorizationActor(job.pending[0].Authorization, job.pending[batchEnd].Authorization) {
				batchEnd++
			}
			batch := append([]preparedAgentRun(nil), job.pending[:batchEnd]...)
			job.pending = job.pending[batchEnd:]
			job.session.ClearYield()
			appended := false
			for _, next := range batch {
				next := next
				if err := job.session.AppendWithActivation(next.Request, func() {
					job.scopeStore.Activate(next.Scope, next.Authorization)
				}); err != nil {
					log.Printf("append queued agent instruction failed: %v", err)
					failedAppends = append(failedAppends, next)
					continue
				}
				appended = true
				job.actorType, job.actorID = authorizationActor(next.Authorization)
				job.sink = next.ReplySink
				job.errorSink = next.ErrorSink
				job.statusSender = next.StatusSender
			}
			if len(job.pending) > 0 {
				job.session.RequestYield()
			}
			if appended || len(job.pending) > 0 {
				r.mu.Unlock()
				for _, failed := range failedAppends {
					_ = sendAgentFallback(job.ctx, failed.ErrorSink, agent.ProcessingErrorFallback)
				}
				continue
			}
		}
		job.running = false
		job.lastActiveAt = time.Now().UTC()
		job.timer = time.AfterFunc(r.idleTimeout, func() {
			r.retireIdleJob(key, job)
		})
		r.mu.Unlock()
		for _, failed := range failedAppends {
			_ = sendAgentFallback(job.ctx, failed.ErrorSink, agent.ProcessingErrorFallback)
		}
		return
	}
}

func (r *conversationAgentRunner) retireIdleJob(key string, job *conversationAgentJob) {
	r.mu.Lock()
	current, ok := r.jobs[key]
	if !ok || current != job || job.running || job.session.HasPending() || len(job.pending) > 0 {
		r.mu.Unlock()
		return
	}
	delete(r.jobs, key)
	if job.timer != nil {
		job.timer.Stop()
		job.timer = nil
	}
	r.mu.Unlock()
	job.cancel()
}

func (r *conversationAgentRunner) activeSessionCountLocked() int {
	return len(r.jobs)
}

func (r *conversationAgentRunner) selectOldestIdleJobLocked() (string, *conversationAgentJob) {
	var selectedKey string
	var selected *conversationAgentJob
	for key, job := range r.jobs {
		if job.running || job.session.HasPending() || len(job.pending) > 0 {
			continue
		}
		if selected == nil || job.lastActiveAt.Before(selected.lastActiveAt) {
			selectedKey, selected = key, job
		}
	}
	if selected == nil {
		return "", nil
	}
	return selectedKey, selected
}

func (r *conversationAgentRunner) CloseConversationSession(conversationID string) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return
	}
	r.mu.Lock()
	job := r.jobs[conversationID]
	if job != nil {
		delete(r.jobs, conversationID)
		if job.timer != nil {
			job.timer.Stop()
		}
	}
	r.mu.Unlock()
	if job != nil {
		job.cancel()
	}
}

func (r *conversationAgentRunner) sendIfCurrent(ctx context.Context, key string, job *conversationAgentJob, delegate agent.OutputSink, content string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if delegate == nil {
		return errors.New("agent output sink unavailable")
	}

	r.mu.Lock()
	current, ok := r.jobs[key]
	r.mu.Unlock()
	if !ok || current != job {
		return context.Canceled
	}

	return delegate.SendMarkdown(ctx, content)
}

func (r *conversationAgentRunner) rejectPreparedRun(
	ctx context.Context,
	sink agent.OutputSink,
	prepared preparedAgentRun,
	content string,
) bool {
	errorSink := prepared.ErrorSink
	if errorSink == nil {
		errorSink = sink
	}
	sendErr := sendAgentFallback(ctx, errorSink, content)
	return sendErr == nil
}

type conversationAgentSink struct {
	delegate      agent.OutputSink
	errorSink     agent.OutputSink
	job           *conversationAgentJob
	key           string
	runner        *conversationAgentRunner
	taskErrorSent bool
}

func (s *conversationAgentSink) SendMarkdown(ctx context.Context, content string) error {
	target := s.delegate
	if isAgentTaskError(content) && s.errorSink != nil {
		target = s.errorSink
	}
	if err := s.runner.sendIfCurrent(ctx, s.key, s.job, target, content); err != nil {
		return err
	}
	if isAgentTaskError(content) {
		s.taskErrorSent = true
	}
	return nil
}

type taskOutputSink struct {
	delegate      agent.OutputSink
	errorSink     agent.OutputSink
	taskErrorSent bool
}

func (s *taskOutputSink) SendMarkdown(ctx context.Context, content string) error {
	target := s.delegate
	if isAgentTaskError(content) && s.errorSink != nil {
		target = s.errorSink
	}
	if target == nil {
		return errors.New("agent output sink unavailable")
	}
	if err := target.SendMarkdown(ctx, content); err != nil {
		return err
	}
	if isAgentTaskError(content) {
		s.taskErrorSent = true
	}
	return nil
}

func isAgentTaskError(content string) bool {
	return content == agent.ModelErrorFallback || content == agent.ProcessingErrorFallback ||
		content == agent.CapacityErrorFallback || content == agent.LoopLimitFallback
}

func (j *conversationAgentJob) sameActor(authorization preparedAuthorization) bool {
	actorType, actorID := authorizationActor(authorization)
	return actorType != "" && actorID != "" && actorType == j.actorType && actorID == j.actorID
}

func sameAuthorizationActor(left preparedAuthorization, right preparedAuthorization) bool {
	leftType, leftID := authorizationActor(left)
	rightType, rightID := authorizationActor(right)
	return leftType != "" && leftID != "" && leftType == rightType && leftID == rightID
}

func authorizationActor(authorization preparedAuthorization) (string, string) {
	return strings.ToLower(strings.TrimSpace(authorization.Authorization.ActorType)), strings.TrimSpace(authorization.Authorization.ActorID)
}

type conversationScopeStore struct {
	mu            sync.RWMutex
	authorization preparedAuthorization
	scope         builtintools.Scope
}

func newConversationScopeStore(scope builtintools.Scope, authorization preparedAuthorization) *conversationScopeStore {
	return &conversationScopeStore{authorization: authorization, scope: scope}
}

func (s *conversationScopeStore) Activate(scope builtintools.Scope, authorization preparedAuthorization) {
	s.mu.Lock()
	s.scope = scope
	s.authorization = authorization
	s.mu.Unlock()
}

func (s *conversationScopeStore) CurrentScope() builtintools.Scope {
	s.mu.RLock()
	scope := s.scope
	s.mu.RUnlock()
	scope.AuthorizationResolver = s
	return scope
}

func (s *conversationScopeStore) ResolveAuthorization(ref string) (builtintools.Authorization, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.authorization.Ref == "" || strings.TrimSpace(ref) != s.authorization.Ref {
		return builtintools.Authorization{}, false
	}
	return s.authorization.Authorization, true
}

func authorizationCandidatesForTrigger(value preparedAuthorization) []agent.AuthorizationCandidate {
	if value.Ref == "" {
		return nil
	}
	return []agent.AuthorizationCandidate{value.Candidate}
}

type conversationAuthorizationStore struct {
	mu      sync.RWMutex
	entries []conversationAuthorizationEntry
}

type conversationAuthorizationEntry struct {
	authorization builtintools.Authorization
	candidate     agent.AuthorizationCandidate
	ref           string
}

func newConversationAuthorizationStore() *conversationAuthorizationStore {
	return &conversationAuthorizationStore{}
}

func (s *conversationAuthorizationStore) Add(authorization preparedAuthorization) []agent.AuthorizationCandidate {
	if authorization.Ref == "" {
		return s.Candidates()
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	entries := s.entries[:0]
	for _, entry := range s.entries {
		if entry.ref != authorization.Ref {
			entries = append(entries, entry)
		}
	}
	entries = append(entries, conversationAuthorizationEntry{
		authorization: authorization.Authorization,
		candidate:     authorization.Candidate,
		ref:           authorization.Ref,
	})
	if len(entries) > 5 {
		entries = entries[len(entries)-5:]
	}
	s.entries = entries

	return authorizationCandidatesFromEntries(s.entries)
}

func (s *conversationAuthorizationStore) Candidates() []agent.AuthorizationCandidate {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return authorizationCandidatesFromEntries(s.entries)
}

func (s *conversationAuthorizationStore) ResolveAuthorization(ref string) (builtintools.Authorization, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for i := len(s.entries) - 1; i >= 0; i-- {
		entry := s.entries[i]
		if entry.ref == ref {
			return entry.authorization, true
		}
	}
	return builtintools.Authorization{}, false
}

func authorizationCandidatesFromEntries(entries []conversationAuthorizationEntry) []agent.AuthorizationCandidate {
	candidates := make([]agent.AuthorizationCandidate, 0, len(entries))
	for _, entry := range entries {
		candidates = append(candidates, entry.candidate)
	}
	return candidates
}

func filterHistoryAfterSeq(history []agent.HistoryMessage, afterSeq int64) []agent.HistoryMessage {
	if afterSeq <= 0 || len(history) == 0 {
		return history
	}
	filtered := make([]agent.HistoryMessage, 0, len(history))
	for _, message := range history {
		if message.Seq > afterSeq {
			filtered = append(filtered, message)
		}
	}
	return filtered
}

func sendAgentFallback(ctx context.Context, sink agent.OutputSink, content string) error {
	if sink == nil {
		return errors.New("agent output sink unavailable")
	}
	if err := sink.SendMarkdown(ctx, content); err != nil {
		if !errors.Is(err, context.Canceled) {
			log.Printf("send agent fallback failed: %v", err)
		}
		return err
	}
	return nil
}
