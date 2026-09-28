// lluvia.js: la lluvia de caracteres de Matrix en el fondo de la web de provision.
//
// Porta a canvas 2D el algoritmo de Rezmason (github.com/Rezmason/matrix, MIT; shaders/glsl/
// rainPass.raindrop.frag.glsl y rainPass.symbol.frag.glsl), con los valores medidos en la investigación
// del 2026-09-28 (docs/DISENO-WEB.md). La rejilla está fija: los glifos no se mueven; lo que cae es una
// onda de brillo en diente de sierra por columna, y cada glifo cambia 1,8 veces por segundo.
//
// Lo propio de esta web: solo se calcula y se dibuja lo que se ve. La cabecera, el contenido y el pie
// son opacos (estilo.css), así que cada cuadro pide sus rectángulos y cada columna recorre solo las filas
// que quedan descubiertas: la franja bajo la cabecera y los márgenes. En el teléfono, apenas se baja de
// la franja no queda nada que dibujar. Se pausa con la pestaña oculta y queda en un cuadro quieto con
// prefers-reduced-motion o con el interruptor «Efectos» (Efectos, en app.js).
(function () {
  'use strict';
  const canvas = document.createElement('canvas');
  canvas.className = 'lluvia';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  const telefono = matchMedia('(max-width: 640px)').matches;
  const o = {
    celda: telefono ? 22 : 18,     // alto de celda en px CSS
    fps: telefono ? 20 : 30,       // en 60 Hz solo existen 60/30/20/15
    caida: 0.3,                    // fallSpeed de Rezmason
    largo: 0.75,                   // raindropLength
    ciclos: 1.8,                   // cambios de glifo por segundo por celda
    niveles: 12,                   // escalones de brillo
    maxDpr: telefono ? 1 : 2,
    brilloPunta: 8,                // shadowBlur solo en la punta
  };
  // Matrix-Code.ttf trae los glifos ya espejados y sin el 6.
  const G = [...'"*+012345789:<>z|¦╌▪アウエオカキケコサシスセソタツテナニヌネハヒホマミムメモヤヨラリワー꞊'];
  const FONDO = '#050a06';
  // Paleta de Rezmason, hsl(108°, 90 %, L): 0,2 → #176105, 0,7 → #89f76e, 0,8 → #b0fa9e.
  const pal = [[0, [5, 10, 6]], [0.2, [0x17, 0x61, 0x05]], [0.7, [0x89, 0xf7, 0x6e]], [0.8, [0xb0, 0xfa, 0x9e]], [1, [0xb0, 0xfa, 0x9e]]];
  const color = (b) => {
    for (let i = 1; i < pal.length; i++) {
      if (b <= pal[i][0]) {
        const [a0, c0] = pal[i - 1], [a1, c1] = pal[i];
        const k = (b - a0) / (a1 - a0);
        return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k))})`;
      }
    }
    return 'rgb(176,250,158)';
  };
  // Tenue: la lluvia se ve a una fracción de su brillo, mezclada con el fondo (lo mismo que una opacidad,
  // sin pagar la composición). Dos zonas: la franja bajo la cabecera (--lluvia-franja, 0,6) y el resto de
  // los márgenes (--lluvia-fondo, 0,3). Una pantalla puede cambiarlas en su CSS.
  const css = getComputedStyle(document.documentElement);
  const factor = (v, d) => { const x = parseFloat(css.getPropertyValue(v)); return x >= 0 && x <= 1 ? x : d; };
  const zonas = [factor('--lluvia-franja', 0.6), factor('--lluvia-fondo', 0.3)];
  const mezcla = (rgb, f) => `rgb(${rgb.map((c, j) => Math.round([5, 10, 6][j] + (c - [5, 10, 6][j]) * f))})`;
  const aRGB = (t) => t.match(/\d+/g).map(Number);
  const NIV = o.niveles + 1;
  const colores = zonas.flatMap((f) => Array.from({ length: NIV }, (_, l) =>
    mezcla(aRGB(l === o.niveles ? 'rgb(232,255,216)'   // punta #e8ffd8
    : color((l + 1) / o.niveles)), f)));
  const azar = (s) => { const x = Math.sin(s * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const ondula = (x) => x + 0.3 * Math.sin(Math.SQRT2 * x) + 0.2 * Math.sin(2.23606797749979 * x);

  let cols = 0, filas = 0, dpr = 1, sym, edad, desfase, veloc, bx, by, bg, bn;
  const t0 = performance.now();
  let ultimo = 0, raf = 0;

  function medir() {
    dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr);
    const w = innerWidth, h = innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    cols = Math.ceil(w / o.celda); filas = Math.ceil(h / o.celda);
    const n = cols * filas;
    sym = new Uint8Array(n); edad = new Float32Array(n);
    for (let i = 0; i < n; i++) { sym[i] = (Math.random() * G.length) | 0; edad[i] = Math.random(); }
    desfase = new Float32Array(cols); veloc = new Float32Array(cols);
    for (let c = 0; c < cols; c++) { desfase[c] = azar(c + 1) * 1000; veloc[c] = azar(c + 1.1) * 0.5 + 0.5; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${Math.round(o.celda * 0.85)}px "Matrix Code", monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    bx = colores.map(() => new Float32Array(n)); by = colores.map(() => new Float32Array(n));  // un lote por zona y nivel
    bg = colores.map(() => new Uint8Array(n)); bn = new Uint32Array(colores.length);
  }

  // Lo opaco que tapa la lluvia, en px de la ventana.
  const tapas = () => [...document.querySelectorAll('.barra, main, .pie p')]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.bottom > 0 && r.top < innerHeight && r.width > 0);
  // Hasta dónde llega la franja: el borde de arriba del contenido. Sin contenido, todo es fondo.
  const finFranja = () => { const m = document.querySelector('main'); return m ? m.getBoundingClientRect().top : -1; };

  function cuadro(ahora, dt) {
    const t = (ahora - t0) / 1000;
    const r = tapas(), franja = finFranja();
    ctx.fillStyle = FONDO;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const cambio = o.ciclos * dt, paso = 0.8 / filas;
    bn.fill(0);
    let dibujadas = 0;
    for (let c = 0; c < cols; c++) {
      const x0 = c * o.celda, x1 = x0 + o.celda;
      const tapan = r.filter((q) => q.left <= x0 && q.right >= x1);
      const tiempo = desfase[c] + t * o.caida * veloc[c];
      let abajo = -1;
      for (let f = filas - 1; f >= 0; f--) {
        const y0 = f * o.celda, y1 = y0 + o.celda;
        if (tapan.some((q) => q.top <= y0 && q.bottom >= y1)) { abajo = -1; continue; }
        const gy = filas - 1 - f;
        const rt = ondula((gy * paso + tiempo) / o.largo);
        const b = 1 - (rt - Math.floor(rt));        // 1 en la punta; baja hacia arriba
        const punta = abajo >= 0 && b > abajo;       // más clara que la celda de abajo
        abajo = b;
        const i = c * filas + f;
        if ((edad[i] += cambio) >= 1) { edad[i] -= 1; sym[i] = (Math.random() * G.length) | 0; }
        const base = b * 1.1 - 0.5;                  // baseContrast 1,1 y baseBrightness −0,5
        if (base <= 0.02 && !punta) continue;
        const nivel = (y1 <= franja ? 0 : NIV) + (punta ? o.niveles : Math.min(o.niveles - 1, (base * o.niveles) | 0));
        const k = bn[nivel]++;
        bx[nivel][k] = x0 + o.celda / 2; by[nivel][k] = y0 + o.celda / 2; bg[nivel][k] = sym[i];
        dibujadas++;
      }
    }
    if (!dibujadas) return;
    for (let l = 0; l < colores.length; l++) {
      ctx.fillStyle = colores[l];                    // un cambio de color por nivel, no por glifo
      const brillo = l === o.niveles && o.brilloPunta > 0;   // la punta de la franja; en el fondo, sin brillo
      if (brillo) { ctx.shadowColor = '#6dff8a'; ctx.shadowBlur = o.brilloPunta * dpr; }
      for (let k = 0; k < bn[l]; k++) ctx.fillText(G[bg[l][k]], bx[l][k], by[l][k]);
      if (brillo) ctx.shadowBlur = 0;
    }
  }

  function bucle(ahora) {
    raf = requestAnimationFrame(bucle);
    const dt = (ahora - ultimo) / 1000;
    if (dt < 1 / o.fps - 0.004) return;
    ultimo = ahora;
    cuadro(ahora, Math.min(dt, 0.1));
  }
  const andar = () => { if (!raf) { ultimo = performance.now(); raf = requestAnimationFrame(bucle); } };
  const parar = () => { cancelAnimationFrame(raf); raf = 0; };
  const quieta = () => (window.Efectos ? !Efectos.activos() : matchMedia('(prefers-reduced-motion: reduce)').matches);

  function sincronizar() {
    if (document.hidden) { parar(); return; }
    if (quieta()) { parar(); cuadro(performance.now(), 0); } else andar();
  }

  // Quieta, la franja visible cambia al desplazarse: se vuelve a dibujar, una vez por cuadro.
  let pendiente = false;
  addEventListener('scroll', () => {
    if (raf || pendiente || document.hidden) return;
    pendiente = true;
    requestAnimationFrame(() => { pendiente = false; cuadro(performance.now(), 0); });
  }, { passive: true });
  let espera;
  addEventListener('resize', () => { clearTimeout(espera); espera = setTimeout(() => { medir(); sincronizar(); }, 150); });
  document.addEventListener('visibilitychange', sincronizar);
  if (window.Efectos) Efectos.alCambiar(sincronizar);
  else matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', sincronizar);

  medir();
  const fuente = document.fonts && document.fonts.load ? document.fonts.load('20px "Matrix Code"') : Promise.resolve();
  fuente.catch(() => {}).then(() => { medir(); sincronizar(); });
})();
