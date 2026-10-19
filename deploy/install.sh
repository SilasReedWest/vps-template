#!/usr/bin/env bash
# ==========================================================
# VPS 一键部署（3x-ui + Reality + 住宅分流）
# 用法：  bash <(curl -Ls https://raw.githubusercontent.com/SilasReedWest/vps-template/main/deploy/install.sh)
#   可选：bash install.sh /root/my.env          直接指定 .env
#         bash install.sh --restore-db x-ui.db  用旧数据库恢复（第二条退路）
# 可以重复运行：已经装好的部分会跳过，配置会按 .env 更新。
# ==========================================================
set -euo pipefail
REPO="${VPS_TEMPLATE_REPO:-SilasReedWest/vps-template}"     # Fork 后可改成你自己的仓库（可选）
BRANCH="${VPS_TEMPLATE_BRANCH:-main}"
WORK=/opt/vps-template
ENV_FILE=/root/vps.env
RESULT=/root/vps-deploy-result.txt
XUI_BIN=/usr/local/x-ui/x-ui

red(){ echo -e "\033[31m$*\033[0m"; }
green(){ echo -e "\033[32m$*\033[0m"; }
step(){ echo; echo -e "\033[36m▶ $*\033[0m"; }
die(){ red "❌ $*"; exit 1; }

[[ $EUID -eq 0 ]] || die "请用 root 运行（先输入 sudo -i）"
grep -qiE 'ubuntu|debian' /etc/os-release || die "只支持 Ubuntu / Debian（推荐 Ubuntu 24.04）"

# ---------- 0. 用旧数据库恢复 ----------
if [[ "${1:-}" == "--restore-db" ]]; then
  [[ -f "${2:-}" ]] || die "找不到数据库文件：${2:-}"
  [[ -x $XUI_BIN ]] || die "请先完整运行一次本脚本装好面板，再恢复数据库"
  systemctl stop x-ui; cp -a /etc/x-ui/x-ui.db "/etc/x-ui/x-ui.db.bak.$(date +%s)" 2>/dev/null || true
  cp "$2" /etc/x-ui/x-ui.db; systemctl start x-ui
  green "✅ 已恢复数据库，原数据库已备份在 /etc/x-ui/"; exit 0
fi

# ---------- 1. 读取 .env ----------
step "1/8 读取你的 .env"
if [[ -n "${1:-}" && -f "$1" ]]; then cp "$1" "$ENV_FILE"
elif [[ -f "$ENV_FILE" ]] && read -rp "发现上次的 $ENV_FILE，直接使用？[Y/n] " a && [[ ! "$a" =~ ^[Nn] ]]; then :
else
  echo "请把 .env 文件的全部内容粘贴进来，粘贴完后：先按一次回车，再按 Ctrl+D"
  cat > "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

step "2/8 下载模板（$REPO@$BRANCH）"
apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl socat python3 cron openssl dnsutils >/dev/null
rm -rf "$WORK" && mkdir -p "$WORK"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar xz -C "$WORK" --strip-components=1 || die "下载仓库失败，检查仓库地址"
CHK=$(python3 "$WORK/deploy/apply.py" "$ENV_FILE" --check) || { echo "$CHK"; die ".env 有问题，请按上面的提示用网页工具修改后重新运行"; }
eval "$(echo "$CHK" | grep '^CFG_')"
green "✅ .env 检查通过"

