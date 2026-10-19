import re,collections,os,glob,subprocess,sys
def find():
    if len(sys.argv)>1: return sys.argv[1]
    try:
        pid=subprocess.check_output(['pgrep','-f','xray-linux'],text=True).split()[0]
        p=os.path.join(os.readlink(f'/proc/{pid}/cwd'),'access.log')
        if os.path.exists(p): return p
    except Exception: pass
    for p in ['/usr/local/x-ui/bin/access.log','/usr/local/x-ui/access.log','/etc/x-ui/access.log','/var/log/x-ui/access.log','/root/access.log']+glob.glob('/usr/local/x-ui/**/access.log',recursive=True):
        if os.path.exists(p): return p
    r=subprocess.run("find / -xdev -name 'access.log' -size +1k 2>/dev/null | head -5",shell=True,capture_output=True,text=True).stdout.split()
    if r: return r[0]
    sys.exit('❌ 没找到 access.log：可能访问日志没有开启（面板 → Xray 配置 → 日志 → 访问日志）')
P=find(); print('读取：',P)
c=collections.Counter()
for l in open(P,errors='ignore'):
  m=re.search(r'accepted (?:tcp|udp):(\S+?):\d+ \[([^\]]+)\]',l)
  if not m: continue
  host,route=m.groups(); out=re.split(r'>>|->',route)[-1].strip()
  if re.match(r'^[\d.]+$',host) or ':' in host: host='(直接连IP)'
  else:
    p=host.lower().split('.'); host='.'.join(p[-3:]) if len(p)>2 and len(p[-1])==2 and p[-2] in('co','com','net','org','gov','edu','ac','ne','or') else '.'.join(p[-2:])
  c[(host,out)]+=1
with open('/root/route-summary.txt','w') as f:
  f.write('次数\t出口\t网站\n')
  for (h,o),n in sorted(c.items(),key=lambda x:-x[1]): f.write(f'{n}\t{o}\t{h}\n')
print('OK: 已生成 /root/route-summary.txt，共',len(c),'项')
