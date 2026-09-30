package appclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"assistant/internal/agent"
	"assistant/internal/builtintools"
	"assistant/internal/llm"
	"assistant/internal/mcpclient"
)

func TestDirectAgentRunnerStatusFailureDoesNotAffectOutputAndStopsBeforeOutput(t *testing.T) {
	var mu sync.Mutex
	statusCalls := 0
	outputCallsAtStatus := -1
	output := make(chan string, 1)
	prepared := preparedAgentRun{
		StatusSender: func(context.Context, string) error {
			mu.Lock()
			statusCalls++
			mu.Unlock()
			return errors.New("status unavailable")
		},
	}
	sink := agent.OutputSinkFunc(func(_ context.Context, content string) error {
		mu.Lock()
		outputCallsAtStatus = statusCalls
		mu.Unlock()
		output <- content
		return nil
	})
	replier := replyAgentFunc(func(ctx context.Context, _ agent.Request, sink agent.OutputSink) error {
		return sink.SendMarkdown(ctx, "final reply")
	})
	if !(directAgentRunner{}).Start(context.Background(), "direct", sink, replier, prepared) {
		t.Fatal("direct run was not accepted")
	}
	if got := <-output; got != "final reply" {
		t.Fatalf("output = %q", got)
	}
	mu.Lock()
	stoppedAt := statusCalls
	atOutput := outputCallsAtStatus
	mu.Unlock()
	_ = stoppedAt
	_ = atOutput
	time.Sleep(20 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if statusCalls != stoppedAt {
		t.Fatalf("status continued after output: before=%d after=%d", stoppedAt, statusCalls)
	}
}

func TestDirectAgentRunnerContextCancelStopsStatus(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	firstStatus := make(chan struct{})
	var once sync.Once
	var mu sync.Mutex
	calls := 0
	prepared := preparedAgentRun{StatusSender: func(context.Context, string) error {
		mu.Lock()
		calls++
		mu.Unlock()
		once.Do(func() { close(firstStatus) })
		return nil
	}}
	replier := replyAgentFunc(func(ctx context.Context, _ agent.Request, _ agent.OutputSink) error {
		<-ctx.Done()
		return ctx.Err()
	})
	result := make(chan bool, 1)
	go func() {
		result <- directAgentRunner{}.Start(ctx, "direct", agent.OutputSinkFunc(func(context.Context, string) error { return nil }), replier, prepared)
	}()
	waitForSignal(t, firstStatus, "initial direct status")
	cancel()
	if accepted := <-result; accepted {
		t.Fatal("canceled direct run reported accepted")
	}
	mu.Lock()
	stoppedAt := calls
	mu.Unlock()
	time.Sleep(20 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if calls != stoppedAt {
		t.Fatalf("status continued after cancel: before=%d after=%d", stoppedAt, calls)
	}
}
func TestConversationStatusHeartbeatSendsImmediatelyPeriodicallyAndStops(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	first := make(chan struct{})
	sender := func(context.Context) error {
		mu.Lock()
		calls++
		if calls == 1 {
			close(first)
		}
		mu.Unlock()
		return errors.New("best effort failure")
	}
	stop := startConversationStatusHeartbeat(context.Background(), sender, 10*time.Millisecond)
	waitForSignal(t, first, "immediate status")
	time.Sleep(25 * time.Millisecond)
	stop()
	mu.Lock()
	stoppedAt := calls
	mu.Unlock()
	if stoppedAt < 2 {
		t.Fatalf("status calls = %d, want immediate and periodic calls", stoppedAt)
	}
	time.Sleep(20 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if calls != stoppedAt {
		t.Fatalf("status continued after stop: before=%d after=%d", stoppedAt, calls)
	}
}

func TestDirectAgentRunnerMapsProgressPhasesInOrderAndSurvivesOutputBeforeTool(t *testing.T) {
	statuses := make(chan string, 8)
	waitStatus := func(want string) {
		t.Helper()
		select {
		case got := <-statuses:
			if got != want {
				t.Fatalf("status=%q want=%q", got, want)
			}
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for %q", want)
		}
	}
	progress := &progressReplyAgent{run: func(ctx context.Context, sink agent.OutputSink, observe agent.ProgressObserver) error {
		observe(agent.PhaseThinking)
		waitStatus("正在思考")
		observe(agent.PhaseTool)
		waitStatus("正在调用外部工具")
		observe(agent.PhaseText)
		waitStatus("正在生成回复内容")
		if err := sink.SendMarkdown(ctx, "partial text"); err != nil {
			return err
		}
		observe(agent.PhaseTool)
		waitStatus("正在调用外部工具")
		return nil
	}}
	prepared := preparedAgentRun{StatusSender: func(_ context.Context, status string) error { statuses <- status; return nil }}
	if !(directAgentRunner{}).Start(context.Background(), "direct", agent.OutputSinkFunc(func(context.Context, string) error { return nil }), progress, prepared) {
		t.Fatal("run rejected")
	}
}

func TestStatusControllerSamePhaseDoesNotRestartAndBlockedSendDoesNotBlockSwitch(t *testing.T) {
	started := make(chan string, 4)
	canceled := make(chan string, 4)
	controller := newConversationStatusController(context.Background(), func(ctx context.Context, status string) error {
		started <- status
		if status == "正在思考" {
			<-ctx.Done()
			canceled <- status
		}
		return nil
	}, time.Hour)
	controller.Switch("正在思考")
	if got := waitForString(t, started, "thinking send"); got != "正在思考" {
		t.Fatalf("got %q", got)
	}

	begin := time.Now()
	controller.Switch("正在思考")
	controller.Switch("正在调用外部工具")
	if time.Since(begin) > 100*time.Millisecond {
		t.Fatal("Switch blocked on sender")
	}
	if got := waitForString(t, canceled, "canceled thinking send"); got != "正在思考" {
		t.Fatalf("got %q", got)
	}
	if got := waitForString(t, started, "tool send"); got != "正在调用外部工具" {
		t.Fatalf("got %q", got)
	}
	select {
	case extra := <-started:
		t.Fatalf("same phase restarted immediately: %q", extra)
	case <-time.After(30 * time.Millisecond):
	}
	controller.Stop()
}

type progressReplyAgent struct {
	run func(context.Context, agent.OutputSink, agent.ProgressObserver) error
}

func (p *progressReplyAgent) Run(ctx context.Context, _ agent.Request, sink agent.OutputSink) error {
	return p.run(ctx, sink, nil)
}
func (p *progressReplyAgent) RunWithProgress(ctx context.Context, _ agent.Request, sink agent.OutputSink, observer agent.ProgressObserver) error {
	return p.run(ctx, sink, observer)
}

func TestFastTextReplyDoesNotSendStatusAfterReplyOrStop(t *testing.T) {
	var mu sync.Mutex
	replied := false
	stale := make(chan string, 1)
	progress := &progressReplyAgent{run: func(ctx context.Context, sink agent.OutputSink, observe agent.ProgressObserver) error {
		observe(agent.PhaseText)
		return sink.SendMarkdown(ctx, "fast reply")
	}}
	prepared := preparedAgentRun{StatusSender: func(_ context.Context, status string) error {
		mu.Lock()
		afterReply := replied
		mu.Unlock()
		if afterReply {
			stale <- status
		}
		return nil
	}}
	sink := agent.OutputSinkFunc(func(context.Context, string) error {
		mu.Lock()
		replied = true
		mu.Unlock()
		return nil
	})
	if !(directAgentRunner{}).Start(context.Background(), "fast", sink, progress, prepared) {
		t.Fatal("run rejected")
	}
	select {
	case status := <-stale:
		t.Fatalf("status %q sent after reply", status)
	case <-time.After(30 * time.Millisecond):
	}
}

func TestConversationAgentRunnerSessionOutlivesTriggerContext(t *testing.T) {
	rootCtx, cancelRoot := context.WithCancel(context.Background())
	defer cancelRoot()
	runner := newConversationAgentRunner(rootCtx)

	started := make(chan struct{})
	canceled := make(chan struct{})
	assistantAgent := agent.New(llmModelFunc(func(ctx context.Context, request llm.Request) (llm.Response, error) {
		close(started)
		<-ctx.Done()
		close(canceled)
		return llm.Response{}, ctx.Err()
	}))
	triggerCtx, cancelTrigger := context.WithCancel(context.Background())
	runner.Start(
		triggerCtx,
		"conversation-1",
		agent.OutputSinkFunc(func(context.Context, string) error { return nil }),
		assistantAgent,
		preparedTextRun("conversation-1", "message-1", 1, "第一条"),
	)
	waitForSignal(t, started, "agent session to start")

	cancelTrigger()
	select {
	case <-canceled:
		t.Fatal("agent session canceled with trigger context")
	case <-time.After(50 * time.Millisecond):
	}

	cancelRoot()
	waitForSignal(t, canceled, "agent session to stop with process context")
}

func TestConversationAgentRunnerDefaultsIdleTimeoutToTenMinutes(t *testing.T) {
	runner := newConversationAgentRunner(context.Background())
	defer runner.CancelAll()
	if runner.idleTimeout != 10*time.Minute {
		t.Fatalf("idle timeout = %s, want 10m", runner.idleTimeout)
	}
}

func TestConversationAgentRunnerKeepsSessionAfterConversationEnd(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := newConversationAgentRunner(ctx)
	registry, err := mcpclient.NewRegistry(ctx, []mcpclient.Source{builtintools.NewSource()})
	if err != nil {
		t.Fatalf("NewRegistry() error = %v", err)
	}
	var mu sync.Mutex
	var requests []llm.Request
	firstCalled := make(chan struct{}, 1)
	assistantAgent := agent.New(llmModelFunc(func(_ context.Context, request llm.Request) (llm.Response, error) {
		mu.Lock()
		requests = append(requests, request)
		requestNumber := len(requests)
		mu.Unlock()
		if requestNumber == 1 {
			firstCalled <- struct{}{}
			return llm.Response{Blocks: []llm.Block{{
				Type:      llm.BlockTypeToolUse,
				ToolUseID: "toolu_end",
				ToolName:  "builtin__end_conversation",
				ToolInput: json.RawMessage(`{}`),
			}}}, nil
		}
		return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "继续会话"}}}, nil
	}), agent.WithToolRegistry(registry))
	output := make(chan struct{}, 1)
	sink := agent.OutputSinkFunc(func(context.Context, string) error {
		output <- struct{}{}
		return nil
	})
	first := preparedTextRun("conversation-1", "message-1", 1, "第一条")
	runner.Start(ctx, "conversation-1", sink, assistantAgent, first)
	waitForSignal(t, firstCalled, "end tool request")

	deadline := time.Now().Add(time.Second)
	for {
		runner.mu.Lock()
		job, exists := runner.jobs["conversation-1"]
		idle := exists && !job.running
		runner.mu.Unlock()
		if idle {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("conversation session did not become idle after end: exists=%v", exists)
		}
		time.Sleep(time.Millisecond)
	}

	second := preparedTextRun("conversation-1", "message-2", 2, "第二条")
	runner.Start(ctx, "conversation-1", sink, assistantAgent, second)
	waitForSignal(t, output, "new session response")

	mu.Lock()
	defer mu.Unlock()
	if len(requests) != 2 {
		t.Fatalf("request count = %d, want 2", len(requests))
	}
	secondJSON, err := json.Marshal(requests[1].Messages)
	if err != nil {
		t.Fatalf("marshal second request: %v", err)
	}
	if !strings.Contains(string(secondJSON), "第一条") || !strings.Contains(string(secondJSON), "第二条") {
		t.Fatalf("second request messages = %s, want preserved and new context", secondJSON)
	}
}

