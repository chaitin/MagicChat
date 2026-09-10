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
	publicID, key, err := GenerateServerKey()
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	if len(key) != 32 {
		t.Fatalf("key length = %d, want 32", len(key))
	}
	if _, err := hex.DecodeString(key); err != nil {
		t.Fatalf("key is not hexadecimal: %v", err)
	}
	parsed, valid := ServerKeyPublicID(key)
	if !valid || parsed != publicID || len(publicID) != 24 {
		t.Fatalf("parsed public id = %q/%v, want %q", parsed, valid, publicID)
	}
	for _, invalid := range []string{"wrong", strings.ToUpper(key), key + "00"} {
		if _, valid := ServerKeyPublicID(invalid); valid {
			t.Fatalf("invalid key %q was accepted", invalid)
		}
	}
}
