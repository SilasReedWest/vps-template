#!/usr/bin/env python3
"""从一台已经配好的 3x-ui 服务器导出 .env（只读：不改面板、不重启任何服务）。
用法（在服务器上用 root 运行）：
  python3 export-env.py                       → 写到 /root/vps-export.env（只有 root 可读）
  python3 export-env.py /etc/x-ui/x-ui.db /root/out.env
导出后：
  - 面板密码数据库里只存了加密后的值，导不出来：用网页工具打开导出的文件，自己填上 PANEL_PASS；
  - Cloudflare 令牌（CF_API_TOKEN）不在服务器上，要用就自己填；
  - 「追加：直连的域名」只在客户端规则里，服务器上没有，需要的话自己补。
屏幕上只显示摘要，不显示密码和密钥。"""
import json, os, re, shutil, sqlite3, subprocess, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DB = sys.argv[1] if len(sys.argv) > 1 else "/etc/x-ui/x-ui.db"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/root/vps-export.env"
notes = []                      # 需要用户注意的地方

def die(m): print("❌ " + m); sys.exit(1)
def run(*cmd):
    try: return subprocess.run(cmd, capture_output=True, text=True, timeout=15).stdout
    except Exception: return ""
def J(s):
    try: return json.loads(s or "{}")
    except Exception: return {}

if not os.path.exists(DB): die(f"找不到面板数据库 {DB}")
con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True); con.row_factory = sqlite3.Row
q = lambda sql, *a: con.execute(sql, a).fetchall()
cols = lambda t: {r[1] for r in q(f"pragma table_info({t})")}
S = {r["key"]: r["value"] for r in q("select key, value from settings")}
schema = json.load(open(os.path.join(HERE, "schema.json"), encoding="utf-8"))
v = {f["k"]: f.get("def", "") for s in schema for f in s["items"]}
strip = lambda p: (p or "").strip("/")

# ---------- 面板、订阅 ----------
v["PANEL_PORT"] = S.get("webPort", v["PANEL_PORT"])
v["PANEL_PATH"] = strip(S.get("webBasePath"))
v["SUB_PORT"] = S.get("subPort", v["SUB_PORT"])
v["SUB_PATH"] = strip(S.get("subPath"))
u = q("select username from users order by id limit 1")
v["PANEL_USER"] = u[0]["username"] if u else ""
v["PANEL_PASS"] = ""; notes.append("面板密码导不出来（数据库里是加密的）：请自己填 PANEL_PASS")
v["CF_API_TOKEN"] = ""

# ---------- 入站 ----------
ibs = [dict(r) for r in q("select * from inbounds")]
for ib in ibs: ib["S"], ib["T"] = J(ib["settings"]), J(ib["stream_settings"])
main = next((i for i in ibs if i["protocol"] == "vless" and i["T"].get("security") == "reality"), None)
back = next((i for i in ibs if i["protocol"] == "vless" and i["T"].get("network") == "ws" and i["T"].get("security") == "tls"), None)
if not main: die("没找到 Reality 入站（vless + reality），这台服务器可能不是按本模板配置的")
rs = main["T"].get("realitySettings", {})
tgt = rs.get("target") or rs.get("dest") or ""
fport = tgt.rsplit(":", 1)[-1] if tgt.startswith("127.0.0.1:") else ""
filt = next((i for i in ibs if i["protocol"] in ("tunnel", "dokodemo-door") and str(i["port"]) == fport), None) if fport else None
v["REALITY_PORT"] = str(main["port"])
v["REALITY_PRIVATE_KEY"] = rs.get("privateKey", "")
v["REALITY_PUBLIC_KEY"] = (rs.get("settings") or {}).get("publicKey", "")
v["REALITY_SHORT_IDS"] = ",".join(rs.get("shortIds") or [])
v["REALITY_FINGERPRINT"] = (rs.get("settings") or {}).get("fingerprint") or v["REALITY_FINGERPRINT"]
v["REALITY_MIN_CLIENT_VER"] = rs.get("minClientVer", "") or ""
if filt:
    v["REALITY_FILTER_PORT"] = str(filt["port"])
    v["REALITY_TARGET"] = filt["S"].get("rewriteAddress") or (rs.get("serverNames") or [""])[0]
