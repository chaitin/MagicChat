package secure

import (
	"crypto/rand"
	"encoding/base64"
	"strings"
)

const serverKeyPrefix = "mcps_srv_"

func GenerateServerKey() (publicID string, key string, err error) {
	identifier := make([]byte, 9)
	if _, err = rand.Read(identifier); err != nil {
		return "", "", err
	}
	secret := make([]byte, 32)
	if _, err = rand.Read(secret); err != nil {
		return "", "", err
	}
	publicID = base64.RawURLEncoding.EncodeToString(identifier)
	key = serverKeyPrefix + publicID + "_" + base64.RawURLEncoding.EncodeToString(secret)
	return publicID, key, nil
}

func ServerKeyPublicID(key string) (string, bool) {
	value := strings.TrimSpace(key)
	if !strings.HasPrefix(value, serverKeyPrefix) {
		return "", false
	}
	content := strings.TrimPrefix(value, serverKeyPrefix)
	if len(content) != 12+1+43 || content[12] != '_' {
		return "", false
	}
	publicID := content[:12]
	secret := content[13:]
	if len(publicID) != 12 || len(secret) != 43 {
		return "", false
	}
	if _, err := base64.RawURLEncoding.DecodeString(publicID); err != nil {
		return "", false
	}
	if decoded, err := base64.RawURLEncoding.DecodeString(secret); err != nil || len(decoded) != 32 {
		return "", false
	}
	return publicID, true
}
