package gateway

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"push-gateway/internal/model"
	"push-gateway/internal/provider"
	"push-gateway/internal/secure"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const testServerKey = "mcps_srv_AAAAAAAAAAAA_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

type recordingProvider struct {
	mu                     sync.Mutex
	notifications          []provider.Notification
	errors                 []error
	requestIdentifierCalls int
}

func (*recordingProvider) Name() string { return "fake" }

func (*recordingProvider) ValidateRegistration(provider.Registration) error { return nil }

func (p *recordingProvider) NewRequestIdentifier(context.Context) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.requestIdentifierCalls++
	return "provider-request-identifier", nil
}

func (p *recordingProvider) Send(_ context.Context, notification provider.Notification) (provider.Receipt, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.notifications = append(p.notifications, notification)
	if len(p.errors) > 0 {
		err := p.errors[0]
		p.errors = p.errors[1:]
		return provider.Receipt{}, err
	}
	return provider.Receipt{MessageID: "provider-message-1"}, nil
}

func TestInstallationGrantAndNotificationLifecycle(t *testing.T) {
	service, db, pushProvider, now := newTestService(t)
	credential, err := service.RegisterInstallation(t.Context(), RegisterInstallationInput{
		Provider: "fake", ProviderToken: "provider-token-123", Platform: "android", AppVersion: "1.0.0",
	})
	if err != nil {
		t.Fatalf("register installation: %v", err)
	}
	grant, err := service.CreateActiveGrant(t.Context(), credential.InstallationID, credential.ManagementToken)
	if err != nil {
		t.Fatalf("create active grant: %v", err)
	}
	input := NotificationInput{
		Event: EventMessageCreated, RouteToken: "route-token-123",
		CollapseKey: "conversation-hash", IdempotencyKey: "message-1:grant-1",
	}
	first, err := service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, input)
	if err != nil || !first.Accepted || first.Duplicate {
		t.Fatalf("first enqueue = %#v, err = %v", first, err)
	}
	second, err := service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, input)
	if err != nil || !second.Duplicate || second.JobID != first.JobID {
		t.Fatalf("duplicate enqueue = %#v, err = %v", second, err)
	}
	processed, err := service.DispatchBatch(t.Context(), 10)
	if err != nil || processed != 1 {
		t.Fatalf("dispatch = %d, err = %v", processed, err)
	}
	if len(pushProvider.notifications) != 1 {
		t.Fatalf("provider notifications = %d", len(pushProvider.notifications))
	}
	notification := pushProvider.notifications[0]
	if notification.ID != first.JobID || notification.Title != "即应" || notification.Body != "你收到一条新消息" || notification.Token != "provider-token-123" {
		t.Fatalf("notification = %#v", notification)
	}
	var job model.Job
	if err := db.First(&job, "id = ?", first.JobID).Error; err != nil {
		t.Fatalf("load job: %v", err)
	}
	if job.Status != model.JobStatusAccepted || job.ProviderMessageID != "provider-message-1" || job.LastErrorCode != "" {
		t.Fatalf("stored job = %#v", job)
	}

	*now = now.Add(time.Minute)
	replacement, err := service.CreateActiveGrant(t.Context(), credential.InstallationID, credential.ManagementToken)
	if err != nil {
		t.Fatalf("replace active grant: %v", err)
	}
	if _, err := service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, NotificationInput{
		Event: EventMessageCreated, RouteToken: "another-route", IdempotencyKey: "message-2:old-grant",
	}); failureCode(err) != "grant_revoked" {
		t.Fatalf("old grant enqueue error = %v", err)
	}
	if _, err := service.EnqueueNotification(t.Context(), replacement.GrantID, replacement.SendToken, testServerKey, NotificationInput{
		Event: EventMessageCreated, RouteToken: "another-route", IdempotencyKey: "message-2:new-grant",
	}); err != nil {
		t.Fatalf("replacement grant enqueue: %v", err)
	}
}

