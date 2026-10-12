import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

export type Lang = "zh-Hans" | "zh-Hant" | "en";

// English strings are used as keys. Chinese overrides live in `zhHans`
// (Simplified) and `zhHant` (Traditional). Anything missing falls back to
// the (English) key, so the UI degrades gracefully and every language is
// reachable via the switcher.
const zhHans: Record<string, string> = {
  // Layout / navigation
  Overview: "总览",
  Nodes: "节点",
  "My devices": "我的设备",
  Users: "用户",
  "Pre-auth keys": "预授权密钥",
  "ACL Policy": "访问控制策略",
  Workspace: "工作区",
  Administration: "管理",
  "Log out": "退出登录",
  admin: "管理员",
  user: "普通用户",

  // Self-service
  "Joined devices": "已加入的设备",
  "No devices yet.": "暂无设备。",
  "Generate join key (self-service)": "生成接入密钥（自助入网）",
  "Target user": "目标用户",
  "Create a Headscale user first": "请先在「用户」页面创建 Headscale 用户",
  "Join command (key shown once)": "接入命令（密钥仅显示一次）",
  "Copy command": "复制命令",

  // Generic
  "Loading…": "加载中…",
  Refresh: "刷新",
  "Signing in…": "登录中…",
  "Sign in": "登录",

  // Login / security (Cloudflare Turnstile human verification)
  "Sign in to your network console": "登录你的网络控制台",
  "Secure, self-hosted Tailscale control plane": "自建、安全的 Tailscale 控制平面",
  "Security verification": "安全验证",
  "Complete the security check to continue": "完成安全验证以继续",
  "Human verification failed, please try again": "人机验证未通过，请重试",
  "Verifying you are human…": "正在验证你是真人…",
  "Protected by Cloudflare Turnstile": "由 Cloudflare Turnstile 提供人机验证保护",

  // First-run password setup (out-of-box default admin)
  "First-run setup": "首次部署设置",
  "Set a password for the administrator": "设置管理员密码",
  "This is the first launch. Set a password for the default admin account to start using the console.": "首次部署：为默认管理员账号设置密码后即可开始使用。",
  "Welcome": "欢迎",
  "Passwords do not match": "两次输入的密码不一致",
  "Create password": "创建密码",
  "Default admin account": "默认管理员账号",

  // Nodes
  Name: "名称",
  User: "用户",
  Addresses: "地址",
  Status: "状态",
  "Last seen": "最近活跃",
  Tags: "标签",
  Actions: "操作",
  online: "在线",
  offline: "离线",
  Live: "实时",
  Rename: "重命名",
  Expire: "过期",
  Delete: "删除",
  "No nodes": "暂无节点",
  "New name": "新名称",
  "Tags (space separated, e.g. tag:server)": "标签（空格分隔，例如 tag:server）",
  "Rename failed": "重命名失败",
  "Set tags failed": "设置标签失败",
  "Delete node": "删除节点",
  "Delete failed": "删除失败",

  // Users
  "New user name": "新用户名",
  Create: "创建",
  "Display name": "显示名称",
  Email: "邮箱",
  "No users": "暂无用户",
  "Create failed": "创建失败",
  "Delete user": "删除用户",

  // Console accounts (login accounts with passwords)
  "Console accounts": "控制台账号",
  "Login accounts for this web console (with passwords). Not the same as Headscale users.":
    "登录本网页控制台的账号（带密码）。与 Headscale 用户（VPN 命名空间）不是一回事。",
  "Account name": "账号名",
  Password: "密码",
  Role: "角色",
  "Bind to Headscale user": "绑定 Headscale 用户",
  "(admin sees all)": "（管理员可见全部）",
  "Bound Headscale user": "绑定用户",
  "Reset password": "重置密码",
  "Password reset": "密码已重置",
  "Password must be at least 6 characters": "密码至少 6 位",
  "at least 6 characters": "至少 6 位",
  "Pick a Headscale user to bind": "请选择要绑定的 Headscale 用户",
  Created: "已创建",
  "Delete account": "删除账号",
  "No accounts": "暂无账号",
  "Tip: a role=user account can only see and manage devices of its bound Headscale user.":
    "提示：普通用户账号只能查看和管理其绑定 Headscale 用户下的设备。",

  // Pre-auth keys
  "New key created": "已创建新密钥",
  "Copy it now — it will not be shown again.": "请立即复制——密钥仅显示一次。",
  "User name": "用户名",
  "ACL tags (e.g. tag:server)": "ACL 标签（例如 tag:server）",
  Reusable: "可复用",
  Ephemeral: "临时",
  "Create key": "创建密钥",
  ID: "标识",
  Expiration: "过期时间",
  yes: "是",
  no: "否",
  "No keys": "暂无密钥",
  "User is required": "请填写用户名",
  "Expire failed": "过期操作失败",

  // Policy
  Groups: "分组",
  Hosts: "主机",
  "Tag owners": "标签所有者",
  "ACL rules": "ACL 规则",
  Action: "动作",
  Source: "源",
  Destination: "目标",
  accept: "允许",
  deny: "拒绝",
  Load: "加载",
  Validate: "校验",
  Save: "保存",
  "No policy is stored yet. Saving will create one.":
    "尚未存储策略，保存将创建一条。",
  "Quick add rule": "快速添加规则",
  Add: "添加",
  "Isolated mode": "成员隔离",
  "Mesh mode": "成员互访",
  "— none —": "— 无 —",

  // Invite device
  "Invite device": "邀请设备",
  "Invite a colleague to join": "邀请同事加入本网络",
  "Generate an invite command with a built-in token.":
    "生成一条带内置令牌的邀请命令，同事运行即自动加入（无需登录后台）。",
  "Generate invite command": "生成邀请命令",
  "Key (shown once)": "密钥（仅显示一次）",
  "Linux / macOS": "Linux / macOS",
  "Windows": "Windows",
  "Copy install script": "复制命令",
  "Download script": "下载脚本",
  "Token valid for": "令牌有效期",
  "hours": "小时",
  "Revoke anytime from": "可随时在",
  "Revoke device": "吊销设备",
  "Revoke node": "吊销节点",
  "Target user is required": "请选择目标用户",

  // Invite ledger
  "Applicant": "申请人",
  "Device description": "设备描述",
  "Organization": "单位",
  "Used as node hostname; ASCII only, e.g. zhangsan-laptop":
    "作为节点名（仅 ASCII，例如 zhangsan-laptop）",
  "Invitation ledger": "邀请台账",
  "Invite record": "邀请记录",
  "Show expired": "显示已过期",
  "Hide expired": "隐藏已过期",
  "Clear expired": "清除已过期",
  "Clear expired invites": "确定清除所有已过期的邀请记录",
  "Clear failed": "清除失败",
  "Invited, not yet joined — the device will appear above once it joins.":
    "已发出邀请、尚未加入——设备上线后会自动出现在上方节点列表。",
  "Add device": "添加设备",
  "Pending join": "待加入",
  "Invite sent": "邀请已发出",
  Close: "关闭",
  "No invitations yet.": "暂无邀请记录。",
  "Device": "设备",
  "Node name": "节点名",
  "By": "生成人",
  "Expires": "过期时间",
  "未使用": "未使用",
  "已使用": "已使用",
  "已过期": "已过期",
  "已吊销": "已吊销",

  // Change password
  "Change password": "修改密码",
  "Old password": "原密码",
  "New password": "新密码",
  "Confirm password": "确认新密码",
  "Password changed": "密码已修改",
  "Change password failed": "修改密码失败",

  // Activity log (audit)
  "Activity log": "活动日志",
  Notifications: "站内通知",
  "Mark all read": "全部已读",
  "No notifications": "暂无通知",
  "Machine id used in ACLs and join commands": "机器标识：ACL 与入网命令中使用的用户名（英文小写）",
  "e.g. real name / nickname": "例如：姓名 / 昵称",
  "Time": "时间",
  "Actor": "操作者",
  "Event": "事件",
  "Target": "对象",
  "Detail": "详情",
  "IP": "来源 IP",
  "No activity yet.": "暂无活动记录。",

  // Mobile onboarding
  "Mobile access": "移动端接入",
  "Download profile (iOS)": "下载描述文件（iOS）",
  "iOS install steps": "iOS 安装步骤",
  "Android access": "Android 接入",
  "Android note":
    "Android 需通过 MDM（Android Enterprise）下发 ServerURL + AuthKey 托管配置，或先将设备设为完全托管设备后再安装 Tailscale。",
  "Managed config (Android)": "Android 托管配置（JSON）",
  "Copy config": "复制配置",
  "Install profile hint":
    "将描述文件通过 AirDrop / 邮件 / 网盘发送到 iPhone 或 iPad，打开「设置 → 已下载的描述文件」安装，再打开 Tailscale 即可自动连接。",
  "Server": "服务器",
  "Auth key embedded": "密钥已内嵌于描述文件（仅显示一次，请妥善保管）",

  // Mail / SMTP settings
  "Mail settings": "邮件设置",
  "Enable email alerts": "启用邮件告警",
  "SMTP configuration": "SMTP 配置",
  "SMTP host": "SMTP 主机",
  "SMTP port": "SMTP 端口",
  "SMTP username": "SMTP 用户名",
  "SMTP password": "SMTP 密码",
  "Leave blank to keep unchanged": "留空表示不修改",
  "From address": "发件地址",
  "Encryption": "加密方式",
  "STARTTLS (587)": "STARTTLS（587）",
  "Implicit TLS (465)": "隐式 TLS（465）",
  "Resend API key": "Resend API 密钥",
  "Resend from": "Resend 发件地址",
  "Alert recipients": "告警收件人",
  "comma-separated emails": "多个邮箱用逗号分隔",
  "Test recipient": "测试收件邮箱",
  Saved: "已保存",

  // Site branding (Settings)
  Settings: "设置",
  Branding: "品牌",
  "Site name": "站点名称",
  Slogan: "标语",
  "Login page headline": "登录页标题",
  "Login page subtitle": "登录页副标题",
  "ICP filing number": "ICP 备案号",
  "Public security filing number": "公安备案号",
  "Footer text": "页脚文案",
  Logo: "标志",
  "Logo URL": "标志链接",
  "Upload logo": "上传标志",
  "Remove logo": "移除标志",
  "Logo uploaded": "标志已上传",
  "Logo removed": "标志已移除",
  "Powered by": "由",
  Driven: "驱动",
  "Leave blank to use built-in copy": "留空则使用内置文案",
  "Shown in the browser tab title and on the login page": "显示在浏览器标签标题与登录页",
  "Shown under the site name": "显示在站点名称下方",
  "Leave blank to hide": "留空则隐藏",
  "Example: 京ICP备12345678号-1": "示例：京ICP备12345678号-1",
  "PNG, JPEG, WebP or ICO, up to 1 MiB. An uploaded logo takes precedence over the URL.":
    "支持 PNG / JPEG / WebP / ICO，最大 1 MiB。上传的标志优先于链接。",
  "Remote logo address (http/https)": "远程标志地址（http/https）",
  "Built-in mark in use": "正在使用内置标志",
  "Send test email": "发送测试邮件",
  "Test email sent": "测试邮件已发送",
  "Test recipient required": "请填写测试收件邮箱",
  "Mail not configured": "尚未配置邮件",
};