func TestConversationWaitRegistryClaimsOnlyMatchingReplies(t *testing.T) {
	registry := newConversationWaitRegistry()
	registration, err := registry.RegisterConversationWait("conversation-1", 10, "user", "user-1")
	if err != nil {
		t.Fatalf("RegisterConversationWait() error = %v", err)
	}
	if registry.Claim("conversation-1", 10, "user", "user-2") {
		t.Fatal("message at after_seq was claimed")
	}
	if registry.Claim("conversation-1", 11, "user", "user-1") {
		t.Fatal("runas identity's own message was claimed")
	}
	if registry.Claim("conversation-1", 11, "system", "") {
		t.Fatal("system message was claimed")
	}
	if !registry.Claim("conversation-1", 11, "user", "user-2") {
		t.Fatal("new reply was not claimed")
	}
	if !registry.Claim("conversation-1", 12, "app", "app-2") {
		t.Fatal("new app reply was not claimed")
	}
	registration.Close()
	if registry.Claim("conversation-1", 13, "user", "user-2") {
		t.Fatal("message was claimed after waiter closed")
	}
}

func TestConversationWaitRegistryRejectsConcurrentWaiter(t *testing.T) {
	registry := newConversationWaitRegistry()
	registration, err := registry.RegisterConversationWait("conversation-1", 10, "user", "user-1")
	if err != nil {
		t.Fatalf("RegisterConversationWait() error = %v", err)
	}
	defer registration.Close()
	if _, err := registry.RegisterConversationWait("conversation-1", 20, "user", "user-2"); err == nil {
		t.Fatal("second waiter registration error = nil")
	}
}