GEN=""
gen(){ tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
[[ -n "$CFG_PANEL_USER" ]] || { CFG_PANEL_USER="u$(gen 9)"; GEN+="PANEL_USER=\"$CFG_PANEL_USER\"\n"; }
[[ -n "$CFG_PANEL_PASS" ]] || { CFG_PANEL_PASS="$(gen 20)"; GEN+="PANEL_PASS=\"$CFG_PANEL_PASS\"\n"; }
[[ -n "$CFG_PANEL_PATH" ]] || { CFG_PANEL_PATH="$(gen 18)"; GEN+="PANEL_PATH=\"$CFG_PANEL_PATH\"\n"; }
CFG_PANEL_PATH="${CFG_PANEL_PATH#/}"; CFG_PANEL_PATH="${CFG_PANEL_PATH%/}"

# ---------- 3. 系统优化 ----------
step "3/8 开启 BBR"
cat > /etc/sysctl.d/99-vps-template.conf <<'EOF'
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF
sysctl --system >/dev/null 2>&1 || true
green "✅ BBR：$(sysctl -n net.ipv4.tcp_congestion_control)"

# ---------- 4. 域名解析 ----------
step "4/8 检查域名 $CFG_DOMAIN"
IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org || curl -4 -fsS --max-time 10 https://ifconfig.me) || die "获取本机公网 IP 失败"
echo "   本机 IPv4：$IP"
if [[ -n "$CFG_CF_API_TOKEN" ]]; then
  CF(){ curl -fsS -H "Authorization: Bearer $CFG_CF_API_TOKEN" -H "Content-Type: application/json" "$@"; }
  ZONE_ID=""; d="$CFG_DOMAIN"
  while [[ "$d" == *.* && -z "$ZONE_ID" ]]; do
    ZONE_ID=$(CF "https://api.cloudflare.com/client/v4/zones?name=$d" | python3 -c 'import sys,json;r=json.load(sys.stdin)["result"];print(r[0]["id"] if r else "")') || die "Cloudflare 令牌无效或没有权限"
    d="${d#*.}"
  done
  [[ -n "$ZONE_ID" ]] || die "Cloudflare 里找不到 $CFG_DOMAIN 所在的域名，检查域名是否已添加到 Cloudflare"
  REC=$(CF "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=A&name=$CFG_DOMAIN" | python3 -c 'import sys,json;r=json.load(sys.stdin)["result"];print(r[0]["id"] if r else "")')
  BODY="{\"type\":\"A\",\"name\":\"$CFG_DOMAIN\",\"content\":\"$IP\",\"ttl\":60,\"proxied\":false}"
  if [[ -n "$REC" ]]; then CF -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$REC" --data "$BODY" >/dev/null
  else CF -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" --data "$BODY" >/dev/null; fi
  green "✅ Cloudflare：$CFG_DOMAIN → $IP（灰云）"
else
  for i in $(seq 1 30); do R=$(dig +short A "$CFG_DOMAIN" @1.1.1.1 | tail -1); [[ "$R" == "$IP" ]] && break; echo "   当前解析：${R:-无}，等待 DNS 生效（$i/30）…"; sleep 10; done
  [[ "$R" == "$IP" ]] || die "域名 $CFG_DOMAIN 没有指向本机 $IP。请在 Cloudflare 添加 A 记录（灰云）后重新运行"
  green "✅ 域名已指向本机"
fi

# ---------- 5. 证书 ----------
step "5/8 申请证书（Let's Encrypt）"
CERT_DIR=/root/cert/$CFG_DOMAIN; mkdir -p "$CERT_DIR"
[[ -x ~/.acme.sh/acme.sh ]] || curl -fsSL https://get.acme.sh | sh -s email="${CFG_ACME_EMAIL:-admin@$CFG_DOMAIN}" >/dev/null
ACME=~/.acme.sh/acme.sh; $ACME --set-default-ca --server letsencrypt >/dev/null
if [[ -s "$CERT_DIR/fullchain.pem" ]] && openssl x509 -checkend 2592000 -noout -in "$CERT_DIR/fullchain.pem" >/dev/null 2>&1; then
  green "✅ 已有有效证书，跳过申请"
else
  if [[ -n "$CFG_CF_API_TOKEN" ]]; then
    CF_Token="$CFG_CF_API_TOKEN" $ACME --issue --dns dns_cf -d "$CFG_DOMAIN" --keylength ec-256 --force || die "证书申请失败（DNS 验证）"
  else
    ss -ltn | grep -q ':80 ' && die "80 端口被占用，无法验证证书。填 Cloudflare 令牌可以不用 80 端口"
    $ACME --issue --standalone --httpport 80 -d "$CFG_DOMAIN" --keylength ec-256 --force || die "证书申请失败：确认 80 端口可从外网访问"
  fi
  $ACME --install-cert -d "$CFG_DOMAIN" --ecc --key-file "$CERT_DIR/privkey.pem" --fullchain-file "$CERT_DIR/fullchain.pem" \
        --reloadcmd "systemctl restart x-ui" >/dev/null
  chmod 600 "$CERT_DIR/privkey.pem"; green "✅ 证书已签发，会自动续期"
fi

# ---------- 6. 安装 3x-ui（固定版本） ----------
step "6/8 安装 3x-ui $CFG_XUI_VERSION"
CUR=$([[ -x $XUI_BIN ]] && $XUI_BIN -v 2>/dev/null | grep -oE 'v?[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
if [[ "${CUR#v}" == "${CFG_XUI_VERSION#v}" ]]; then
  green "✅ 已经是 $CFG_XUI_VERSION，跳过安装"
  $XUI_BIN setting -port "$CFG_PANEL_PORT" -username "$CFG_PANEL_USER" -password "$CFG_PANEL_PASS" -webBasePath "$CFG_PANEL_PATH" >/dev/null
else
  [[ -n "$CUR" ]] && echo "   当前版本 $CUR，将安装为 $CFG_XUI_VERSION（数据库保留）"
  XUI_NONINTERACTIVE=1 XUI_SSL_MODE=none XUI_DB_TYPE=sqlite XUI_PANEL_PORT="$CFG_PANEL_PORT" XUI_WEB_BASE_PATH="$CFG_PANEL_PATH" \
  XUI_USERNAME="$CFG_PANEL_USER" XUI_PASSWORD="$CFG_PANEL_PASS" \
    bash <(curl -fsSL "https://raw.githubusercontent.com/mhsanaei/3x-ui/$CFG_XUI_VERSION/install.sh") "$CFG_XUI_VERSION" </dev/null \
    || die "3x-ui 安装失败"
fi
$XUI_BIN setting -webCert "$CERT_DIR/fullchain.pem" -webCertKey "$CERT_DIR/privkey.pem" >/dev/null
systemctl restart x-ui; sleep 5
systemctl is-active --quiet x-ui || die "面板没有启动：journalctl -u x-ui -n 50"
green "✅ 面板运行中"

# ---------- 7. 按 .env 配置 ----------
step "7/8 按 .env 写入入站、用户、节点名、路由、住宅出口"
TOKEN=$($XUI_BIN setting -getApiToken -tokenName vps-template 2>/dev/null | sed -n 's/.*apiToken: *//p' | tail -1)
[[ -n "$TOKEN" ]] || die "获取面板 API 令牌失败"
XUI_API_TOKEN="$TOKEN" XUI_CERT="$CERT_DIR/fullchain.pem" XUI_KEY="$CERT_DIR/privkey.pem" XUI_RESULT=/root/.xui-apply.json \
  python3 "$WORK/deploy/apply.py" "$ENV_FILE"

# ---------- 8. 验收 ----------
step "8/8 验收"
eval "$(python3 - "$ENV_FILE" <<'PY'
import sys,shlex,importlib.util
s=importlib.util.spec_from_file_location("a","/opt/vps-template/deploy/apply.py");m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
c=m.load_cfg(sys.argv[1])
for k in ("REALITY_PORT","REALITY_TARGET","SUB_PORT"): print(f"V_{k}={shlex.quote(c[k])}")
PY
)" >/dev/null
t(){ echo | timeout 8 openssl s_client -connect "127.0.0.1:$V_REALITY_PORT" -servername "$1" 2>/dev/null | grep -q "subject="; }
if t "$V_REALITY_TARGET"; then green "✅ Reality 伪装正常（$V_REALITY_TARGET 返回证书）"; else red "⚠️ 伪装目标 $V_REALITY_TARGET 没有返回证书：可能已失效，需要在面板里重新扫描一个"; fi
if t www.cloudflare.com; then red "❌ 过滤没有生效：其他网站也能通过（DMIT 会警告），请检查"; else green "✅ 防滥用过滤正常（其他网站被拦截）"; fi

SUB=$(python3 -c 'import json;print(json.load(open("/root/.xui-apply.json"))["SUB_URL"])')
{
  echo "部署时间：$(date '+%F %T')"
  echo "面板地址：https://$CFG_DOMAIN:$CFG_PANEL_PORT/$CFG_PANEL_PATH/"
  echo "面板用户名：$CFG_PANEL_USER"
  echo "面板密码：$CFG_PANEL_PASS"
  echo "订阅地址：$SUB"
} > "$RESULT"; chmod 600 "$RESULT"
python3 - >> "$RESULT" <<'PY'
import json;f=json.load(open("/root/.xui-apply.json")).get("FILLED",{})
if f: print("自动生成、需要补回 .env 的项目："); [print(f'{k}="{v}"') for k,v in f.items()]
PY
[[ -n "$GEN" ]] && printf "%b" "$GEN" >> "$RESULT"
rm -f /root/.xui-apply.json
echo; green "================ 部署完成 ================"
cat "$RESULT"
echo
echo "以上内容也保存在 $RESULT（仅 root 可读）。"
grep -q '="' "$RESULT" && red "⚠️ 上面有自动生成的项目：用网页工具打开你的 .env，补进去后重新导出保存。"
echo "防火墙提醒：如果服务商后台有安全组，放行 TCP $CFG_PANEL_PORT、$V_REALITY_PORT、$V_SUB_PORT 和备用节点端口。"
