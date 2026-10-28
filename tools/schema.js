// 字段定义：网页工具与 .env 共用（单一来源）
const SCHEMA = [
 {sec:"基本信息", items:[
  {k:"PROFILE_NAME", label:"这套配置的名字", def:"DMIT-LA", help:"随便起，方便区分多台机器，例如 DMIT-LA。只用字母、数字、横线。", re:"^[A-Za-z0-9-]+$"},
 ]},
 {sec:"服务器登录（SSH）", items:[
  {k:"SSH_LOGIN", label:"登录方式", def:"password", opts:["password","key"], help:"password = 保持服务商给的 root + 密码登录（简单，适合新手）。key = 只允许密钥登录、关闭密码登录（更安全，别人猜不到密码；需要先在 Termius 或电脑上生成一对密钥，见《部署攻略》）。"},
  {k:"SSH_PUBKEY", label:"SSH 公钥（选 key 时填）", def:"", ph:"ssh-ed25519 AAAA…（公钥，不是私钥）", help:"只填「公钥」那一行（以 ssh-ed25519 或 ssh-rsa 开头）。私钥留在你自己的设备上，任何时候都不要贴到这里或发给别人。服务器上已经有公钥的可以留空。", re:"^$|^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\\.com|sk-ecdsa-sha2-nistp256@openssh\\.com) [A-Za-z0-9+/]+={0,3}( [^\\n]*)?$"},
 ]},
 {sec:"版本（默认就是验证过的稳定组合，不懂就别改）", items:[
  {k:"XUI_VERSION", label:"3x-ui 面板版本", def:"v3.10.2", help:"固定版本。升级前必须先在测试机上验证。", re:"^v\\d+\\.\\d+\\.\\d+$"},
  {k:"XRAY_VERSION", label:"Xray 内核版本", def:"v26.6.27", help:"不要升到 v26.9 及以后：小火箭默认指纹会连不上。", re:"^v\\d+\\.\\d+\\.\\d+$"},
 ]},
 {sec:"域名与 Cloudflare", items:[
  {k:"DOMAIN", label:"你的完整域名（含子域名）", def:"", ph:"例：node.example.xyz", help:"面板、订阅、备用节点都用它。在 Cloudflare 里必须是灰云（仅 DNS）。", re:"^([A-Za-z0-9-]+\\.)+[A-Za-z]{2,}$", req:true},
  {k:"CF_API_TOKEN", label:"Cloudflare API 令牌（可选）", def:"", secret:true, help:"填了：安装时自动把域名指向这台 VPS（换 IP 不用去 Cloudflare 手动改），域名证书改用 DNS 验证。留空：部署前自己在 Cloudflare 加或改一条 A 记录。服务器上不保存它，所以导出的 .env 里这一格是空的。"},
  {k:"ACME_EMAIL", label:"证书账户邮箱（可选）", def:"", ph:"例：you@example.com", help:"只用来在 Let's Encrypt 登记账户，留空也行（脚本自动续期）。Let's Encrypt 从 2025 年 6 月起已不再发到期提醒邮件。", re:"^$|^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"},
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
  {k:"REALITY_MODE", label:"伪装模式", def:"self", opts:["self","external"], help:"self（推荐，默认）= 偷自己：安装脚本自动申请 Let's Encrypt 的 IP 证书（约 6 天有效，开机自启、每 6 小时自动检查续期），在本机放一个正常的 HTTPS 网页做伪装。不依赖外部网站，也不会把别人的连接转发出去（DMIT 防滥用问题的根源不存在）。需要 VPS 的 80 端口能从外网访问（DMIT 默认就是通的）。external = 伪装成附近的外部网站 + 本机过滤（旧方案）。两种可以随时切换：改这一格后重跑安装，客户端刷新一次订阅。"},
  {k:"REALITY_TARGET", label:"伪装目标网站（external 模式用）", def:"", ph:"留空 = 安装时自动挑选", help:"只有选 external 时才用，self 模式不用管。建议留空：安装脚本会扫描 VPS 附近（同一网段）的网站，自动挑一个延迟低、支持 TLS 1.3 和 HTTP/2、证书正规的。以后失效了：把这一格清空重新运行安装即可。也可以手动填，只填域名，不要 https:// 和端口。", re:"^$|^([A-Za-z0-9-]+\\.)+[A-Za-z]{2,}$"},
  {k:"REALITY_FILTER_PORT", label:"过滤入口端口（本机，external 模式用）", def:"4431", re:"^\\d{2,5}$", port:true, help:"DMIT 防滥用整改用，只监听本机。"},
  {k:"SELF_SITE_PORT", label:"本机伪装网页端口（本机，self 模式用）", def:"4432", re:"^\\d{2,5}$", port:true, help:"偷自己时 Reality 把探测流量交给本机这个端口上的网页，只监听本机，外面访问不到。一般不用改。"},
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
  {k:"BACKUP_DAYS", label:"每日自动备份保留天数（0=关闭）", def:"7", re:"^\\d{1,3}$", help:"每天凌晨在服务器本机备份一次面板数据库、证书和 .env，保留最近 N 天，放在 /var/backups/vps-template/（只有 root 能读）。防的是面板里误操作、升级出错；VPS 整台没了它也没了，所以 .env 还是要自己保管好。"},
 ]},
];
if (typeof module!=="undefined") module.exports={SCHEMA};
