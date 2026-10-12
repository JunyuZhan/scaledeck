// Package webbackend implements a small, self-contained web administration
// backend for Headscale.
//
// It is intentionally a SEPARATE process from headscale so that:
//   - The Headscale API key lives only on the server (never in the browser).
//   - Web users, sessions and roles are stored in an independent SQLite database
//     and never touch Headscale's own schema (which uses strict migration
//     digests and must not be mutated by us).
//   - The SPA talks only to this backend; this backend proxies every Headscale
//     operation server-side using the configured API key.
//
// Deployment (see docker-compose.yml): Caddy exposes a single entry, routing
//   /ui/api/*  -> webbackend
//   /ui, /    -> headscale   (headscale keeps serving the static SPA + API)
package webbackend

import (
	"bytes"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/smtp"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/glebarez/sqlite"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// WebUser is a login account for the web console. A web user maps to a Headscale
// user (by name) so that, when role == "user", every proxied Headscale call is
// scoped to that Headscale user. role == "admin" sees and manages everything.
type WebUser struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	Username       string    `gorm:"uniqueIndex;size:128" json:"username"`
	PasswordHash   string    `json:"-"`
	Email          string    `json:"email,omitempty"` // optional; used for alert emails
	HeadscaleUser  string    `json:"headscale_user"`  // empty for admin (sees all)
	Role           string    `json:"role"`            // "admin" | "user"
	// MustChangePassword marks the first-run default admin, created with no
	// password, that must set one on its first login (the "out of box" flow).
	MustChangePassword bool `json:"-"`
	CreatedAt      time.Time `json:"created_at"`
}

// Event is an audit-log / activity record for the web console. Every security-
// relevant action (login, key creation, node changes, policy edits, user
// management) is recorded here so admins have a tamper-evident trace and users
// can see their own recent activity.
type Event struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Time      time.Time `json:"time"`
	Actor     string    `json:"actor"`     // username, or "anonymous" / "system"
	Type      string    `json:"type"`      // login | login_fail | create_key | node_join | node_offline | apply_policy | ...
	Target    string    `json:"target"`    // affected object (node name, username, ...)
	Detail    string    `json:"detail"`    // human-readable summary
	IP        string    `json:"ip"`
}

// Setting is a small key/value store for runtime-tunable configuration edited
// from the web console (currently the mail/SMTP settings). Values are JSON.
type Setting struct {
	Key       string    `gorm:"primaryKey" json:"key"`
	Value     string    `json:"value"` // JSON-encoded payload
	UpdatedAt time.Time `json:"updated_at"`
}

// MailSettings holds the email/SMTP configuration. It is persisted as a Setting
// (key "mail") so admins can configure mail from the console instead of editing
// environment variables. SMTP_PASSWORD / RESEND_API_KEY are secrets and are
// never returned by GET (only presence flags are).
type MailSettings struct {
	Enabled        bool   `json:"enabled"`
	SMTPHost       string `json:"smtp_host"`
	SMTPPort       string `json:"smtp_port"`
	SMTPUsername   string `json:"smtp_username"`
	SMTPPassword   string `json:"smtp_password"`
	SMTPFrom       string `json:"smtp_from"`
	SMTPTLS        string `json:"smtp_tls"` // starttls (587) | ssl (465)
	ResendAPIKey   string `json:"resend_api_key"`
	ResendFrom     string `json:"resend_from"`
	ResendNotifyTo string `json:"resend_notify_to"`
}

// Session is an authenticated browser session identified by a random token
// stored in an HttpOnly cookie.
type Session struct {
	Token     string    `gorm:"primaryKey" json:"-"`
	UserID    uint      `json:"-"`
	ExpiresAt time.Time `json:"-"`
	CreatedAt time.Time `json:"-"`
}

// Invite is a ledger record of a Pre-Auth Key handed out via the web console.
// Headscale's PreAuthKey itself carries no descriptive metadata (no applicant,
// device or org), so we keep our own traceability record: who it was given to,
// what device, which org, and whether it has been used / expired / revoked.
type Invite struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Applicant    string    `json:"applicant"`     // 申请人
	DeviceDesc   string    `json:"device_desc"`   // 设备描述
	Org          string    `json:"org"`           // 单位
	TargetUser   string    `json:"target_user"`   // 目标 Headscale 用户
	KeyPrefix    string    `json:"key_prefix"`    // 密钥前缀（仅用于辨识）
	Hostname     string    `json:"hostname"`      // 写入 tailscale up --hostname
	CreatedBy    string    `json:"created_by"`    // 谁生成的
	CreatedAt    time.Time `json:"created_at"`
	ExpiresAt    time.Time `json:"expires_at"`
	Status       string    `json:"status"` // unused | used | expired | revoked
}

type Config struct {
	Listen           string
	HeadscaleURL     string
	HeadscaleAPIKey  string
	DBPath           string
	SessionDuration  time.Duration
	BootstrapAdmin   string // "user:pass" created on first run if no users exist
	CookieSecure     bool
	ServerURL        string // public base URL used to build client join commands

	// Email. Emails are best-effort: a send failure is logged but never fails
	// the triggering action. When SMTPHost is set, mail is delivered via SMTP
	// (Resend or any SMTP server); otherwise the Resend REST API is used as a
	// fallback when RESEND_API_KEY is set. Empty of both => email disabled.
	ResendAPIKey   string // RESEND_API_KEY; REST fallback when SMTP not configured
	ResendFrom     string // default "Headscale <no-reply@sclink.dev>"
	ResendNotifyTo string // comma-separated fallback recipients for alerts

	// SMTP delivery. For Resend SMTP: host smtp.resend.com, port 587,
	// username "resend", password = your Resend API key, TLS = starttls.
	SMTPHost     string // e.g. smtp.resend.com
	SMTPPort     string // default "587"
	SMTPUsername string // e.g. "resend" (Resend literal username)
	SMTPPassword string // for Resend this is the API key
	SMTPFrom     string // envelope/from address (must be a verified domain)
	SMTPTLS      string // "starttls" (default, port 587) | "ssl" (implicit TLS, port 465)

	// Cloudflare Turnstile: human verification / anti-credential-stuffing.
	// The secret is server-side only; the public site key is exposed to the
	// login page via GET /ui/api/auth/config. Turnstile is enabled only when
	// both SiteKey and Hostnames are set (the verifier ignores a missing
	// secret, so the hostname allow-list is the hard on/off switch).
	TurnstileSecret    string   // WEBUI_TURNSTILE_SECRET
	TurnstileSiteKey   string   // WEBUI_TURNSTILE_SITE_KEY (public)
	TurnstileHostnames []string // WEBUI_TURNSTILE_HOSTNAMES (comma-separated)
	TurnstileAction    string   // WEBUI_TURNSTILE_ACTION (default "login")
}

func LoadConfig() *Config {
	c := &Config{
		Listen:          getenv("WEBUI_LISTEN", ":8090"),
		HeadscaleURL:    getenv("HEADSCALE_URL", "http://localhost:8080"),
		HeadscaleAPIKey: os.Getenv("HEADSCALE_API_KEY"),
		DBPath:          getenv("WEBUI_DB", "webui.db"),
		SessionDuration: 12 * time.Hour,
		BootstrapAdmin:  os.Getenv("WEBUI_BOOTSTRAP_ADMIN"),
		CookieSecure:    os.Getenv("WEBUI_COOKIE_SECURE") != "false",
		ServerURL:       getenv("HEADSCALE_PUBLIC_URL", ""),
		ResendAPIKey:    os.Getenv("RESEND_API_KEY"),
		ResendFrom:      getenv("RESEND_FROM", "Headscale <no-reply@sclink.dev>"),
		ResendNotifyTo:  os.Getenv("RESEND_NOTIFY_TO"),
		SMTPHost:        os.Getenv("SMTP_HOST"),
		SMTPPort:        getenv("SMTP_PORT", "587"),
		SMTPUsername:    os.Getenv("SMTP_USERNAME"),
		SMTPPassword:    os.Getenv("SMTP_PASSWORD"),
		SMTPFrom:        os.Getenv("SMTP_FROM"),
		SMTPTLS:         getenv("SMTP_TLS", "starttls"),

		TurnstileSecret:    os.Getenv("WEBUI_TURNSTILE_SECRET"),
		TurnstileSiteKey:   os.Getenv("WEBUI_TURNSTILE_SITE_KEY"),
		TurnstileHostnames: splitList(os.Getenv("WEBUI_TURNSTILE_HOSTNAMES")),
		TurnstileAction:    getenv("WEBUI_TURNSTILE_ACTION", DefaultTurnstileAction),
	}
	return c
}