func TestConversationAgentRunnerIgnoresDuplicateSequence(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := newConversationAgentRunner(ctx)
	outputs := make(chan struct{}, 2)
	assistantAgent := agent.New(llmModelFunc(func(ctx context.Context, request llm.Request) (llm.Response, error) {
		return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "完成"}}}, nil
	}))
	sink := agent.OutputSinkFunc(func(context.Context, string) error {
		outputs <- struct{}{}
		return nil
	})
	prepared := preparedTextRun("conversation-1", "message-1", 7, "第一条")
	runner.Start(ctx, "conversation-1", sink, assistantAgent, prepared)
	waitForSignal(t, outputs, "first response")

	runner.Start(ctx, "conversation-1", sink, assistantAgent, prepared)
	select {
	case <-outputs:
		t.Fatal("duplicate sequence executed a second time")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestConversationAgentRunnerUsesJobWatermarkAfterGlobalEviction(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := newConversationAgentRunner(ctx)
	outputs := make(chan struct{}, 2)
	assistantAgent := agent.New(llmModelFunc(func(context.Context, llm.Request) (llm.Response, error) {
		return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "完成"}}}, nil
	}))
	sink := agent.OutputSinkFunc(func(context.Context, string) error {
		outputs <- struct{}{}
		return nil
	})
	prepared := preparedTextRun("conversation-1", "message-1", 7, "第一条")
	runner.Start(ctx, "conversation-1", sink, assistantAgent, prepared)
	waitForSignal(t, outputs, "first response")

	runner.mu.Lock()
	for i := 0; i <= maxConversationSequenceWatermarks; i++ {
		runner.recordSequenceLocked(fmt.Sprintf("other-%d", i), 1)
	}
	_, stillCached := runner.lastSeenSeq["conversation-1"]
	runner.mu.Unlock()
	if stillCached {
		t.Fatal("conversation watermark was not evicted")
	}

	runner.Start(ctx, "conversation-1", sink, assistantAgent, prepared)
	select {
	case <-outputs:
		t.Fatal("duplicate sequence appended after global watermark eviction")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestConversationAgentRunnerKeepsSequenceWatermarkAfterIdleCleanup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := newConversationAgentRunner(ctx)
	runner.idleTimeout = 10 * time.Millisecond
	outputs := make(chan struct{}, 2)
	assistantAgent := agent.New(llmModelFunc(func(ctx context.Context, request llm.Request) (llm.Response, error) {
		return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "完成"}}}, nil
	}))
	sink := agent.OutputSinkFunc(func(context.Context, string) error {
		outputs <- struct{}{}
		return nil
	})
	prepared := preparedTextRun("conversation-1", "message-1", 7, "第一条")
	runner.Start(ctx, "conversation-1", sink, assistantAgent, prepared)
	waitForSignal(t, outputs, "first response")

	deadline := time.Now().Add(time.Second)
	for {
		runner.mu.Lock()
		_, exists := runner.jobs["conversation-1"]
		runner.mu.Unlock()
		if !exists {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("conversation job was not removed after idle timeout")
		}
		time.Sleep(time.Millisecond)
	}

	runner.Start(ctx, "conversation-1", sink, assistantAgent, prepared)
	select {
	case <-outputs:
		t.Fatal("duplicate sequence executed after idle session cleanup")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestConversationAgentRunnerIdleRetirementKeepsTopicOpen(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	requester := newRunnerTopicRequester()
	runner := newConversationAgentRunner(ctx, conversationAgentRunnerOptions{
		IdleTimeout: 15 * time.Millisecond,
		MaxSessions: 2,
	})
	defer runner.CancelAll()
	output := make(chan struct{}, 1)
	assistantAgent := agent.New(llmModelFunc(func(context.Context, llm.Request) (llm.Response, error) {
		return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "完成"}}}, nil
	}))
	prepared := preparedTopicRun("topic-1", "topic-message-1", 1, "第一条", "user-1", "auth_1", requester)
	runner.Start(ctx, "topic-1", agent.OutputSinkFunc(func(context.Context, string) error {
		output <- struct{}{}
		return nil
	}), assistantAgent, prepared)
	waitForSignal(t, output, "topic response")
	waitForRunnerJobRemoved(t, runner, "topic-1")
	if methods := requester.requestMethods(); len(methods) != 0 {
		t.Fatalf("idle retirement sent server requests: %v", methods)
	}
}

