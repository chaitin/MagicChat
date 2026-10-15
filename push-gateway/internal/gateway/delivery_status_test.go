package gateway

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"push-gateway/internal/model"
)

func TestDeliveryStatusIsInstallationScopedAndSeparatesQueuedFromProviderAcceptance(t *testing.T) {
	service, db, _, now := newTestService(t)
	installation, err := service.RegisterInstallation(t.Context(), RegisterInstallationInput{Provider: "fake", ProviderToken: "diagnostic-device-token", Platform: "android"})
	if err != nil {
		t.Fatal(err)
	}
	grant, err := service.CreateActiveGrant(t.Context(), installation.InstallationID, installation.ManagementToken)
	if err != nil {
		t.Fatal(err)
	}
	other, err := service.RegisterInstallation(t.Context(), RegisterInstallationInput{Provider: "fake", ProviderToken: "other-diagnostic-device-token", Platform: "android"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.GetDeliveryStatus(t.Context(), grant.GrantID, other.ManagementToken); failureCode(err) != "unauthorized" {
		t.Fatalf("other installation read status: %v", err)
	}
	status, err := service.GetDeliveryStatus(t.Context(), grant.GrantID, installation.ManagementToken)
	if err != nil || status.LastJob != nil || status.GrantStatus != model.GrantStatusActive {
		t.Fatalf("empty status=%#v err=%v", status, err)
	}
	_, err = service.EnqueueNotification(t.Context(), grant.GrantID, grant.SendToken, testServerKey, NotificationInput{Event: EventMessageCreated, RouteToken: "diagnostic-route-token", IdempotencyKey: "diagnostic-message"})
	if err != nil {
		t.Fatal(err)
	}
	status, err = service.GetDeliveryStatus(t.Context(), grant.GrantID, installation.ManagementToken)
	if err != nil || status.LastJob == nil || status.LastJob.Status != model.JobStatusQueued {
		t.Fatalf("queued status=%#v err=%v", status, err)
	}
	if _, err = service.DispatchBatch(t.Context(), 10); err != nil {
		t.Fatal(err)
	}
	status, err = service.GetDeliveryStatus(t.Context(), grant.GrantID, installation.ManagementToken)
	if err != nil || status.LastJob == nil || status.LastJob.Status != model.JobStatusAccepted {
		t.Fatalf("provider status=%#v err=%v", status, err)
	}
	encoded, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{installation.ManagementToken, grant.SendToken, "diagnostic-device-token", "diagnostic-route-token", "provider-message-1"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatal("diagnostics contain credentials, routing data or provider receipt identifiers")
		}
	}
	if err := db.Model(&model.Grant{}).Where("id = ?", grant.GrantID).Update("expires_at", now.Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	status, err = service.GetDeliveryStatus(t.Context(), grant.GrantID, installation.ManagementToken)
	if err != nil || status.GrantStatus != model.GrantStatusExpired {
		t.Fatalf("expired grant status=%#v err=%v", status, err)
	}
	if _, err = service.GetDeliveryStatus(t.Context(), "not-a-uuid", installation.ManagementToken); failureCode(err) != "invalid_request" {
		t.Fatalf("invalid grant id accepted: %v", err)
	}
}
