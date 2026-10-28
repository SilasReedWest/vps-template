#!/usr/bin/env python3
"""在本机附近（同一网段）找一个适合做 Reality 伪装目标的网站。只读扫描，不改任何配置。
用法：python3 reality-scan.py 本机IPv4        → 最后一行输出选中的域名；找不到时退出码为 1
挑选标准（和 XTLS 官方 RealiTLScanner 一致）：
  - 443 端口支持 TLS 1.3，并且协商出 HTTP/2；
  - 证书由正规机构签发、域名校验通过（不要自签名、不要通配符）；
  - 优先：域名本身就解析到这个邻居 IP（「IP 和域名对得上」），其次看握手延迟。
先扫同一个 /24；找不到再扩大到 /23、/22。只做一次 TLS 握手，不发任何请求内容。"""
import concurrent.futures as cf, ipaddress, os, re, socket, ssl, subprocess, sys, tempfile, time

TIMEOUT = 2.5
SKIP = re.compile(r"(^|\.)(localhost|local|lan|internal|invalid|test|example\.(com|net|org))$|^\d+\.\d+\.\d+\.\d+$")

def names_from_der(der):
    """从证书里取出域名（SAN 优先，没有就用 CN）。"""
    pem = ssl.DER_cert_to_PEM_cert(der)
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as f: f.write(pem); fn = f.name
        try: d = ssl._ssl._test_decode_cert(fn)          # 标准库自带的解析（CPython 私有接口）
        finally: os.unlink(fn)
        names = [v for k, v in d.get("subjectAltName", ()) if k == "DNS"]
        if not names:
            names = [v for rdn in d.get("subject", ()) for k, v in rdn if k == "commonName"]
        return names
    except Exception:
        try:
            out = subprocess.run(["openssl", "x509", "-noout", "-ext", "subjectAltName"], input=pem, capture_output=True, text=True, timeout=5).stdout
            return re.findall(r"DNS:([^,\s]+)", out)
        except Exception:
            return []

def probe_ip(ip):
    """不带 SNI 连邻居 IP，拿它默认返回的证书里的域名。"""
    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
        ctx.minimum_version = ssl.TLSVersion.TLSv1_3; ctx.set_alpn_protocols(["h2", "http/1.1"])
        with socket.create_connection((ip, 443), timeout=TIMEOUT) as s:
            with ctx.wrap_socket(s) as t:
                if t.selected_alpn_protocol() != "h2": return ip, []
                der = t.getpeercert(binary_form=True)
        good = []
        for n in names_from_der(der) if der else []:
            n = n.lower().strip(".")
            if n.startswith("*.") or SKIP.search(n) or n in good: continue
            good.append(n)
        return ip, good[:3]
    except Exception:
        return ip, []

def verify(domain, near_ip):
    """按正常客户端的方式校验这个域名：DNS → TLS 1.3 + h2 + 证书校验通过。返回 (分数, 延迟毫秒) 或 None。"""
    try:
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(domain, 443, socket.AF_INET, socket.SOCK_STREAM)})
    except Exception:
        return None
    if not addrs: return None
    ctx = ssl.create_default_context(); ctx.minimum_version = ssl.TLSVersion.TLSv1_3; ctx.set_alpn_protocols(["h2", "http/1.1"])
    best = None
    for _ in range(2):
        try:
            t0 = time.monotonic()
            with socket.create_connection((addrs[0], 443), timeout=TIMEOUT) as s:
                with ctx.wrap_socket(s, server_hostname=domain) as t:
                    if t.version() != "TLSv1.3" or t.selected_alpn_protocol() != "h2": return None
            ms = (time.monotonic() - t0) * 1000
            best = ms if best is None else min(best, ms)
        except Exception:
            return None
    same = near_ip in addrs
    return (0 if same else 1, round(best)), addrs[0]

def main():
    if len(sys.argv) < 2: print(__doc__); sys.exit(2)
    me = ipaddress.ip_address(sys.argv[1])
    done, found = set(), {}
    for prefix in (24, 23, 22):
        net = ipaddress.ip_network(f"{me}/{prefix}", strict=False)
        ips = [str(i) for i in net.hosts() if i != me and str(i) not in done]
        done.update(ips)
        print(f"   扫描 {net}（{len(ips)} 个地址）…", file=sys.stderr, flush=True)
        with cf.ThreadPoolExecutor(48) as ex:
            for ip, names in ex.map(probe_ip, ips):
                for n in names: found.setdefault(n, ip)
        if found: 
            cand = []
            with cf.ThreadPoolExecutor(16) as ex:
                for (n, ip), r in zip(found.items(), ex.map(lambda kv: verify(*kv), found.items())):
                    if r: cand.append((r[0], n, ip, r[1]))
            if cand:
                cand.sort()
                print("   候选（越靠前越好）：", file=sys.stderr)
                for (same, ms), n, ip, res in cand[:5]:
                    print(f"     {n:<40} 握手 {ms:>4} ms  {'域名就解析到这个邻居 IP' if not same else '域名解析到别处'}", file=sys.stderr)
                print(cand[0][1]); return
            found = {}
    print("   附近没有找到合适的网站", file=sys.stderr); sys.exit(1)

if __name__ == "__main__":
    main()