func TestConversationAgentRunnerNewMessageRecreatesSessionAfterIdleRetirement(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	requester := newRunnerTopicRequester()
	runner := newConversationAgentRunner(ctx, conversationAgentRunnerOptions{
		IdleTimeout: 15 * time.Millisecond,
		MaxSessions: 2,
	})
	defer runner.CancelAll()
	outputs := make(chan string, 2)
	var modelCalls int
	var modelMu sync.Mutex
	assistantAgent := agent.New(llmModelFunc(func(context.Context, llm.Request) (llm.Response, error) {
		modelMu.Lock()
		modelCalls++
		call := modelCalls
		modelMu.Unlock()
		return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: fmt.Sprintf("完成-%d", call)}}}, nil
	}))
	sink := agent.OutputSinkFunc(func(_ context.Context, content string) error {
		outputs <- content
		return nil
	})
	first := preparedTopicRun("topic-1", "topic-message-1", 1, "第一条", "user-1", "auth_1", requester)
	runner.Start(ctx, "topic-1", sink, assistantAgent, first)
	if output := waitForString(t, outputs, "first topic response"); output != "完成-1" {
		t.Fatalf("first output = %q", output)
	}
	runner.mu.Lock()
	originalJob := runner.jobs["topic-1"]
	runner.mu.Unlock()
	waitForRunnerJobRemoved(t, runner, "topic-1")
	runner.mu.Lock()
	runner.idleTimeout = time.Hour
	runner.mu.Unlock()
	second := preparedTopicRun("topic-1", "topic-message-2", 2, "第二条", "user-1", "auth_2", requester)
	runner.Start(ctx, "topic-1", sink, assistantAgent, second)
	if output := waitForString(t, outputs, "second topic response"); output != "完成-2" {
		t.Fatalf("second output = %q", output)
	}

	runner.mu.Lock()
	currentJob := runner.jobs["topic-1"]
	runner.mu.Unlock()
	if currentJob == nil || currentJob == originalJob {
		t.Fatalf("topic job after idle retirement = %p, want a new job distinct from %p", currentJob, originalJob)
	}
	if methods := requester.requestMethods(); len(methods) != 0 {
		t.Fatalf("session recreation sent server requests: %v", methods)
	}
}

func TestConversationAgentRunnerRoutesModelFailureToParentConversation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := newConversationAgentRunner(ctx)
	defer runner.CancelAll()
	modelErr := errors.New("model unavailable")
	assistantAgent := agent.New(llmModelFunc(func(context.Context, llm.Request) (llm.Response, error) {
		return llm.Response{}, modelErr
	}))
	topicOutputs := make(chan string, 1)
	parentOutputs := make(chan string, 2)
	prepared := preparedTopicRun("topic-1", "topic-message-1", 1, "开始", "user-1", "auth_1", newRunnerTopicRequester())
	prepared.ErrorSink = agent.OutputSinkFunc(func(_ context.Context, content string) error {
		parentOutputs <- content
		return nil
	})
	runner.Start(ctx, "topic-1", agent.OutputSinkFunc(func(_ context.Context, content string) error {
		topicOutputs <- content
		return nil
	}), assistantAgent, prepared)
	if output := waitForString(t, parentOutputs, "parent task error"); output != agent.ModelErrorFallback {
		t.Fatalf("parent output = %q, want model fallback", output)
	}
	select {
	case output := <-topicOutputs:
		t.Fatalf("model failure was sent to topic: %q", output)
	case <-time.After(50 * time.Millisecond):
	}
	select {
	case output := <-parentOutputs:
		t.Fatalf("model failure was sent more than once: %q", output)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestReplyDeliveryFailureDoesNotSendFallback(t *testing.T) {
	for _, persistent := range []bool{false, true} {
		name := "direct"
		if persistent {
			name = "session"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			assistantAgent := agent.New(llmModelFunc(func(context.Context, llm.Request) (llm.Response, error) {
				return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "完成"}}}, nil
			}))
			replyCalls := make(chan string, 2)
			errorCalls := make(chan string, 2)
			sink := agent.OutputSinkFunc(func(_ context.Context, content string) error {
				replyCalls <- content
				return errors.New("send failed")
			})
			prepared := preparedTopicRun("topic-delivery", "message-1", 1, "开始", "user-1", "auth_1", newRunnerTopicRequester())
			prepared.ErrorSink = agent.OutputSinkFunc(func(_ context.Context, content string) error {
				errorCalls <- content
				return nil
			})
			if persistent {
				runner := newConversationAgentRunner(ctx)
				defer runner.CancelAll()
				runner.Start(ctx, "topic-delivery", sink, assistantAgent, prepared)
				waitForRunnerJobIdle(t, runner, "topic-delivery")
			} else {
				directAgentRunner{}.Start(ctx, "topic-delivery", sink, assistantAgent, prepared)
			}
			if got := <-replyCalls; got != "完成" {
				t.Fatalf("reply = %q", got)
			}
			select {
			case got := <-replyCalls:
				t.Fatalf("unexpected second reply attempt: %q", got)
			default:
			}
			select {
			case got := <-errorCalls:
				t.Fatalf("unexpected error fallback: %q", got)
			default:
			}
		})
	}
}