// splitList splits a comma-separated env value into a trimmed, non-empty slice.
// "a, b ,,c" -> ["a", "b", "c"]; "" -> nil.
func splitList(v string) []string {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

type Server struct {
	cfg    *Config
	db     *gorm.DB
	client *http.Client

	// loginGuard throttles failed login attempts per client IP + username to
	// blunt brute-force / credential-stuffing. Stored in-memory (single
	// process); good enough for this deployment and resets on restart.
	guardMu      sync.Mutex
	guardFails   map[string]int
	guardLocked  map[string]time.Time

	// loginIPMu + loginIPTimes is a global, per-source-IP rate limit on the
	// login endpoint. It complements loginGuard (which is per IP|username):
	// even before any credential check, a single IP can't hammer /login faster
	// than loginIPMax attempts per loginIPWindow. Also in-memory.
	loginIPMu    sync.Mutex
	loginIPTimes map[string][]time.Time

	// turnstile is the Cloudflare Turnstile verifier; nil when disabled.
	turnstile         TurnstileVerifier
	turnstileSiteKey  string
	turnstileAction   string
	turnstileEnabled  bool

	// watcher state for node join / offline detection (reliability alerts).
	watchMu      sync.Mutex
	knownNodes   map[string]bool   // node id -> was online last seen
	knownOnline  map[string]bool   // node id -> last known online state
	notifiedKeys map[string]bool   // preauthkey id -> expiry alert already sent

	// mailMu guards the runtime-editable mail settings (loaded from the DB,
	// overridable from the web console without restarting the process).
	mailMu sync.RWMutex
	mail   *MailSettings

	// brandingMu guards the runtime-editable site branding (name, slogan,
	// logo, footer/ICP fields) edited from the console.
	brandingMu sync.RWMutex
	branding   *BrandingSettings

	// SSE node-stream hub: a lightweight poller watches the node set / online
	// state and signals every subscribed browser so the UI refreshes without a
	// manual reload. Channels are buffered (size 1) and signalled
	// non-blockingly, so a slow client can never stall the broadcaster.
	sseMu      sync.Mutex
	sseClients map[chan struct{}]bool
	sseSig     string // last broadcast signature ("id:online,...")

	// SSE event-stream hub: signals subscribed browsers when a new audit event
	// is recorded, so the console can show an in-app notification (badge/toast).
	// Each channel carries the event payload; buffered + non-blocking send.
	sseEvMu      sync.Mutex
	sseEvClients map[chan []byte]bool
}

func NewServer(cfg *Config) (*Server, error) {
	if cfg.HeadscaleAPIKey == "" {
		return nil, errors.New("WEBUI_HEADSCALE_API_KEY (HEADSCALE_API_KEY) is required")
	}

	gormDB, err := gorm.Open(sqlite.Open(cfg.DBPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("opening web db: %w", err)
	}
	if err := gormDB.AutoMigrate(&WebUser{}, &Session{}, &Invite{}, &Event{}, &Setting{}); err != nil {
		return nil, fmt.Errorf("migrating web db: %w", err)
	}

	s := &Server{
		cfg:          cfg,
		db:           gormDB,
		client:       &http.Client{Timeout: 30 * time.Second},
		guardFails:   map[string]int{},
		guardLocked:  map[string]time.Time{},
		loginIPTimes: map[string][]time.Time{},
		knownNodes:   map[string]bool{},
		knownOnline:  map[string]bool{},
		notifiedKeys: map[string]bool{},
		mail:         &MailSettings{},
		branding:     DefaultBranding(),
		sseClients:   map[chan struct{}]bool{},
		sseEvClients: map[chan []byte]bool{},
	}

	// Build the Turnstile verifier. NewTurnstileVerifier returns nil (disabled)
	// unless both the secret and an allowed hostname list are configured.
	s.turnstile = NewTurnstileVerifier(cfg.TurnstileSecret, cfg.TurnstileAction, cfg.TurnstileHostnames, s.client)
	s.turnstileSiteKey = cfg.TurnstileSiteKey
	s.turnstileAction = cfg.TurnstileAction
	s.turnstileEnabled = s.turnstile != nil && cfg.TurnstileSiteKey != ""
	if s.turnstileEnabled {
		log.Printf("webbackend: Cloudflare Turnstile enabled for hostnames %v (action %q)", cfg.TurnstileHostnames, cfg.TurnstileAction)
	} else if s.turnstile != nil {
		// Secret + hostnames set but the public site key is missing: the login
		// page can't render the widget, so we must NOT require verification
		// (that would lock everyone out). Log it loudly instead.
		log.Printf("webbackend: WARNING Turnstile secret is set but WEBUI_TURNSTILE_SITE_KEY is missing — human verification is DISABLED")
	}

	if err := s.bootstrap(); err != nil {
		return nil, err
	}
	if err := s.loadMailSettings(); err != nil {
		return nil, fmt.Errorf("loading mail settings: %w", err)
	}
	if err := s.loadBranding(); err != nil {
		return nil, fmt.Errorf("loading branding: %w", err)
	}
	return s, nil
}

// loadMailSettings reads persisted mail settings, seeding them from the
// environment on first run so existing deployments keep working without a UI
// edit. Safe to call once at startup.
func (s *Server) loadMailSettings() error {
	var row Setting
	if err := s.db.Where("key = ?", "mail").First(&row).Error; err == nil {
		m := &MailSettings{}
		if json.Unmarshal([]byte(row.Value), m) == nil {
			s.mailMu.Lock()
			s.mail = m
			s.mailMu.Unlock()
			return nil
		}
		// corrupt JSON -> fall through and reseed
	}
	// Seed from environment variables (first run / legacy deployment).
	m := &MailSettings{
		Enabled:        s.cfg.ResendAPIKey != "" || s.cfg.SMTPHost != "",
		SMTPHost:       s.cfg.SMTPHost,
		SMTPPort:       s.cfg.SMTPPort,
		SMTPUsername:   s.cfg.SMTPUsername,
		SMTPPassword:   s.cfg.SMTPPassword,
		SMTPFrom:       s.cfg.SMTPFrom,
		SMTPTLS:        s.cfg.SMTPTLS,
		ResendAPIKey:   s.cfg.ResendAPIKey,
		ResendFrom:     s.cfg.ResendFrom,
		ResendNotifyTo: s.cfg.ResendNotifyTo,
	}
	if m.SMTPTLS == "" {
		m.SMTPTLS = "starttls"
	}
	s.mailMu.Lock()
	s.mail = m
	s.mailMu.Unlock()
	return s.saveMailSettings(m)
}

// saveMailSettings persists the mail settings row (upsert).
func (s *Server) saveMailSettings(m *MailSettings) error {
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	row := Setting{Key: "mail", Value: string(b), UpdatedAt: time.Now()}
	var existing Setting
	if err := s.db.Where("key = ?", "mail").First(&existing).Error; err == nil {
		existing.Value = row.Value
		existing.UpdatedAt = row.UpdatedAt
		return s.db.Save(&existing).Error
	}
	return s.db.Create(&row).Error
}

// effectiveMail returns the current mail settings (never nil).
func (s *Server) effectiveMail() *MailSettings {
	s.mailMu.RLock()
	defer s.mailMu.RUnlock()
	if s.mail == nil {
		return &MailSettings{}
	}
	return s.mail
}

// bootstrap creates the initial admin account if none exist yet. Two modes:
//   1. WEBUI_BOOTSTRAP_ADMIN="user:pass" set -> create that admin (legacy).
//   2. No users AND no bootstrap env -> create a default "admin" with NO
//      password; the first login is forced into a "set your password" flow
//      (handleSetup). This makes a fresh deployment usable out of the box
//      without pre-configuring a credential.
func (s *Server) bootstrap() error {
	var count int64
	if err := s.db.Model(&WebUser{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	if s.cfg.BootstrapAdmin != "" {
		parts := strings.SplitN(s.cfg.BootstrapAdmin, ":", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			return fmt.Errorf("WEBUI_BOOTSTRAP_ADMIN must be 'user:pass'")
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(parts[1]), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		admin := WebUser{
			Username:      parts[0],
			PasswordHash:  string(hash),
			HeadscaleUser: "",
			Role:          "admin",
		}
		if err := s.db.Create(&admin).Error; err != nil {
			return err
		}
		log.Printf("webbackend: created bootstrap admin user %q", parts[0])
		return nil
	}
	// Out-of-box default admin (no password yet); first login sets it.
	admin := WebUser{
		Username:           "admin",
		PasswordHash:       "",
		HeadscaleUser:      "",
		Role:               "admin",
		MustChangePassword: true,
	}
	if err := s.db.Create(&admin).Error; err != nil {
		return err
	}
	log.Printf("webbackend: created default 'admin' with no password; first login sets it")
	return nil
}

// Handler builds the chi router for the web backend.
func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)

	r.Post("/ui/api/auth/login", s.handleLogin)
	r.Post("/ui/api/auth/logout", s.handleLogout)
	r.Get("/ui/api/auth/me", s.withSession(s.handleMe))
	// Public, unauthenticated: tells the login page whether to render the
	// Turnstile widget and with which (public) site key + action.
	r.Get("/ui/api/auth/config", s.handleAuthConfig)
	// Public, unauthenticated: first-run password setup for the default admin
	// (created with no password). Gated by the same IP rate limit + Turnstile.
	r.Post("/ui/api/auth/setup", s.handleSetup)

	// Public, unauthenticated: site branding (name / slogan / logo / footer
	// fields). Nothing secret — the login page needs it pre-session.
	r.Get("/ui/api/branding", s.handleGetBranding)
	r.Get("/ui/api/branding/logo", s.handleServeBrandingLogo)

	r.Group(func(protected chi.Router) {
		protected.Use(middlewareOf(s.withSession))

		// Admin-only web user management.
		protected.Route("/ui/api/admin/webusers", func(rt chi.Router) {
			rt.Use(middlewareOf(s.requireAdmin))
			rt.Get("/", s.handleListWebUsers)
			rt.Post("/", s.handleCreateWebUser)
			rt.Delete("/{id}", s.handleDeleteWebUser)
			rt.Post("/{id}/password", s.handleResetPassword)
		})

		// Admin-only invite ledger (traceability of handed-out keys).
		protected.Route("/ui/api/admin/invites", func(rt chi.Router) {
			rt.Use(middlewareOf(s.requireAdmin))
			rt.Get("/", s.handleListInvites)
			rt.Post("/purge-expired", s.handlePurgeExpiredInvites)
			rt.Delete("/{id}", s.handleDeleteInvite)
		})

		// Admin-only audit log.
		protected.Route("/ui/api/admin/events", func(rt chi.Router) {
			rt.Use(middlewareOf(s.requireAdmin))
			rt.Get("/", s.handleListEvents)
		})

		// Admin-only mail settings (runtime-editable SMTP/Resend config).
		protected.Route("/ui/api/admin/settings/mail", func(rt chi.Router) {
			rt.Use(middlewareOf(s.requireAdmin))
			rt.Get("/", s.handleGetMailSettings)
			rt.Put("/", s.handlePutMailSettings)
			rt.Post("/test", s.handleTestMail)
		})

		// Admin-only site branding (name / slogan / logo / footer fields).
		protected.Route("/ui/api/admin/settings/branding", func(rt chi.Router) {
			rt.Use(middlewareOf(s.requireAdmin))
			rt.Put("/", s.handlePutBranding)
			rt.Post("/logo", s.handleUploadBrandingLogo)
			rt.Delete("/logo", s.handleDeleteBrandingLogo)
		})

		// Self-service: the logged-in user's own devices + key generation.
		protected.Get("/ui/api/me", s.handleSelf)
		protected.Post("/ui/api/me/preauthkey", s.handleCreateSelfKey)
		protected.Post("/ui/api/me/password", s.handleChangePassword)
		protected.Get("/ui/api/me/events", s.handleMyEvents)

		// Server-sent events: pushes a signal whenever the node set or any
		// node's online state changes, so the console can auto-refresh.
		protected.Get("/ui/api/nodes/stream", s.handleNodeStream)

		// Server-sent events: pushes each new audit event for in-app
		// notifications (bell badge / toast).
		protected.Get("/ui/api/events/stream", s.handleEventStream)

		// Generic proxy to Headscale /api/v1 with role-based scoping.
		protected.Handle("/ui/api/proxy/*", s.handleProxy())
	})

	return r
}

func (s *Server) Run() error {
	ln, err := net.Listen("tcp", s.cfg.Listen)
	if err != nil {
		return err
	}
	log.Printf("webbackend: listening on %s", s.cfg.Listen)
	s.startWatcher()
	s.startNodeStream()
	return http.Serve(ln, s.Handler())
}

// ---- sessions -------------------------------------------------------------

func (s *Server) newSession(w http.ResponseWriter, user *WebUser) error {
	tok := randomToken()
	sess := Session{Token: tok, UserID: user.ID, ExpiresAt: time.Now().Add(s.cfg.SessionDuration)}
	if err := s.db.Create(&sess).Error; err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "webui_session",
		Value:    tok,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		Expires:  sess.ExpiresAt,
	})
	return nil
}

func (s *Server) clearSession(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("webui_session"); err == nil {
		s.db.Where("token = ?", c.Value).Delete(&Session{})
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "webui_session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		MaxAge:   -1,
	})
}

