// 离线二维码生成（字节模式，纠错等级 M，版本 1–20）。算法依据 ISO/IEC 18004。
const QR = (() => {
  const ECC = [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26];
  const BLK = [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16];
  const rawModules = v => { let r = (16*v+128)*v+64; if (v >= 2) { const n = Math.floor(v/7)+2; r -= (25*n-10)*n-55; if (v >= 7) r -= 36; } return r; };
  const dataCap = v => Math.floor(rawModules(v)/8) - ECC[v]*BLK[v];
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z<<1) ^ ((z>>>7)*0x11D); z ^= ((y>>>i)&1)*x; } return z & 255; };
  function rsDiv(n) { const r = new Array(n).fill(0); r[n-1] = 1; let root = 1;
    for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { r[j] = mul(r[j], root); if (j+1 < n) r[j] ^= r[j+1]; } root = mul(root, 2); } return r; }
  function rsRem(data, div) { const r = new Array(div.length).fill(0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => r[i] ^= mul(c, f)); } return r; }
  const alignPos = (v, size) => { if (v === 1) return []; const n = Math.floor(v/7)+2, step = Math.ceil((v*4+4)/(n*2-2))*2, r = [6];
    for (let p = size-7; r.length < n; p -= step) r.splice(1, 0, p); return r; };

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let v = 1; for (; v <= 20; v++) if (4 + (v < 10 ? 8 : 16) + bytes.length*8 <= dataCap(v)*8) break;
    if (v > 20) throw new Error("内容太长，无法生成二维码");
    const bits = []; const put = (val, n) => { for (let i = n-1; i >= 0; i--) bits.push((val>>>i)&1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
    const cap = dataCap(v)*8; put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
    for (let p = 0xEC; bits.length < cap; p ^= 0xEC ^ 0x11) put(p, 8);
    const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i+8).join(""), 2));
    // 分块 + 纠错 + 交织
    const nb = BLK[v], el = ECC[v], raw = Math.floor(rawModules(v)/8), nShort = nb - raw % nb, sLen = Math.floor(raw/nb), div = rsDiv(el), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) { const d = data.slice(k, k + sLen - el + (i < nShort ? 0 : 1)); k += d.length;
      const e = rsRem(d, div); if (i < nShort) d.push(0); blocks.push(d.concat(e)); }
    const cw = []; for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== sLen-el || j >= nShort) cw.push(b[i]); });
    // 画功能图形
    const size = v*4+17, M = [...Array(size)].map(() => Array(size).fill(false)), F = [...Array(size)].map(() => Array(size).fill(false));
    const set = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i%2 === 0); set(i, 6, i%2 === 0); }
    for (const [cx, cy] of [[3,3],[size-4,3],[3,size-4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx+dx, y = cy+dy, d = Math.max(Math.abs(dx), Math.abs(dy)); if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4); }
    const ap = alignPos(v, size), L = ap.length-1;
    ap.forEach((ax, i) => ap.forEach((ay, j) => { if ((i === 0 && j === 0) || (i === 0 && j === L) || (i === L && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax+dx, ay+dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }));
    const fmt = mask => { const d = mask; let r = d; for (let i = 0; i < 10; i++) r = (r<<1) ^ ((r>>>9)*0x537); const b = ((d<<10)|r) ^ 0x5412, g = i => ((b>>>i)&1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, g(i)); set(8, 7, g(6)); set(8, 8, g(7)); set(7, 8, g(8)); for (let i = 9; i < 15; i++) set(14-i, 8, g(i));
      for (let i = 0; i < 8; i++) set(size-1-i, 8, g(i)); for (let i = 8; i < 15; i++) set(8, size-15+i, g(i)); set(8, size-8, true); };
    fmt(0);
    if (v >= 7) { let r = v; for (let i = 0; i < 12; i++) r = (r<<1) ^ ((r>>>11)*0x1F25); const b = (v<<12)|r;
      for (let i = 0; i < 18; i++) { const d = ((b>>>i)&1) === 1, a = size-11+i%3, c = Math.floor(i/3); set(a, c, d); set(c, a, d); } }
    // 放数据
    let i = 0;
    for (let right = size-1; right >= 1; right -= 2) { if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) { const x = right-j, up = ((right+1)&2) === 0, y = up ? size-1-vert : vert;
        if (!F[y][x] && i < cw.length*8) { M[y][x] = ((cw[i>>>3] >>> (7-(i&7))) & 1) === 1; i++; } } }
    // 选掩码
    const masks = [(x,y)=>(x+y)%2===0,(x,y)=>y%2===0,(x,y)=>x%3===0,(x,y)=>(x+y)%3===0,(x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0,
      (x,y)=>x*y%2+x*y%3===0,(x,y)=>(x*y%2+x*y%3)%2===0,(x,y)=>((x+y)%2+x*y%3)%2===0];
    const apply = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y][x] && masks[m](x, y)) M[y][x] = !M[y][x]; };
    const penalty = () => { let p = 0, dark = 0; const line = get => { let run = 1, s = 0; for (let k = 1; k < size; k++) { if (get(k) === get(k-1)) run++; else { if (run >= 5) s += run-2; run = 1; } } if (run >= 5) s += run-2;
        const str = Array.from({length: size}, (_, k) => get(k) ? 1 : 0).join(""); for (const pat of ["10111010000", "00001011101"]) { let q = str.indexOf(pat); while (q >= 0) { s += 40; q = str.indexOf(pat, q+1); } } return s; };
      for (let k = 0; k < size; k++) { p += line(x => M[k][x]) + line(y => M[y][k]); }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { if (M[y][x]) dark++; if (x < size-1 && y < size-1 && M[y][x] === M[y][x+1] && M[y][x] === M[y+1][x] && M[y][x] === M[y+1][x+1]) p += 3; }
      return p + Math.floor(Math.abs(dark*20 - size*size*10) / (size*size)) * 10; };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) { apply(m); fmt(m); const p = penalty(); if (p < bestP) { bestP = p; best = m; } apply(m); }
    apply(best); fmt(best);
    return M;
  }
  function svg(text, px = 4) {
    const M = encode(text), n = M.length, q = 4; let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (M[y][x]) d += `M${x+q},${y+q}h1v1h-1z`;
    const s = (n + q*2);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s*px}" height="${s*px}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  return { encode, svg };
})();
if (typeof module !== "undefined") module.exports = QR;
