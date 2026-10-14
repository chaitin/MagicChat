package message

import (
	"errors"
	"testing"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
)

func TestAppMessageSendLimits(t *testing.T) {
	for _, scenario := range []struct {
		name               string
		limit              int
		distinctRecipients bool
	}{
		{name: "300_messages", limit: 300},
		{name: "30_recipients", limit: 30, distinctRecipients: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			db := openMessageTestDB(t)
			fixture := insertMessageTestFixture(t, db)
			now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
			for i := 0; i < scenario.limit; i++ {
				recipient := fixture.user.ID
				if scenario.distinctRecipients && i > 0 {
					recipient = uuid.NewString()
				}
				if err := reserveAppMessageSend(db, fixture.app.ID, uuid.NewString(), &recipient, now); err != nil {
					t.Fatalf("reserve message %d within quota: %v", i+1, err)
				}
			}

			wantReservations := int64(scenario.limit)
			if scenario.distinctRecipients {
				if err := reserveAppMessageSend(db, fixture.app.ID, uuid.NewString(), &fixture.user.ID, now.Add(59*time.Second)); err != nil {
					t.Fatalf("repeat recipient must not consume another recipient slot: %v", err)
				}
				wantReservations++
			}
			recipient := fixture.user.ID
			if scenario.distinctRecipients {
				recipient = uuid.NewString()
			}
			err := reserveAppMessageSend(db, fixture.app.ID, uuid.NewString(), &recipient, now.Add(59*time.Second))
			var limited *Error
			if !errors.As(err, &limited) || limited.Code != CodeRateLimited || limited.RetryAfterSeconds != 1 {
				t.Fatalf("over quota error = %#v, want rate_limited with 1 second retry", err)
			}
			var reservations int64
			if err := db.Model(&store.AppMessageSend{}).Where("app_id = ?", fixture.app.ID).Count(&reservations).Error; err != nil {
				t.Fatalf("count reservations: %v", err)
			}
			if reservations != wantReservations {
				t.Fatalf("reservations = %d, want %d; rejected sends must not consume quota", reservations, wantReservations)
			}
			if err := reserveAppMessageSend(db, fixture.app.ID, uuid.NewString(), &recipient, now.Add(time.Minute)); err != nil {
				t.Fatalf("reserve after rolling window expires: %v", err)
			}
		})
	}
}
