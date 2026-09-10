package secure

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

type argon2idHash struct {
	memory      uint32
	iterations  uint32
	parallelism uint8
	salt        []byte
	digest      []byte
}

func HashArgon2id(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	const memory uint32 = 64 * 1024
	const iterations uint32 = 3
	const parallelism uint8 = 2
	derived := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, 32)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s", memory, iterations, parallelism,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(derived)), nil
}

func IsArgon2idHash(encoded string) bool {
	_, ok := parseArgon2idHash(encoded)
	return ok
}

func VerifyArgon2id(encoded, password string) bool {
	parsed, ok := parseArgon2idHash(encoded)
	if !ok {
		return false
	}
	actual := argon2.IDKey([]byte(password), parsed.salt, parsed.iterations, parsed.memory, parsed.parallelism, uint32(len(parsed.digest)))
	return subtle.ConstantTimeCompare(parsed.digest, actual) == 1
}

func parseArgon2idHash(encoded string) (argon2idHash, bool) {
	parts := strings.Split(strings.TrimSpace(encoded), "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return argon2idHash{}, false
	}
	var result argon2idHash
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &result.memory, &result.iterations, &result.parallelism); err != nil {
		return argon2idHash{}, false
	}
	if result.memory < 8*1024 || result.memory > 1024*1024 || result.iterations == 0 || result.iterations > 20 || result.parallelism == 0 || result.parallelism > 32 {
		return argon2idHash{}, false
	}
	var err error
	result.salt, err = base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(result.salt) < 16 || len(result.salt) > 64 {
		return argon2idHash{}, false
	}
	result.digest, err = base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(result.digest) < 16 || len(result.digest) > 64 {
		return argon2idHash{}, false
	}
	return result, true
}