else:
    v["REALITY_TARGET"] = (rs.get("serverNames") or [""])[0]
    notes.append("没找到本机过滤入站（DMIT 防滥用整改）：重新安装时会按模板自动加上")
if back:
    v["BACKUP_PORT"] = str(back["port"])
    v["BACKUP_WS_PATH"] = (back["T"].get("wsSettings") or {}).get("path", "")
else: notes.append("没找到备用节点（vless + WebSocket + TLS）：重新安装时会按模板新建")

want = {"reality-main": main, "reality-filter": filt, "vless-backup": back}
odd = [f"{i['remark']}→{k}" for k, i in want.items() if i and i["remark"] != k]
if odd: notes.append("入站备注名和模板不同（" + "、".join(odd) + "）：用这份 .env 在【这台】服务器重跑安装前，先在面板里把备注改成模板的名字，否则会因端口冲突报错；在新服务器上用不受影响")

# ---------- 域名 ----------
dom = S.get("subDomain") or S.get("webDomain") or ""
if not dom and back: dom = (back["T"].get("tlsSettings") or {}).get("serverName", "")
if not dom:
    m = re.search(r"/cert/([^/]+)/", S.get("webCertFile", "") or S.get("subCertFile", ""))
    dom = m.group(1) if m else ""
v["DOMAIN"] = dom
if not dom: notes.append("没找到域名：请自己填 DOMAIN")

# ---------- 用户 ----------
cl = None
if "client_inbounds" in {r[0] for r in q("select name from sqlite_master where type='table'")}:
    rows = q("select c.* from clients c join client_inbounds ci on ci.client_id=c.id where ci.inbound_id=? order by c.id", main["id"])
    if rows: cl = dict(rows[0])
    if len(rows) > 1: notes.append(f"Reality 入站有 {len(rows)} 个用户，只导出了第一个（{rows[0]['email']}）")
if cl:
    v["CLIENT_NAME"], v["CLIENT_UUID"], v["SUB_ID"] = cl["email"], cl.get("uuid") or "", cl.get("sub_id") or ""
    v["TRAFFIC_LIMIT_GB"] = str(round((cl.get("total_gb") or 0) / 1024 ** 3))
    rd = cl.get("traffic_reset_day") or 0
else:                                           # 旧版：用户写在入站 settings 里
    c0 = (main["S"].get("clients") or [{}])[0]
    v["CLIENT_NAME"], v["CLIENT_UUID"], v["SUB_ID"] = c0.get("email", v["CLIENT_NAME"]), c0.get("id", ""), c0.get("subId", "")
    v["TRAFFIC_LIMIT_GB"] = str(round((c0.get("totalGB") or 0) / 1024 ** 3))
    rd = c0.get("trafficResetDay") or 0
if rd and 1 <= int(rd) <= 28: v["TRAFFIC_RESET_DAY"] = str(rd)
else: notes.append(f"没找到每月流量重置日：先用默认值 {v['TRAFFIC_RESET_DAY']}，请按服务商的账单日改")

# ---------- 节点名 ----------
if "hosts" in {r[0] for r in q("select name from sqlite_master where type='table'")}:
    for h in q("select inbound_id, remark, vless_route from hosts order by sort_order, id"):
        if h["inbound_id"] == main["id"]:
            k = {"": "NAME_AUTO", None: "NAME_AUTO", "1": "NAME_VPS", "2": "NAME_RES"}.get(h["vless_route"])
        elif back and h["inbound_id"] == back["id"]: k = "NAME_BACKUP"
        else: k = None
        if k and h["remark"]: v[k] = h["remark"]

# ---------- 住宅出口、名单、日志 ----------
tpl = J(S.get("xrayTemplateConfig"))
res = next((o for o in tpl.get("outbounds", []) if o.get("tag") == "residential-us"), None)
if res:
    sv = ((res.get("settings") or {}).get("servers") or [{}])[0]; us = (sv.get("users") or [{}])[0]
    v.update(RES_ENABLE="yes", RES_HOST=sv.get("address", ""), RES_PORT=str(sv.get("port", "")), RES_USER=us.get("user", ""), RES_PASS=us.get("pass", ""))
else:
    v["RES_ENABLE"] = "no"
