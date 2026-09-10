package httpserver

import (
	"errors"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"

	"github.com/labstack/echo/v4"
)

func (s *Server) registerAdminWebRoutes(router *echo.Echo) {
	router.GET("/admin", func(c echo.Context) error {
		return c.Redirect(http.StatusPermanentRedirect, "/admin/")
	})
	router.HEAD("/admin", func(c echo.Context) error {
		return c.Redirect(http.StatusPermanentRedirect, "/admin/")
	})
	router.GET("/admin/", s.serveAdminWeb)
	router.HEAD("/admin/", s.serveAdminWeb)
	router.GET("/admin/*", s.serveAdminWeb)
	router.HEAD("/admin/*", s.serveAdminWeb)
}

func (*Server) serveAdminWeb(c echo.Context) error {
	requested := strings.TrimPrefix(c.Request().URL.Path, "/admin/")
	name := strings.TrimPrefix(path.Clean("/"+requested), "/")
	if name == "." || name == "" {
		name = "index.html"
	}

	content, err := assets.ReadFile("admin-dist/" + name)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		if path.Ext(name) != "" {
			return echo.NewHTTPError(http.StatusNotFound)
		}
		name = "index.html"
		content, err = assets.ReadFile("admin-dist/index.html")
		if err != nil {
			return err
		}
	}

	if name == "index.html" {
		c.Response().Header().Set("Cache-Control", "no-cache")
	} else {
		c.Response().Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	contentType := mime.TypeByExtension(path.Ext(name))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	return c.Blob(http.StatusOK, contentType, content)
}