func TestConversationAgentRunnerCapacityFailureKeepsNewTopicOpenAndRepliesToParent(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := newConversationAgentRunner(ctx, conversationAgentRunnerOptions{
		IdleTimeout: time.Hour,
		MaxSessions: 1,
	})
	defer runner.CancelAll()
	firstStarted := make(chan struct{})
	assistantAgent := agent.New(llmModelFunc(func(ctx context.Context, request llm.Request) (llm.Response, error) {
		close(firstStarted)
		<-ctx.Done()
		return llm.Response{}, ctx.Err()
	}))
	first := preparedTopicRun("topic-busy", "busy-message", 1, "持续任务", "user-1", "auth_1", newRunnerTopicRequester())
	runner.Start(ctx, "topic-busy", agent.OutputSinkFunc(func(context.Context, string) error { return nil }), assistantAgent, first)
	waitForSignal(t, firstStarted, "busy topic session")

	requester := newRunnerTopicRequester()
	topicOutputs := make(chan string, 1)
	parentOutputs := make(chan string, 2)
	second := preparedTopicRun("topic-rejected", "rejected-message", 1, "新任务", "user-2", "auth_2", requester)
	second.ErrorSink = agent.OutputSinkFunc(func(_ context.Context, content string) error {
		parentOutputs <- content
		return nil
	})
	accepted := runner.Start(ctx, "topic-rejected", agent.OutputSinkFunc(func(_ context.Context, content string) error {
		topicOutputs <- content
		return nil
	}), assistantAgent, second)
	if !accepted {
		t.Fatal("capacity rejection was not handled after notifying the parent")
	}
	if output := waitForString(t, parentOutputs, "capacity error in parent"); output != agent.CapacityErrorFallback {
		t.Fatalf("parent output = %q, want capacity fallback", output)
	}
	select {
	case output := <-parentOutputs:
		t.Fatalf("capacity error was sent more than once: %q", output)
	default:
	}
	select {
	case output := <-topicOutputs:
		t.Fatalf("capacity error was sent to topic: %q", output)
	default:
	}
	if methods := requester.requestMethods(); len(methods) != 0 {
		t.Fatalf("capacity rejection sent server requests: %v", methods)
	}
	runner.mu.Lock()
	_, busyExists := runner.jobs["topic-busy"]
	_, rejectedExists := runner.jobs["topic-rejected"]
	activeCount := runner.activeSessionCountLocked()
	runner.mu.Unlock()
	if !busyExists || rejectedExists || activeCount != 1 {
		t.Fatalf("jobs after capacity rejection: busy=%v rejected=%v active=%d", busyExists, rejectedExists, activeCount)
	}
}

func TestConversationAgentRunnerEvictsLeastRecentlyUsedIdleTopicAtCapacity(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	requester := newRunnerTopicRequester()
	runner := newConversationAgentRunner(ctx, conversationAgentRunnerOptions{
		IdleTimeout: time.Hour,
		MaxSessions: 2,
	})
	defer runner.CancelAll()
	outputs := make(chan struct{}, 3)
	assistantAgent := agent.New(llmModelFunc(func(context.Context, llm.Request) (llm.Response, error) {
		return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "完成"}}}, nil
	}))
	sink := agent.OutputSinkFunc(func(context.Context, string) error {
		outputs <- struct{}{}
		return nil
	})

	for _, topicID := range []string{"topic-old", "topic-new"} {
		runner.Start(ctx, topicID, sink, assistantAgent, preparedTopicRun(topicID, topicID+"-message", 1, "开始", "user-1", "auth_1", requester))
		waitForSignal(t, outputs, topicID+" response")
		waitForRunnerJobIdle(t, runner, topicID)
	}
	runner.mu.Lock()
	runner.jobs["topic-old"].lastActiveAt = time.Now().Add(-2 * time.Hour)
	runner.jobs["topic-new"].lastActiveAt = time.Now().Add(-time.Hour)
	runner.mu.Unlock()

	runner.Start(ctx, "topic-third", sink, assistantAgent, preparedTopicRun("topic-third", "topic-third-message", 1, "开始", "user-1", "auth_1", requester))
	waitForSignal(t, outputs, "third topic response")
	waitForRunnerJobRemoved(t, runner, "topic-old")
	if methods := requester.requestMethods(); len(methods) != 0 {
		t.Fatalf("capacity eviction sent server requests: %v", methods)
	}
	runner.mu.Lock()
	_, oldExists := runner.jobs["topic-old"]
	_, newExists := runner.jobs["topic-new"]
	_, thirdExists := runner.jobs["topic-third"]
	jobCount := len(runner.jobs)
	runner.mu.Unlock()
	if oldExists || !newExists || !thirdExists || jobCount != 2 {
		t.Fatalf("jobs after eviction: old=%v new=%v third=%v count=%d", oldExists, newExists, thirdExists, jobCount)
	}
}

