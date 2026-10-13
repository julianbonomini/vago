// 22s soundtrack, 120 BPM, A minor. Music and effects share one reverb and key.
const SR = 48000, DUR = 24, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);       // dry
const SL = new Float32Array(N), SRb = new Float32Array(N);    // reverb send
const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
function add(i: number, v: number, pan = 0, send = 0) {
  if (i < 0 || i >= N) return;
  const l = v * Math.cos((pan + 1) * Math.PI / 4), r = v * Math.sin((pan + 1) * Math.PI / 4);
  L[i] += l; R[i] += r; SL[i] += l * send; SRb[i] += r * send;
}
// Master gain envelope for sections (0..1).


// ---- pad: chords per 2s bar
const chords = [[57, 60, 64, 71], [53, 57, 60, 67], [48, 55, 60, 64], [55, 59, 62, 67]]; // Am9-ish, Fmaj7, C, G
{
  let lp1 = 0, lp2 = 0;
  const phases = new Float64Array(16);
  for (let i = 0; i < N; i++) {
    const t = i / SR, bar = Math.floor(t / 2), ch = chords[bar % 4]!;
    const into = t - bar * 2;
    const env = Math.min(1, into / 0.25) * (0.75 + 0.25 * Math.cos(Math.min(1, into / 2) * Math.PI));
    let s = 0;
    ch.forEach((m, k) => {
      for (const d of [-1, 1]) {
        const idx = k * 2 + (d > 0 ? 1 : 0);
        phases[idx] = (phases[idx]! + midi(m) * (1 + d * 0.0025) / SR) % 1;
        s += (phases[idx]! * 2 - 1) * 0.5;
      }
    });
    const final = t >= 22.5 ? Math.max(0, 1 - (t - 22.5) / 1.5) : 1;
    const cutoff = 500 + 1000 * Math.min(1, t / 2.5) + (t > 5.5 && t < 9 ? -300 : 0);
    const a = 1 - Math.exp(-2 * Math.PI * cutoff / SR);
    lp1 += a * (s - lp1); lp2 += a * (lp1 - lp2);
    const g = 0.028 * env * (t < 22.5 ? 1 : 0.6 * final);
    add(i, lp2 * g, Math.sin(t * 0.7) * 0.3, 0.5);
  }
}
// ---- outro sustained chord from 19.0 (Am add9), rings out
{
  const notes = [45, 57, 64, 71, 72, 76];
  for (let i = 22.5 * SR; i < N; i++) {
    const t = i / SR - 22.5, env = Math.min(1, t / 0.02) * Math.exp(-t / 1.6);
    let s = 0; notes.forEach((m, k) => { s += Math.sin(2 * Math.PI * midi(m) * t) * (k === 0 ? 0.7 : 0.35) * Math.exp(-t * k * 0.15); });
    add(i, s * env * 0.05, 0, 0.6);
  }
}
// ---- drums and bass on the groove, 3.0–21
function kick(t0: number, g: number) {
  let ph = 0;
  for (let j = 0; j < SR * 0.35; j++) {
    const t = j / SR, f = 45 + 80 * Math.exp(-t * 28);
    ph += 2 * Math.PI * f / SR;
    add(Math.floor(t0 * SR) + j, Math.sin(ph) * Math.exp(-t * 9) * g, 0, 0.05);
  }
}
function hat(t0: number, g: number, pan: number) {
  let prev = 0;
  for (let j = 0; j < SR * 0.04; j++) {
    const n = rnd(), hp = n - prev; prev = n;
    add(Math.floor(t0 * SR) + j, hp * Math.exp(-j / SR * 120) * g, pan, 0.15);
  }
}
function bassNote(t0: number, m: number, len: number, g: number) {
  const f = midi(m);
  for (let j = 0; j < SR * len; j++) {
    const t = j / SR, env = Math.min(1, t / 0.005) * Math.exp(-t * 5);
    const s = Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t);
    add(Math.floor(t0 * SR) + j, s * env * g, 0, 0);
  }
}
for (let beat = 5; beat < 45; beat++) {           // beats from 2.5s
  const t = beat * 0.5, bar = Math.floor(t / 2), root = chords[bar % 4]![0]! - 24 + (bar % 4 === 2 ? 12 : 0);
  const quiet = t >= 5.5 && t < 9 ? 0.75 : 1;
  if (t < 22.5) {
    if (beat % 2 === 1) kick(t, 0.32 * quiet * (t === 2.5 ? 1.3 : 1));
    hat(t + 0.25, 0.035 * quiet, 0.3);
    if (beat % 4 === 3) hat(t + 0.375, 0.02 * quiet, -0.3);
    bassNote(t, root, 0.45, 0.07 * quiet);
    bassNote(t + 0.25, root + 12, 0.2, 0.03 * quiet);
  }
}
kick(22.5, 0.36);
// ---- plucks (ticket ticks), A minor pentatonic climbing
function pluck(t0: number, m: number, g: number, pan = 0) {
  const f = midi(m);
  for (let j = 0; j < SR * 1.2; j++) {
    const t = j / SR, env = Math.min(1, t / 0.003) * Math.exp(-t * 6);
    const s = Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 14) + 0.12 * Math.sin(6 * Math.PI * f * t) * Math.exp(-t * 25);
    add(Math.floor(t0 * SR) + j, s * env * g, pan, 0.45);
  }
}
const penta = [69, 72, 74, 76, 79, 81, 84, 86];
// hook: one low hit per word
[0.1, 0.18, 0.26].forEach((t, i) => pluck(t, [45, 52, 57][i]!, 0.09));
pluck(0.95, 57, 0.08); pluck(1.03, 64, 0.06); pluck(1.03, 69, 0.04);
pluck(2.5, 45, 0.08);
// planning: soft blips for the agent's lines, a chord for the Proposal
pluck(6.55, 76, 0.03, 0.3); pluck(7.4, 79, 0.03, 0.3);
pluck(8.1, 69, 0.04); pluck(8.1, 76, 0.03); pluck(8.15, 81, 0.03);
// workflow: the chip lands, the harness flips
pluck(11.8, 74, 0.05, 0.3); pluck(11.8, 81, 0.03, 0.3);
pluck(12.8, 84, 0.045, 0.3); pluck(12.8, 88, 0.03, 0.3);
// run: Tickets 01–06 climb on the 8ths, Ticket 07's Steps tick quietly
penta.slice(0, 6).forEach((m, i) => pluck(15.0 + 0.25 * i, m, 0.05, i % 2 ? 0.25 : -0.25));
for (let j = 0; j < 8; j++) pluck(16.45 + j * 0.085, 93, 0.012, 0.2);
pluck(17.13, 84, 0.04); pluck(17.13, 88, 0.03);
// itself: the slam and the counters
pluck(17.6, 57, 0.06); [18.25, 18.37, 18.49].forEach((t, i) => pluck(t, [76, 79, 81][i]!, 0.035, -0.3 + i * 0.3));
// outro: one note per agent, then the wordmark
[20.7, 20.86, 21.02].forEach((t, i) => pluck(t, [69, 72, 76][i]!, 0.045, -0.3 + i * 0.3));
pluck(22.5, 57, 0.06);
// ---- typing: soft filtered clicks, in the background
function click(t0: number, g: number) {
  let lp = 0;
  for (let j = 0; j < SR * 0.015; j++) {
    const n = rnd(); lp += 0.35 * (n - lp);
    add(Math.floor(t0 * SR) + j, lp * Math.exp(-j / SR * 400) * g, rnd() * 0.3, 0.1);
  }
}
const typed = (a: number, len: number, chars: number, g = 0.04) => { for (let k = 0; k < chars; k++) click(a + (k / chars) * len + rnd() * 0.01, g); };
typed(4.45, 0.3, 6); click(5.3, 0.05);
typed(5.85, 0.22, 10, 0.03); typed(6.05, 0.22, 10, 0.03); typed(6.95, 0.22, 8, 0.03); typed(7.75, 0.22, 7, 0.03);
typed(11.05, 0.72, 22, 0.035); typed(12.35, 0.3, 9, 0.035);
// ---- swells into transitions: noise through a rising lowpass
function swell(tEnd: number, len: number, g: number) {
  let lp = 0;
  for (let j = 0; j < SR * len; j++) {
    const x = j / (SR * len), cut = 200 + 2500 * x * x, a = 1 - Math.exp(-2 * Math.PI * cut / SR);
    lp += a * (rnd() - lp);
    add(Math.floor((tEnd - len) * SR) + j, lp * Math.pow(x, 2) * g, 0, 0.4);
  }
}
swell(2.5, 0.5, 0.07); swell(5.5, 0.45, 0.06); swell(9.0, 0.35, 0.06); swell(14.5, 0.35, 0.06); swell(17.5, 0.35, 0.06); swell(20.5, 0.4, 0.07); swell(22.5, 0.4, 0.06);
// ---- reverb: Schroeder, on the send bus
function reverb(inp: Float32Array, offs: number) {
  const out = new Float32Array(N);
  for (const d0 of [1557, 1617, 1491, 1422]) {
    const d = d0 + offs, buf = new Float32Array(d); let p = 0, lp = 0;
    for (let i = 0; i < N; i++) { const y = buf[p]!; lp = y * 0.6 + lp * 0.4; buf[p] = inp[i]! + lp * 0.84; p = (p + 1) % d; out[i]! += y * 0.25; out[i] += 0; }
  }
  let res = out;
  for (const d of [225, 556]) {
    const buf = new Float32Array(d); let p = 0; const o2 = new Float32Array(N);
    for (let i = 0; i < N; i++) { const b = buf[p]!, x = res[i]!; const y = -x + b; buf[p] = x + b * 0.5; o2[i] = y; p = (p + 1) % d; }
    res = o2;
  }
  return res;
}
const rl = reverb(SL, 0), rr = reverb(SRb, 23);
// ---- master
const out = new Int16Array(N * 2);
let peak = 0; const mix = new Float32Array(N * 2);
for (let i = 0; i < N; i++) {
  const t = i / SR, fadeIn = Math.min(1, t / 0.05);
  mix[i * 2] = (L[i]! + rl[i]! * 0.35) * fadeIn; mix[i * 2 + 1] = (R[i]! + rr[i]! * 0.35) * fadeIn;
}
for (let i = 0; i < mix.length; i++) { mix[i] = Math.tanh(mix[i]! * 2.2) / 2.2; peak = Math.max(peak, Math.abs(mix[i]!)); }
const norm = 0.89 / peak;
for (let i = 0; i < mix.length; i++) out[i] = Math.round(mix[i]! * norm * 32767);
const header = new ArrayBuffer(44), v = new DataView(header);
const w = (o: number, s: string) => [...s].forEach((c, k) => v.setUint8(o + k, c.charCodeAt(0)));
w(0, "RIFF"); v.setUint32(4, 36 + out.byteLength, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, SR, true); v.setUint32(28, SR * 4, true);
v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, out.byteLength, true);
await Bun.write("soundtrack.wav", new Blob([header, out.buffer]));
console.log("peak", peak.toFixed(3));
