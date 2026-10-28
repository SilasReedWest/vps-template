#!/usr/bin/env bash
# ==========================================================
# VPS 一键部署（3x-ui + Reality + 住宅分流）
# 用法：  bash <(curl -Ls https://raw.githubusercontent.com/SilasReedWest/vps-template/main/deploy/install.sh)
#   可选：bash install.sh /root/my.env          直接指定 .env
#         bash install.sh --restore-db x-ui.db  用旧数据库恢复（第二条退路）
#   每日备份在 /var/backups/vps-template/，解压后取 x-ui.db 用上面的 --restore-db 恢复
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
CFG_BACKUP_DAYS=$((10#${CFG_BACKUP_DAYS:-0}))
green "✅ .env 检查通过"

GEN=""
gen(){ tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
[[ -n "$CFG_PANEL_USER" ]] || { CFG_PANEL_USER="u$(gen 9)"; GEN+="PANEL_USER=\"$CFG_PANEL_USER\"\n"; }
[[ -n "$CFG_PANEL_PASS" ]] || { CFG_PANEL_PASS="$(gen 20)"; GEN+="PANEL_PASS=\"$CFG_PANEL_PASS\"\n"; }
[[ -n "$CFG_PANEL_PATH" ]] || { CFG_PANEL_PATH="$(gen 18)"; GEN+="PANEL_PATH=\"$CFG_PANEL_PATH\"\n"; }
CFG_PANEL_PATH="${CFG_PANEL_PATH#/}"; CFG_PANEL_PATH="${CFG_PANEL_PATH%/}"

IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org || curl -4 -fsS --max-time 10 https://ifconfig.me) || die "获取本机公网 IP 失败"
if [[ -z "$CFG_REALITY_TARGET" ]]; then
  echo "   伪装目标网站留空：扫描本机附近的网站，自动挑一个（约 1–3 分钟）…"
  CFG_REALITY_TARGET=$(python3 "$WORK/deploy/reality-scan.py" "$IP" | tail -1) && [[ -n "$CFG_REALITY_TARGET" ]] \
    || die "附近没有找到合适的伪装网站。请在 .env 的 REALITY_TARGET 手动填一个（见《部署攻略》），再重新运行"
  python3 - "$ENV_FILE" "$CFG_REALITY_TARGET" <<'PY'
import sys,re
p,v=sys.argv[1],sys.argv[2]; t=open(p,encoding="utf-8").read(); line=f'REALITY_TARGET="{v}"'
t,n=re.subn(r'(?m)^(export\s+)?REALITY_TARGET\s*=.*$',line,t)
if not n: t=t.rstrip("\n")+"\n"+line+"\n"
open(p,"w",encoding="utf-8").write(t)
PY
  GEN+="REALITY_TARGET=\"$CFG_REALITY_TARGET\"\n"
  green "✅ 伪装目标网站：$CFG_REALITY_TARGET（已写入 $ENV_FILE）"
fi

# ---------- 3. 系统设置 ----------
step "3/8 系统设置（BBR、SSH 登录方式、每日备份）"
cat > /etc/sysctl.d/99-vps-template.conf <<'EOF'
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF
sysctl --system >/dev/null 2>&1 || true
green "✅ BBR：$(sysctl -n net.ipv4.tcp_congestion_control)"

SSHD_DROP=/etc/ssh/sshd_config.d/01-vps-template.conf
ssh_reload(){ systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || systemctl restart sshd; }
SSH_KEY_WARN=""
if [[ "$CFG_SSH_LOGIN" == "key" ]]; then
  AK=/root/.ssh/authorized_keys; mkdir -p /root/.ssh; chmod 700 /root/.ssh; touch "$AK"; chmod 600 "$AK"
  if [[ -n "$CFG_SSH_PUBKEY" ]]; then
    printf '%s\n' "$CFG_SSH_PUBKEY" > /root/.ssh/.vps-template.pub
    ssh-keygen -l -f /root/.ssh/.vps-template.pub >/dev/null 2>&1 || { rm -f /root/.ssh/.vps-template.pub; die "SSH 公钥（SSH_PUBKEY）不是有效的公钥，请重新复制「公钥」那一行"; }
    rm -f /root/.ssh/.vps-template.pub
    KEYBODY=$(echo "$CFG_SSH_PUBKEY" | awk '{print $2}')
    grep -qF "$KEYBODY" "$AK" || printf '%s\n' "$CFG_SSH_PUBKEY" >> "$AK"
  fi
  ssh-keygen -l -f "$AK" >/dev/null 2>&1 || die "选了密钥登录，但服务器上没有任何公钥：请在 .env 的 SSH_PUBKEY 填上公钥（为防止把你锁在外面，没有关闭密码登录）"
  grep -qiE '^\s*Include\s+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config \
    || sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' /etc/ssh/sshd_config
  mkdir -p /etc/ssh/sshd_config.d
  cat > "$SSHD_DROP" <<'EOF'
# 由 vps-template 安装脚本写入：只允许密钥登录。想恢复密码登录：.env 里 SSH_LOGIN 改成 password 重新运行，或删掉本文件后 systemctl reload ssh
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
UseDNS no
EOF
  mkdir -p /run/sshd
  if ! sshd -t 2>/dev/null; then rm -f "$SSHD_DROP"; die "SSH 配置检查没通过，已撤销修改，登录方式保持不变"; fi
  T=$(sshd -T 2>/dev/null)
  if echo "$T" | grep -qx 'passwordauthentication no' && echo "$T" | grep -qx 'pubkeyauthentication yes'; then
    ssh_reload; SSH_KEY_WARN=1
    green "✅ SSH：只允许密钥登录（密码登录已关闭）"
    red "   ⚠️ 先不要关闭当前窗口！新开一个窗口用密钥登录一次，能登录再关。登不上就回到这个窗口运行：rm $SSHD_DROP && systemctl reload ssh"
  else
    rm -f "$SSHD_DROP"; die "有其他 SSH 配置覆盖了设置，已撤销修改，登录方式保持不变"
  fi
else
  if [[ -f "$SSHD_DROP" ]]; then rm -f "$SSHD_DROP"; sshd -t 2>/dev/null && ssh_reload; green "✅ SSH：已恢复为服务商默认的登录方式"
  else green "✅ SSH：保持服务商默认的登录方式（root + 密码）"; fi
fi

if [[ "${CFG_BACKUP_DAYS:-0}" -gt 0 ]]; then
  cat > /usr/local/sbin/vps-template-backup <<EOF
#!/bin/sh
# 由 vps-template 写入：备份面板数据库、证书和 .env，保留最近 $CFG_BACKUP_DAYS 份
set -eu
DIR=/var/backups/vps-template; KEEP=$CFG_BACKUP_DAYS
umask 077; mkdir -p "\$DIR"; chmod 700 "\$DIR"
T=\$(mktemp -d); trap 'rm -rf "\$T"' EXIT
python3 -c 'import sqlite3,sys;s=sqlite3.connect("/etc/x-ui/x-ui.db",timeout=30);d=sqlite3.connect(sys.argv[1]);s.backup(d);d.close();s.close()' "\$T/x-ui.db"
[ -f /root/vps.env ] && cp /root/vps.env "\$T/"
[ -d /root/cert ] && cp -a /root/cert "\$T/cert"
F="\$DIR/vps-\$(date +%F).tar.gz"; tar czf "\$F" -C "\$T" .; chmod 600 "\$F"
ls -1t "\$DIR"/vps-*.tar.gz | tail -n +\$((KEEP+1)) | xargs -r rm -f
EOF
  chmod 700 /usr/local/sbin/vps-template-backup
  echo "30 4 * * * root /usr/local/sbin/vps-template-backup >/dev/null 2>&1" > /etc/cron.d/vps-template-backup
  chmod 644 /etc/cron.d/vps-template-backup
  green "✅ 每日备份：每天服务器时间 04:30，保留 $CFG_BACKUP_DAYS 份（/var/backups/vps-template/）"
else
  rm -f /etc/cron.d/vps-template-backup; green "✅ 每日备份：已关闭"
fi

# ---------- 4. 域名解析 ----------
step "4/8 检查域名 $CFG_DOMAIN"
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
for k in ("REALITY_PORT","REALITY_TARGET","SUB_PORT","RES_ENABLE","RES_HOST","RES_PORT","RES_USER","RES_PASS"): print(f"V_{k}={shlex.quote(c[k])}")
PY
)" >/dev/null
t(){ echo | timeout 8 openssl s_client -connect "127.0.0.1:$V_REALITY_PORT" -servername "$1" 2>/dev/null | grep -q "subject="; }
if t "$V_REALITY_TARGET"; then green "✅ Reality 伪装正常（$V_REALITY_TARGET 返回证书）"; else red "⚠️ 伪装目标 $V_REALITY_TARGET 没有返回证书：可能已失效，需要在面板里重新扫描一个"; fi
if t www.cloudflare.com; then red "❌ 过滤没有生效：其他网站也能通过（DMIT 会警告），请检查"; else green "✅ 防滥用过滤正常（其他网站被拦截）"; fi
systemctl is-active --quiet x-ui && pgrep -f 'bin/xray' >/dev/null && green "✅ Xray 运行中" || red "❌ Xray 没有运行：在面板首页查看错误"
# 只显示国家 / 城市 / 运营商，不显示 IP
where(){ curl -fsS --max-time 15 "$@" https://ipinfo.io/json 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin);print(" / ".join(x for x in (d.get("country",""),d.get("city",""),d.get("org","")) if x))' 2>/dev/null; }
W=$(where -4) && [[ -n "$W" ]] && green "✅ VPS 出口：$W" || red "⚠️ VPS 出口查询失败（不影响使用）"
if [[ "$V_RES_ENABLE" == "yes" ]]; then
  q(){ local v="${1//\\/\\\\}"; printf '"%s"' "${v//\"/\\\"}"; }
  W=$(printf 'proxy = %s\nproxy-user = %s\n' "$(q "socks5h://$V_RES_HOST:$V_RES_PORT")" "$(q "$V_RES_USER:$V_RES_PASS")" | where -K -) && [[ -n "$W" ]] \
    && green "✅ 住宅出口：$W" || red "❌ 住宅出口连不上：检查 .env 里的住宅地址、端口、用户名、密码，或住宅服务是否到期"
fi

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
if [[ "${CFG_BACKUP_DAYS:-0}" -gt 0 ]]; then /usr/local/sbin/vps-template-backup && echo "已先做一次备份：$(ls -1t /var/backups/vps-template/vps-*.tar.gz | head -1)" || red "⚠️ 首次备份失败：运行 /usr/local/sbin/vps-template-backup 查看原因"; fi
echo "客户端导入订阅后，在手机和电脑上各打开一次（详见《自检与出行清单》）："
echo "   https://ip.net.coffee/claude/   Claude 出口应为住宅、信任分 ≥70、DNS 不在中国"
echo "   https://browserleaks.com/webrtc 公网 IP 应为 VPS 的 IP"
[[ -n "$SSH_KEY_WARN" ]] && red "⚠️ 已关闭密码登录：关闭本窗口前，先新开一个窗口确认能用密钥登录。"
echo "防火墙提醒：如果服务商后台有安全组，放行 TCP $CFG_PANEL_PORT、$V_REALITY_PORT、$V_SUB_PORT 和备用节点端口。"