func TestRegistrationAndGlobalNotificationRateLimits(t *testing.T) {
	service, _, _, _ := newTestService(t)
	service.maxRegistrationsPerIPMinute = 1
	first, err := service.RegisterInstallation(t.Context(), RegisterInstallationInput{
		ClientKey: "203.0.113.10", Provider: "fake", ProviderToken: "rate-device-token-1", Platform: "android",
	})
	if err != nil {
		t.Fatalf("first registration: %v", err)
	}
	if _, err := service.RegisterInstallation(t.Context(), RegisterInstallationInput{
		ClientKey: "203.0.113.10", Provider: "fake", ProviderToken: "rate-device-token-2", Platform: "android",
	}); failureCode(err) != "rate_limited" {
		t.Fatalf("second registration error = %v", err)
	}
	grant, _ := service.CreateActiveGrant(t.Context(), first.InstallationID, first.ManagementToken)
	service.maxNotificationsGlobalMinute = 1
	if _, err := service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, NotificationInput{
		Event: EventMessageCreated, RouteToken: "rate-route-token-1", IdempotencyKey: "rate-message-id-1",
	}); err != nil {
		t.Fatalf("first notification: %v", err)
	}
	if _, err := service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, NotificationInput{
		Event: EventMessageCreated, RouteToken: "rate-route-token-2", IdempotencyKey: "rate-message-id-2",
	}); failureCode(err) != "rate_limited" {
		t.Fatalf("second notification error = %v", err)
	}
}

func TestServerQuotaChargesAcceptedIdempotentJobsOnce(t *testing.T) {
	service, db, _, now := newTestService(t)
	if err := db.Model(&model.Server{}).Where("status = ?", model.ServerStatusActive).Update("daily_quota", 1).Error; err != nil {
		t.Fatalf("set quota: %v", err)
	}
	credential, err := service.RegisterInstallation(t.Context(), RegisterInstallationInput{
		Provider: "fake", ProviderToken: "quota-provider-token", Platform: "android",
	})
	if err != nil {
		t.Fatalf("register installation: %v", err)
	}
	grant, err := service.CreateActiveGrant(t.Context(), credential.InstallationID, credential.ManagementToken)
	if err != nil {
		t.Fatalf("create grant: %v", err)
	}
	input := NotificationInput{Event: EventMessageCreated, RouteToken: "quota-route-token", IdempotencyKey: "quota-job-one"}
	first, err := service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, input)
	if err != nil {
		t.Fatalf("first enqueue: %v", err)
	}
	duplicate, err := service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, input)
	if err != nil || !duplicate.Duplicate || duplicate.JobID != first.JobID {
		t.Fatalf("duplicate = %#v, err = %v", duplicate, err)
	}
	if _, err := service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, NotificationInput{
		Event: EventMessageCreated, RouteToken: "quota-route-token-two", IdempotencyKey: "quota-job-two",
	}); failureCode(err) != "daily_quota_exceeded" {
		t.Fatalf("quota error = %v", err)
	}
	var usage model.ServerDailyUsage
	if err := db.First(&usage).Error; err != nil || usage.AcceptedCount != 1 {
		t.Fatalf("usage = %#v, err = %v", usage, err)
	}
	*now = time.Date(2026, 8, 21, 16, 0, 0, 0, time.UTC)
	if _, err := service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, NotificationInput{
		Event: EventMessageCreated, RouteToken: "quota-route-next-day", IdempotencyKey: "quota-job-next-day",
	}); err != nil {
		t.Fatalf("next Beijing day enqueue: %v", err)
	}
}