func (s *Server) sessionUser(r *http.Request) (*WebUser, error) {
	c, err := r.Cookie("webui_session")
	if err != nil {
		return nil, errors.New("no session")
	}
	var sess Session
	if err := s.db.Where("token = ?", c.Value).First(&sess).Error; err != nil {
		return nil, errors.New("invalid session")
	}
	if sess.ExpiresAt.Before(time.Now()) {
		s.db.Delete(&sess)
		return nil, errors.New("expired session")
	}
	var u WebUser
	if err := s.db.First(&u, sess.UserID).Error; err != nil {
		return nil, errors.New("user not found")
	}
	return &u, nil
}

// withSession loads the session user into the request context and calls next.
func (s *Server) withSession(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := s.sessionUser(r)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "unauthorized"})
			return
		}
		ctx := contextWithUser(r.Context(), u)
		next(w, r.WithContext(ctx))
	}
}

// requireAdmin restricts access to admin web users.
func (s *Server) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := userFromContext(r.Context())
		if u == nil || u.Role != "admin" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "admin only"})
			return
		}
		next(w, r)
	}
}

// middlewareOf adapts a HandlerFunc-style middleware to chi's Use signature.
func middlewareOf(m func(http.HandlerFunc) http.HandlerFunc) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return m(func(w http.ResponseWriter, r *http.Request) { next.ServeHTTP(w, r) })
	}
}

// ---- auth handlers --------------------------------------------------------

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username       string `json:"username"`
		Password       string `json:"password"`
		TurnstileToken string `json:"turnstile_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "bad request")
		return
	}

	ip := clientIP(r)

	// 1) Global per-IP rate limit on the login endpoint itself, applied before
	//    any credential work so a single source can't hammer the endpoint.
	if !s.loginIPRateLimit(ip) {
		s.recordEvent(r, "login_blocked", body.Username, "ip rate limit")
		writeError(w, http.StatusTooManyRequests, "请求过于频繁，请稍后再试")
		return
	}

	key := ip + "|" + body.Username
	if locked, until := s.guardCheck(key); locked {
		s.recordEvent(r, "login_blocked", body.Username, "locked out")
		writeError(w, http.StatusTooManyRequests, "尝试次数过多，请 "+strconv.Itoa(int(until.Minutes()))+" 分钟后再试")
		return
	}

	// 2) Human verification (Cloudflare Turnstile). Fail-closed: when enabled
	//    we MUST verify; a missing or invalid token rejects the login.
	if s.turnstileEnabled {
		if err := s.turnstile.Verify(r.Context(), body.TurnstileToken, ip); err != nil {
			s.guardFail(key)
			s.recordEvent(r, "login_fail", body.Username, "turnstile: "+err.Error())
			writeError(w, http.StatusBadRequest, "人机验证未通过，请重试")
			return
		}
	}

	var u WebUser
	if err := s.db.Where("username = ?", body.Username).First(&u).Error; err != nil {
		s.guardFail(key)
		s.recordEvent(r, "login_fail", body.Username, "unknown user")
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	// First-run admin that has not set a password yet: the login page should be
	// in "setup" mode, not the password form. Reject here so we never run
	// bcrypt against an empty hash (which would otherwise fail as a wrong
	// password and feed the brute-force guard).
	if u.MustChangePassword && u.PasswordHash == "" {
		s.recordEvent(r, "login_fail", body.Username, "setup required")
		writeError(w, http.StatusUnauthorized, "setup required")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(body.Password)); err != nil {
		s.guardFail(key)
		s.recordEvent(r, "login_fail", body.Username, "wrong password")
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	s.guardSuccess(key)
	if err := s.newSession(w, &u); err != nil {
		writeError(w, http.StatusInternalServerError, "session error")
		return
	}
	s.recordEventAs(u.Username, ip, "login", body.Username, "")
	writeJSON(w, http.StatusOK, map[string]any{"username": u.Username, "role": u.Role, "headscale_user": u.HeadscaleUser})
}

// handleAuthConfig returns the public login-page configuration: whether
// Turnstile is enabled and, if so, the (public) site key and action the widget
// must render with. Unauthenticated — it's fetched by the login page.
func (s *Server) handleAuthConfig(w http.ResponseWriter, r *http.Request) {
	resp := map[string]any{
		"turnstile_enabled":  s.turnstileEnabled,
		"turnstile_site_key": s.turnstileSiteKey,
		"turnstile_action":   s.turnstileAction,
		"setup_required":     false,
	}
	// First-run: a default admin exists that has never set a password.
	var pending WebUser
	if err := s.db.Where("must_change_password = ? AND (password_hash = ? OR password_hash IS NULL)", true, "").First(&pending).Error; err == nil {
		resp["setup_required"] = true
		resp["setup_username"] = pending.Username
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleSetup sets the password for the first-run default admin account, which
// is created with no password (MustChangePassword). It is the "out of box" path:
// a fresh deployment's first visit lands in setup mode instead of the normal
// login. Only an account that is explicitly awaiting setup (MustChangePassword
// && empty password) may use this endpoint — a normal account must go through
// login + change-password, so this can't be used to hijack an existing account.
func (s *Server) handleSetup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username       string `json:"username"`
		NewPassword    string `json:"new_password"`
		TurnstileToken string `json:"turnstile_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "bad request")
		return
	}

	ip := clientIP(r)
	if !s.loginIPRateLimit(ip) {
		writeError(w, http.StatusTooManyRequests, "请求过于频繁，请稍后再试")
		return
	}
	if s.turnstileEnabled {
		if err := s.turnstile.Verify(r.Context(), body.TurnstileToken, ip); err != nil {
			writeError(w, http.StatusBadRequest, "人机验证未通过，请重试")
			return
		}
	}
	if len(body.NewPassword) < 6 {
		writeError(w, http.StatusBadRequest, "密码至少 6 位")
		return
	}

	var u WebUser
	if err := s.db.Where("username = ?", body.Username).First(&u).Error; err != nil {
		writeError(w, http.StatusUnauthorized, "invalid account")
		return
	}
	if !u.MustChangePassword || u.PasswordHash != "" {
		// Not a first-run setup account: refuse. Avoids turning this into a
		// password-reset bypass for ordinary accounts.
		writeError(w, http.StatusForbidden, "this account cannot be set up this way")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash error")
		return
	}
	if err := s.db.Model(&u).Updates(map[string]any{
		"password_hash":        string(hash),
		"must_change_password": false,
	}).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "update error")
		return
	}
	if err := s.newSession(w, &u); err != nil {
		writeError(w, http.StatusInternalServerError, "session error")
		return
	}
	s.recordEventAs(u.Username, ip, "setup_admin_password", body.Username, "")
	writeJSON(w, http.StatusOK, map[string]any{"username": u.Username, "role": u.Role, "headscale_user": u.HeadscaleUser})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.clearSession(w, r)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"username":       u.Username,
		"role":           u.Role,
		"headscale_user": u.HeadscaleUser,
	})
}

