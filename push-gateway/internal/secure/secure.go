package secure

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
)

const tokenBytes = 32

func GenerateToken() (string, error) {
	content := make([]byte, tokenBytes)
	if _, err := rand.Read(content); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(content), nil
}

func HashToken(token string) []byte {
	value := sha256.Sum256([]byte(token))
	return value[:]
}

func MatchesToken(expected []byte, token string) bool {
	actual := HashToken(token)
	return len(expected) == len(actual) && subtle.ConstantTimeCompare(expected, actual) == 1
}
