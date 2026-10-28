<div align="center">

# 🧭 vps-template

**一份 `.env`，一条命令，部署好「Reality 主节点 + 备用节点 + 住宅 IP 智能分流」的 3x-ui 服务器，并生成配套的 Clash / 小火箭规则。**

不懂技术也能用：填表 → 导出 → 粘贴 → 完成。换 IP、换机器、重装系统，客户端都不用动。

[部署攻略](docs/部署攻略.md) · [日志排查](docs/日志排查.md) · [网页工具](tools/配置生成器.html) · [手动配置参考](docs/手动配置参考-住宅路由规则.md)

</div>

---

## ✨ 特点

| | |
|---|---|
| 🧩 **一份 .env 管一切** | 服务器、订阅、客户端规则都从同一份 .env 生成。个人信息只在 .env 里，仓库永远是空白模板 |
| 🖱️ **离线网页工具** | 双击打开就能用，不联网。每一格都有中文说明；住宅 IP 整串粘贴自动拆分；UUID、密钥、路径一键生成；能打开旧 .env 改一格再导出 |
| ⚡ **一条命令部署** | BBR / SSH 登录方式 / 每日备份 → 域名解析 → 证书（域名 + IP）→ 本机伪装网页 → 安装 3x-ui → 入站 / 用户 / 节点名 / 路由 / 住宅出口 → 自动验收（含住宅出口所在地）。可重复运行 |
| 🔐 **SSH 两种登录方式** | 默认保持 root + 密码；也可以只填公钥，脚本自动关闭密码登录（改错会自动撤销，不会把你锁在外面） |
| 💾 **每日自动备份** | 默认开启：每天备份面板数据库、证书和 .env，保留 7 份；旧服务器还能只读导出 .env |
| 🏠 **住宅 IP 智能分流** | 一个用户、四个节点：自动分流 / 全走 VPS / 全走住宅 / 备用。AI、社交、美国电商、流媒体走住宅，其余走 VPS |
| 🛡️ **Reality 偷自己（默认）** | 自动申请 Let's Encrypt **IP 证书**，在本机放一个正常的 HTTPS 网页做伪装：不依赖外部网站，也不会把别人的连接转发出去。证书约 6 天有效，开机自启、每 6 小时检查、自动续期。也可选旧方案「外部网站 + 本机过滤」 |
| 📱 **配套客户端规则** | Clash 覆写（Mac Clash Party / Windows Clash Verge Rev 通用）+ 小火箭配置 + v2rayN 路由（Windows），人在中国大陆使用：国内直连、金融支付强制直连、海外按需代理；订阅二维码离线生成 |
| 🔁 **换机不换客户端** | 客户端连的是域名，密钥都在 .env。换 IP / 换 VPS 只需重跑命令（填 Cloudflare 令牌还能自动改 DNS） |
| 📌 **版本固定** | 3x-ui v3.10.2 + Xray v26.6.27，全流程验证过；通过 3x-ui 官方 API 配置，不直接改数据库 |

## 🚀 快速开始

1. **准备**：一台 Ubuntu 24.04 / Debian 的 VPS、一个接入 Cloudflare 的域名（灰云）、（可选）一个静态住宅 SOCKS5。
2. **生成 .env**：下载并双击打开 [`tools/配置生成器.html`](tools/配置生成器.html) → 填好 → 「✨ 空白项一键生成」→「⬇️ 导出 .env」。
3. **部署**：SSH 登录 VPS（root），运行：

   ```bash
   bash <(curl -Ls https://raw.githubusercontent.com/SilasReedWest/vps-template/main/deploy/install.sh)
   ```

   按提示粘贴 .env 全部内容，**先按回车，再按 Ctrl+D**。

4. **客户端**：网页工具里打开 .env → 最下面「📱 客户端」：复制订阅地址 / 扫二维码，下载 Clash 覆写、小火箭配置或 v2rayN 路由导入。

详细步骤、失败对照表、换 IP 与断网应急，见 **[部署攻略](docs/部署攻略.md)**。部署完在手机、电脑上自检，以及长住大陆的定期检查，见 **[自检与出行清单](docs/自检与出行清单.md)**。

## 🗺️ 工作原理

