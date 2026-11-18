package usermanagement

import (
	"context"
	"fmt"
	"reflect"
	"testing"

	"app/internal/store"
)

func TestJobTitleSuggestions(t *testing.T) {
	db, service, _, _, _, _ := unifiedMemberFixture(t)
	for i, title := range []string{" 工程师 ", "工程师", "高级工程师", "", "   ", "100%专家", "100位专家"} {
		if err := db.Create(&store.User{ID: fmt.Sprintf("title-user-%d", i), Email: fmt.Sprintf("title-%d@example.test", i), Name: "Test", JobTitle: title, Status: StatusActive}).Error; err != nil {
			t.Fatal(err)
		}
	}
	titles, err := service.JobTitles(context.Background(), " 工程 ")
	if err != nil || !reflect.DeepEqual(titles, []string{"工程师", "高级工程师"}) {
		t.Fatalf("titles=%v err=%v", titles, err)
	}
	titles, err = service.JobTitles(context.Background(), "100%")
	if err != nil || !reflect.DeepEqual(titles, []string{"100%专家"}) {
		t.Fatalf("literal wildcard titles=%v err=%v", titles, err)
	}
	titles, err = service.JobTitles(context.Background(), "不存在")
	if err != nil || titles == nil || len(titles) != 0 {
		t.Fatalf("empty titles=%v err=%v", titles, err)
	}
}