// ---- admin web user handlers ---------------------------------------------

func (s *Server) handleListWebUsers(w http.ResponseWriter, r *http.Request) {
	var users []WebUser
	if err := s.db.Order("id asc").Find(&users).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleCreateWebUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username      string `json:"username"`
		Password      string `json:"password"`
		Email         string `json:"email"`
		HeadscaleUser string `json:"headscale_user"`
		Role          string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "bad request")
		return
	}
	if body.Username == "" || body.Password == "" {
		writeError(w, http.StatusBadRequest, "username and password required")
		return
	}
	if body.Role != "admin" && body.Role != "user" {
		body.Role = "user"
	}
	if body.Role == "user" && body.HeadscaleUser == "" {
		writeError(w, http.StatusBadRequest, "headscale_user required for role=user")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash error")
		return
	}
	u := WebUser{
		Username:      body.Username,
		PasswordHash:  string(hash),
		Email:         body.Email,
		HeadscaleUser: body.HeadscaleUser,
		Role:          body.Role,
	}
	if err := s.db.Create(&u).Error; err != nil {
		writeError(w, http.StatusConflict, "username exists or db error")
		return
	}
	s.recordEvent(r, "create_user", body.Username, "role="+body.Role)
	writeJSON(w, http.StatusCreated, u)
}

func (s *Server) handleDeleteWebUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// Drop any active sessions for the deleted user.
	if uid, err := strconv.Atoi(id); err == nil {
		s.db.Where("user_id = ?", uint(uid)).Delete(&Session{})
	}
	if err := s.db.Delete(&WebUser{}, id).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	s.recordEvent(r, "delete_user", id, "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleChangePassword lets the logged-in web user change their own password.
func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	var body struct {
		Old string `json:"old"`
		New string `json:"new"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "bad request")
		return
	}
	if len(body.New) < 6 {
		writeError(w, http.StatusBadRequest, "新密码至少 6 位")
		return
	}
	var dbu WebUser
	if err := s.db.First(&dbu, u.ID).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "user error")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(dbu.PasswordHash), []byte(body.Old)); err != nil {
		writeError(w, http.StatusUnauthorized, "原密码错误")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.New), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash error")
		return
	}
	if err := s.db.Model(&dbu).Update("password_hash", string(hash)).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "update error")
		return
	}
	// Invalidate every session for this user (including the current one) so a
	// stolen/old session can no longer be used after the password changes.
	s.db.Where("user_id = ?", u.ID).Delete(&Session{})
	s.clearSession(w, r)
	s.recordEvent(r, "change_password", u.Username, "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleResetPassword lets an admin reset another web user's password.
func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		New string `json:"new"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.New) < 6 {
		writeError(w, http.StatusBadRequest, "新密码至少 6 位")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.New), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash error")
		return
	}
	if err := s.db.Model(&WebUser{}).Where("id = ?", id).Update("password_hash", string(hash)).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "update error")
		return
	}
	// The target user's sessions are invalidated so a reset password takes
	// immediate effect (the user must log in again).
	if uid, cerr := strconv.Atoi(id); cerr == nil {
		s.db.Where("user_id = ?", uint(uid)).Delete(&Session{})
	}
	s.recordEvent(r, "reset_password", id, "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleListInvites returns the full invitation ledger (admin only).
func (s *Server) handleListInvites(w http.ResponseWriter, r *http.Request) {
	var invites []Invite
	if err := s.db.Order("id desc").Find(&invites).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, invites)
}

// handleDeleteInvite removes a single ledger row (housekeeping of stale/test
// invites). It does not touch the underlying Headscale pre-auth key.
func (s *Server) handleDeleteInvite(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := strconv.Atoi(id); err != nil {
		writeError(w, http.StatusBadRequest, "bad id")
		return
	}
	if err := s.db.Delete(&Invite{}, id).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	s.recordEvent(r, "delete_invite", id, "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handlePurgeExpiredInvites removes all ledger rows whose invitation has
// expired (a convenience so the ledger does not accumulate stale entries).
func (s *Server) handlePurgeExpiredInvites(w http.ResponseWriter, r *http.Request) {
	res := s.db.Where("expires_at < ?", time.Now()).Delete(&Invite{})
	if res.Error != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	s.recordEvent(r, "purge_invites", "", strconv.FormatInt(res.RowsAffected, 10)+" rows")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "removed": res.RowsAffected})
}

// ---- self-service ---------------------------------------------------------

