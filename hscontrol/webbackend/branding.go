package webbackend

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// BrandingSettings is the user-visible identity of the console: product name,
// slogan, optional overrides for the login-page copy, logo, and the
// legally-relevant footer fields (ICP / public-security filing numbers) that
// sites served in mainland China must display. It is persisted as a Setting
// (key "branding") so the console can be rebranded from the web UI without a
// rebuild. Nothing here is secret — the public GET returns the same payload as
// the admin one; empty fields fall back to built-in defaults / i18n copy on the
// frontend.
type BrandingSettings struct {
	SiteName      string `json:"site_name"`
	Slogan        string `json:"slogan"`
	LoginHeadline string `json:"login_headline"`
	LoginSubtitle string `json:"login_subtitle"`
	LogoURL       string `json:"logo_url"`         // remote logo, http(s) only
	ICP           string `json:"icp"`              // e.g. 京ICP备12345678号-1
	Gongan        string `json:"gongan"`           // e.g. 京公网安备11010802000000号
	FooterText    string `json:"footer_text"`      // free-form footer line
	HasUploadedLogo bool `json:"has_uploaded_logo"` // read-only, computed server-side
}

// DefaultBranding is the out-of-the-box identity: the project's own name, with
// every other field left to built-in frontend fallbacks.
func DefaultBranding() *BrandingSettings {
	return &BrandingSettings{SiteName: "ScaleDeck"}
}

const (
	brandingSettingKey = "branding"
	maxLogoBytes       = 1 << 20 // 1 MiB
)

// logoExts is the upload whitelist. SVG is deliberately excluded: SVG can carry
// <script>, and serving an uploaded SVG from our origin would be an XSS vector.
var logoExts = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".ico":  "image/x-icon",
}

// brandingDir is where uploaded logo files live: a "branding" subdirectory next
// to the SQLite database, so it lands on the same volume as the rest of the
// web console's state.
func (s *Server) brandingDir() string {
	dir := filepath.Dir(s.cfg.DBPath)
	if dir == "" {
		dir = "."
	}
	return filepath.Join(dir, "branding")
}

// uploadedLogoPath returns the path of the stored logo file, or "" when none
// has been uploaded.
func (s *Server) uploadedLogoPath() string {
	entries, err := os.ReadDir(s.brandingDir())
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if _, ok := logoExts[strings.ToLower(filepath.Ext(e.Name()))]; ok {
			return filepath.Join(s.brandingDir(), e.Name())
		}
	}
	return ""
}

// loadBranding reads the persisted branding row, seeding defaults on first run.
// Safe to call once at startup.
func (s *Server) loadBranding() error {
	var row Setting
	if err := s.db.Where("key = ?", brandingSettingKey).First(&row).Error; err == nil {
		b := DefaultBranding()
		if json.Unmarshal([]byte(row.Value), b) == nil {
			if b.SiteName == "" {
				b.SiteName = DefaultBranding().SiteName
			}
			s.brandingMu.Lock()
			s.branding = b
			s.brandingMu.Unlock()
			return nil
		}
		// corrupt JSON -> fall through and reseed
	}
	return s.saveBranding(DefaultBranding())
}

// saveBranding persists the branding row (upsert).
func (s *Server) saveBranding(b *BrandingSettings) error {
	b.HasUploadedLogo = false // computed field, never persisted
	payload, err := json.Marshal(b)
	if err != nil {
		return err
	}
	row := Setting{Key: brandingSettingKey, Value: string(payload), UpdatedAt: time.Now()}
	var existing Setting
	if err := s.db.Where("key = ?", brandingSettingKey).First(&existing).Error; err == nil {
		existing.Value = row.Value
		existing.UpdatedAt = row.UpdatedAt
		return s.db.Save(&existing).Error
	}
	return s.db.Create(&row).Error
}

// effectiveBranding returns a copy of the current branding with the
// HasUploadedLogo flag computed from disk. Never nil.
func (s *Server) effectiveBranding() *BrandingSettings {
	s.brandingMu.RLock()
	cp := *s.branding
	s.brandingMu.RUnlock()
	if cp.SiteName == "" {
		cp.SiteName = DefaultBranding().SiteName
	}
	cp.HasUploadedLogo = s.uploadedLogoPath() != ""
	return &cp
}

// cleanField trims, strips control characters and rune-safely caps a string.
func cleanField(s string, max int) string {
	s = strings.TrimSpace(s)
	s = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, s)
	runes := []rune(s)
	if len(runes) > max {
		runes = runes[:max]
	}
	return string(runes)
}

