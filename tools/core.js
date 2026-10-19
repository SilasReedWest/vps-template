// .env 读写、智能粘贴、随机生成（浏览器与 Node 通用）
const CORE = (() => {
  const enc = s => String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
  const dec = s => s.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");

  function parseEnv(text) {
    const out = {};
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if (v.startsWith('"')) { const e = v.match(/^"((?:[^"\\]|\\.)*)"/); v = e ? dec(e[1]) : v.slice(1); }
      else if (v.startsWith("'")) { const e = v.match(/^'([^']*)'/); v = e ? e[1] : v.slice(1); }
      else v = v.replace(/\s+#.*$/, "");
      out[m[1]] = v;
    }
    return out;
  }

  function buildEnv(schema, values) {
    const L = ["# ==========================================================",
      "# 个人配置文件（.env）—— 由网页工具生成",
      "# 包含密码和密钥：不要上传 GitHub、不要截图、不要发到聊天里。",
      "# 修改方法：用网页工具「打开旧文件」→ 改 → 重新导出。",
      "# 生成时间：" + new Date().toISOString().slice(0, 16).replace("T", " "),
      "# =========================================================="];
    for (const s of schema) {
      L.push("", "# ---- " + s.sec + " ----");
      for (const f of s.items) {
        if (f.help) L.push("# " + f.label + "：" + f.help); else L.push("# " + f.label);
        L.push(f.k + '="' + enc(values[f.k] ?? f.def ?? "") + '"');
      }
    }
    return L.join("\n") + "\n";
  }

  // 智能粘贴：识别住宅代理信息
  const isHost = s => /^(\d{1,3}\.){3}\d{1,3}$/.test(s) || /^([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/.test(s);
  const isPort = s => /^\d{2,5}$/.test(s) && +s > 0 && +s < 65536;
  function parseProxy(text) {
    const t = String(text).trim();
    const r = {};
    // 1) URL：socks5://user:pass@host:port
    let m = t.match(/(?:socks5h?|socks|http|https):\/\/(?:([^:@\s\/]+):([^@\s\/]+)@)?([^:\s\/@]+):(\d{2,5})/i);
    if (m) return clean({ RES_USER: m[1] && decodeURIComponent(m[1]), RES_PASS: m[2] && decodeURIComponent(m[2]), RES_HOST: m[3], RES_PORT: m[4] });
    // 2) user:pass@host:port
    m = t.match(/^([^:@\s]+):([^@\s]+)@([^:\s@]+):(\d{2,5})$/);
    if (m) return clean({ RES_USER: m[1], RES_PASS: m[2], RES_HOST: m[3], RES_PORT: m[4] });
    // 3) host:port@user:pass
    m = t.match(/^([^:@\s]+):(\d{2,5})@([^:\s]+):(\S+)$/);
    if (m && isHost(m[1])) return clean({ RES_HOST: m[1], RES_PORT: m[2], RES_USER: m[3], RES_PASS: m[4] });
    // 4) 冒号分隔四段：host:port:user:pass 或 user:pass:host:port
    const p = t.split(/[:|\s]+/).filter(Boolean);
    if (p.length === 4) {
      if (isHost(p[0]) && isPort(p[1])) return clean({ RES_HOST: p[0], RES_PORT: p[1], RES_USER: p[2], RES_PASS: p[3] });
      if (isHost(p[2]) && isPort(p[3])) return clean({ RES_USER: p[0], RES_PASS: p[1], RES_HOST: p[2], RES_PORT: p[3] });
    }
    // 5) 带标签的多行文字
    const lab = [
      ["RES_HOST", /(?:^|\n|\s)(?:proxy\s*)?(?:ip(?:\s*address)?|host(?:name)?|server|address|地址|主机|服务器|代理\s*ip|ip\s*地址)\s*[:：=]\s*([^\s,，;；]+)/i],
      ["RES_PORT", /(?:^|\n|\s)(?:port|端口)[^:：=\n]*[:：=]\s*(\d{2,5})/i],
      ["RES_USER", /(?:^|\n|\s)(?:user(?:name)?|login|账号|帐号|用户名|用户)\s*[:：=]\s*([^\s,，;；]+)/i],
      ["RES_PASS", /(?:^|\n|\s)(?:pass(?:word)?|pwd|密码)\s*[:：=]\s*([^\s,，;；]+)/i],
    ];
    for (const [k, re] of lab) { const x = ("\n" + t).match(re); if (x) r[k] = x[1]; }
    if (r.RES_HOST && /:\d{2,5}$/.test(r.RES_HOST) && !r.RES_PORT) { const [h, po] = r.RES_HOST.split(":"); r.RES_HOST = h; r.RES_PORT = po; }
    // 6) 兜底：只有 host:port
    if (!r.RES_HOST) { m = t.match(/((?:\d{1,3}\.){3}\d{1,3}):(\d{2,5})/); if (m) { r.RES_HOST = m[1]; r.RES_PORT = r.RES_PORT || m[2]; } }
    return clean(r);
  }
  const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v));

  // 随机生成
  const cr = () => (typeof crypto !== "undefined" ? crypto : require("crypto").webcrypto);
  const rand = (n, chars) => { const a = new Uint8Array(n); cr().getRandomValues(a); return [...a].map(x => chars[x % chars.length]).join(""); };
  const AZ = "abcdefghijklmnopqrstuvwxyz", AZ9 = AZ + "0123456789", ALL = AZ9 + "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const hex = n => rand(n, "0123456789abcdef");
  const b64url = u8 => { let s = ""; u8.forEach(b => s += String.fromCharCode(b)); return (typeof btoa !== "undefined" ? btoa(s) : Buffer.from(s, "binary").toString("base64")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  async function x25519() {
    const kp = await cr().subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    const pub = new Uint8Array(await cr().subtle.exportKey("raw", kp.publicKey));
    const pk8 = new Uint8Array(await cr().subtle.exportKey("pkcs8", kp.privateKey));
    return { priv: b64url(pk8.slice(-32)), pub: b64url(pub) };
  }
  const gen = {
    uuid: () => cr().randomUUID(),
    pass: () => rand(20, ALL),
    user: () => "u" + rand(9, AZ9),
    path: () => rand(18, ALL),
    wspath: () => "/" + rand(14, AZ9),
    subid: () => rand(16, AZ9),
    shortids: () => [hex(8), hex(16), hex(4), hex(12)].join(","),
  };
  return { parseEnv, buildEnv, parseProxy, gen, x25519 };
})();
if (typeof module !== "undefined") module.exports = CORE;
