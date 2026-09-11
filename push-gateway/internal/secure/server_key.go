package secure

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

const serverKeyBytes = 16

func GenerateServerKey() (string, error) {
	content := make([]byte, serverKeyBytes)
	if _, err := rand.Read(content); err != nil {
		return "", err
	}
	return hex.EncodeToString(content), nil
}

func ValidServerKey(key string) bool {
	value := strings.TrimSpace(key)
	if len(value) != serverKeyBytes*2 || value != strings.ToLower(value) {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == serverKeyBytes
}