func TestNotificationRequiresActiveServerKey(t *testing.T) {
	service, db, _, _ := newTestService(t)
	credential, _ := service.RegisterInstallation(t.Context(), RegisterInstallationInput{
		Provider: "fake", ProviderToken: "server-auth-provider-token", Platform: "android",
	})
	grant, _ := service.CreateActiveGrant(t.Context(), credential.InstallationID, credential.ManagementToken)
	input := NotificationInput{Event: EventMessageCreated, RouteToken: "server-auth-route", IdempotencyKey: "server-auth-job"}
	if _, err := service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, "wrong", input); failureCode(err) != "server_unauthorized" {
		t.Fatalf("invalid key error = %v", err)
	}
	if err := db.Model(&model.Server{}).Where("status = ?", model.ServerStatusActive).Update("status", model.ServerStatusDisabled).Error; err != nil {
		t.Fatalf("disable server: %v", err)
	}
	if _, err := service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, input); failureCode(err) != "server_disabled" {
		t.Fatalf("disabled server error = %v", err)
	}
}

func TestRegisteringExistingProviderTokenRevokesOldGrant(t *testing.T) {
	service, _, _, _ := newTestService(t)
	first, err := service.RegisterInstallation(t.Context(), RegisterInstallationInput{
		Provider: "fake", ProviderToken: "same-provider-token", Platform: "ios",
	})
	if err != nil {
		t.Fatalf("register first installation: %v", err)
	}
	grant, err := service.CreateActiveGrant(t.Context(), first.InstallationID, first.ManagementToken)
	if err != nil {
		t.Fatalf("create first grant: %v", err)
	}
	second, err := service.RegisterInstallation(t.Context(), RegisterInstallationInput{
		Provider: "fake", ProviderToken: "same-provider-token", Platform: "ios", AppVersion: "2.0.0",
	})
	if err != nil {
		t.Fatalf("register replacement installation: %v", err)
	}
	if second.InstallationID != first.InstallationID || second.ManagementToken == first.ManagementToken {
		t.Fatalf("replacement credential = %#v, first = %#v", second, first)
	}
	if _, err := service.CreateActiveGrant(t.Context(), first.InstallationID, first.ManagementToken); failureCode(err) != "unauthorized" {
		t.Fatalf("old management token error = %v", err)
	}
	if _, err := service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, NotificationInput{
		Event: EventMessageCreated, RouteToken: "stale-route", IdempotencyKey: "stale-message-id",
	}); failureCode(err) != "grant_revoked" {
		t.Fatalf("old send token error = %v", err)
	}
}

func TestDispatchLazilyRotatesProviderTokenEncryption(t *testing.T) {
	oldService, db, pushProvider, now := newTestService(t)
	credential, _ := oldService.RegisterInstallation(t.Context(), RegisterInstallationInput{
		Provider: "fake", ProviderToken: "rotation-device-token", Platform: "android",
	})
	grant, _ := oldService.CreateActiveGrant(t.Context(), credential.InstallationID, credential.ManagementToken)
	_, _ = oldService.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, NotificationInput{
		Event: EventMessageCreated, RouteToken: "rotation-route", IdempotencyKey: "rotation-message",
	})
	newKey := make([]byte, 32)
	for index := range newKey {
		newKey[index] = byte(index + 1)
	}
	rotatedCipher, err := secure.NewTokenCipher(newKey, make([]byte, 32))
	if err != nil {
		t.Fatalf("create rotated cipher: %v", err)
	}
	rotatedService, err := New(Options{
		DB: db, Cipher: rotatedCipher, Providers: []provider.Provider{pushProvider},
		Now: func() time.Time { return *now },
	})
	if err != nil {
		t.Fatalf("create rotated service: %v", err)
	}
	var before model.Installation
	_ = db.First(&before, "id = ?", credential.InstallationID).Error
	if !rotatedCipher.NeedsRotation(before.ProviderTokenCiphertext) {
		t.Fatal("old provider token ciphertext does not need rotation")
	}
	if _, err := rotatedService.DispatchBatch(t.Context(), 1); err != nil {
		t.Fatalf("dispatch with rotated keyring: %v", err)
	}
	var after model.Installation
	_ = db.First(&after, "id = ?", credential.InstallationID).Error
	if rotatedCipher.NeedsRotation(after.ProviderTokenCiphertext) {
		t.Fatal("provider token ciphertext was not rotated")
	}
}

