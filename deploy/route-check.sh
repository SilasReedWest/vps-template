#!/bin/bash
# 分流检查：汇总 Xray 访问日志，确认 AI / X / Reddit / TikTok 走住宅、Google / Saily 等走 VPS。
# 用法：bash route-check.sh [小时数，默认 6] [平台名，可选]
#   例：bash route-check.sh 2 tiktok   → 额外列出最近 2 小时 TikTok 每个域名走了哪个出口
# 前提：临时打开访问日志（面板 → Xray 设置 → 日志 → 访问日志填 /var/log/x-ui/access.log，保存并重启 Xray）。
# 输出只有「平台 / 出口 / 次数」，不含你的 IP 和用户名。查完记得把访问日志改回 none 并删除日志文件。
HOURS="${1:-6}"; DETAIL="${2:-}"
CFG=/usr/local/x-ui/bin/config.json
[ -f "$CFG" ] || CFG=$(find / -path /proc -prune -o -name config.json -path '*x-ui*' -print 2>/dev/null | head -1)
ACC=$(python3 -c "import json;print(json.load(open('$CFG')).get('log',{}).get('access','none'))" 2>/dev/null)
echo "配置文件: $CFG"; echo "访问日志设置: ${ACC:-未设置}"
GS="$(dirname "$CFG")/geosite.dat"; [ -f "$GS" ] && echo "域名库 geosite.dat 日期: $(date -r "$GS" +%F)（太旧的话 x-ui 菜单里更新 geo 文件）"
if [ -z "$ACC" ] || [ "$ACC" = "none" ]; then echo ">>> 访问日志没开：面板 → Xray 设置 → 日志 → 访问日志填 /var/log/x-ui/access.log，保存并重启 Xray，用一会儿再运行"; exit 0; fi
LOG="$ACC"
if [ ! -f "$LOG" ]; then
  for d in /usr/local/x-ui /usr/local/x-ui/bin /etc/x-ui; do [ -f "$d/${ACC#./}" ] && LOG="$d/${ACC#./}" && break; done
fi
[ -f "$LOG" ] || { echo ">>> 找不到日志文件 $ACC（刚打开的话先用一会儿再运行）"; exit 0; }
echo "日志文件: $LOG"
python3 - "$LOG" "$HOURS" "$DETAIL" <<'PY'
import re,sys,collections,datetime
log,hours,detail=sys.argv[1],float(sys.argv[2]),sys.argv[3].lower()
since=datetime.datetime.now()-datetime.timedelta(hours=hours)
cats=[("TikTok",r"tiktok|ttwstatic|ttcdn-us|ttlivecdn|ttoverseaus|byteoversea|ibyteimg|ibytedtos|muscdn|musical\.ly|tik-tokapi|bytedapm|capcut|lemon8"),
("Saily/Nord",r"saily|nordcdn|nordsec|nordpayments|nordaccount|nordvpn|adyen"),
("X/Grok",r"(^|\.)(x\.com|twitter\.com|twimg\.com|t\.co|grok\.com|x\.ai)$|arkoselabs|funcaptcha"),
("Reddit",r"reddit|redd\.it"),
("Claude",r"claude|anthropic|^160\.79\.10[45]\."),
("ChatGPT",r"openai|chatgpt|oaistatic|oaiusercontent"),
("Google/YouTube",r"google|youtube|gstatic|ggpht|gvt[0-9]|ytimg"),
("Meta",r"facebook|fbcdn|instagram|whatsapp|meta\.ai"),
("Discord",r"discord")]
want_res={"X/Grok","Reddit","Claude","ChatGPT","TikTok"}; want_vps={"Google/YouTube","Saily/Nord"}
c=collections.Counter(); bad=collections.Counter(); hosts=collections.Counter(); first=last=None
pat=re.compile(r"^(\d{4}/\d\d/\d\d \d\d:\d\d:\d\d).*? accepted (?:tcp|udp):(.+):\d+ \[([^\]]+)\]")
for l in open(log,errors="ignore"):
    m=pat.search(l)
    if not m: continue
    t=datetime.datetime.strptime(m.group(1),"%Y/%m/%d %H:%M:%S")
    if t<since: continue
    host=m.group(2).lower(); out=re.split(r"\s*(?:>>|->)\s*",m.group(3))[-1].strip()
    first=first or t; last=t
    for name,rx in cats:
        if re.search(rx,host):
            c[(name,out)]+=1
            if detail and detail in name.lower(): hosts[(host,out)]+=1
            if (name in want_res and out!="residential-us") or (name in want_vps and out=="residential-us"): bad[(name,host,out)]+=1
            break
if not c: print("这段时间没有相关记录：用手机或电脑打开 X、Reddit、Claude、ChatGPT、TikTok、Google 用一会儿再运行"); sys.exit()
print(f"统计范围: {first} ~ {last}（VPS 本地时间）")
print("平台 | 出口 | 次数")
for (n,o),v in sorted(c.items()): print(f"{n} | {o} | {v}")
print("\n出口不符合预期的:" if bad else "\n全部符合预期 ✅（AI / X / Reddit / TikTok 走住宅，Google / Saily 走 VPS）")
for (n,h,o),v in bad.most_common(30): print(f"  {n} | {h} | {o} | {v}次")
if detail:
    print(f"\n「{detail}」每个域名的出口:" if hosts else f"\n这段时间没有「{detail}」的记录")
    for (h,o),v in sorted(hosts.items(),key=lambda x:(x[0][1],-x[1])): print(f"  {o} | {h} | {v}次")
PY