func TestConversationAgentRunnerIsolatesAuthorizationPerTopicTrigger(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	requester := newRunnerTopicRequester()
	runner := newConversationAgentRunner(ctx)
	defer runner.CancelAll()
	source := builtintools.NewSource()
	var modelCalls int
	var modelMu sync.Mutex
	errorsSeen := make(chan error, 3)
	assistantAgent := agent.New(llmModelFunc(func(ctx context.Context, _ llm.Request) (llm.Response, error) {
		modelMu.Lock()
		modelCalls++
		call := modelCalls
		modelMu.Unlock()
		if call == 1 {
			_, err := source.CallTool(ctx, "projects", json.RawMessage(`{"operation":"search_projects","runas":{"type":"user","id":"user-a","authorization_ref":"auth_a"},"arguments":{}}`))
			errorsSeen <- err
		} else if call == 2 {
			_, oldErr := source.CallTool(ctx, "projects", json.RawMessage(`{"operation":"search_projects","runas":{"type":"user","id":"user-a","authorization_ref":"auth_a"},"arguments":{}}`))
			if oldErr == nil {
				errorsSeen <- errors.New("previous trigger authorization still resolves")
			} else {
				errorsSeen <- nil
			}
			_, currentErr := source.CallTool(ctx, "projects", json.RawMessage(`{"operation":"search_projects","runas":{"type":"user","id":"user-b","authorization_ref":"auth_b"},"arguments":{}}`))
			errorsSeen <- currentErr
		}
		return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "完成"}}}, nil
	}))
	outputs := make(chan struct{}, 2)
	sink := agent.OutputSinkFunc(func(context.Context, string) error {
		outputs <- struct{}{}
		return nil
	})

	first := preparedTopicRun("topic-1", "parent-message", 42, "第一条", "user-a", "auth_a", requester)
	first.EventConversationID = "parent-group"
	first.Scope.AuthorizationConversationID = "parent-group"
	runner.Start(ctx, "topic-1", sink, assistantAgent, first)
	waitForSignal(t, outputs, "first trigger response")
	waitForRunnerJobIdle(t, runner, "topic-1")

	second := preparedTopicRun("topic-1", "topic-message-1", 1, "第二条", "user-b", "auth_b", requester)
	runner.Start(ctx, "topic-1", sink, assistantAgent, second)
	waitForSignal(t, outputs, "second trigger response")
	for index := 0; index < 3; index++ {
		if err := <-errorsSeen; err != nil {
			t.Fatalf("authorization check %d: %v", index+1, err)
		}
	}

	projectCalls := requester.projectCalls()
	if len(projectCalls) != 2 {
		t.Fatalf("project requester calls = %d, want 2", len(projectCalls))
	}
	if projectCalls[0].AuthorizationConversationID != "parent-group" || projectCalls[0].ID != "user-a" || projectCalls[0].TriggerMessageID != "parent-message" {
		t.Fatalf("first trigger runas = %#v", projectCalls[0])
	}
	if projectCalls[1].AuthorizationConversationID != "topic-1" || projectCalls[1].ID != "user-b" || projectCalls[1].TriggerMessageID != "topic-message-1" {
		t.Fatalf("second trigger runas = %#v", projectCalls[1])
	}
}

func TestConversationAgentRunnerActivatesInterveningTriggerAtNextModelTurn(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	requester := newRunnerTopicRequester()
	runner := newConversationAgentRunner(ctx)
	defer runner.CancelAll()
	source := builtintools.NewSource()
	registry := &blockingToolRegistry{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	checks := make(chan error, 3)
	var modelCalls int
	var modelMu sync.Mutex
	assistantAgent := agent.New(llmModelFunc(func(ctx context.Context, _ llm.Request) (llm.Response, error) {
		modelMu.Lock()
		modelCalls++
		call := modelCalls
		modelMu.Unlock()
		if call == 1 {
			_, err := source.CallTool(ctx, "projects", json.RawMessage(`{"operation":"search_projects","runas":{"type":"user","id":"user-a","authorization_ref":"auth_a"},"arguments":{}}`))
			checks <- err
			return llm.Response{Blocks: []llm.Block{{
				Type:      llm.BlockTypeToolUse,
				ToolUseID: "toolu_wait",
				ToolName:  "test__wait",
				ToolInput: json.RawMessage(`{}`),
			}}}, nil
		}
		_, oldErr := source.CallTool(ctx, "projects", json.RawMessage(`{"operation":"search_projects","runas":{"type":"user","id":"user-a","authorization_ref":"auth_a"},"arguments":{}}`))
		if oldErr == nil {
			checks <- errors.New("previous trigger authorization still resolves")
		} else {
			checks <- nil
		}
		_, currentErr := source.CallTool(ctx, "projects", json.RawMessage(`{"operation":"search_projects","runas":{"type":"user","id":"user-b","authorization_ref":"auth_b"},"arguments":{}}`))
		checks <- currentErr
		return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "已按补充继续"}}}, nil
	}), agent.WithToolRegistry(registry))
	outputs := make(chan struct{}, 1)
	sink := agent.OutputSinkFunc(func(context.Context, string) error {
		outputs <- struct{}{}
		return nil
	})

	first := preparedTopicRun("topic-1", "parent-message", 42, "第一条", "user-a", "auth_a", requester)
	first.EventConversationID = "parent-group"
	first.Scope.AuthorizationConversationID = "parent-group"
	runner.Start(ctx, "topic-1", sink, assistantAgent, first)
	waitForSignal(t, registry.started, "first tool call to start")

	second := preparedTopicRun("topic-1", "topic-message-1", 1, "方向不对，按第二条处理", "user-b", "auth_b", requester)
	runner.Start(ctx, "topic-1", sink, assistantAgent, second)
	runner.mu.Lock()
	job := runner.jobs["topic-1"]
	runner.mu.Unlock()
	if _, ok := job.scopeStore.ResolveAuthorization("auth_a"); !ok {
		t.Fatal("current tool-chain authorization changed before the next model turn")
	}
	if _, ok := job.scopeStore.ResolveAuthorization("auth_b"); ok {
		t.Fatal("intervening trigger authorization activated before the next model turn")
	}

	close(registry.release)
	waitForSignal(t, outputs, "intervening trigger response")
	for index := 0; index < 3; index++ {
		if err := <-checks; err != nil {
			t.Fatalf("authorization check %d: %v", index+1, err)
		}
	}

	projectCalls := requester.projectCalls()
	if len(projectCalls) != 2 {
		t.Fatalf("project requester calls = %d, want 2", len(projectCalls))
	}
	if projectCalls[0].AuthorizationConversationID != "parent-group" || projectCalls[0].ID != "user-a" {
		t.Fatalf("first trigger runas = %#v", projectCalls[0])
	}
	if projectCalls[1].AuthorizationConversationID != "topic-1" || projectCalls[1].ID != "user-b" {
		t.Fatalf("intervening trigger runas = %#v", projectCalls[1])
	}
}