func TestInvalidDeviceDisablesInstallation(t *testing.T) {
	service, db, pushProvider, _ := newTestService(t)
	pushProvider.errors = []error{&provider.SendError{Kind: provider.ErrorInvalidDevice, Code: "device_unregistered"}}
	credential, _ := service.RegisterInstallation(t.Context(), RegisterInstallationInput{
		Provider: "fake", ProviderToken: "invalid-device-token", Platform: "android",
	})
	grant, _ := service.CreateActiveGrant(t.Context(), credential.InstallationID, credential.ManagementToken)
	job, err := service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, NotificationInput{
		Event: EventMessageCreated, RouteToken: "invalid-device-route", IdempotencyKey: "invalid-device-message",
	})
	if err != nil {
		t.Fatalf("enqueue notification: %v", err)
	}
	if _, err := service.DispatchBatch(t.Context(), 10); err != nil {
		t.Fatalf("dispatch invalid device: %v", err)
	}
	var installation model.Installation
	if err := db.First(&installation, "id = ?", credential.InstallationID).Error; err != nil {
		t.Fatalf("load installation: %v", err)
	}
	if installation.Status != model.InstallationStatusDisabled {
		t.Fatalf("installation status = %q", installation.Status)
	}
	var storedJob model.Job
	_ = db.First(&storedJob, "id = ?", job.JobID).Error
	if storedJob.Status != model.JobStatusFailed || storedJob.LastErrorCode != "device_unregistered" {
		t.Fatalf("stored job = %#v", storedJob)
	}
}

func TestStaleInvalidDeviceResponseDoesNotDisableRotatedToken(t *testing.T) {
	service, db, pushProvider, _ := newTestService(t)
	credential, _ := service.RegisterInstallation(t.Context(), RegisterInstallationInput{
		Provider: "fake", ProviderToken: "old-rotation-device-token", Platform: "android",
	})
	grant, _ := service.CreateActiveGrant(t.Context(), credential.InstallationID, credential.ManagementToken)
	_, _ = service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, NotificationInput{
		Event: EventMessageCreated, RouteToken: "rotation-race-route", IdempotencyKey: "rotation-race-message",
	})
	claimed, err := service.claimJobs(t.Context(), 1)
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim = %#v, %v", claimed, err)
	}
	if err := service.UpdateProviderToken(
		t.Context(), credential.InstallationID, credential.ManagementToken,
		"new-rotation-device-token", "2.0.0",
	); err != nil {
		t.Fatalf("rotate provider token: %v", err)
	}
	pushProvider.errors = []error{&provider.SendError{Kind: provider.ErrorInvalidDevice, Code: "device_unregistered"}}
	if err := service.dispatchJob(t.Context(), claimed[0]); err != nil {
		t.Fatalf("dispatch stale token: %v", err)
	}
	var installation model.Installation
	if err := db.First(&installation, "id = ?", credential.InstallationID).Error; err != nil {
		t.Fatalf("load installation: %v", err)
	}
	if installation.Status != model.InstallationStatusActive {
		t.Fatalf("installation status = %q", installation.Status)
	}
	providerToken, err := service.cipher.Decrypt(installation.ProviderTokenCiphertext, []byte(installation.ID))
	if err != nil || providerToken != "new-rotation-device-token" {
		t.Fatalf("provider token = %q, %v", providerToken, err)
	}
	var storedGrant model.Grant
	if err := db.First(&storedGrant, "id = ?", grant.GrantID).Error; err != nil {
		t.Fatalf("load grant: %v", err)
	}
	if storedGrant.Status != model.GrantStatusActive {
		t.Fatalf("grant status = %q", storedGrant.Status)
	}
}

