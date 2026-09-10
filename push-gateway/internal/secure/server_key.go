package secure

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

const serverKeyBytes = 16

func GenerateServerKey() (publicID string, key string, err error) {
	content := make([]byte, serverKeyBytes)
	if _, err = rand.Read(content); err != nil {
		return "", "", err
	}
	key = hex.EncodeToString(content)
	publicID, _ = ServerKeyPublicID(key)
	return publicID, key, nil
}

func ServerKeyPublicID(key string) (string, bool) {
	value := strings.TrimSpace(key)
	if len(value) != serverKeyBytes*2 || value != strings.ToLower(value) {
		return "", false
	}
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != serverKeyBytes {
		return "", false
	}
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:12]), true
}
