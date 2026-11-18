package admin

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

func (a *UserAPI) jobTitles(c echo.Context) error {
	titles, err := a.users.JobTitles(c.Request().Context(), c.QueryParam("keyword"))
	if err != nil {
		return writeUserManagementError(c, err)
	}
	return writeSuccess(c, http.StatusOK, struct {
		Titles []string `json:"titles"`
	}{Titles: titles})
}