func TestWorkerCleansAbandonedInstallationsAndRetainsActiveOnes(t *testing.T) {
	service, db, _, now := newTestService(t)
	service.installationRetention = time.Hour
	abandoned, _ := service.RegisterInstallation(t.Context(), RegisterInstallationInput{
		Provider: "fake", ProviderToken: "abandoned-device-token", Platform: "android",
	})
	revoked, _ := service.RegisterInstallation(t.Context(), RegisterInstallationInput{
		Provider: "fake", ProviderToken: "revoked-device-token", Platform: "android",
	})
	revokedGrant, _ := service.CreateActiveGrant(t.Context(), revoked.InstallationID, revoked.ManagementToken)
	if err := service.RevokeGrant(t.Context(), revokedGrant.GrantID, revoked.ManagementToken); err != nil {
		t.Fatalf("revoke grant: %v", err)
	}
	active, _ := service.RegisterInstallation(t.Context(), RegisterInstallationInput{
		Provider: "fake", ProviderToken: "active-device-token", Platform: "android",
	})
	_, _ = service.CreateActiveGrant(t.Context(), active.InstallationID, active.ManagementToken)
	if err := db.Model(&model.Installation{}).Where("id IN ?", []string{
		abandoned.InstallationID, revoked.InstallationID, active.InstallationID,
	}).UpdateColumn("updated_at", *now).Error; err != nil {
		t.Fatalf("set installation timestamps: %v", err)
	}
	if err := db.Model(&model.Grant{}).Where("installation_id = ?", revoked.InstallationID).
		UpdateColumn("updated_at", *now).Error; err != nil {
		t.Fatalf("set grant timestamp: %v", err)
	}
	*now = now.Add(2 * time.Hour)
	if _, err := service.DispatchBatch(t.Context(), 1); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	for _, installationID := range []string{abandoned.InstallationID, revoked.InstallationID} {
		var count int64
		_ = db.Model(&model.Installation{}).Where("id = ?", installationID).Count(&count).Error
		if count != 0 {
			t.Fatalf("installation %s was retained", installationID)
		}
	}
	var activeCount int64
	_ = db.Model(&model.Installation{}).Where("id = ?", active.InstallationID).Count(&activeCount).Error
	if activeCount != 1 {
		t.Fatal("active installation was deleted")
	}
}

func TestReclaimedJobRejectsStaleWorkerBeforeProviderSend(t *testing.T) {
	service, _, pushProvider, now := newTestService(t)
	credential, _ := service.RegisterInstallation(t.Context(), RegisterInstallationInput{
		Provider: "fake", ProviderToken: "lease-device-token", Platform: "android",
	})
	grant, _ := service.CreateActiveGrant(t.Context(), credential.InstallationID, credential.ManagementToken)
	_, _ = service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, NotificationInput{
		Event: EventMessageCreated, RouteToken: "lease-route-token", IdempotencyKey: "lease-message-id",
	})
	firstClaim, err := service.claimJobs(t.Context(), 1)
	if err != nil || len(firstClaim) != 1 {
		t.Fatalf("first claim = %#v, err = %v", firstClaim, err)
	}
	*now = now.Add(staleJobLock + time.Second)
	secondClaim, err := service.claimJobs(t.Context(), 1)
	if err != nil || len(secondClaim) != 1 {
		t.Fatalf("second claim = %#v, err = %v", secondClaim, err)
	}
	if firstClaim[0].LockToken == secondClaim[0].LockToken {
		t.Fatal("reclaimed job reused its lease token")
	}
	if err := service.dispatchJob(t.Context(), firstClaim[0]); err != nil {
		t.Fatalf("stale dispatch: %v", err)
	}
	if len(pushProvider.notifications) != 0 {
		t.Fatal("stale worker sent a provider notification")
	}
	if err := service.dispatchJob(t.Context(), secondClaim[0]); err != nil {
		t.Fatalf("current dispatch: %v", err)
	}
	if len(pushProvider.notifications) != 1 {
		t.Fatalf("provider notifications = %d", len(pushProvider.notifications))
	}
}

