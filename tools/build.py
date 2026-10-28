#!/usr/bin/env python3
"""把 schema.js / core.js / qr.js / client.js / 规则模板 合并成单文件「配置生成器.html」，并导出 deploy/schema.json。
用法：python3 tools/build.py   （改了任何源文件后运行一次）"""
import json, pathlib, subprocess
T = pathlib.Path(__file__).resolve().parent; R = T.parent
rd = lambda p: (T / p).read_text(encoding="utf-8") if not str(p).startswith("/") else pathlib.Path(p).read_text(encoding="utf-8")
tpl = {"clash": (R / "rules/client-clash.yaml").read_text(encoding="utf-8"), "rocket": (R / "rules/client-shadowrocket.conf").read_text(encoding="utf-8"),
       "wechatIps": [l.strip() for l in (R / "rules/wechat-as132203-v4.txt").read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]}
html = rd("page.html")
for mark, body in {"/*SCHEMA*/": rd("schema.js"), "/*CORE*/": rd("core.js"), "/*QR*/": rd("qr.js"), "/*CLIENT*/": rd("client.js"),
                   "/*TPL*/": "const TPL = " + json.dumps(tpl, ensure_ascii=False).replace("</", "<\\/") + ";"}.items():
    assert mark in html, mark; html = html.replace(mark, body.replace("</script", "<\\/script"))
(T / "配置生成器.html").write_text(html, encoding="utf-8")
schema = subprocess.run(["node", "-e", f"process.stdout.write(JSON.stringify(require({json.dumps(str(T / 'schema.js'))}).SCHEMA,null,1))"], capture_output=True, text=True, check=True).stdout
(R / "deploy/schema.json").write_text(schema + "\n", encoding="utf-8")
print("✅ 已生成 tools/配置生成器.html 和 deploy/schema.json")
