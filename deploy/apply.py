#!/usr/bin/env python3
"""读取 .env，通过 3x-ui 官方接口把服务器配置成模板状态。可重复运行（已存在的会更新）。
用法：python3 apply.py /root/my.env
"""
import shlex, json, os, re, ssl, sys, urllib.request, urllib.parse, uuid, secrets, string, subprocess, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

def die(msg): print("\n❌ " + msg); sys.exit(1)
def ok(msg): print("✅ " + msg)
def info(msg): print("   " + msg)

# ---------- .env ----------
def parse_env(text):
    out = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"): continue
        m = re.match(r'^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$', line)
        if not m: continue
        v = m.group(2).strip()
        if v.startswith('"'):
            e = re.match(r'^"((?:[^"\\]|\\.)*)"', v)
            v = e.group(1) if e else v[1:]
            v = v.replace('\\n', '\n').replace('\\"', '"').replace('\\\\', '\\')
        elif v.startswith("'"):
            e = re.match(r"^'([^']*)'", v); v = e.group(1) if e else v[1:]
        else:
            v = re.sub(r'\s+#.*$', '', v)
        out[m.group(1)] = v
    return out

def load_cfg(path):
    schema = json.load(open(os.path.join(HERE, "schema.json"), encoding="utf-8"))
    fields = [f for s in schema for f in s["items"]]
    raw = parse_env(open(path, encoding="utf-8").read())
    c = {f["k"]: (raw.get(f["k"], "") or "").strip() if f["k"] in raw else f.get("def", "") for f in fields}
    errs = []
    for f in fields:
        v = c[f["k"]]
        if f.get("req") and not v: errs.append(f'{f["label"]}（{f["k"]}）必填')
        elif f.get("re") and v and not re.search(f["re"].replace("\\\\", "\\"), v): errs.append(f'{f["label"]}（{f["k"]}）格式不对：{v if not f.get("secret") else "***"}')
    ports = [k for k in ("PANEL_PORT", "SUB_PORT", "REALITY_PORT", "REALITY_FILTER_PORT", "BACKUP_PORT")]
    seen = {}
    for k in ports:
        if c[k] in seen: errs.append(f"端口重复：{k} 和 {seen[c[k]]} 都是 {c[k]}")
        seen[c[k]] = k
    if c["RES_ENABLE"] == "yes":
        for k in ("RES_HOST", "RES_PORT", "RES_USER", "RES_PASS"):
            if not c[k]: errs.append(f"启用了住宅出口，但 {k} 为空")
    if bool(c["REALITY_PRIVATE_KEY"]) != bool(c["REALITY_PUBLIC_KEY"]): errs.append("Reality 私钥和公钥要成对填写，或都留空")
    if c["BACKUP_WS_PATH"] and not c["BACKUP_WS_PATH"].startswith("/"): errs.append("WebSocket 路径要以 / 开头")
    if errs: die(".env 检查没通过：\n   - " + "\n   - ".join(errs))
    return c

