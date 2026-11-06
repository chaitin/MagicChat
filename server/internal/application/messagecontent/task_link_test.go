package messagecontent

import "testing"

func TestTaskCardURLProtocol(t *testing.T) {
	const id = "550e8400-e29b-41d4-a716-446655440000"
	value := "jiying://task/" + id + "/" + id
	for _, link := range []string{value, "/projects/" + id + "?taskId=" + id} {
		if got, err := normalizeCardURL(link); err != nil || got != link {
			t.Fatalf("normalizeCardURL(%q) = %q, %v", link, got, err)
		}
	}
	for _, link := range []string{
		value + "?server=other", value + "#fragment", value + "/extra",
		"jiying://task/" + id, "jiying://task/invalid/" + id,
		"jiying://task@evil/" + id + "/" + id,
	} {
		if _, err := normalizeCardURL(link); err == nil {
			t.Fatalf("unsafe task URL accepted: %q", link)
		}
	}
}
