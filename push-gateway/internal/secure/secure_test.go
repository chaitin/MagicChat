package secure

import "testing"

func TestGeneratedTokensAreStrongAndDistinct(t *testing.T) {
	first, err := GenerateToken()
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}
	second, err := GenerateToken()
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}
	if len(first) < 40 || first == second {
		t.Fatalf("generated tokens have unexpected values: %q, %q", first, second)
	}
	if !MatchesToken(HashToken(first), first) || MatchesToken(HashToken(first), second) {
		t.Fatal("token hash matching returned an unexpected result")
	}
}
