package client

import "net/http"

const (
	MobileSessionCapabilityHeader  = "X-Dianbao-Mobile-Session"
	MobileSessionCapabilityVersion = "2"
)

// supportsMobileSessionResponse restricts the token-bearing response to a
// supported native-client capability request. Browser requests carry Origin
// and must continue receiving the user-only response.
func supportsMobileSessionResponse(r *http.Request) bool {
	capabilityValues := r.Header.Values(MobileSessionCapabilityHeader)
	if len(capabilityValues) != 1 || capabilityValues[0] != MobileSessionCapabilityVersion {
		return false
	}
	return len(r.Header.Values("Origin")) == 0
}