// handleSelf returns the web user's Headscale user and that user's nodes.
func (s *Server) handleSelf(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	resp := map[string]any{
		"username":       u.Username,
		"role":           u.Role,
		"headscale_user": u.HeadscaleUser,
	}
	if u.Role == "user" && u.HeadscaleUser != "" {
		nodes, err := s.headscaleNodes(u.HeadscaleUser)
		if err != nil {
			resp["nodes_error"] = err.Error()
		} else {
			resp["nodes"] = nodes
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleCreateSelfKey generates a Pre-Auth Key for the web user's Headscale
// user and returns it together with ready-to-use join commands / config.
// It also writes an Invite ledger record (applicant / device / org) so admins
// can later trace who each handed-out key was given to.
func (s *Server) handleCreateSelfKey(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	var body struct {
		Reusable        bool   `json:"reusable"`
		Ephemeral       bool   `json:"ephemeral"`
		ExpirationHours int    `json:"expiration_hours"`
		HeadscaleUser   string `json:"headscale_user"` // admin picks a target user
		Applicant       string `json:"applicant"`      // 申请人
		DeviceDesc      string `json:"device_desc"`    // 设备描述
		Org             string `json:"org"`            // 单位
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.ExpirationHours <= 0 || body.ExpirationHours > 24*30 {
		body.ExpirationHours = 24
	}

	// Determine the target Headscale user for the new key.
	target := u.HeadscaleUser
	if u.Role == "admin" {
		// Admins are not bound to a single Headscale user, so they must pick one.
		if body.HeadscaleUser == "" {
			writeError(w, http.StatusBadRequest, "管理员需先选择目标 Headscale 用户")
			return
		}
		target = body.HeadscaleUser
	} else if u.Role != "user" || u.HeadscaleUser == "" {
		writeError(w, http.StatusForbidden, "only mapped users can self-provision")
		return
	}

	key, err := s.createPreAuthKey(target, body.Reusable, body.Ephemeral, body.ExpirationHours)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create key failed: "+err.Error())
		return
	}

	hostname := sanitizeHostname(body.DeviceDesc)
	// Record the invitation in our own ledger for traceability.
	if err := s.db.Create(&Invite{
		Applicant:    body.Applicant,
		DeviceDesc:   body.DeviceDesc,
		Org:          body.Org,
		TargetUser:   target,
		KeyPrefix:    shorten(key, 16),
		Hostname:     hostname,
		CreatedBy:    u.Username,
		ExpiresAt:    time.Now().Add(time.Duration(body.ExpirationHours) * time.Hour),
		Status:       "unused",
	}).Error; err != nil {
		// Non-fatal: the key was created; ledger is best-effort.
		log.Printf("webbackend: failed to record invite ledger: %v", err)
	}

	// Audit + alert on key creation.
	s.recordEvent(r, "create_key", target, "device="+body.DeviceDesc+" expiry="+strconv.Itoa(body.ExpirationHours)+"h")
	keyHTML := "<p>用户 <b>" + u.Username + "</b> 生成了一枚接入密钥。</p>" +
		"<ul><li>目标 Headscale 用户: " + target + "</li>" +
		"<li>设备: " + body.DeviceDesc + "</li>" +
		"<li>有效期: " + strconv.Itoa(body.ExpirationHours) + " 小时</li>" +
		"<li>申请人: " + body.Applicant + "</li>" +
		"<li>组织: " + body.Org + "</li></ul>"
	s.notifyAdmins("新接入密钥已生成: "+u.Username, keyHTML)

	serverURL := s.cfg.ServerURL
	if serverURL == "" {
		serverURL = s.cfg.HeadscaleURL
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"key":              key,
		"server_url":       serverURL,
		"headscale_user":   u.HeadscaleUser,
		"commands":         joinCommands(serverURL, key, hostname),
		"expiration_hours": body.ExpirationHours,
	})
}

// ---- Headscale proxy ------------------------------------------------------

// handleProxy forwards to Headscale's /api/v1, injecting the server-side key and
// enforcing role-based scoping so a non-admin can only touch their own user.
// proxyAllowed restricts the generic Headscale proxy to the exact endpoints the
// web UI needs. Anything else (api keys, tailnet settings, DERP config, …) is
// rejected with 403 so a compromised session cannot drive the full Headscale
// API through the web backend. Role scoping in preprocessProxy still applies on
// top of this for non-admin users.
func proxyAllowed(method, rest string) bool {
	switch method {
	case http.MethodGet:
		return rest == "/node" || strings.HasPrefix(rest, "/node/") ||
			rest == "/user" || strings.HasPrefix(rest, "/user/") ||
			rest == "/preauthkey" || rest == "/policy"
	case http.MethodPost:
		return rest == "/preauthkey" || rest == "/preauthkey/expire" || rest == "/policy/check" ||
			rest == "/user" || strings.HasPrefix(rest, "/node/")
	case http.MethodPut:
		return rest == "/policy"
	case http.MethodDelete:
		return rest == "/preauthkey" || strings.HasPrefix(rest, "/user/") ||
			strings.HasPrefix(rest, "/node/")
	}
	return false
}

func (s *Server) handleProxy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := userFromContext(r.Context())
		rest := strings.TrimPrefix(r.URL.Path, "/ui/api/proxy")
		if !strings.HasPrefix(rest, "/") {
			rest = "/" + rest
		}

		if !proxyAllowed(r.Method, rest) {
			writeError(w, http.StatusForbidden, "forbidden: proxy endpoint not allowed")
			return
		}

		target := strings.TrimRight(s.cfg.HeadscaleURL, "/") + "/api/v1" + rest

		if err := s.preprocessProxy(r, rest, u.HeadscaleUser, u.Role == "admin"); err != nil {
			writeError(w, http.StatusForbidden, err.Error())
			return
		}

		// Record mutating operations for the audit log (reads are skipped).
		s.recordProxyEvent(r, rest)

		s.forward(w, r, target)
	}
}

// preprocessProxy rewrites/blocks requests and resolves the Pre-Auth Key user
// (Headscale expects a numeric ID, not a name). For non-admins it also confines
// every call to their own Headscale user.
func (s *Server) preprocessProxy(r *http.Request, rest, hsUser string, isAdmin bool) error {
	// Pre-Auth Key creation needs the numeric user ID (Headscale rejects names).
	if r.Method == http.MethodPost && rest == "/preauthkey" {
		if err := s.resolvePreAuthKeyUser(r, hsUser, isAdmin); err != nil {
			return err
		}
	}

	if isAdmin {
		return nil
	}

	// Scoping for non-admin users.
	switch {
	case r.Method == http.MethodGet && rest == "/user":
		return errors.New("forbidden: user listing requires admin")
	case r.Method == http.MethodPost && rest == "/user":
		return errors.New("forbidden: user creation requires admin")
	case r.Method == http.MethodDelete && rest == "/user":
		return errors.New("forbidden: user deletion requires admin")
	case r.Method == http.MethodGet && rest == "/node":
		r.URL.RawQuery = appendUserFilter(r.URL.RawQuery, hsUser)
	case r.Method == http.MethodGet && rest == "/preauthkey":
		r.URL.RawQuery = appendUserFilter(r.URL.RawQuery, hsUser)
	case r.Method == http.MethodPost && strings.HasPrefix(rest, "/node/"):
		return errors.New("forbidden: node changes require admin")
	case r.Method == http.MethodDelete && strings.HasPrefix(rest, "/node/"):
		return errors.New("forbidden: node deletion requires admin")
	case rest == "/policy":
		return errors.New("forbidden: policy requires admin")
	}
	return nil
}

// resolvePreAuthKeyUser ensures the "user" field is a numeric ID. For non-admins
// it forces the mapped Headscale user; for both roles it turns a name into an ID.
func (s *Server) resolvePreAuthKeyUser(r *http.Request, hsUser string, isAdmin bool) error {
	var body map[string]any
	if raw, err := io.ReadAll(r.Body); err == nil && len(raw) > 0 {
		_ = json.Unmarshal(raw, &body)
	}
	if body == nil {
		body = map[string]any{}
	}
	if !isAdmin {
		body["user"] = hsUser
		// users should not create ephemeral keys by default
		if _, ok := body["ephemeral"]; !ok {
			body["ephemeral"] = false
		}
	}
	if v, ok := body["user"].(string); ok && v != "" {
		if _, err := strconv.ParseUint(v, 10, 64); err != nil {
			id, rerr := s.resolveUserID(v)
			if rerr != nil {
				return rerr
			}
			body["user"] = id
		}
	}
	nb, _ := json.Marshal(body)
	r.Body = io.NopCloser(bytes.NewReader(nb))
	r.ContentLength = int64(len(nb))
	return nil
}

// resolveUserID looks up a Headscale user's numeric ID by name.
func (s *Server) resolveUserID(name string) (string, error) {
	req, err := http.NewRequest(http.MethodGet,
		strings.TrimRight(s.cfg.HeadscaleURL, "/")+"/api/v1/user", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.HeadscaleAPIKey)
	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var parsed struct {
		Users []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"users"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", err
	}
	for _, u := range parsed.Users {
		if u.Name == name {
			return u.ID, nil
		}
	}
	return "", fmt.Errorf("headscale user not found: %s", name)
}

func appendUserFilter(q, user string) string {
	if user == "" {
		return q
	}
	if q == "" {
		return "user=" + user
	}
	return q + "&user=" + user
}

