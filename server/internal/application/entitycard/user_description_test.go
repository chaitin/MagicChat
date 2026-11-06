package entitycard

import (
	"app/internal/store"
	"testing"
)

func TestUserCardDescriptionPriority(t *testing.T) {
	phone := " 13800138000 "
	emptyPhone := " "
	for _, tc := range []struct {
		user store.User
		want string
	}{
		{store.User{Email: " user@example.com ", Phone: &phone, Nickname: "昵称", Name: "姓名"}, "user@example.com"},
		{store.User{Email: " ", Phone: &phone, Nickname: "昵称", Name: "姓名"}, "13800138000"},
		{store.User{Phone: &emptyPhone, Nickname: " 昵称 ", Name: "姓名"}, "昵称"},
		{store.User{Name: " 姓名 "}, "姓名"},
		{store.User{}, ""},
	} {
		if got := userCardDescription(tc.user); got != tc.want {
			t.Errorf("description = %q, want %q", got, tc.want)
		}
	}
}
