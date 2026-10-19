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