func (s *Server) forward(w http.ResponseWriter, r *http.Request, target string) {
	var body io.Reader
	if r.Body != nil {
		body = r.Body
	}
	req, err := http.NewRequestWithContext(r.Context(), r.Method, target, body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "proxy error")
		return
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.HeadscaleAPIKey)
	req.Header.Set("Content-Type", "application/json")
	// Preserve query string.
	req.URL.RawQuery = r.URL.RawQuery

	resp, err := s.client.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "headscale unreachable: "+err.Error())
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	// Headscale returns HTTP 500 with "acl policy not found" when no ACL policy
	// is configured (policy.mode=database). That is semantically "empty policy",
	// not a server fault, so normalize it to a clean 200 with an empty policy.
	// This keeps the web UI's "no policy yet" template working without a console
	// error.
	if resp.StatusCode == http.StatusInternalServerError &&
		r.Method == http.MethodGet &&
		strings.HasSuffix(r.URL.Path, "/policy") &&
		strings.Contains(string(respBody), "acl policy not found") {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"policy":""}`))
		return
	}

	copyHeader(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// ---- audit log, email, security helpers ----------------------------------

// clientIP returns the best-effort client IP. The RealIP middleware sets
// RemoteAddr to the real client IP; we also honour X-Forwarded-For (Caddy sits
// in front and passes the original address through).
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if idx := strings.IndexByte(xff, ','); idx >= 0 {
			return strings.TrimSpace(xff[:idx])
		}
		return strings.TrimSpace(xff)
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// recordEvent writes an audit event. The actor is taken from the active session
// when available; an absent/invalid session (or a nil request, used by the
// background watcher) yields "system" / "anonymous".
func (s *Server) recordEvent(r *http.Request, eventType, target, detail string) {
	actor := "system"
	ip := ""
	if r != nil {
		ip = clientIP(r)
		if u, err := s.sessionUser(r); err == nil {
			actor = u.Username
		} else {
			actor = "anonymous"
		}
	}
	s.recordEventAs(actor, ip, eventType, target, detail)
}

// recordEventAs writes an audit event with an explicitly known actor. Used for
// events where the session is not yet available in the request (e.g. a
// successful login, where the cookie is only set on the response) so the actor
// is recorded accurately instead of "anonymous".
func (s *Server) recordEventAs(actor, ip, eventType, target, detail string) {
	if actor == "" {
		actor = "system"
	}
	ev := Event{Time: time.Now(), Actor: actor, Type: eventType, Target: target, Detail: detail, IP: ip}
	if err := s.db.Create(&ev).Error; err != nil {
		log.Printf("webbackend: recordEvent failed: %v", err)
		return
	}
	// Push to any subscribed console so it can show an in-app notification.
	s.broadcastEvent(ev)
}

// broadcastEvent fans a new audit event out to all subscribed SSE clients.
// Sends are non-blocking: a slow/stalled client simply misses a push (it still
// has the full list to resync from).
func (s *Server) broadcastEvent(ev Event) {
	b, err := json.Marshal(ev)
	if err != nil {
		return
	}
	s.sseEvMu.Lock()
	clients := make([]chan []byte, 0, len(s.sseEvClients))
	for ch := range s.sseEvClients {
		clients = append(clients, ch)
	}
	s.sseEvMu.Unlock()
	for _, ch := range clients {
		select {
		case ch <- b:
		default:
		}
	}
}

// sendEmail delivers a single email. When SMTP is configured it is used;
// otherwise the Resend REST API is used as a fallback. Best-effort: failures
// are logged but never returned to the caller so they cannot break the action.
func (s *Server) sendEmail(to, subject, htmlBody string) {
	m := s.effectiveMail()
	if !m.Enabled {
		log.Printf("webbackend: email skipped (mail disabled): %s -> %s", to, subject)
		return
	}
	if m.SMTPHost != "" {
		s.sendEmailSMTP(to, subject, htmlBody, m)
		return
	}
	if m.ResendAPIKey != "" {
		s.sendEmailResend(to, subject, htmlBody, m)
		return
	}
	log.Printf("webbackend: email skipped (no SMTP_HOST and no RESEND_API_KEY): %s -> %s", to, subject)
}

// sendEmailResend delivers via the Resend REST API (fallback path).
func (s *Server) sendEmailResend(to, subject, htmlBody string, m *MailSettings) error {
	key := m.ResendAPIKey
	if key == "" {
		return fmt.Errorf("RESEND_API_KEY not set")
	}
	from := m.ResendFrom
	if from == "" {
		from = "Headscale <no-reply@sclink.dev>"
	}
	payload, _ := json.Marshal(map[string]any{
		"from":    from,
		"to":      []string{to},
		"subject": subject,
		"html":    htmlBody,
	})
	req, err := http.NewRequest(http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("email build error: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("email send error: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("email send failed (%d): %s", resp.StatusCode, string(b))
	}
	log.Printf("webbackend: email sent (resend api) to %s: %s", to, subject)
	return nil
}

// sendEmailSMTP delivers via an SMTP server (preferred path). It supports both
// STARTTLS (port 587, default) and implicit TLS (port 465). For Resend the
// username is the literal "resend" and the password is the API key.
func (s *Server) sendEmailSMTP(to, subject, htmlBody string, m *MailSettings) error {
	from := m.SMTPFrom
	if from == "" {
		from = m.ResendFrom
	}
	if from == "" {
		from = "no-reply@sclink.dev"
	}
	host := m.SMTPHost
	port := m.SMTPPort
	if port == "" {
		port = "587"
	}
	addr := net.JoinHostPort(host, port)

	var c *smtp.Client
	var err error
	if m.SMTPTLS == "ssl" {
		tlsConn, derr := tls.Dial("tcp", addr, &tls.Config{ServerName: host})
		if derr != nil {
			return fmt.Errorf("smtp ssl dial error: %w", derr)
		}
		c, err = smtp.NewClient(tlsConn, host)
	} else {
		c, err = smtp.Dial(addr)
		if err != nil {
			return fmt.Errorf("smtp dial error: %w", err)
		}
		if ok, _ := c.Extension("STARTTLS"); ok {
			if terr := c.StartTLS(&tls.Config{ServerName: host}); terr != nil {
				c.Close()
				return fmt.Errorf("smtp starttls error: %w", terr)
			}
		}
	}
	defer c.Close()

	if m.SMTPUsername != "" {
		pass := m.SMTPPassword
		if pass == "" {
			pass = m.ResendAPIKey // reuse Resend key if SMTP_PASSWORD unset
		}
		auth := smtp.PlainAuth("", m.SMTPUsername, pass, host)
		if aerr := c.Auth(auth); aerr != nil {
			return fmt.Errorf("smtp auth error: %w", aerr)
		}
	}
	if err := c.Mail(from); err != nil {
		return fmt.Errorf("smtp mail-from error: %w", err)
	}
	if err := c.Rcpt(to); err != nil {
		return fmt.Errorf("smtp rcpt error: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp data error: %w", err)
	}
	msg := buildMailMessage(from, to, subject, htmlBody)
	if _, err := w.Write([]byte(msg)); err != nil {
		return fmt.Errorf("smtp write error: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp close error: %w", err)
	}
	log.Printf("webbackend: smtp email sent to %s: %s", to, subject)
	return nil
}

// buildMailMessage assembles a minimal RFC 5322 message with an HTML body and
// an RFC 2047 encoded subject so non-ASCII (e.g. Chinese) subjects render.
func buildMailMessage(from, to, subject, htmlBody string) string {
	var b strings.Builder
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + mime.QEncoding.Encode("UTF-8", subject) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/html; charset=\"UTF-8\"\r\n")
	b.WriteString("Date: " + time.Now().Format(time.RFC1123Z) + "\r\n")
	b.WriteString("\r\n")
	b.WriteString(htmlBody)
	b.WriteString("\r\n")
	return b.String()
}

// alertRecipients returns the addresses that should receive administrative
// alerts: any admin web user with an email set, falling back to
// RESEND_NOTIFY_TO when no admin has an email configured.
func (s *Server) alertRecipients(m *MailSettings) []string {
	seen := map[string]bool{}
	var out []string
	var admins []WebUser
	if err := s.db.Where("role = ?", "admin").Find(&admins).Error; err == nil {
		for _, a := range admins {
			if a.Email != "" && !seen[a.Email] {
				seen[a.Email] = true
				out = append(out, a.Email)
			}
		}
	}
	for _, e := range strings.Split(m.ResendNotifyTo, ",") {
		e = strings.TrimSpace(e)
		if e != "" && !seen[e] {
			seen[e] = true
			out = append(out, e)
		}
	}
	return out
}

// notifyAdmins sends an alert email to every configured recipient.
func (s *Server) notifyAdmins(subject, htmlBody string) {
	m := s.effectiveMail()
	if !m.Enabled {
		return
	}
	for _, to := range s.alertRecipients(m) {
		s.sendEmail(to, subject, htmlBody)
	}
}

// ---- login throttling -----------------------------------------------------

const (
	loginMaxFails    = 5
	loginLockMinutes = 15

	// Global per-IP login rate limit: at most loginIPMax POSTs to /login from
	// a single source IP within loginIPWindow. Generous for humans (one per
	// second) but chokes high-rate credential stuffing / password spraying.
	loginIPMax    = 60
	loginIPWindow = time.Minute
)

// guardCheck reports whether the key is currently locked out and for how long.
func (s *Server) guardCheck(key string) (bool, time.Duration) {
	s.guardMu.Lock()
	defer s.guardMu.Unlock()
	if until, ok := s.guardLocked[key]; ok && until.After(time.Now()) {
		return true, time.Until(until)
	}
	return false, 0
}

// guardFail records a failed attempt and locks the key past the threshold.
func (s *Server) guardFail(key string) {
	s.guardMu.Lock()
	defer s.guardMu.Unlock()
	s.guardFails[key]++
	if s.guardFails[key] >= loginMaxFails {
		s.guardLocked[key] = time.Now().Add(time.Duration(loginLockMinutes) * time.Minute)
		s.guardFails[key] = 0
	}
}

// guardSuccess resets the failure counter for a key.
func (s *Server) guardSuccess(key string) {
	s.guardMu.Lock()
	defer s.guardMu.Unlock()
	delete(s.guardFails, key)
	delete(s.guardLocked, key)
}

// loginIPRateLimit enforces a global sliding-window rate limit per source IP on
// the login endpoint. It returns false when the IP has exceeded loginIPMax
// attempts within loginIPWindow; the caller should reject the request. Old
// timestamps are pruned on each call so the map stays bounded.
func (s *Server) loginIPRateLimit(ip string) bool {
	s.loginIPMu.Lock()
	defer s.loginIPMu.Unlock()

	now := time.Now()
	times := s.loginIPTimes[ip]
	kept := times[:0]
	for _, t := range times {
		if now.Sub(t) < loginIPWindow {
			kept = append(kept, t)
		}
	}
	if len(kept) >= loginIPMax {
		// Re-store the pruned window (drop the oldest entries) but do not add
		// this attempt; the caller rejects.
		s.loginIPTimes[ip] = kept
		return false
	}
	s.loginIPTimes[ip] = append(kept, now)
	return true
}

// ---- audit log endpoints --------------------------------------------------

func (s *Server) handleListEvents(w http.ResponseWriter, r *http.Request) {
	var events []Event
	if err := s.db.Order("id desc").Limit(300).Find(&events).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, events)
}

func (s *Server) handleMyEvents(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	var events []Event
	if err := s.db.Where("actor = ?", u.Username).Order("id desc").Limit(100).Find(&events).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, events)
}

// handleEventStream is the SSE endpoint backing the in-app notification bell.
// Admins receive every new audit event; non-admins receive only their own.
func (s *Server) handleEventStream(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	isAdmin := u.Role == "admin"
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	ch := make(chan []byte, 8)
	s.sseEvMu.Lock()
	s.sseEvClients[ch] = true
	s.sseEvMu.Unlock()
	defer func() {
		s.sseEvMu.Lock()
		delete(s.sseEvClients, ch)
		s.sseEvMu.Unlock()
	}()

	fmt.Fprint(w, "event: hello\ndata: ok\n\n")
	flusher.Flush()

	keep := time.NewTicker(25 * time.Second)
	defer keep.Stop()
	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case data := <-ch:
			if !isAdmin {
				var ev Event
				if json.Unmarshal(data, &ev) == nil && ev.Actor != u.Username {
					continue
				}
			}
			fmt.Fprintf(w, "event: message\ndata: %s\n\n", data)
			flusher.Flush()
		case <-keep.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// handleGetMailSettings returns the current mail settings. Secrets (the SMTP
// password and Resend API key) are never returned; only presence flags are.
func (s *Server) handleGetMailSettings(w http.ResponseWriter, r *http.Request) {
	m := s.effectiveMail()
	s.mailMu.RLock()
	out := *m
	s.mailMu.RUnlock()
	out.SMTPPassword = ""
	out.ResendAPIKey = ""
	writeJSON(w, http.StatusOK, map[string]any{
		"mail":              out,
		"has_smtp_password": m.SMTPPassword != "",
		"has_resend_key":    m.ResendAPIKey != "",
	})
}

// handlePutMailSettings updates and persists the mail settings. Empty secret
// fields are left unchanged, so an admin can update other fields without
// re-typing the password.
func (s *Server) handlePutMailSettings(w http.ResponseWriter, r *http.Request) {
	var in MailSettings
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	s.mailMu.RLock()
	cur := *s.mail
	s.mailMu.RUnlock()
	if in.SMTPPassword == "" {
		in.SMTPPassword = cur.SMTPPassword
	}
	if in.ResendAPIKey == "" {
		in.ResendAPIKey = cur.ResendAPIKey
	}
	if in.SMTPTLS == "" {
		in.SMTPTLS = "starttls"
	}
	if in.SMTPPort == "" {
		in.SMTPPort = "587"
	}
	s.mailMu.Lock()
	s.mail = &in
	s.mailMu.Unlock()
	if err := s.saveMailSettings(&in); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := in
	out.SMTPPassword = ""
	out.ResendAPIKey = ""
	writeJSON(w, http.StatusOK, map[string]any{
		"mail":              out,
		"has_smtp_password": in.SMTPPassword != "",
		"has_resend_key":    in.ResendAPIKey != "",
	})
}

// handleTestMail sends a real test email to the provided address and reports
// the result, so admins can verify the SMTP/Resend configuration works.
func (s *Server) handleTestMail(w http.ResponseWriter, r *http.Request) {
	var body struct {
		To string `json:"to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.To == "" {
		writeError(w, http.StatusBadRequest, "missing 'to'")
		return
	}
	m := s.effectiveMail()
	if !m.Enabled || (m.SMTPHost == "" && m.ResendAPIKey == "") {
		writeError(w, http.StatusBadRequest, "mail not configured")
		return
	}
	var err error
	if m.SMTPHost != "" {
		err = s.sendEmailSMTP(body.To, "Headscale 邮件配置测试",
			"<p>这是一封来自 Headscale 控制台的测试邮件。若你收到了它，说明 SMTP 邮件配置正确。</p>", m)
	} else {
		err = s.sendEmailResend(body.To, "Headscale 邮件配置测试",
			"<p>这是一封来自 Headscale 控制台的测试邮件。若你收到了它，说明 Resend 邮件配置正确。</p>", m)
	}
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// recordProxyEvent records audit events for mutating proxy calls (node tag /
// rename / expire / delete, policy apply). Read-only calls are not recorded.
func (s *Server) recordProxyEvent(r *http.Request, rest string) {
	parts := strings.Split(strings.Trim(rest, "/"), "/")
	switch {
	case r.Method == http.MethodPut && rest == "/policy":
		s.recordEvent(r, "apply_policy", "policy", "")
	case r.Method == http.MethodPost && len(parts) >= 3 && parts[0] == "node":
		id := parts[1]
		switch parts[2] {
		case "tags":
			s.recordEvent(r, "node_tag", id, "")
		case "rename":
			s.recordEvent(r, "node_rename", id, "")
		case "expire":
			s.recordEvent(r, "node_expire", id, "")
		}
	case r.Method == http.MethodDelete && len(parts) >= 2 && parts[0] == "node":
		s.recordEvent(r, "node_delete", parts[1], "")
	}
}