func TestConversationAgentRunnerPreservesSenderOrderAcrossInterventions(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := newConversationAgentRunner(ctx)
	defer runner.CancelAll()
	registry := &blockingToolRegistry{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	secondTurn := make(chan struct{})
	thirdTurn := make(chan struct{})
	var requests []llm.Request
	var requestsMu sync.Mutex
	assistantAgent := agent.New(llmModelFunc(func(_ context.Context, request llm.Request) (llm.Response, error) {
		requestsMu.Lock()
		requests = append(requests, request)
		call := len(requests)
		requestsMu.Unlock()
		switch call {
		case 1:
			return llm.Response{Blocks: []llm.Block{
				{Type: llm.BlockTypeToolUse, ToolUseID: "toolu_wait", ToolName: "test__wait", ToolInput: json.RawMessage(`{}`)},
				{Type: llm.BlockTypeToolUse, ToolUseID: "toolu_must_skip", ToolName: "test__must_skip", ToolInput: json.RawMessage(`{}`)},
			}}, nil
		case 2:
			close(secondTurn)
			return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "处理 Bob 的消息"}}}, nil
		default:
			close(thirdTurn)
			return llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "处理 Alice 的后续消息"}}}, nil
		}
	}), agent.WithToolRegistry(registry))
	sink := agent.OutputSinkFunc(func(context.Context, string) error { return nil })
	requester := newRunnerTopicRequester()

	runner.Start(ctx, "topic-1", sink, assistantAgent,
		preparedTopicRun("topic-1", "message-a1", 1, "Alice 第一条", "user-a", "auth_a1", requester))
	waitForSignal(t, registry.started, "first sender tool call")
	runner.Start(ctx, "topic-1", sink, assistantAgent,
		preparedTopicRun("topic-1", "message-b1", 2, "Bob 插话", "user-b", "auth_b1", requester))
	runner.Start(ctx, "topic-1", sink, assistantAgent,
		preparedTopicRun("topic-1", "message-a2", 3, "Alice 再补充", "user-a", "auth_a2", requester))
	close(registry.release)
	waitForSignal(t, secondTurn, "second sender turn")
	waitForSignal(t, thirdTurn, "third sender turn")

	requestsMu.Lock()
	defer requestsMu.Unlock()
	if len(requests) != 3 {
		t.Fatalf("model request count = %d, want 3", len(requests))
	}
	secondJSON, _ := json.Marshal(requests[1].Messages)
	if !strings.Contains(string(secondJSON), "Bob 插话") || strings.Contains(string(secondJSON), "Alice 再补充") {
		t.Fatalf("second sender request = %s, want Bob only", secondJSON)
	}
	for _, snippet := range []string{"toolu_must_skip", "用户发送了新的消息，本工具尚未执行。"} {
		if !strings.Contains(string(secondJSON), snippet) {
			t.Fatalf("second sender request = %s, want interrupted tool result %q", secondJSON, snippet)
		}
	}
	thirdJSON, _ := json.Marshal(requests[2].Messages)
	if !strings.Contains(string(thirdJSON), "Alice 再补充") {
		t.Fatalf("third sender request = %s, want Alice follow-up", thirdJSON)
	}
}

func TestConversationAgentRunnerTopicClosedEventCancelsSession(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := newConversationAgentRunner(ctx)
	started := make(chan struct{})
	canceled := make(chan struct{})
	assistantAgent := agent.New(llmModelFunc(func(ctx context.Context, _ llm.Request) (llm.Response, error) {
		close(started)
		<-ctx.Done()
		close(canceled)
		return llm.Response{}, ctx.Err()
	}))
	runner.Start(ctx, "topic-1", agent.OutputSinkFunc(func(context.Context, string) error { return nil }), assistantAgent,
		preparedTopicRun("topic-1", "topic-message-1", 1, "开始", "user-1", "auth_1", newRunnerTopicRequester()))
	waitForSignal(t, started, "topic session start")
	runner.CloseConversationSession("topic-1")
	waitForSignal(t, canceled, "topic session cancellation")
	runner.mu.Lock()
	_, exists := runner.jobs["topic-1"]
	runner.mu.Unlock()
	if exists {
		t.Fatal("closed topic session remains registered")
	}
}