// sanitizeBranding normalizes and validates an admin-supplied payload.
func sanitizeBranding(b *BrandingSettings) error {
	b.SiteName = cleanField(b.SiteName, 64)
	b.Slogan = cleanField(b.Slogan, 200)
	b.LoginHeadline = cleanField(b.LoginHeadline, 120)
	b.LoginSubtitle = cleanField(b.LoginSubtitle, 300)
	b.ICP = cleanField(b.ICP, 80)
	b.Gongan = cleanField(b.Gongan, 80)
	b.FooterText = cleanField(b.FooterText, 300)
	b.LogoURL = cleanField(b.LogoURL, 500)
	if b.SiteName == "" {
		return fmt.Errorf("site_name is required")
	}
	if b.LogoURL != "" {
		lower := strings.ToLower(b.LogoURL)
		if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
			return fmt.Errorf("logo_url must be an http(s) URL")
		}
	}
	return nil
}

// ---- handlers --------------------------------------------------------------

// handleGetBranding is public (unauthenticated): the login page needs the name,
// slogan and logo before anyone has a session. Nothing here is secret.
func (s *Server) handleGetBranding(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.effectiveBranding())
}

// handlePutBranding saves the admin-editable branding fields.
func (s *Server) handlePutBranding(w http.ResponseWriter, r *http.Request) {
	var b BrandingSettings
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	b.HasUploadedLogo = false // ignore any client-supplied value
	if err := sanitizeBranding(&b); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.brandingMu.Lock()
	*s.branding = b
	s.brandingMu.Unlock()
	if err := s.saveBranding(&b); err != nil {
		writeError(w, http.StatusInternalServerError, "saving branding failed")
		return
	}
	writeJSON(w, http.StatusOK, s.effectiveBranding())
}

// handleUploadBrandingLogo stores an uploaded logo (PNG/JPEG/WebP/ICO, <=1MiB)
// and keeps any separately-configured remote URL untouched.
func (s *Server) handleUploadBrandingLogo(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(maxLogoBytes + 1024); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form")
		return
	}
	file, header, err := r.FormFile("logo")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing logo file")
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	want, ok := logoExts[ext]
	if !ok {
		writeError(w, http.StatusBadRequest, "unsupported file type: use PNG, JPEG, WebP or ICO")
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, maxLogoBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "reading upload failed")
		return
	}
	if len(data) == 0 || len(data) > maxLogoBytes {
		writeError(w, http.StatusBadRequest, "logo must be between 1 byte and 1 MiB")
		return
	}
	// Cross-check the declared extension against the sniffed content type so a
	// .png that is really HTML/JS can't slip through.
	if got := http.DetectContentType(data[:min(512, len(data))]); got != want {
		writeError(w, http.StatusBadRequest, "file content does not match its extension")
		return
	}

	dir := s.brandingDir()
	if err := os.MkdirAll(dir, 0o750); err != nil {
		writeError(w, http.StatusInternalServerError, "preparing storage failed")
		return
	}
	// Replace any previous upload first so stale files don't linger.
	if old := s.uploadedLogoPath(); old != "" {
		_ = os.Remove(old)
	}
	dst := filepath.Join(dir, "logo"+ext)
	if err := os.WriteFile(dst, data, 0o640); err != nil {
		writeError(w, http.StatusInternalServerError, "writing logo failed")
		return
	}
	log.Printf("webbackend: branding logo uploaded (%d bytes, %s)", len(data), ext)
	writeJSON(w, http.StatusOK, s.effectiveBranding())
}

// handleDeleteBrandingLogo removes the uploaded logo (falls back to the remote
// URL, then to the built-in mark).
func (s *Server) handleDeleteBrandingLogo(w http.ResponseWriter, r *http.Request) {
	if old := s.uploadedLogoPath(); old != "" {
		if err := os.Remove(old); err != nil {
			writeError(w, http.StatusInternalServerError, "removing logo failed")
			return
		}
	}
	writeJSON(w, http.StatusOK, s.effectiveBranding())
}

// handleServeBrandingLogo serves the uploaded logo. Returns 404 when none is
// uploaded; the frontend then falls back to the configured URL or the built-in
// mark.
func (s *Server) handleServeBrandingLogo(w http.ResponseWriter, r *http.Request) {
	p := s.uploadedLogoPath()
	if p == "" {
		writeError(w, http.StatusNotFound, "no uploaded logo")
		return
	}
	ext := strings.ToLower(filepath.Ext(p))
	w.Header().Set("Content-Type", logoExts[ext])
	w.Header().Set("Cache-Control", "public, max-age=300")
	http.ServeFile(w, r, p)
}
