// Small statistics library: OLS with heteroskedasticity-robust (HC1) standard errors,
// one-way fixed-effects (within) estimator with cluster-robust standard errors,
// and Student t probabilities.

// Regularised incomplete beta function (continued fraction, Numerical Recipes)
function betacf(a, b, x) {
  const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let hh = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; hh *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; hh *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return hh;
}
function lgamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function ibeta(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
// Two-sided p-value for a t statistic
export const pT = (t, df) => ibeta(df / (df + t * t), df / 2, 0.5);
// Critical value t_{0.975, df} by bisection
export function tCrit(df, alpha = 0.05) {
  let lo = 0, hi = 50;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (pT(mid, df) > alpha) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

function inv(A) {
  const n = A.length, M = A.map((r, i) => [...r, ...A.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const v = M[c][c]; if (Math.abs(v) < 1e-14) return null;
    for (let j = 0; j < 2 * n; j++) M[c][j] /= v;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map(r => r.slice(n));
}

// OLS of y on [1, x1..xk]. rows: [{y, x:[...]}]. Returns coefficients with HC1 robust SEs.
export function ols(rows, names) {
  const n = rows.length, k = rows[0].x.length + 1;
  if (n <= k + 1) return null;
  const X = rows.map(r => [1, ...r.x]), y = rows.map(r => r.y);
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
  const XtXi = inv(XtX); if (!XtXi) return null;
  const Xty = Array.from({ length: k }, (_, i) => X.reduce((s, r, t) => s + r[i] * y[t], 0));
  const b = XtXi.map(row => row.reduce((s, v, j) => s + v * Xty[j], 0));
  const fitted = X.map(r => r.reduce((s, v, j) => s + v * b[j], 0));
  const e = y.map((v, i) => v - fitted[i]);
  const ybar = y.reduce((s, v) => s + v, 0) / n;
  const ssr = e.reduce((s, v) => s + v * v, 0), sst = y.reduce((s, v) => s + (v - ybar) ** 2, 0);
  const meat = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, r, t) => s + e[t] * e[t] * r[i] * r[j], 0)));
  const V = mult(mult(XtXi, meat), XtXi).map(r => r.map(v => v * n / (n - k)));
  const df = n - k, tc = tCrit(df);
  const coefs = b.map((bi, i) => {
    const se = Math.sqrt(V[i][i]), t = bi / se;
    return { name: i === 0 ? "Constant" : names[i - 1], b: bi, se, t, p: pT(Math.abs(t), df), lo: bi - tc * se, hi: bi + tc * se };
  });
  // prediction band for the single-regressor case (mean response, robust variance)
  const predict = x0 => {
    const v = [1, x0], f = b[0] + b[1] * x0;
    const s2 = v.reduce((s, vi, i) => s + vi * v.reduce((s2, vj, j) => s2 + V[i][j] * vj, 0), 0);
    const se = Math.sqrt(Math.max(0, s2));
    return { fit: f, lo: f - tc * se, hi: f + tc * se };
  };
  return { coefs, n, k, df, r2: sst > 0 ? 1 - ssr / sst : null, adjR2: sst > 0 ? 1 - (ssr / (n - k)) / (sst / (n - 1)) : null, predict, vcov: "HC1" };
}

// One-way fixed effects (within estimator) of y on x, groups g; SEs clustered by group.
export function feOLS(rows) {
  const groups = new Map();
  for (const r of rows) { if (!groups.has(r.g)) groups.set(r.g, []); groups.get(r.g).push(r); }
  const tr = [];
  for (const [g, rs] of groups) {
    if (rs.length < 2) continue;
    const my = rs.reduce((s, r) => s + r.y, 0) / rs.length, mx = rs.reduce((s, r) => s + r.x, 0) / rs.length;
    for (const r of rs) tr.push({ g, y: r.y - my, x: r.x - mx });
  }
  const N = tr.length, G = new Set(tr.map(r => r.g)).size;
  if (N < 10 || G < 3) return null;
  const sxx = tr.reduce((s, r) => s + r.x * r.x, 0), sxy = tr.reduce((s, r) => s + r.x * r.y, 0);
  const b = sxy / sxx;
  const e = tr.map(r => r.y - b * r.x);
  const byG = new Map();
  tr.forEach((r, i) => byG.set(r.g, (byG.get(r.g) || 0) + r.x * e[i]));
  const meat = [...byG.values()].reduce((s, v) => s + v * v, 0);
  const K = 1 + G;
  const V = meat / (sxx * sxx) * (G / (G - 1)) * ((N - 1) / (N - K));
  const se = Math.sqrt(V), t = b / se, df = G - 1, tc = tCrit(df);
  const sst = tr.reduce((s, r) => s + r.y * r.y, 0), ssr = e.reduce((s, v) => s + v * v, 0);
  return { coefs: [{ name: "slope", b, se, t, p: pT(Math.abs(t), df), lo: b - tc * se, hi: b + tc * se }], n: N, groups: G, df, r2Within: 1 - ssr / sst, vcov: "cluster" };
}

function mult(A, B) { return A.map(r => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0))); }

export const stars = p => (p < 0.01 ? "***" : p < 0.05 ? "**" : p < 0.1 ? "*" : "");
export const fmtP = p => (p < 0.001 ? "< 0.001" : p.toFixed(3));
