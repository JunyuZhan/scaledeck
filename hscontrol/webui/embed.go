// Package webui embeds the React single-page admin interface and serves it
// from the headscale binary itself under /ui.
//
// The compiled frontend is produced by `make web` (which builds the project
// under web/) into hscontrol/webui/dist.
//
// dist is not committed: only a .gitkeep placeholder is tracked, and go:embed
// skips dot files. So the frontend MUST be built before `go build` — otherwise
// the embed fails outright with "pattern dist: cannot embed directory dist:
// contains no embeddable files". There is no runtime fallback. `make build`
// handles this via its dependency on the `web` target, and so does the Build
// workflow (build-web runs first and its output is shared with build-go).
package webui

import "embed"

//go:embed dist
var distFS embed.FS

// Dist exposes the embedded filesystem for tests or advanced use.
func Dist() embed.FS {
	return distFS
}
