package usermanagement

type PresencePort interface {
	OnlineStatus([]string) map[string]bool
	IsOnline(string) bool
	CloseUser(string) int
}

type AppConnectionPort interface {
	CloseApp(string) int
}
