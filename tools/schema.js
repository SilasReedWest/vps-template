// 字段定义：网页工具与 .env 共用（单一来源）
const SCHEMA = [
 {sec:"基本信息", items:[
  {k:"PROFILE_NAME", label:"这套配置的名字", def:"DMIT-LA", help:"随便起，方便区分多台机器，例如 DMIT-LA。只用字母、数字、横线。", re:"^[A-Za-z0-9-]+$"},
 ]},
 {sec:"版本（默认就是验证过的稳定组合，不懂就别改）", items:[
  {k:"XUI_VERSION", label:"3x-ui 面板版本", def:"v3.10.2", help:"固定版本。升级前必须先在测试机上验证。", re:"^v\\d+\\.\\d+\\.\\d+$"},
  {k:"XRAY_VERSION", label:"Xray 内核版本", def:"v26.6.27", help:"不要升到 v26.9 及以后：小火箭默认指纹会连不上。", re:"^v\\d+\\.\\d+\\.\\d+$"},
 ]},
 {sec:"域名与 Cloudflare", items:[
  {k:"DOMAIN", label:"你的完整域名（含子域名）", def:"", ph:"例：node.example.xyz", help:"面板、订阅、备用节点都用它。在 Cloudflare 里必须是灰云（仅 DNS）。", re:"^([A-Za-z0-9-]+\\.)+[A-Za-z]{2,}$", req:true},
  {k:"CF_API_TOKEN", label:"Cloudflare API 令牌（可选）", def:"", secret:true, help:"填了：自动改 DNS、申请证书不需要 80 端口。留空：按手册手动改 DNS。"},
  {k:"ACME_EMAIL", label:"证书通知邮箱（可选）", def:"", ph:"例：you@example.com", help:"证书快过期时 Let's Encrypt 会发邮件提醒。", re:"^$|^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"},
 ]},
 {sec:"面板与订阅（带「生成」按钮的都可以留空，系统会自动生成随机值）", items:[
  {k:"PANEL_PORT", label:"面板端口", def:"8443", help:"浏览器打开面板用的端口，1024–65535。", re:"^\\d{2,5}$", port:true},
  {k:"PANEL_PATH", label:"面板访问路径", def:"", gen:"path", help:"网址后面那串随机字符，越乱越安全。点「生成」。"},
  {k:"PANEL_USER", label:"面板用户名", def:"", gen:"user", secret:true},
  {k:"PANEL_PASS", label:"面板密码", def:"", gen:"pass", secret:true},
  {k:"SUB_PORT", label:"订阅端口", def:"2096", re:"^\\d{2,5}$", port:true},
  {k:"SUB_PATH", label:"订阅路径", def:"", gen:"path", help:"订阅地址里的路径，点「生成」。"},
 ]},
 {sec:"用户（一个用户，四个节点名）", items:[
  {k:"CLIENT_NAME", label:"用户名", def:"route-auto"},
  {k:"CLIENT_UUID", label:"用户 UUID", def:"", gen:"uuid", secret:true, help:"相当于节点密码。沿用旧的，客户端就不用重新导入。"},
  {k:"SUB_ID", label:"订阅 ID", def:"", gen:"subid", secret:true, help:"订阅地址的最后一段。泄露了就点「生成」换一个。"},
  {k:"TRAFFIC_LIMIT_GB", label:"每月流量上限（GB，0=不限）", def:"750", re:"^\\d+$"},
  {k:"TRAFFIC_RESET_DAY", label:"每月流量重置日（1–28）", def:"11", re:"^([1-9]|1\\d|2[0-8])$"},
  {k:"NAME_AUTO", label:"节点名：自动分流", def:"DMIT-AUTO", help:"按住宅名单分流（日常用这个）。"},
  {k:"NAME_VPS", label:"节点名：全走 VPS", def:"DMIT-VPS"},
  {k:"NAME_RES", label:"节点名：全走住宅", def:"DMIT-RES"},
  {k:"NAME_BACKUP", label:"节点名：备用（WebSocket）", def:"DMIT-BACKUP"},
 ]},
 {sec:"Reality 主节点", items:[
  {k:"REALITY_PORT", label:"Reality 端口", def:"443", re:"^\\d{2,5}$", port:true},
  {k:"REALITY_MODE", label:"伪装模式", def:"external", opts:["external"], help:"external = 伪装成扫描到的外部网站 + 本机过滤（DMIT 整改方案）。"},
  {k:"REALITY_TARGET", label:"伪装目标网站", def:"xyfu.me", help:"失效时在面板里重新扫描一个，只改这里。只填域名，不要 https:// 和端口。", re:"^([A-Za-z0-9-]+\\.)+[A-Za-z]{2,}$"},
  {k:"REALITY_FILTER_PORT", label:"过滤入口端口（本机）", def:"4431", re:"^\\d{2,5}$", port:true, help:"DMIT 防滥用整改用，只监听本机。"},
  {k:"REALITY_PRIVATE_KEY", label:"Reality 私钥", def:"", gen:"x25519", secret:true, help:"点「生成」会同时生成私钥和公钥。沿用旧的，客户端只需刷新订阅。"},
  {k:"REALITY_PUBLIC_KEY", label:"Reality 公钥", def:"", help:"和私钥成对，不要单独改。"},
  {k:"REALITY_SHORT_IDS", label:"Short ID（多个用英文逗号分隔）", def:"", gen:"shortids", secret:true, re:"^$|^[0-9a-f]{0,16}(,[0-9a-f]{0,16})*$"},
  {k:"REALITY_FINGERPRINT", label:"客户端指纹", def:"chrome", opts:["chrome","safari","firefox","ios","edge","random"]},
  {k:"REALITY_MIN_CLIENT_VER", label:"最小客户端版本", def:"", help:"默认留空：Xray v26.6.27 留空就能正常用（这也是固定这个版本的原因）。只有以后换成 v26.9 及以后的内核、客户端被拒绝连接时，才填 1.8.2。"},
 ]},
 {sec:"备用节点（VLESS + WebSocket + TLS）", items:[
  {k:"BACKUP_PORT", label:"备用节点端口", def:"13266", re:"^\\d{2,5}$", port:true},
  {k:"BACKUP_WS_PATH", label:"WebSocket 路径", def:"", gen:"wspath", help:"以 / 开头，点「生成」。"},
 ]},
 {sec:"住宅 IP（SOCKS5）", paste:true, items:[
  {k:"RES_ENABLE", label:"启用住宅出口", def:"yes", opts:["yes","no"]},
  {k:"RES_HOST", label:"住宅 IP / 地址", def:"", secret:true},
  {k:"RES_PORT", label:"住宅端口", def:"", re:"^$|^\\d{2,5}$"},
  {k:"RES_USER", label:"住宅用户名", def:"", secret:true},
  {k:"RES_PASS", label:"住宅密码", def:"", secret:true},
 ]},
 {sec:"分流名单（追加，可选）", items:[
  {k:"EXTRA_RES_DOMAINS", label:"追加：走住宅的域名", def:"", area:true, help:"每行一个，例如 example.com。会同时加到 VPS 住宅名单和两端客户端的代理规则。"},
  {k:"EXTRA_DIRECT_DOMAINS", label:"追加：直连的域名（如新银行）", def:"", area:true, help:"每行一个。会同时加到两端客户端的直连规则。"},
 ]},
 {sec:"其他", items:[
  {k:"XRAY_ACCESS_LOG", label:"服务器访问日志", def:"none", opts:["none","on"], help:"none = 不记录你访问过的网站（推荐）；on = 记录，排查问题时临时打开。"},
 ]},
];
if (typeof module!=="undefined") module.exports={SCHEMA};
