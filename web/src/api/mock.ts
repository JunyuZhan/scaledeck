// ---------------------------------------------------------------------------
// Demo mock backend.
//
// This module is ONLY active when the app is built with VITE_DEMO="1" (the
// GitHub Pages demo deploy). It monkeypatches window.fetch and window.EventSource
// so the *real* ScaleDeck UI runs entirely client-side against in-memory fixtures
// — no Headscale, no web backend, no secrets. Every page, table, form and the
// branding editor behave exactly as in production; mutations just update memory
// (and the demo session is persisted to localStorage so a refresh keeps you in).
//
// Nothing here is reachable in a normal production build.
// ---------------------------------------------------------------------------

import type { Branding } from "../lib/branding";
import type {
  Node,
  User,
  PreAuthKey,
  WebUser,
  Invite,
  Event,
  MailSettingsResp,
  Me,
} from "./client";

const DEMO = import.meta.env.VITE_DEMO === "1";

const SESSION_KEY = "sd_demo_session";
const DEMO_ME: Me = { username: "demo", role: "admin", headscale_user: "owner" };

// --- session persistence ---------------------------------------------------
function loadSession(): Me | null {
  try {
    const s = localStorage.getItem(SESSION_KEY);
    return s ? (JSON.parse(s) as Me) : null;
  } catch {
    return null;
  }
}
function saveSession(m: Me | null) {
  try {
    if (m) localStorage.setItem(SESSION_KEY, JSON.stringify(m));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

// --- seed data -------------------------------------------------------------
const seedUsers: User[] = [
  { id: "1", name: "owner", displayName: "管理员", email: "admin@example.com" },
  { id: "2", name: "zhangsan", displayName: "张三", email: "zhangsan@example.com" },
  { id: "3", name: "lisi", displayName: "李四", email: "lisi@example.com" },
];

const seedNodes: Node[] = [
  {
    id: "1",
    name: "hk-node",
    givenName: "hk-node",
    user: seedUsers[0],
    online: true,
    lastSeen: "2026-10-12T14:54:16.000Z",
    expiry: undefined,
    ipAddresses: ["100.64.0.1", "fd7a:115c:a1e0::1"],
    tags: ["tag:server"],
    subnetRoutes: ["192.168.50.0/24"],
    primaryRoutes: ["192.168.50.0/24"],
    machineKey: "mkey:demo000000000000000000000000000000000000000000000000000000000001",
    nodeKey: "nodekey:demo000000000000000000000000000000000000000000000000000000000001",
  },
  {
    id: "2",
    name: "debian-internal",
    givenName: "debian-internal",
    user: seedUsers[0],
    online: true,
    lastSeen: "2026-10-12T15:28:57.000Z",
    expiry: undefined,
    ipAddresses: ["100.64.0.2", "fd7a:115c:a1e0::2"],
    tags: [],
    subnetRoutes: [],
    primaryRoutes: [],
    machineKey: "mkey:demo000000000000000000000000000000000000000000000000000000000002",
    nodeKey: "nodekey:demo000000000000000000000000000000000000000000000000000000000002",
  },
  {
    id: "3",
    name: "zhangsan-laptop",
    givenName: "zhangsan-laptop",
    user: seedUsers[1],
    online: true,
    lastSeen: "2026-10-12T11:02:31.000Z",
    expiry: undefined,
    ipAddresses: ["100.64.0.3", "fd7a:115c:a1e0::3"],
    tags: [],
    subnetRoutes: [],
    primaryRoutes: [],
    machineKey: "mkey:demo000000000000000000000000000000000000000000000000000000000003",
    nodeKey: "nodekey:demo000000000000000000000000000000000000000000000000000000000003",
  },
  {
    id: "4",
    name: "office-router",
    givenName: "office-router",
    user: seedUsers[0],
    online: false,
    lastSeen: "2026-10-11T22:14:09.000Z",
    expiry: undefined,
    ipAddresses: ["100.64.0.4", "fd7a:115c:a1e0::4"],
    tags: ["tag:server"],
    subnetRoutes: ["10.0.0.0/24"],
    primaryRoutes: ["10.0.0.0/24"],
    machineKey: "mkey:demo000000000000000000000000000000000000000000000000000000000004",
    nodeKey: "nodekey:demo000000000000000000000000000000000000000000000000000000000004",
  },
];

const seedKeys: PreAuthKey[] = [
  {
    id: "1",
    key: "hskey-demo-1dd0c6d0a0c3-****",
    user: seedUsers[0],
    reusable: true,
    ephemeral: false,
    expiration: "2026-11-08T13:53:36.000Z",
    createdAt: "2026-10-09T13:53:36.000Z",
    aclTags: [],
  },
  {
    id: "2",
    key: "hskey-demo-72018f3b9e21-****",
    user: seedUsers[1],
    reusable: false,
    ephemeral: true,
    expiration: "2026-10-19T09:12:00.000Z",
    createdAt: "2026-10-12T09:12:00.000Z",
    aclTags: ["tag:laptop"],
  },
];

const seedInvites: Invite[] = [
  {
    id: 14,
    applicant: "王五",
    device_desc: "macbook-pro",
    org: "技术部",
    target_user: "owner",
    key_prefix: "hskey-demo-72018",
    hostname: "wangwu-mbp",
    created_by: "admin",
    created_at: "2026-10-12T09:46:04.000Z",
    expires_at: "2026-10-15T09:46:04.000Z",
    status: "unused",
  },
  {
    id: 13,
    applicant: "赵六",
    device_desc: "windows-pc",
    org: "财务部",
    target_user: "owner",
    key_prefix: "hskey-demo-51426",
    hostname: "zhaoliu-pc",
    created_by: "admin",
    created_at: "2026-10-12T08:30:11.000Z",
    expires_at: "2026-10-15T08:30:11.000Z",
    status: "unused",
  },
  {
    id: 12,
    applicant: "张三",
    device_desc: "zhangsan-laptop",
    org: "技术部",
    target_user: "owner",
    key_prefix: "hskey-demo-71208",
    hostname: "zhangsan-laptop",
    created_by: "admin",
    created_at: "2026-10-11T15:46:03.000Z",
    expires_at: "2026-10-14T15:46:03.000Z",
    status: "used",
  },
];

const seedWebUsers: WebUser[] = [
  {
    id: 1,
    username: "admin",
    email: "admin@example.com",
    headscale_user: "owner",
    role: "admin",
    created_at: "2026-10-09T13:05:27.000Z",
  },
  {
    id: 2,
    username: "demo",
    email: "demo@example.com",
    headscale_user: "zhangsan",
    role: "user",
    created_at: "2026-10-12T08:00:00.000Z",
  },
];

const seedEvents: Event[] = [
  { id: 62, time: "2026-10-12T15:42:20.000Z", actor: "admin", type: "login", target: "admin", detail: "", ip: "203.0.113.7" },
  { id: 61, time: "2026-10-12T14:51:01.000Z", actor: "admin", type: "create_key", target: "owner", detail: "device=demo-laptop expiry=1h", ip: "203.0.113.7" },
  { id: 60, time: "2026-10-12T14:40:21.000Z", actor: "system", type: "node_offline", target: "office-router", detail: "node went offline", ip: "" },
  { id: 59, time: "2026-10-12T13:54:08.000Z", actor: "admin", type: "apply_policy", target: "policy", detail: "", ip: "203.0.113.7" },
  { id: 58, time: "2026-10-12T13:26:32.000Z", actor: "admin", type: "create_user", target: "zhangsan", detail: "role=user", ip: "203.0.113.7" },
  { id: 57, time: "2026-10-12T12:57:30.000Z", actor: "admin", type: "login", target: "admin", detail: "", ip: "203.0.113.7" },
  { id: 56, time: "2026-10-12T11:02:31.000Z", actor: "system", type: "node_join", target: "zhangsan-laptop", detail: "new node online", ip: "" },
  { id: 55, time: "2026-10-12T09:12:00.000Z", actor: "admin", type: "create_key", target: "zhangsan", detail: "ephemeral device=mbp expiry=7d", ip: "203.0.113.7" },
  { id: 54, time: "2026-10-11T22:14:09.000Z", actor: "system", type: "node_offline", target: "office-router", detail: "node went offline", ip: "" },
  { id: 53, time: "2026-10-11T15:47:26.000Z", actor: "admin", type: "node_tag", target: "hk-node", detail: "tag:server", ip: "203.0.113.7" },
];

const seedPolicy = `{
  // ScaleDeck 演示策略（huJSON，支持注释）
  "groups": {
    "group:admins": ["owner"],
    "group:dev":    ["zhangsan", "lisi"],
  },
  "hosts": {
    "internal-server": "100.64.0.1",
    "office-lan":     "10.0.0.0/24",
  },
  "tagOwners": {
    "tag:server": ["group:admins"],
    "tag:laptop": ["group:dev"],
  },
  "acls": [
    // 管理员可访问所有节点
    {
      "action": "accept",
      "src":    ["group:admins"],
      "dst":    ["*:*"],
    },
    // 成员之间互不可达，仅可访问服务器与各自设备
    {
      "action": "accept",
      "src":    ["group:dev"],
      "dst":    ["tag:server:*", "internal-server:*"],
    },
    // 所有节点可访问内网网段（通过子网路由）
    {
      "action": "accept",
      "src":    ["*"],
      "dst":    ["office-lan:*"],
    },
  ],
}
`;

const seedBranding: Branding = {
  site_name: "ScaleDeck",
  slogan: "",
  login_headline: "",
  login_subtitle: "",
  logo_url: "",
  icp: "",
  gongan: "",
  footer_text: "",
  has_uploaded_logo: false,
};

const seedMail: MailSettingsResp = {
  mail: {
    enabled: false,
    smtp_host: "",
    smtp_port: "587",
    smtp_username: "",
    smtp_password: "",
    smtp_from: "",
    smtp_tls: "starttls",
    resend_api_key: "",
    resend_from: "",
    resend_notify_to: "",
  },
  has_smtp_password: false,
  has_resend_key: false,
};

interface DemoState {
  session: Me | null;
  nodes: Node[];
  users: User[];
  keys: PreAuthKey[];
  invites: Invite[];
  webUsers: WebUser[];
  events: Event[];
  policy: string;
  policyUpdatedAt: string;
  branding: Branding;
  mail: MailSettingsResp;
}

const state: DemoState = {
  session: loadSession(),
  nodes: seedNodes,
  users: seedUsers,
  keys: seedKeys,
  invites: seedInvites,
  webUsers: seedWebUsers,
  events: seedEvents,
  policy: seedPolicy,
  policyUpdatedAt: "2026-10-12T13:54:08.000Z",
  branding: { ...seedBranding },
  mail: { ...seedMail },
};

// --- helpers ---------------------------------------------------------------
function readJson(init: RequestInit | undefined): Record<string, unknown> {
  if (!init || init.body == null) return {};
  if (typeof init.body === "string") {
    try {
      return JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function noContent(): Response {
  return new Response(null, { status: 204 });
}
function err(msg: string, status = 400): Response {
  return json({ error: msg }, status);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => resolve("");
    r.readAsDataURL(file);
  });
}

function match(path: string, re: RegExp): RegExpMatchArray | null {
  return path.match(re);
}

// --- the router ------------------------------------------------------------
async function route(
  method: string,
  url: URL,
  init: RequestInit,
): Promise<Response> {
  const p = url.pathname;
  const q = url.searchParams;
  const b = readJson(init);
  let m: RegExpMatchArray | null;

  // ---------------- AUTH ----------------
  if (p === "/ui/api/auth/config")
    return json({ turnstile_enabled: false, turnstile_site_key: "", turnstile_action: "login" });
  if (p === "/ui/api/auth/me")
    return state.session ? json(state.session) : err("unauthorized", 401);
  if (p === "/ui/api/auth/login" && method === "POST") {
    if (b.username === "demo" && b.password === "demo") {
      state.session = DEMO_ME;
      saveSession(state.session);
      return json(state.session);
    }
    return err("演示账号为 demo / 密码 demo", 401);
  }
  if (p === "/ui/api/auth/logout" && method === "POST") {
    state.session = null;
    saveSession(null);
    return json({ ok: true });
  }
  if (p === "/ui/api/auth/setup" && method === "POST") {
    state.session = DEMO_ME;
    saveSession(state.session);
    return json(state.session);
  }

  // ---------------- PROXY (Headscale) ----------------
  if (p === "/ui/api/proxy/node" && method === "GET") return json({ nodes: state.nodes });
  if ((m = match(p, /^\/ui\/api\/proxy\/node\/([^/]+)$/)) && method === "DELETE") {
    state.nodes = state.nodes.filter((n) => n.id !== m![1]);
    return noContent();
  }
  if ((m = match(p, /^\/ui\/api\/proxy\/node\/([^/]+)\/expire$/)) && method === "POST") {
    const n = state.nodes.find((x) => x.id === m![1]);
    if (n) n.expiry = new Date().toISOString();
    return json({ node: n });
  }
  if ((m = match(p, /^\/ui\/api\/proxy\/node\/([^/]+)\/rename\/(.+)$/)) && method === "POST") {
    const n = state.nodes.find((x) => x.id === m![1]);
    if (n) { n.name = m![2]; n.givenName = m![2]; }
    return json({ node: n });
  }
  if ((m = match(p, /^\/ui\/api\/proxy\/node\/([^/]+)\/tags$/)) && method === "POST") {
    const n = state.nodes.find((x) => x.id === m![1]);
    if (n) n.tags = (b.tags as string[]) || [];
    return json({ node: n });
  }

  if (p === "/ui/api/proxy/user" && method === "GET") return json({ users: state.users });
  if (p === "/ui/api/proxy/user" && method === "POST") {
    const u: User = {
      id: String(Date.now()),
      name: String(b.name || "new-user"),
      displayName: (b.displayName as string) || "",
      email: (b.email as string) || "",
    };
    state.users = [...state.users, u];
    return json({ user: u });
  }
  if ((m = match(p, /^\/ui\/api\/proxy\/user\/([^/]+)$/)) && method === "DELETE") {
    state.users = state.users.filter((u) => u.id !== m![1]);
    return noContent();
  }

  if (p === "/ui/api/proxy/preauthkey" && method === "GET") return json({ preAuthKeys: state.keys });
  if (p === "/ui/api/proxy/preauthkey" && method === "POST") {
    const owner = state.users.find((u) => u.name === b.user) || state.users[0];
    const k: PreAuthKey = {
      id: String(Date.now()),
      key: "hskey-demo-" + Math.random().toString(36).slice(2, 14) + "-****",
      user: owner,
      reusable: Boolean(b.reusable),
      ephemeral: Boolean(b.ephemeral),
      expiration: (b.expiration as string) || new Date(Date.now() + 30 * 864e5).toISOString(),
      createdAt: new Date().toISOString(),
      aclTags: (b.aclTags as string[]) || [],
    };
    state.keys = [...state.keys, k];
    return json({ preAuthKey: k });
  }
  if (p === "/ui/api/proxy/preauthkey/expire" && method === "POST") {
    const id = String(b.id);
    state.keys = state.keys.map((k) =>
      k.id === id ? { ...k, expiration: new Date().toISOString() } : k,
    );
    return json({ ok: true });
  }
  if (p === "/ui/api/proxy/preauthkey" && method === "DELETE") {
    const id = q.get("id");
    if (id) state.keys = state.keys.filter((k) => k.id !== id);
    return noContent();
  }

  if (p === "/ui/api/proxy/policy" && method === "GET")
    return json({ policy: state.policy, updatedAt: state.policyUpdatedAt });
  if (p === "/ui/api/proxy/policy" && method === "PUT") {
    state.policy = (b.policy as string) || state.policy;
    state.policyUpdatedAt = new Date().toISOString();
    return json({ policy: state.policy, updatedAt: state.policyUpdatedAt });
  }
  if (p === "/ui/api/proxy/policy/check" && method === "POST") return json({ ok: true });

  // ---------------- BACKEND (self / admin) ----------------
  if (p === "/ui/api/me" && method === "GET") return json(state.session ?? DEMO_ME);
  if (p === "/ui/api/me/preauthkey" && method === "POST")
    return json({
      key: "hskey-demo-" + Math.random().toString(36).slice(2, 14),
      server_url: "https://demo.scaledeck.example",
      headscale_user: "owner",
      commands: {
        linux: "tailscale up --login-server https://demo.scaledeck.example --authkey <KEY>",
        macos: "tailscale up --login-server https://demo.scaledeck.example --authkey <KEY>",
        windows: "tailscale up --login-server https://demo.scaledeck.example --authkey <KEY>",
      },
      expiration_hours: 1,
    });
  if (p === "/ui/api/me/password" && method === "POST") return json({ ok: true });
  if (p === "/ui/api/me/events" && method === "GET") return json(state.events);

  if (p === "/ui/api/admin/invites" && method === "GET") return json(state.invites);
  if ((m = match(p, /^\/ui\/api\/admin\/invites\/([^/]+)$/)) && method === "DELETE") {
    state.invites = state.invites.filter((i) => String(i.id) !== m![1]);
    return noContent();
  }
  if (p === "/ui/api/admin/invites/purge-expired" && method === "POST")
    return json({ ok: true, removed: 0 });
  if (p === "/ui/api/admin/events" && method === "GET") return json(state.events);

  if (p === "/ui/api/admin/webusers" && method === "GET") return json(state.webUsers);
  if (p === "/ui/api/admin/webusers" && method === "POST") {
    const u: WebUser = {
      id: state.webUsers.length + 1,
      username: String(b.username || "new"),
      email: (b.email as string) || "",
      headscale_user: (b.headscale_user as string) || "",
      role: (b.role as "admin" | "user") || "user",
      created_at: new Date().toISOString(),
    };
    state.webUsers = [...state.webUsers, u];
    return json(u);
  }
  if ((m = match(p, /^\/ui\/api\/admin\/webusers\/([^/]+)$/)) && method === "DELETE") {
    state.webUsers = state.webUsers.filter((u) => String(u.id) !== m![1]);
    return noContent();
  }
  if ((m = match(p, /^\/ui\/api\/admin\/webusers\/([^/]+)\/password$/)) && method === "POST")
    return json({ ok: true });

  if (p === "/ui/api/admin/settings/mail" && method === "GET") return json(state.mail);
  if (p === "/ui/api/admin/settings/mail" && method === "PUT") {
    const mail = b as unknown as MailSettingsResp["mail"];
    state.mail = {
      mail,
      has_smtp_password: Boolean(mail.smtp_password),
      has_resend_key: Boolean(mail.resend_api_key),
    };
    return json(state.mail);
  }
  if (p === "/ui/api/admin/settings/mail/test" && method === "POST")
    return json({ ok: true });

  // ---------------- BRANDING ----------------
  if (p === "/ui/api/branding" && method === "GET") return json(state.branding);
  if (p === "/ui/api/admin/settings/branding" && method === "GET") return json(state.branding);
  if (p === "/ui/api/admin/settings/branding" && method === "PUT") {
    state.branding = { ...state.branding, ...(b as Partial<Branding>) };
    return json(state.branding);
  }
  if (p === "/ui/api/admin/settings/branding/logo" && method === "POST") {
    if (init.body instanceof FormData) {
      const file = init.body.get("logo");
      if (file instanceof File) {
        const dataUrl = await fileToDataUrl(file);
        // Represent the uploaded logo as an inline data: URL so the <img>-based
        // brand mark renders without a real backend (EventSource/fetch of the
        // /branding/logo route would not work on static GitHub Pages).
        state.branding = { ...state.branding, logo_url: dataUrl, has_uploaded_logo: false };
      }
    }
    return json(state.branding);
  }
  if (p === "/ui/api/admin/settings/branding/logo" && method === "DELETE") {
    state.branding = { ...state.branding, logo_url: "", has_uploaded_logo: false };
    return json(state.branding);
  }

  return err("Demo mock: 未处理的 " + method + " " + p, 404);
}

async function mockFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  let url: URL;
  try {
    if (typeof input === "string") url = new URL(input, location.href);
    else if (input instanceof URL) url = input;
    else url = new URL((input as Request).url, location.href);
  } catch {
    return json({ error: "bad url" }, 400);
  }
  const method = (
    init.method ||
    (typeof input !== "string" && input instanceof Request ? input.method : "") ||
    "GET"
  ).toUpperCase();
  return route(method, url, init);
}

// Called from main.tsx before the app renders. In a normal build it is a no-op.
export function installMock(): void {
  if (!DEMO) return;
  // Deliberately override the global fetch for the demo.
  (window as unknown as { fetch: typeof fetch }).fetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => mockFetch(input, init);
  // SSE streams have no backend in the demo; stub to a no-op so the live-update
  // hooks don't spam reconnection errors.
  (window as unknown as { EventSource: unknown }).EventSource = class {
    constructor() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return false;
    }
  };
}
