package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"syscall"

	"push-gateway/internal/secure"

	"golang.org/x/term"
)

func main() {
	fmt.Fprint(os.Stderr, "Password: ")
	var password string
	var err error
	if term.IsTerminal(int(syscall.Stdin)) {
		var value []byte
		value, err = term.ReadPassword(int(syscall.Stdin))
		fmt.Fprintln(os.Stderr)
		password = string(value)
	} else {
		password, err = bufio.NewReader(os.Stdin).ReadString('\n')
		password = strings.TrimRight(password, "\r\n")
	}
	if err != nil && password == "" {
		fmt.Fprintln(os.Stderr, "failed to read password")
		os.Exit(1)
	}
	if len(password) < 12 {
		fmt.Fprintln(os.Stderr, "password must contain at least 12 characters")
		os.Exit(1)
	}
	hash, err := secure.HashArgon2id(password)
	if err != nil {
		fmt.Fprintln(os.Stderr, "failed to hash password")
		os.Exit(1)
	}
	fmt.Println(hash)
}