// ---- background watcher (reliability alerts) -----------------------------

// startWatcher launches a background goroutine that periodically polls
// Headscale for node join / offline transitions and soon-to-expire keys. It
// always records these as audit events; email alerts are sent on top only when
// Resend is configured, so the reliability trail works even without email.
func (s *Server) startWatcher() {
	if m := s.effectiveMail(); !m.Enabled || (m.SMTPHost == "" && m.ResendAPIKey == "") {
		log.Printf("webbackend: email alerts disabled (mail not configured); watcher still records join/offline events")
	}
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		s.scanNodes(false)
		s.scanKeys(false)
		for range ticker.C {
			s.scanNodes(true)
			s.scanKeys(true)
		}
	}()
}

// startNodeStream launches a lightweight poller that watches the node set and
// each node's online state, and signals all subscribed SSE clients whenever it
// changes. This lets the console refresh itself when devices join, leave or
// flip online/offline — no external dependency, and it works even when email
// alerts are disabled. Poll interval is short (5s) so "online" updates feel
// near-real-time on a small self-hosted tailnet.
func (s *Server) startNodeStream() {
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		s.broadcastNodeChanges()
		for range ticker.C {
			s.broadcastNodeChanges()
		}
	}()
}

// broadcastNodeChanges polls Headscale, computes a cheap signature of the node
// set + online flags, and (only when it differs from the last broadcast)
// signals every SSE subscriber.
func (s *Server) broadcastNodeChanges() {
	sig := s.nodeSignature()
	if sig == "" {
		return // Headscale unreachable / parse error; keep last signature
	}
	s.sseMu.Lock()
	changed := sig != s.sseSig
	if changed {
		s.sseSig = sig
	}
	var clients []chan struct{}
	if changed {
		clients = make([]chan struct{}, 0, len(s.sseClients))
		for ch := range s.sseClients {
			clients = append(clients, ch)
		}
	}
	s.sseMu.Unlock()
	for _, ch := range clients {
		select {
		case ch <- struct{}{}:
		default: // client not draining; skip (it will resync on next change)
		}
	}
}

