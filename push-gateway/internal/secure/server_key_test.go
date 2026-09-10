package secure

import "testing"

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
	parsed, valid := ServerKeyPublicID(key)
	if !valid || parsed != publicID {
		t.Fatalf("parsed public id = %q/%v, want %q", parsed, valid, publicID)
	}
	if _, valid := ServerKeyPublicID("wrong"); valid {
		t.Fatal("invalid key was accepted")
	}
}
