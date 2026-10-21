package messagecontent

import "testing"

func TestContactCardURLProtocol(t *testing.T) {
	const id = "550e8400-e29b-41d4-a716-446655440000"
	for _, kind := range []string{"contact", "app", "group"} {
		value := "jiying://" + kind + "/" + id
		if got, err := normalizeCardURL(value); err != nil || got != value {
			t.Fatalf("normalizeCardURL(%q) = %q, %v", value, got, err)
		}
	}
	for _, value := range []string{
		"jiying://contact/no-uuid", "jiying://task/" + id,
		"jiying://contact/" + id + "?server=other", "jiying://contact/" + id + "#fragment",
		"jiying://contact/" + id + "/extra", "jiying://contact@evil/" + id,
		"javascript:alert(1)", "jiying://contact/" + id + "\\extra",
	} {
		if _, err := normalizeCardURL(value); err == nil {
			t.Fatalf("unsafe URL accepted: %q", value)
		}
	}
}