// nodeSignature returns a stable string describing every node's id + online
// state (sorted, so ordering never causes spurious "changes").
func (s *Server) nodeSignature() string {
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(s.cfg.HeadscaleURL, "/")+"/api/v1/node", nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.HeadscaleAPIKey)
	resp, err := s.client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var parsed struct {
		Nodes []struct {
			ID     string `json:"id"`
			Online bool   `json:"online"`
		} `json:"nodes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return ""
	}
	parts := make([]string, 0, len(parsed.Nodes))
	for _, n := range parsed.Nodes {
		parts = append(parts, n.ID+":"+strconv.FormatBool(n.Online))
	}
	sort.Strings(parts)
	return strings.Join(parts, ",")
}

// handleNodeStream is the SSE endpoint. It authenticates via the session cookie
// (EventSource sends same-origin cookies automatically), keeps the connection
// open, and emits a "nodes" event whenever the broadcaster detects a change. A
// periodic comment line keeps intermediaries from closing an idle stream.
func (s *Server) handleNodeStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	// Tell nginx (host TLS terminator) not to buffer this response.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	ch := make(chan struct{}, 1)
	s.sseMu.Lock()
	s.sseClients[ch] = true
	s.sseMu.Unlock()
	defer func() {
		s.sseMu.Lock()
		delete(s.sseClients, ch)
		s.sseMu.Unlock()
	}()

	// Initial hello so the client can tell the stream is live.
	fmt.Fprint(w, "event: hello\ndata: ok\n\n")
	flusher.Flush()

	keep := time.NewTicker(25 * time.Second)
	defer keep.Stop()
	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ch:
			fmt.Fprint(w, "event: nodes\ndata: changed\n\n")
			flusher.Flush()
		case <-keep.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// scanNodes detects new nodes and offline transitions. When alert is false it
// only primes the known-state cache (no emails / events).
func (s *Server) scanNodes(alert bool) {
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(s.cfg.HeadscaleURL, "/")+"/api/v1/node", nil)
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.HeadscaleAPIKey)
	resp, err := s.client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	var parsed struct {
		Nodes []struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Online bool   `json:"online"`
		} `json:"nodes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return
	}
	cur := map[string]bool{}
	for _, n := range parsed.Nodes {
		cur[n.ID] = true
		s.watchMu.Lock()
		wasOnline, seen := s.knownOnline[n.ID]
		s.knownOnline[n.ID] = n.Online
		isNew := !s.knownNodes[n.ID]
		s.knownNodes[n.ID] = true
		s.watchMu.Unlock()
		if !alert {
			continue
		}
		if isNew {
			s.recordEvent(nil, "node_join", n.Name, "new node online")
			s.notifyAdmins("新节点入网: "+n.Name, "<p>节点 <b>"+n.Name+"</b> 已加入组网。</p>")
		} else if seen && wasOnline && !n.Online {
			s.recordEvent(nil, "node_offline", n.Name, "node went offline")
			s.notifyAdmins("节点掉线: "+n.Name, "<p>节点 <b>"+n.Name+"</b> 已掉线。</p>")
		}
	}
	s.watchMu.Lock()
	for id := range s.knownNodes {
		if !cur[id] {
			delete(s.knownNodes, id)
			delete(s.knownOnline, id)
		}
	}
	s.watchMu.Unlock()
}

// scanKeys alerts (once) about pre-auth keys that will expire within 24h.
func (s *Server) scanKeys(alert bool) {
	ureq, err := http.NewRequest(http.MethodGet, strings.TrimRight(s.cfg.HeadscaleURL, "/")+"/api/v1/user", nil)
	if err != nil {
		return
	}
	ureq.Header.Set("Authorization", "Bearer "+s.cfg.HeadscaleAPIKey)
	uresp, err := s.client.Do(ureq)
	if err != nil {
		return
	}
	defer uresp.Body.Close()
	var uparsed struct {
		Users []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"users"`
	}
	if err := json.NewDecoder(uresp.Body).Decode(&uparsed); err != nil {
		return
	}
	threshold := time.Now().Add(24 * time.Hour)
	for _, u := range uparsed.Users {
		kreq, err := http.NewRequest(http.MethodGet, strings.TrimRight(s.cfg.HeadscaleURL, "/")+"/api/v1/preauthkey?user="+u.ID, nil)
		if err != nil {
			continue
		}
		kreq.Header.Set("Authorization", "Bearer "+s.cfg.HeadscaleAPIKey)
		kresp, err := s.client.Do(kreq)
		if err != nil {
			continue
		}
		b, _ := io.ReadAll(kresp.Body)
		kresp.Body.Close()
		var kparsed struct {
			PreAuthKeys []struct {
				ID         string    `json:"id"`
				Expiration time.Time `json:"expiration"`
			} `json:"preAuthKeys"`
		}
		if err := json.Unmarshal(b, &kparsed); err != nil {
			continue
		}
		for _, k := range kparsed.PreAuthKeys {
			if k.Expiration.IsZero() {
				continue
			}
			s.watchMu.Lock()
			notified := s.notifiedKeys[k.ID]
			s.watchMu.Unlock()
			if notified {
				continue
			}
			if k.Expiration.Before(threshold) && k.Expiration.After(time.Now()) {
				s.watchMu.Lock()
				s.notifiedKeys[k.ID] = true
				s.watchMu.Unlock()
				s.recordEvent(nil, "key_expiring", u.Name, "key "+k.ID+" expires "+k.Expiration.In(cstZone).Format("2006-01-02 15:04:05"))
				if alert {
					s.notifyAdmins("密钥即将过期: "+u.Name,
						"<p>用户 <b>"+u.Name+"</b> 的密钥将于 "+k.Expiration.In(cstZone).Format("2006-01-02 15:04:05")+" 过期。</p>")
				}
			}
		}
	}
}

// ---- Headscale helpers ----------------------------------------------------

// cstZone is UTC+8 (Asia/Shanghai); used only for human-facing timestamps
// (emails, event details). Storage and API fields stay UTC/RFC3339.
var cstZone = time.FixedZone("CST", 8*3600)

func (s *Server) headscaleNodes(hsUser string) (any, error) {
	req, err := http.NewRequest(http.MethodGet,
		strings.TrimRight(s.cfg.HeadscaleURL, "/")+"/api/v1/node?user="+hsUser, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.HeadscaleAPIKey)
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Server) createPreAuthKey(hsUser string, reusable, ephemeral bool, expHours int) (string, error) {
	// Headscale needs a numeric user ID, not the name.
	userID, err := s.resolveUserID(hsUser)
	if err != nil {
		return "", err
	}
	expiration := time.Now().Add(time.Duration(expHours) * time.Hour).Format(time.RFC3339)
	payload := map[string]any{
		"user":       userID,
		"reusable":   reusable,
		"ephemeral":  ephemeral,
		"expiration": expiration,
	}
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost,
		strings.TrimRight(s.cfg.HeadscaleURL, "/")+"/api/v1/preauthkey", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.HeadscaleAPIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("status %d: %s", resp.StatusCode, string(data))
	}
	var parsed struct {
		PreAuthKey struct {
			Key string `json:"key"`
		} `json:"preAuthKey"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return "", fmt.Errorf("decode: %w", err)
	}
	if parsed.PreAuthKey.Key == "" {
		return "", fmt.Errorf("no key in response: %s", string(data))
	}
	return parsed.PreAuthKey.Key, nil
}

// joinCommands builds platform-specific Tailscale join commands for the user.
// Each command bundles the client install step so a colleague can run a single
// line to download Tailscale AND auto-join this control server: no web login and
// no manual config import are needed — the authkey + login-server ARE the config.
// When hostname is non-empty it is injected as --hostname so the device shows up
// in the node list under a recognizable name (device ownership at a glance).
func joinCommands(serverURL, key, hostname string) map[string]string {
	up := fmt.Sprintf("tailscale up --login-server %s --authkey %s", serverURL, key)
	if hostname != "" {
		up += " --hostname " + hostname
	}
	linuxMac := "curl -fsSL https://tailscale.com/install.sh | sh && sudo " + up
	windows := "powershell -Command \"Invoke-WebRequest -Uri https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe -OutFile $env:TEMP\\tailscale-setup.exe; " +
		"Start-Process -Wait -FilePath $env:TEMP\\tailscale-setup.exe -ArgumentList '/S'; " +
		"& 'C:\\Program Files\\Tailscale\\tailscale.exe' " + up + "\""
	return map[string]string{
		"linux_macos": linuxMac,
		"windows":     windows,
		"note":        "一行命令：先自动安装 Tailscale 客户端，再用内置令牌自动加入本网络（无需登录后台、无需手动导入配置）。",
	}
}

// sanitizeHostname turns an arbitrary device description into a DNS-safe
// Tailscale hostname (lowercase [a-z0-9-]). Non-ASCII (e.g. Chinese) and spaces
// are dropped/converted to dashes; empty results mean "no hostname".
func sanitizeHostname(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else if r == ' ' || r == '_' || r == '.' || r == '-' {
			b.WriteRune('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	for strings.Contains(out, "--") {
		out = strings.ReplaceAll(out, "--", "-")
	}
	if len(out) > 32 {
		out = out[:32]
	}
	return out
}

// shorten returns the first n bytes of s (used for a key prefix preview).
func shorten(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// ---- small utilities ------------------------------------------------------

func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]any{"error": msg})
}

func copyHeader(dst, src http.Header) {
	for k, vv := range src {
		if strings.EqualFold(k, "Content-Length") || strings.EqualFold(k, "Transfer-Encoding") {
			continue
		}
		dst[k] = vv
	}
}