```
客户端（Clash / 小火箭 / v2rayN）       VPS（3x-ui + Xray）
┌──────────────────────────┐          ┌────────────────────────────────────┐
│ 国内 / 金融支付  → 直连     │          │ 节点 AUTO：住宅名单 → 住宅 SOCKS5   │
│ 其余海外        → PROXY ───┼─Reality─▶│            其余     → VPS 直出      │
│ （只决定直连还是代理）       │   443    │ 节点 VPS ：全部 → VPS 直出          │
└──────────────────────────┘          │ 节点 RES ：全部 → 住宅              │
                                      │ 节点 BACKUP：WebSocket + TLS 备用    │
                                      └────────────────────────────────────┘
```

- 客户端只分「直连 / 代理」；走住宅还是走 VPS 由服务器决定，名单只维护一处。
- 四个节点是**同一个用户**，靠 3x-ui「主机」功能生成，订阅里自动出现。

## 📁 目录

| 路径 | 内容 |
|---|---|
| `tools/配置生成器.html` | 离线网页工具（单文件，由 `tools/build.py` 合并生成） |
| `deploy/install.sh` | VPS 一键部署入口 |
| `deploy/apply.py` | 读取 .env，通过 3x-ui API 写入全部配置 |
| `deploy/reality-scan.py` | external 模式用：扫描 VPS 附近支持 TLS 1.3 + HTTP/2 的网站，自动挑伪装目标 |
| `deploy/export-env.py` | 从已经配好的服务器**只读**导出 .env（面板密码要自己填） |
| `deploy/route-check.sh` | 分流检查：确认 AI / X / Reddit / TikTok 走住宅、Google / Saily 走 VPS（需临时打开访问日志） |
| `rules/vps-residential.txt` | 服务器端「走住宅」名单 |
| `rules/vps-direct.txt` | 服务器端「先送回 VPS」的例外名单 |
| `rules/client-clash.yaml` | Clash 覆写模板（Clash Party / Clash Verge Rev 通用；v2rayN 路由也由它自动转换） |
| `rules/client-shadowrocket.conf` | 小火箭配置模板 |
| `rules/wechat-as132203-v4.txt` | 微信 AS132203 的 IP 段（v2rayN 不支持 ASN 规则，用它代替） |
| `docs/部署攻略.md` | 从零到完成的图文攻略 |
| `docs/手动配置参考-住宅路由规则.md` | 不用脚本、手动在面板里配置时的对照表 |
| `docs/自检与出行清单.md` | 两个检测网页的预期结果、长住大陆的定期检查和断网应急顺序 |
| `docs/日志排查.md` | 三端日志怎么导出、怎么脱敏、怎么检查分流 |
| `docs/开发进度.md` | 当前版本、已验证项、待办（接手前先看） |

## ❓ 常见问题

<details><summary><b>.env 丢了怎么办？</b></summary>

服务器上 `/root/vps.env` 有一份（仅 root 可读）。用 Cyberduck 下载回来，再存一份到网盘或 U 盘。
</details>

<details><summary><b>可以给朋友用吗？</b></summary>

可以。仓库里没有任何个人信息，朋友用网页工具生成自己的 .env，运行同一条命令即可，彼此完全独立。想固定在某个版本就 Fork 一份，并把 `install.sh` 里的 `REPO` 改成自己的仓库。
</details>

<details><summary><b>不用住宅 IP 行不行？</b></summary>

行。网页工具里「启用住宅出口」选 `no`，所有流量走 VPS 直出，四个节点照常生成。
</details>

<details><summary><b>为什么不升级到最新版 Xray？</b></summary>

Xray v26.9 起服务端默认拒绝旧版客户端，小火箭可能连不上。需要升级时先在测试机验证，再改 .env 里的版本号重跑。
</details>

<details><summary><b>想加一个走住宅 / 直连的网站？</b></summary>

网页工具「分流名单（追加）」里每行填一个域名，导出 .env 后重跑命令、重新下载客户端规则即可。支持 `domain:` `full:` `keyword:` `geosite:` `ip:` 写法。
</details>

## ⚠️ 声明

本项目仅用于学习与个人网络管理。请遵守你所在地以及服务器所在地的法律法规，遵守 VPS 与住宅 IP 服务商的使用条款。作者不对任何使用后果负责。

---

<div align="center">

觉得有用的话，点个 ⭐ Star 支持一下 🙏

</div>