# ---------- 接口 ----------
class API:
    def __init__(self, base, token):
        self.base, self.token = base.rstrip("/"), token
        self.ctx = ssl.create_default_context(); self.ctx.check_hostname = False; self.ctx.verify_mode = ssl.CERT_NONE  # 只连本机 127.0.0.1
    def call(self, method, path, body=None, form=None, timeout=60, quiet=False):
        url = self.base + path
        data, hdr = None, {"Authorization": "Bearer " + self.token, "Accept": "application/json"}
        if form is not None: data = urllib.parse.urlencode(form).encode(); hdr["Content-Type"] = "application/x-www-form-urlencoded"
        elif body is not None: data = json.dumps(body).encode(); hdr["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=hdr, method=method)
        try:
            with urllib.request.urlopen(req, context=self.ctx, timeout=timeout) as r: txt = r.read().decode()
        except urllib.error.HTTPError as e: die(f"接口 {path} 返回 HTTP {e.code}：{e.read().decode()[:300]}")
        except Exception as e:
            if quiet: return None
            die(f"连不上面板接口 {path}：{e}")
        try: j = json.loads(txt)
        except Exception: die(f"接口 {path} 返回的不是 JSON：{txt[:200]}")
        if isinstance(j, dict) and j.get("success") is False: die(f"接口 {path} 失败：{j.get('msg')}")
        return j.get("obj") if isinstance(j, dict) else j
    get = lambda s, p: s.call("GET", p)
    post = lambda s, p, body=None, form=None, timeout=60: s.call("POST", p, body if body is not None or form is not None else {}, form, timeout)

# ---------- 名单 ----------
def read_list(name):
    p = os.path.join(REPO, "rules", name)
    return [l.strip() for l in open(p, encoding="utf-8") if l.strip() and not l.strip().startswith("#")]

def extra_domains(s):
    out = []
    for d in re.split(r'[\s,，]+', s.replace("\\n", "\n")):
        d = d.strip().lower().removeprefix("https://").removeprefix("http://").split("/")[0]
        if not d: continue
        t, _, x = d.partition(":") if ":" in d else ("domain", "", d)
        x = re.sub(r"^[*+]?\.", "", x)
        if x: out.append(t + ":" + x)
    return out

# ---------- 构建 ----------
def gen_missing(c):
    filled = {}
    def need(k, fn):
        if not c[k]: c[k] = fn(); filled[k] = c[k]
    a = string.ascii_letters + string.digits
    need("CLIENT_UUID", lambda: str(uuid.uuid4()))
    need("SUB_ID", lambda: "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(16)))
    need("SUB_PATH", lambda: "".join(secrets.choice(a) for _ in range(18)))
    need("BACKUP_WS_PATH", lambda: "/" + "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(14)))
    need("REALITY_SHORT_IDS", lambda: ",".join(secrets.token_hex(n) for n in (4, 8, 2, 6)))
    return filled

def slash(p): p = p.strip("/"); return "/" + p + "/" if p else "/"

def xray_template(c, default_tpl, filter_tag):
    t = json.loads(json.dumps(default_tpl))
    t["log"] = {"access": "./access.log" if c["XRAY_ACCESS_LOG"] == "on" else "none", "dnsLog": False, "error": "", "loglevel": "warning", "maskAddress": ""}
    outs = [
        {"tag": "direct", "protocol": "freedom",
         "settings": {"finalRules": [{"action": "block", "ip": ["geoip:private"]}, {"action": "allow"}]},
         "streamSettings": {"sockopt": {"domainStrategy": "ForceIPv4"}}},
        {"tag": "blocked", "protocol": "blackhole", "settings": {}},
    ]
    res = c["RES_ENABLE"] == "yes"
    if res:
        outs.append({"tag": "residential-us", "protocol": "socks", "settings": {"servers": [{
            "address": c["RES_HOST"], "port": int(c["RES_PORT"]), "users": [{"user": c["RES_USER"], "pass": c["RES_PASS"]}]}]}})
    t["outbounds"] = outs
    R = [{"type": "field", "inboundTag": ["api"], "outboundTag": "api"},
         {"type": "field", "inboundTag": [filter_tag], "domain": [c["REALITY_TARGET"]], "outboundTag": "direct"},
         {"type": "field", "inboundTag": [filter_tag], "outboundTag": "blocked"},
         {"type": "field", "ip": ["geoip:private"], "outboundTag": "blocked"},
         {"type": "field", "protocol": ["bittorrent"], "outboundTag": "blocked"},
         {"type": "field", "vlessRoute": "1", "outboundTag": "direct"}]
    if res: R.append({"type": "field", "vlessRoute": "2", "outboundTag": "residential-us"})
    R.append({"type": "field", "domain": read_list("vps-direct.txt"), "outboundTag": "direct"})
    if res:
        lst = read_list("vps-residential.txt") + extra_domains(c["EXTRA_RES_DOMAINS"])
        R.append({"type": "field", "domain": [x for x in lst if not x.startswith("ip:")], "outboundTag": "residential-us"})
        ips = [x[3:] for x in lst if x.startswith("ip:")]
        if ips: R.append({"type": "field", "ip": ips, "outboundTag": "residential-us"})
    t["routing"] = {"domainStrategy": "AsIs", "rules": R}
    t["geodata"] = {"assets": [
        {"url": "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat", "file": "geoip.dat"},
        {"url": "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat", "file": "geosite.dat"}],
        "cron": "0 4 * * *", "outbound": "direct"}
    return t

def inbound_payloads(c, cert, key):
    sniff_full = {"enabled": True, "destOverride": ["http", "tls", "quic", "fakedns"], "metadataOnly": False, "routeOnly": False}
    filt = {"enable": True, "remark": "reality-filter", "listen": "127.0.0.1", "port": int(c["REALITY_FILTER_PORT"]), "protocol": "tunnel",
            "expiryTime": 0, "total": 0,
            "settings": {"rewriteAddress": c["REALITY_TARGET"], "rewritePort": 443, "portMap": {}, "allowedNetwork": "tcp", "followRedirect": False},
            "streamSettings": {"security": "none"},
            "sniffing": {"enabled": True, "destOverride": ["tls"], "metadataOnly": False, "routeOnly": True}}
    main = {"enable": True, "remark": "reality-main", "listen": "", "port": int(c["REALITY_PORT"]), "protocol": "vless", "expiryTime": 0, "total": 0,
            "settings": {"clients": [], "decryption": "none", "encryption": "none", "fallbacks": []},
            "streamSettings": {"network": "tcp", "tcpSettings": {"acceptProxyProtocol": False, "header": {"type": "none"}}, "security": "reality",
                "realitySettings": {"show": False, "xver": 0, "target": "127.0.0.1:" + c["REALITY_FILTER_PORT"], "serverNames": [c["REALITY_TARGET"]],
                    "privateKey": c["REALITY_PRIVATE_KEY"], "minClientVer": c["REALITY_MIN_CLIENT_VER"], "maxClientVer": "", "maxTimediff": 0,
                    "shortIds": [s.strip() for s in c["REALITY_SHORT_IDS"].split(",")],
                    "settings": {"publicKey": c["REALITY_PUBLIC_KEY"], "fingerprint": c["REALITY_FINGERPRINT"], "serverName": "", "spiderX": "/"}}},
            "sniffing": sniff_full}
    back = {"enable": True, "remark": "vless-backup", "listen": "", "port": int(c["BACKUP_PORT"]), "protocol": "vless", "expiryTime": 0, "total": 0,
            "settings": {"clients": [], "decryption": "none", "encryption": "none", "fallbacks": []},
            "streamSettings": {"network": "ws", "wsSettings": {"acceptProxyProtocol": False, "path": c["BACKUP_WS_PATH"], "host": "", "headers": {}}, "security": "tls",
                "tlsSettings": {"serverName": c["DOMAIN"], "minVersion": "1.2", "maxVersion": "1.3", "cipherSuites": "", "rejectUnknownSni": False,
                    "certificates": [{"certificateFile": cert, "keyFile": key, "ocspStapling": 0, "oneTimeLoading": False, "usage": "encipherment", "buildChain": False}],
                    "alpn": ["h2", "http/1.1"], "settings": {"fingerprint": c["REALITY_FINGERPRINT"]}}},
            "sniffing": sniff_full}
    return filt, main, back

def main():
    if len(sys.argv) < 2: die("用法：python3 apply.py /root/你的配置.env")
    c = load_cfg(sys.argv[1]); ok(".env 检查通过")
    if "--check" in sys.argv:
        for k in ("DOMAIN", "PANEL_PORT", "PANEL_PATH", "PANEL_USER", "PANEL_PASS", "XUI_VERSION", "CF_API_TOKEN", "ACME_EMAIL"):
            print(f"CFG_{k}={shlex.quote(c[k])}")
        return
    base = os.environ.get("XUI_API_BASE") or f'https://127.0.0.1:{c["PANEL_PORT"]}{slash(c["PANEL_PATH"])}panel/api'
    token = os.environ.get("XUI_API_TOKEN") or die("缺少面板 API 令牌（安装脚本会自动获取）")
    cert = os.environ.get("XUI_CERT", f'/root/cert/{c["DOMAIN"]}/fullchain.pem'); key = os.environ.get("XUI_KEY", f'/root/cert/{c["DOMAIN"]}/privkey.pem')
    api = API(base, token)
    filled = gen_missing(c)
    if not c["REALITY_PRIVATE_KEY"]:
        kp = api.get("/server/getNewX25519Cert"); c["REALITY_PRIVATE_KEY"], c["REALITY_PUBLIC_KEY"] = kp["privateKey"], kp["publicKey"]
        filled["REALITY_PRIVATE_KEY"], filled["REALITY_PUBLIC_KEY"] = c["REALITY_PRIVATE_KEY"], c["REALITY_PUBLIC_KEY"]

    # 1. Xray 内核版本
    want = c["XRAY_VERSION"]
    cur = ((api.get("/server/status") or {}).get("xray") or {}).get("version", "")
    if cur.lstrip("v") != want.lstrip("v"):
        info(f"安装 Xray {want}（当前 {cur or '未知'}）…")
        api.post(f"/server/installXray/{want}", timeout=300)
        time.sleep(3)
        cur = ((api.get("/server/status") or {}).get("xray") or {}).get("version", "")
        if cur.lstrip("v") != want.lstrip("v"): die(f"Xray 内核安装后版本是 {cur}，不是 {want}")
    ok(f"Xray 内核：{want}")

    # 2. 订阅与证书设置
    s = api.post("/setting/all")
    s.update({"subEnable": True, "subPort": int(c["SUB_PORT"]), "subPath": slash(c["SUB_PATH"]), "subDomain": c["DOMAIN"],
              "subCertFile": cert, "subKeyFile": key, "webCertFile": cert, "webKeyFile": key, "subEncrypt": True, "remarkTemplate": "{{HOST}}",
              "subClashEnable": True, "subClashAutoDetect": True})
    if os.environ.get("XUI_SKIP_CERT"): s.update({"subCertFile": "", "subKeyFile": "", "webCertFile": "", "webKeyFile": ""})
    api.post("/setting/update", s)
    api.post("/setting/restartPanel")
    time.sleep(4)
    for _ in range(30):
        time.sleep(2)
        try:
            if api.call("GET", "/server/status", timeout=5, quiet=True) is not None: break
        except SystemExit: pass
    else: die("面板重启后 60 秒内没有恢复")
    ok("订阅设置：端口 %s，域名 %s（面板已重启）" % (c["SUB_PORT"], c["DOMAIN"]))

    # 3. 入站（按备注匹配：已存在就更新）
    filt, mainib, back = inbound_payloads(c, cert, key)
    existing = {ib["remark"]: ib for ib in (api.get("/inbounds/list") or [])}
    ids = {}
    for p in (filt, mainib, back):
        old = existing.get(p["remark"])
        if old:
            keep = json.loads(old["settings"]) if isinstance(old["settings"], str) else old["settings"]
            if p["protocol"] == "vless": p["settings"]["clients"] = keep.get("clients", [])
            api.post(f'/inbounds/update/{old["id"]}', p); ids[p["remark"]] = old["id"]; ok(f'更新入站 {p["remark"]}（端口 {p["port"]}）')
        else:
            r = api.post("/inbounds/add", p); ids[p["remark"]] = r["id"]; ok(f'新建入站 {p["remark"]}（端口 {p["port"]}）')
    tags = {ib["remark"]: ib["tag"] for ib in api.get("/inbounds/list")}

    # 4. 用户
    gb = int(c["TRAFFIC_LIMIT_GB"] or 0) * 1024 ** 3
    client = {"email": c["CLIENT_NAME"], "id": c["CLIENT_UUID"], "subId": c["SUB_ID"], "flow": "", "totalGB": gb, "expiryTime": 0,
              "limitIp": 0, "limitHwid": 0, "tgId": 0, "enable": True, "trafficReset": "monthly", "trafficResetDay": int(c["TRAFFIC_RESET_DAY"])}
    names = [x.get("email") for x in (api.get("/clients/list") or [])]
    targets = [ids["reality-main"], ids["vless-backup"]]
    if c["CLIENT_NAME"] in names:
        api.post(f'/clients/update/{urllib.parse.quote(c["CLIENT_NAME"])}', client)
        api.post(f'/clients/{urllib.parse.quote(c["CLIENT_NAME"])}/attach', {"inboundIds": targets}); ok(f'更新用户 {c["CLIENT_NAME"]}')
    else:
        api.post("/clients/add", {"client": client, "inboundIds": targets}); ok(f'新建用户 {c["CLIENT_NAME"]}')

    # 5. 节点名（主机）：先删本模板管理的，再重建
    for h in (api.get("/hosts/list") or []):
        if set(h.get("inboundIds") or []) & set(targets): api.post(f'/hosts/del/{h["groupId"]}')
    for name, ib, route in ((c["NAME_AUTO"], ids["reality-main"], ""), (c["NAME_VPS"], ids["reality-main"], "1"),
                            (c["NAME_RES"], ids["reality-main"], "2"), (c["NAME_BACKUP"], ids["vless-backup"], "")):
        if route == "2" and c["RES_ENABLE"] != "yes": continue
        api.post("/hosts/add", {"inboundIds": [ib], "remark": name, "hosts": [], "port": 0, "security": "same", "vlessRoute": route, "serverDescription": ""})
    ok("节点名：%s / %s / %s / %s" % (c["NAME_AUTO"], c["NAME_VPS"], c["NAME_RES"], c["NAME_BACKUP"]))

    # 6. Xray 模板（出站 + 路由）
    cur_tpl = api.post("/xray/")
    cur_tpl = json.loads(cur_tpl) if isinstance(cur_tpl, str) else cur_tpl
    tpl = xray_template(c, cur_tpl["xraySetting"], tags["reality-filter"])
    api.post("/xray/update", form={"xraySetting": json.dumps(tpl, ensure_ascii=False)})
    ok("路由规则 %d 条、出站 %d 个（直连 ForceIPv4%s）" % (len(tpl["routing"]["rules"]), len(tpl["outbounds"]), "，住宅已启用" if c["RES_ENABLE"] == "yes" else ""))

    # 7. 重启 Xray 并检查
    api.post("/server/restartXrayService")
    st = {}
    for _ in range(15):
        time.sleep(2)
        st = api.call("GET", "/server/status", timeout=5, quiet=True) or {}
        if (st.get("xray") or {}).get("state") == "running": break
    xs = (st.get("xray") or {}).get("state")
    if xs and xs != "running": die("Xray 没有正常运行：%s" % (st.get("xray") or {}).get("errorMsg"))
    ok("Xray 运行正常")

    sub = f'https://{c["DOMAIN"]}:{c["SUB_PORT"]}{slash(c["SUB_PATH"])}{c["SUB_ID"]}'
    out = {"SUB_URL": sub, "FILLED": filled}
    json.dump(out, open(os.environ.get("XUI_RESULT", "/root/xui-apply-result.json"), "w"), ensure_ascii=False, indent=1)
    if filled:
        print("\n⚠️  以下项目在 .env 里是空的，已自动生成。请用网页工具打开你的 .env，把它们补进去再导出保存，")
        print("   否则下次重装会生成新的，客户端就要重新导入：")
        for k, v in filled.items(): print(f'   {k}="{v}"')
    print("\n🎉 配置完成。订阅地址：" + sub)

if __name__ == "__main__":
    main()