// Traditional Chinese mirror of `zhHans`. Same keys, Traditional glyphs.
const zhHant: Record<string, string> = {
  // Layout / navigation
  Overview: "總覽",
  Nodes: "節點",
  "My devices": "我的裝置",
  Users: "使用者",
  "Pre-auth keys": "預授權金鑰",
  "ACL Policy": "存取控制策略",
  Workspace: "工作區",
  Administration: "管理",
  "Log out": "登出",
  admin: "管理員",
  user: "一般使用者",

  // Self-service
  "Joined devices": "已加入的裝置",
  "No devices yet.": "尚無裝置。",
  "Generate join key (self-service)": "產生加入金鑰（自助入網）",
  "Target user": "目標使用者",
  "Create a Headscale user first": "請先於「使用者」頁面建立 Headscale 使用者",
  "Join command (key shown once)": "加入命令（金鑰僅顯示一次）",
  "Copy command": "複製命令",

  // Generic
  "Loading…": "載入中…",
  Refresh: "重新整理",
  "Signing in…": "登入中…",
  "Sign in": "登入",

  // Login / security (Cloudflare Turnstile human verification)
  "Sign in to your network console": "登入你的網路控制台",
  "Secure, self-hosted Tailscale control plane": "自建、安全的 Tailscale 控制平面",
  "Security verification": "安全驗證",
  "Complete the security check to continue": "完成安全驗證以繼續",
  "Human verification failed, please try again": "人機驗證未通過，請重試",
  "Verifying you are human…": "正在驗證你是真人…",
  "Protected by Cloudflare Turnstile": "由 Cloudflare Turnstile 提供人機驗證保護",

  // First-run password setup (out-of-box default admin)
  "First-run setup": "首次部署設定",
  "Set a password for the administrator": "設定管理員密碼",
  "This is the first launch. Set a password for the default admin account to start using the console.": "首次部署：為預設管理員帳號設定密碼後即可開始使用。",
  "Welcome": "歡迎",
  "Passwords do not match": "兩次輸入的密碼不一致",
  "Create password": "建立密碼",
  "Default admin account": "預設管理員帳號",

  // Nodes
  Name: "名稱",
  User: "使用者",
  Addresses: "位址",
  Status: "狀態",
  "Last seen": "最近活動",
  Tags: "標籤",
  Actions: "操作",
  online: "線上",
  offline: "離線",
  Live: "即時",
  Rename: "重新命名",
  Expire: "過期",
  Delete: "刪除",
  "No nodes": "尚無節點",
  "New name": "新名稱",
  "Tags (space separated, e.g. tag:server)": "標籤（以空格分隔，例如 tag:server）",
  "Rename failed": "重新命名失敗",
  "Set tags failed": "設定標籤失敗",
  "Delete node": "刪除節點",
  "Delete failed": "刪除失敗",

  // Users
  "New user name": "新使用者名稱",
  Create: "建立",
  "Display name": "顯示名稱",
  Email: "電子郵件",
  "No users": "尚無使用者",
  "Create failed": "建立失敗",
  "Delete user": "刪除使用者",

  // Console accounts (login accounts with passwords)
  "Console accounts": "控制台帳號",
  "Login accounts for this web console (with passwords). Not the same as Headscale users.":
    "登入此網頁控制台的帳號（含密碼）。與 Headscale 使用者（VPN 命名空間）並非同一回事。",
  "Account name": "帳號名稱",
  Password: "密碼",
  Role: "角色",
  "Bind to Headscale user": "綁定 Headscale 使用者",
  "(admin sees all)": "（管理員可檢視全部）",
  "Bound Headscale user": "已綁定使用者",
  "Reset password": "重設密碼",
  "Password reset": "密碼已重設",
  "Password must be at least 6 characters": "密碼至少需 6 個字元",
  "at least 6 characters": "至少 6 個字元",
  "Pick a Headscale user to bind": "請選擇要綁定的 Headscale 使用者",
  Created: "已建立",
  "Delete account": "刪除帳號",
  "No accounts": "尚無帳號",
  "Tip: a role=user account can only see and manage devices of its bound Headscale user.":
    "提示：一般使用者帳號僅能檢視與管理其所綁定 Headscale 使用者下的裝置。",

  // Pre-auth keys
  "New key created": "已建立新金鑰",
  "Copy it now — it will not be shown again.": "請立即複製——金鑰僅顯示一次。",
  "User name": "使用者名稱",
  "ACL tags (e.g. tag:server)": "ACL 標籤（例如 tag:server）",
  Reusable: "可重複使用",
  Ephemeral: "臨時",
  "Create key": "建立金鑰",
  ID: "識別碼",
  Expiration: "到期時間",
  yes: "是",
  no: "否",
  "No keys": "尚無金鑰",
  "User is required": "請填寫使用者名稱",
  "Expire failed": "過期操作失敗",

  // Policy
  Groups: "群組",
  Hosts: "主機",
  "Tag owners": "標籤擁有者",
  "ACL rules": "ACL 規則",
  Action: "動作",
  Source: "來源",
  Destination: "目的地",
  accept: "允許",
  deny: "拒絕",
  Load: "載入",
  Validate: "驗證",
  Save: "儲存",
  "No policy is stored yet. Saving will create one.":
    "尚未儲存原則，儲存將建立一條。",
  "Quick add rule": "快速新增規則",
  Add: "新增",
  "Isolated mode": "成員隔離",
  "Mesh mode": "成員互訪",
  "— none —": "— 無 —",

  // Invite device
  "Invite device": "邀請裝置",
  "Invite a colleague to join": "邀請同事加入本網路",
  "Generate an invite command with a built-in token.":
    "產生一條內含令牌的邀請命令，同事執行後即自動加入（無需登入後台）。",
  "Generate invite command": "產生邀請命令",
  "Key (shown once)": "金鑰（僅顯示一次）",
  "Linux / macOS": "Linux / macOS",
  "Windows": "Windows",
  "Copy install script": "複製命令",
  "Download script": "下載腳本",
  "Token valid for": "令牌有效期",
  "hours": "小時",
  "Revoke anytime from": "可隨時於",
  "Revoke device": "撤銷裝置",
  "Revoke node": "撤銷節點",
  "Target user is required": "請選擇目標使用者",

  // Invite ledger
  "Applicant": "申請人",
  "Device description": "裝置描述",
  "Organization": "單位",
  "Used as node hostname; ASCII only, e.g. zhangsan-laptop":
    "作為節點名稱（僅限 ASCII，例如 zhangsan-laptop）",
  "Invitation ledger": "邀請台帳",
  "Invite record": "邀請記錄",
  "Show expired": "顯示已過期",
  "Hide expired": "隱藏已過期",
  "Clear expired": "清除已過期",
  "Clear expired invites": "確定清除所有已過期的邀請記錄",
  "Clear failed": "清除失敗",
  "Invited, not yet joined — the device will appear above once it joins.":
    "已發出邀請、尚未加入——裝置上線後會自動出現於上方節點清單。",
  "Add device": "新增裝置",
  "Pending join": "待加入",
  "Invite sent": "邀請已送出",
  Close: "關閉",
  "No invitations yet.": "尚無邀請記錄。",
  "Device": "裝置",
  "Node name": "節點名稱",
  "By": "產生人",
  "Expires": "到期時間",
  "未使用": "未使用",
  "已使用": "已使用",
  "已过期": "已過期",
  "已吊销": "已撤銷",

  // Change password
  "Change password": "修改密碼",
  "Old password": "原密碼",
  "New password": "新密碼",
  "Confirm password": "確認新密碼",
  "Password changed": "密碼已修改",
  "Change password failed": "修改密碼失敗",

  // Activity log (audit)
  "Activity log": "活動紀錄",
  Notifications: "站內通知",
  "Mark all read": "全部已讀",
  "No notifications": "尚無通知",
  "Machine id used in ACLs and join commands": "機器識別碼：用於 ACL 與入網命令中的使用者名稱（英文小寫）",
  "e.g. real name / nickname": "例如：姓名 / 暱稱",
  "Time": "時間",
  "Actor": "操作者",
  "Event": "事件",
  "Target": "對象",
  "Detail": "詳情",
  "IP": "來源 IP",
  "No activity yet.": "尚無活動記錄。",

  // Mobile onboarding
  "Mobile access": "行動裝置接入",
  "Download profile (iOS)": "下載描述檔（iOS）",
  "iOS install steps": "iOS 安裝步驟",
  "Android access": "Android 接入",
  "Android note":
    "Android 需透過 MDM（Android Enterprise）推送 ServerURL + AuthKey 受管理設定，或先將裝置設為完全受管理裝置後再安裝 Tailscale。",
  "Managed config (Android)": "Android 受管理設定（JSON）",
  "Copy config": "複製設定",
  "Install profile hint":
    "請將描述檔透過 AirDrop / 郵件 / 網盤傳送至 iPhone 或 iPad，開啟「設定 → 已下載的描述檔」安裝，再開啟 Tailscale 即可自動連線。",
  "Server": "伺服器",
  "Auth key embedded": "金鑰已內嵌於描述檔（僅顯示一次，請妥善保存）",

  // Mail / SMTP settings
  "Mail settings": "郵件設定",
  "Enable email alerts": "啟用郵件警示",
  "SMTP configuration": "SMTP 設定",
  "SMTP host": "SMTP 主機",
  "SMTP port": "SMTP 連接埠",
  "SMTP username": "SMTP 使用者名稱",
  "SMTP password": "SMTP 密碼",
  "Leave blank to keep unchanged": "留白表示不修改",
  "From address": "寄件者地址",
  "Encryption": "加密方式",
  "STARTTLS (587)": "STARTTLS（587）",
  "Implicit TLS (465)": "隱含式 TLS（465）",
  "Resend API key": "Resend API 金鑰",
  "Resend from": "Resend 寄件地址",
  "Alert recipients": "警示收件人",
  "comma-separated emails": "多個郵件以逗號分隔",
  "Test recipient": "測試收件郵件",
  "Send test email": "傳送測試郵件",
  "Test email sent": "測試郵件已傳送",
  "Test recipient required": "請填寫測試收件郵件",
  "Mail not configured": "尚未設定郵件",

  // Site branding (Settings)
  Settings: "設定",
  Branding: "品牌",
  "Site name": "站點名稱",
  Slogan: "標語",
  "Login page headline": "登入頁標題",
  "Login page subtitle": "登入頁副標題",
  "ICP filing number": "ICP 備案號",
  "Public security filing number": "公安備案號",
  "Footer text": "頁腳文案",
  Logo: "標誌",
  "Logo URL": "標誌連結",
  "Upload logo": "上傳標誌",
  "Remove logo": "移除標誌",
  "Logo uploaded": "標誌已上傳",
  "Logo removed": "標誌已移除",
  "Powered by": "由",
  Driven: "驅動",
  "Leave blank to use built-in copy": "留空則使用內建文案",
  "Shown in the browser tab title and on the login page": "顯示於瀏覽器分頁標題與登入頁",
  "Shown under the site name": "顯示於站點名稱下方",
  "Leave blank to hide": "留空則隱藏",
  "Example: 京ICP备12345678号-1": "範例：京ICP備12345678號-1",
  "PNG, JPEG, WebP or ICO, up to 1 MiB. An uploaded logo takes precedence over the URL.":
    "支援 PNG / JPEG / WebP / ICO，最大 1 MiB。上傳的標誌優先於連結。",
  "Remote logo address (http/https)": "遠端標誌位址（http/https）",
  "Built-in mark in use": "正在使用內建標誌",
};

const STORAGE_KEY = "hs_lang";

function initialLang(): Lang {
  if (typeof localStorage === "undefined") return "zh-Hans";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "zh-Hant" || v === "en" ? v : "zh-Hans";
}

// Reflect the active language on <html lang> so browsers don't try to
// auto-translate our already-localized text.
function applyHtmlLang(l: Lang) {
  if (typeof document !== "undefined") document.documentElement.lang = l;
}

interface LangCtxValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (s: string) => string;
}

const LangCtx = createContext<LangCtxValue>({
  lang: "zh-Hans",
  setLang: () => {},
  t: (s) => s,
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang());
  applyHtmlLang(lang);

  const setLang = (l: Lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
    applyHtmlLang(l);
    setLangState(l);
  };

  const t = (s: string) => {
    if (lang === "en") return s;
    const dict = lang === "zh-Hant" ? zhHant : zhHans;
    return dict[s] ?? s;
  };

  return (
    <LangCtx.Provider value={{ lang, setLang, t }}>
      {children}
    </LangCtx.Provider>
  );
}

export function useI18n(): LangCtxValue {
  return useContext(LangCtx);
}