rules = (tpl.get("routing") or {}).get("rules", [])
have = {l.strip() for l in open(os.path.join(REPO, "rules", "vps-residential.txt"), encoding="utf-8") if l.strip() and not l.startswith("#")}
cur = [d for r in rules if r.get("outboundTag") == "residential-us" for d in r.get("domain", [])] + \
      ["ip:" + i for r in rules if r.get("outboundTag") == "residential-us" for i in r.get("ip", [])]
extra = [x.removeprefix("domain:") for x in dict.fromkeys(cur) if x not in have]
v["EXTRA_RES_DOMAINS"] = "\n".join(extra)
if extra: notes.append(f"服务器住宅名单比模板多 {len(extra)} 项，已放进「追加：走住宅的域名」")
acc = (tpl.get("log") or {}).get("access", "none")
v["XRAY_ACCESS_LOG"] = "none" if acc in ("", "none") else "on"

# ---------- 版本 ----------
m = re.search(r"v?(\d+\.\d+\.\d+)", run("/usr/local/x-ui/x-ui", "-v"))
if m: v["XUI_VERSION"] = "v" + m.group(1)
else: notes.append(f"没读到面板版本，先用模板默认 {v['XUI_VERSION']}")
xb = sorted(glob.glob("/usr/local/x-ui/bin/xray-linux-*"))
m = re.search(r"Xray (\d+\.\d+\.\d+)", run(xb[0], "version")) if xb else None
if m: v["XRAY_VERSION"] = "v" + m.group(1)
else: notes.append(f"没读到 Xray 版本，先用模板默认 {v['XRAY_VERSION']}")

# ---------- SSH 登录方式 ----------
if shutil.which("sshd"):
    T = run("sshd", "-T")
    if re.search(r"(?m)^passwordauthentication no$", T):
        v["SSH_LOGIN"] = "key"
        try: v["SSH_PUBKEY"] = next(l.strip() for l in open("/root/.ssh/authorized_keys") if l.strip() and not l.startswith("#") and re.match(r"^(ssh-|ecdsa-|sk-)", l.strip()))
        except Exception: v["SSH_PUBKEY"] = ""
    elif T: v["SSH_LOGIN"] = "password"

# ---------- 写文件 ----------
enc = lambda s: str(s).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
import datetime
L = ["# ==========================================================",
     "# 个人配置文件（.env）—— 由 export-env.py 从现有服务器导出",
     "# 包含密码和密钥：不要上传 GitHub、不要截图、不要发到聊天里。",
     "# 还需要你自己填：PANEL_PASS（面板密码）；用 Cloudflare 自动解析的再填 CF_API_TOKEN。",
     "# 导出时间：" + datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
     "# =========================================================="]
for s in schema:
    L += ["", "# ---- " + s["sec"] + " ----"]
    for f in s["items"]:
        L.append("# " + f["label"] + ("：" + f["help"] if f.get("help") else ""))
        L.append(f'{f["k"]}="{enc(v.get(f["k"], ""))}"')
old = os.umask(0o077)
with open(OUT, "w", encoding="utf-8") as fh: fh.write("\n".join(L) + "\n")
os.umask(old); os.chmod(OUT, 0o600)

# ---------- 摘要（不显示密钥） ----------
hide = lambda s: "（有）" if s else "（空）"
print("✅ 已导出到 " + OUT + "（只有 root 可读）")
for k, show in [("DOMAIN", 1), ("PANEL_PORT", 1), ("PANEL_USER", 0), ("PANEL_PASS", 0), ("SUB_PORT", 1), ("REALITY_PORT", 1), ("REALITY_TARGET", 1),
                ("REALITY_FILTER_PORT", 1), ("REALITY_PRIVATE_KEY", 0), ("BACKUP_PORT", 1), ("CLIENT_NAME", 1), ("CLIENT_UUID", 0),
                ("TRAFFIC_LIMIT_GB", 1), ("TRAFFIC_RESET_DAY", 1), ("NAME_AUTO", 1), ("RES_ENABLE", 1), ("RES_HOST", 0),
                ("XUI_VERSION", 1), ("XRAY_VERSION", 1), ("SSH_LOGIN", 1), ("XRAY_ACCESS_LOG", 1)]:
    print(f"   {k:<22} {v.get(k) if show else hide(v.get(k))}")
for n in notes: print("⚠️ " + n)
print("下一步：把这个文件下载到自己设备上保管（用 Termius 的 SFTP，或 cat 后复制），用网页工具打开、补上面板密码后重新导出。")