type runnerProjectRunAs struct {
	AuthorizationConversationID string `json:"authorization_conversation_id"`
	ID                          string `json:"id"`
	TriggerMessageID            string `json:"trigger_message_id"`
}

type runnerTopicRequester struct {
	mu       sync.Mutex
	methods  []string
	projects []runnerProjectRunAs
}

func newRunnerTopicRequester() *runnerTopicRequester {
	return &runnerTopicRequester{}
}

func (r *runnerTopicRequester) Request(_ context.Context, method string, payload any) (json.RawMessage, error) {
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	r.methods = append(r.methods, method)
	r.mu.Unlock()
	switch method {
	case "projects.list":
		var request struct {
			RunAs runnerProjectRunAs `json:"runas"`
		}
		if err := json.Unmarshal(rawPayload, &request); err != nil {
			return nil, err
		}
		r.mu.Lock()
		r.projects = append(r.projects, request.RunAs)
		r.mu.Unlock()
		return json.RawMessage(`{"ok":true}`), nil
	default:
		return nil, fmt.Errorf("unexpected requester method %q", method)
	}
}

func (r *runnerTopicRequester) requestMethods() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.methods...)
}

func (r *runnerTopicRequester) projectCalls() []runnerProjectRunAs {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]runnerProjectRunAs(nil), r.projects...)
}

func preparedTopicRun(topicID, messageID string, seq int64, content, userID, authorizationRef string, requester builtintools.AppRequester) preparedAgentRun {
	prepared := preparedTextRun(topicID, messageID, seq, content)
	prepared.EventConversationID = topicID
	prepared.Authorization = preparedAuthorization{
		Authorization: builtintools.Authorization{ActorID: userID, ActorType: "user", TriggerMessageID: messageID},
		Candidate: agent.AuthorizationCandidate{
			Ref: authorizationRef, SenderID: userID, SenderName: userID,
			SenderType: "user", MessageSeq: seq, MessageSummary: content,
		},
		Ref: authorizationRef,
	}
	prepared.Request.AuthorizationRef = authorizationRef
	prepared.Request.Conversation = agent.Conversation{ID: topicID, Name: "话题", Type: "topic"}
	prepared.Request.Sender = agent.Sender{ID: userID, Name: userID, Type: "user"}
	prepared.Scope = builtintools.Scope{
		AuthorizationConversationID: topicID,
		ConversationID:              topicID,
		ConversationType:            "topic",
		Requester:                   requester,
	}
	return prepared
}

func waitForRunnerJobIdle(t *testing.T, runner *conversationAgentRunner, key string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		runner.mu.Lock()
		job := runner.jobs[key]
		idle := job != nil && !job.running && !job.session.HasPending() && len(job.pending) == 0
		runner.mu.Unlock()
		if idle {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("runner job %q did not become idle", key)
		}
		time.Sleep(time.Millisecond)
	}
}

func waitForRunnerJobRemoved(t *testing.T, runner *conversationAgentRunner, key string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		runner.mu.Lock()
		_, exists := runner.jobs[key]
		runner.mu.Unlock()
		if !exists {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("runner job %q was not removed", key)
		}
		time.Sleep(time.Millisecond)
	}
}

func waitForString(t *testing.T, ch <-chan string, label string) string {
	t.Helper()
	select {
	case value := <-ch:
		return value
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for %s", label)
		return ""
	}
}

func TestStatusControllerCadenceIncludesSlowSenderTime(t *testing.T) {
	starts := make(chan time.Time, 8)
	controller := newConversationStatusController(context.Background(), func(ctx context.Context, _ string) error {
		starts <- time.Now()
		timer := time.NewTimer(30 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-timer.C:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}, 20*time.Millisecond)
	controller.Switch("working")
	times := collectStatusStarts(t, starts, 3)
	controller.Stop()
	for i := 1; i < len(times); i++ {
		delta := times[i].Sub(times[i-1])
		if delta < 25*time.Millisecond || delta >= 47*time.Millisecond {
			t.Fatalf("slow sender start interval %d = %v, want near 30ms and below additive 50ms", i, delta)
		}
	}
}

func TestStatusControllerCadenceForFastSenderUsesInterval(t *testing.T) {
	starts := make(chan time.Time, 8)
	controller := newConversationStatusController(context.Background(), func(context.Context, string) error {
		starts <- time.Now()
		return nil
	}, 20*time.Millisecond)
	controller.Switch("working")
	times := collectStatusStarts(t, starts, 3)
	controller.Stop()
	for i := 1; i < len(times); i++ {
		delta := times[i].Sub(times[i-1])
		if delta < 14*time.Millisecond || delta >= 40*time.Millisecond {
			t.Fatalf("fast sender start interval %d = %v, want near 20ms", i, delta)
		}
	}
}

func collectStatusStarts(t *testing.T, starts <-chan time.Time, count int) []time.Time {
	t.Helper()
	result := make([]time.Time, 0, count)
	timeout := time.NewTimer(time.Second)
	defer timeout.Stop()
	for len(result) < count {
		select {
		case started := <-starts:
			result = append(result, started)
		case <-timeout.C:
			t.Fatalf("timed out after %d/%d sends", len(result), count)
		}
	}
	return result
}
