// 客户端：订阅地址 + 用模板生成 Clash 覆写 / 小火箭配置（追加名单）
const CLIENT = (() => {
  const slash = p => { p = String(p || "").replace(/^\/+|\/+$/g, ""); return p ? "/" + p + "/" : "/"; };
  const subUrl = v => v.DOMAIN && v.SUB_ID ? `https://${v.DOMAIN}${String(v.SUB_PORT) === "443" ? "" : ":" + v.SUB_PORT}${slash(v.SUB_PATH)}${v.SUB_ID}` : "";
  // 与 VPS 端 apply.py 同口径：domain:/full:/keyword:/geosite: 前缀，或直接写域名
  function parse(s) {
    const out = [], bad = [];
    for (let d of String(s || "").replace(/\\n/g, "\n").split(/[\s,，]+/)) {
      d = d.trim().toLowerCase(); const ipRaw = d.startsWith("ip:") ? d.slice(3) : null; d = d.replace(/^https?:\/\//, "").split("/")[0];
      if (!d) continue;
      let [t, x] = d.includes(":") ? d.split(/:(.*)/) : ["domain", d];
      x = (x || "").replace(/^[*+]?\./, "");
      if (t === "ip") { x = ipRaw; d = "ip:" + ipRaw; }
      const ok = t === "ip" ? /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(x) : t === "geosite" ? /^[a-z0-9@!_-]+$/.test(x) : /^([a-z0-9-]+\.)*[a-z0-9-]+$/.test(x) && (t === "keyword" || x.includes("."));
      if (!ok || !["domain", "full", "keyword", "geosite", "ip"].includes(t)) { bad.push(d); continue; }
      out.push([t, x]);
    }
    return { out, bad };
  }
  const RT = { domain: "DOMAIN-SUFFIX", full: "DOMAIN", keyword: "DOMAIN-KEYWORD" };
  function lines(list, pol, clash) {
    const r = [];
    for (const [t, x] of list) {
      if (t === "geosite") { if (clash) r.push(`GEOSITE,${x},${pol}`); else r.push(`# 小火箭不支持 geosite:${x}，请改写成具体域名`); }
      else if (t === "ip") r.push(`IP-CIDR,${x.includes("/") ? x : x + "/32"},${pol},no-resolve`);
      else r.push(`${RT[t]},${x},${pol}`);
    }
    return r;
  }
  function fill(tpl, v, clash) {
    const ind = clash ? "  " : "", dash = clash ? "- " : "";
    const blk = (key, list, pol, title) => {
      const L = lines(list, pol, clash);
      return L.length ? [`# ${title}（来自 .env，共 ${list.length} 项）`, ...L].map(l => ind + (l.startsWith("#") ? l : dash + l)).join("\n") + "\n" + (clash || key === "d" ? "" : "\n") : "";
    };
    const d = parse(v.EXTRA_DIRECT_DOMAINS).out, p = parse(v.EXTRA_RES_DOMAINS).out;
    return tpl.replace(new RegExp(`^${ind}# @@EXTRA_DIRECT@@\\n`, "m"), blk("d", d, "DIRECT", "追加直连"))
              .replace(new RegExp(`^${ind}# @@EXTRA_PROXY@@\\n`, "m"), blk("p", p, "PROXY", "追加住宅（客户端走代理，VPS 端走住宅）"));
  }
  const clash = (tpl, v) => fill(tpl, v, true), rocket = (tpl, v) => fill(tpl, v, false);
  return { subUrl, parse, clash, rocket };
})();
if (typeof module !== "undefined") module.exports = CLIENT;

// v2rayN（Windows，Xray 内核）：把填好的 Clash 规则逐条翻译成 v2rayN「路由规则集」JSON，顺序不变（先匹配先生效）
// 不支持的：PROCESS-NAME（按程序名，跳过）；IP-ASN 用整理好的 IP 段代替。
CLIENT.v2rayn = (clashText, wechatIps) => {
  const rules = []; let cur = null, sec = "", skipped = 0;
  const add = (out, kind, val) => {
    if (!cur || cur.outboundTag !== out || !cur[kind] || cur._sec !== sec) { cur = { remarks: sec || "规则", outboundTag: out, [kind]: [] }; cur._sec = sec; rules.push(cur); }
    cur[kind].push(val);
  };
  for (const raw of String(clashText).split("\n")) {
    const h = raw.match(/^\s*#\s*(\d+(?:\.\d+)?\.?\s+.+)$/); if (h) { sec = h[1].replace(/[：:（(].*$/, "").trim().slice(0, 40); continue; }
    const m = raw.match(/^\s*-\s*([A-Z-]+),([^,#]+?)(?:,([A-Z]+))?(?:,no-resolve)?\s*$/); if (!m) continue;
    const [, t, x, p] = m, out = (t === "MATCH" ? x : p) === "DIRECT" ? "direct" : (t === "MATCH" ? x : p) === "REJECT" ? "block" : "proxy";
    if (t === "DOMAIN-SUFFIX") add(out, "domain", "domain:" + x);
    else if (t === "DOMAIN") add(out, "domain", "full:" + x);
    else if (t === "DOMAIN-KEYWORD") add(out, "domain", x);
    else if (t === "GEOSITE") add(out, "domain", "geosite:" + x);
    else if (t === "GEOIP") add(out, "ip", "geoip:" + x.toLowerCase());
    else if (t === "IP-CIDR") add(out, "ip", x);
    else if (t === "IP-ASN" && x === "132203") { sec = "微信海外服务器（AS132203）"; for (const i of wechatIps || []) add(out, "ip", i); }
    else if (t === "MATCH") { rules.push({ remarks: "兜底：其余全部走代理", outboundTag: out, port: "0-65535" }); cur = null; }
    else skipped++;
  }
  rules.forEach(r => delete r._sec);
  return JSON.stringify(rules, null, 2) + "\n";
};
