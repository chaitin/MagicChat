package secure

import (
	"encoding/hex"
	"strings"
	"testing"
)

func TestArgon2idPasswordRoundTrip(t *testing.T) {
	hash, err := HashArgon2id("a sufficiently long password")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if !VerifyArgon2id(hash, "a sufficiently long password") {
		t.Fatal("correct password was rejected")
	}
	if VerifyArgon2id(hash, "wrong password") {
		t.Fatal("wrong password was accepted")
	}
}

func TestServerKeyRoundTrip(t *testing.T) {
	key, err := GenerateServerKey()
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	if len(key) != 32 {
		t.Fatalf("key length = %d, want 32", len(key))
	}
	if _, err := hex.DecodeString(key); err != nil {
		t.Fatalf("key is not hexadecimal: %v", err)
	}
	if !ValidServerKey(key) {
		t.Fatal("generated key is invalid")
	}
	for _, invalid := range []string{"wrong", strings.ToUpper(key), key + "00"} {
		if ValidServerKey(invalid) {
			t.Fatalf("invalid key %q was accepted", invalid)
		}
	}
}