func TestTransientProviderFailureRetries(t *testing.T) {
	service, db, pushProvider, now := newTestService(t)
	pushProvider.errors = []error{&provider.SendError{Kind: provider.ErrorTransient, Code: "provider_busy"}}
	credential, _ := service.RegisterInstallation(t.Context(), RegisterInstallationInput{
		Provider: "fake", ProviderToken: "retry-device-token", Platform: "android",
	})
	grant, _ := service.CreateActiveGrant(t.Context(), credential.InstallationID, credential.ManagementToken)
	job, _ := service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, NotificationInput{
		Event: EventMessageCreated, RouteToken: "retry-route-token", IdempotencyKey: "retry-message-id",
	})
	if _, err := service.DispatchBatch(t.Context(), 10); err != nil {
		t.Fatalf("first dispatch: %v", err)
	}
	var stored model.Job
	_ = db.First(&stored, "id = ?", job.JobID).Error
	if stored.Status != model.JobStatusRetry || stored.Attempts != 1 {
		t.Fatalf("job after transient failure = %#v", stored)
	}
	*now = now.Add(3 * time.Second)
	if _, err := service.DispatchBatch(t.Context(), 10); err != nil {
		t.Fatalf("retry dispatch: %v", err)
	}
	_ = db.First(&stored, "id = ?", job.JobID).Error
	if stored.Status != model.JobStatusAccepted || stored.Attempts != 2 {
		t.Fatalf("job after retry = %#v", stored)
	}
	if pushProvider.requestIdentifierCalls != 1 || len(pushProvider.notifications) != 2 ||
		pushProvider.notifications[0].RequestIdentifier != "provider-request-identifier" ||
		pushProvider.notifications[1].RequestIdentifier != "provider-request-identifier" ||
		stored.ProviderRequestID != "provider-request-identifier" {
		t.Fatalf("provider request identifiers = calls:%d notifications:%#v stored:%q",
			pushProvider.requestIdentifierCalls, pushProvider.notifications, stored.ProviderRequestID)
	}
}

func newTestService(t *testing.T) (*Service, *gorm.DB, *recordingProvider, *time.Time) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&model.RateLimit{}, &model.Installation{}, &model.Grant{}, &model.Server{},
		&model.ServerKey{}, &model.ServerDailyUsage{}, &model.AdminSession{},
		&model.AdminAuditEvent{}, &model.Job{},
	); err != nil {
		t.Fatalf("migrate test database: %v", err)
	}
	serverID := uuid.NewString()
	if err := db.Create(&model.Server{
		ID: serverID, Name: "test", Status: model.ServerStatusActive,
		DailyQuota: 1000, Revision: 1, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}).Error; err != nil {
		t.Fatalf("create test server: %v", err)
	}
	if err := db.Create(&model.ServerKey{
		ID: uuid.NewString(), ServerID: serverID, PublicID: "AAAAAAAAAAAA",
		KeyHash: secure.HashToken(testServerKey), Status: model.ServerKeyStatusActive,
		CreatedAt: time.Now(), KeyCiphertext: []byte{1},
	}).Error; err != nil {
		t.Fatalf("create test server key: %v", err)
	}
	cipher, err := secure.NewTokenCipher(make([]byte, 32))
	if err != nil {
		t.Fatalf("create cipher: %v", err)
	}
	now := time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC)
	pushProvider := &recordingProvider{}
	service, err := New(Options{
		DB: db, Cipher: cipher, Providers: []provider.Provider{pushProvider}, Now: func() time.Time { return now },
		GrantTTL: 30 * 24 * time.Hour, NotificationTTL: 5 * time.Minute,
		MaxNotificationTTL: time.Hour, MaxJobsPerGrantMinute: 120,
	})
	if err != nil {
		t.Fatalf("create service: %v", err)
	}
	return service, db, pushProvider, &now
}

func failureCode(err error) string {
	if err == nil {
		return ""
	}
	var failure *Failure
	if errors.As(err, &failure) {
		return failure.Code
	}
	return "unknown"
}
