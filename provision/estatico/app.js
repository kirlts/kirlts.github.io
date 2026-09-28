// provision-web. Sin dependencias. El servidor empuja lo que cambia por Server-Sent Events: el
// inventario que llega, el avance de cada acción y su fin. La página nunca pregunta cada tanto.

// Copiar al portapapeles: el botón Copiar o un toque sobre el comando mismo. Por http dentro de
// Tailscale navigator.clipboard no existe (exige contexto seguro): ahí se usa la selección y execCommand.
// La confirmación se ve en el botón y en el borde del bloque, y se anuncia a los lectores de pantalla.
function copiar(bloque) {
  const code = bloque.querySelector('code');
  const b = bloque.querySelector('[data-copiar]');
  if (!code) return;
  const r = document.createRange();
  r.selectNodeContents(code);
  const s = getSelection();
  s.removeAllRanges(); s.addRange(r);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) {}
  if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(code.textContent).catch(() => {}); ok = true; }
  bloque.classList.add('copiado');
  if (b) { b.textContent = ok ? 'Copiado' : 'Seleccionado'; b.classList.add('hecho'); }
  anunciar(ok ? 'Comando copiado' : 'Comando seleccionado');
  clearTimeout(bloque._t);
  bloque._t = setTimeout(() => {
    bloque.classList.remove('copiado');
    if (b) { b.textContent = 'Copiar'; b.classList.remove('hecho'); }
  }, 2000);
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-copiar]');
  if (b) { copiar(b.closest('.cmd') || b.parentElement); return; }
  const code = ev.target.closest('.cmd code');
  // Un toque sobre el comando lo copia; si alguien arrastró para seleccionar una parte, se respeta.
  if (code && getSelection().isCollapsed) copiar(code.closest('.cmd'));
});

let voz = null;
function anunciar(texto) {
  if (!voz) {
    voz = document.createElement('div');
    voz.setAttribute('aria-live', 'polite');
    voz.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
    document.body.appendChild(voz);
  }
  voz.textContent = '';
  setTimeout(() => { voz.textContent = texto; }, 30);
}

// Linux / Windows en la portada.
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('.so [data-so]');
  if (!t) return;
  document.querySelectorAll('.so [data-so]').forEach((x) => x.setAttribute('aria-selected', x === t ? 'true' : 'false'));
  document.querySelectorAll('.so-linea').forEach((x) => { x.hidden = x.dataset.so !== t.dataset.so; });
});

// Cambiar un select vuelve a calcular.
document.addEventListener('change', (ev) => {
  if (ev.target.matches('[data-enviar]')) ev.target.form.submit();
});

const principal = () => document.getElementById('principal');

// Reemplaza el contenido por el que el servidor arme para esa dirección, sin recargar.
async function refrescar(url, reemplazar) {
  const destino = url || location.pathname + location.search;
  const r = await fetch(destino, { headers: { 'X-Parcial': '1' } });
  if (!r.ok) return;
  const html = await r.text();
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const nuevo = tmp.querySelector('#principal');
  if (!nuevo) return;
  principal().replaceWith(nuevo);
  const titulo = r.headers.get('X-Titulo');
  if (titulo) document.title = decodeURIComponent(titulo) + ' · Provision';
  if (reemplazar) history.replaceState(null, '', reemplazar);
  conectar();
}

// ── eventos ───────────────────────────────────────────────────────────────────
let fuente = null;
let temas = '';

function conectar() {
  const m = principal();
  const p = new URLSearchParams();
  if (m.dataset.codigo) p.append('codigo', m.dataset.codigo);
  if (m.dataset.equipo) p.append('equipo', m.dataset.equipo);
  const nuevos = p.toString();
  if (nuevos === temas && fuente) return;
  if (fuente) fuente.close();
  temas = nuevos;
  fuente = null;
  if (!nuevos) return;
  fuente = new EventSource('/api/eventos?' + nuevos);
  fuente.addEventListener('inventario', (ev) => {
    const d = JSON.parse(ev.data);
    const m = principal();
    if (location.pathname === '/' && m.dataset.codigo && d.equipo !== m.dataset.equipo) {
      // Llegó el inventario del equipo que corrió la línea de esta portada.
      refrescar('/?codigo=' + encodeURIComponent(m.dataset.codigo), '/');
    } else if (d.equipo === m.dataset.equipo) {
      refrescar();
    }
  });
  fuente.addEventListener('accion', (ev) => {
    const d = JSON.parse(ev.data);
    bloqueAccion(d.id, d.titulo, d.estado);
  });
  fuente.addEventListener('linea', (ev) => {
    const d = JSON.parse(ev.data);
    const b = bloqueAccion(d.id);
    if (!b) return;
    const pre = b.querySelector('pre');
    const abajo = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
    pre.textContent += (pre.textContent ? '\n' : '') + d.texto;
    if (abajo) pre.scrollTop = pre.scrollHeight;
    avance(b, d.texto);
  });
  fuente.addEventListener('fin', (ev) => {
    const d = JSON.parse(ev.data);
    const b = bloqueAccion(d.id);
    if (b) {
      const est = b.querySelector('.a-estado');
      est.innerHTML = '';
      est.appendChild(etiqueta(d.estado));
    }
    document.querySelectorAll(`[data-corriendo="${CSS.escape(d.id)}"]`).forEach((x) => {
      x.disabled = false; x.removeAttribute('data-corriendo');
      if (x.dataset.texto) x.textContent = x.dataset.texto;
    });
    if (d.orden === 'drive-listar' && d.estado === 'hecho') {
      const q = new URLSearchParams(location.search);
      q.set('origen', d.args[0]);
      if (d.args[1]) q.set('carpeta', d.args[1]); else q.delete('carpeta');
      const url = location.pathname + '?' + q.toString() + '#drive';
      refrescar(url, url);
    }
  });
}

function etiqueta(texto) {
  const s = document.createElement('span');
  const clase = { hecho: 'ok', error: 'mal', 'en curso': 'curso' }[texto] || '';
  s.className = 'estado ' + clase;
  s.textContent = texto;
  return s;
}

function bloqueAccion(id, titulo, estado) {
  const lista = document.querySelector('[data-acciones]');
  if (!lista) return null;
  let b = lista.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (b || !titulo) return b;
  b = document.createElement('details');
  b.className = 'accion';
  b.dataset.id = id;
  b.open = true;
  const s = document.createElement('summary');
  const hora = document.createElement('span'); hora.className = 'a-inicio';
  hora.textContent = new Date().toTimeString().slice(0, 8);
  const t = document.createElement('span'); t.className = 'a-titulo'; t.textContent = titulo;
  const dur = document.createElement('span'); dur.className = 'a-dur num';
  const est = document.createElement('span'); est.className = 'a-estado'; est.appendChild(etiqueta(estado || 'en curso'));
  s.append(hora, t, dur, est);
  const pre = document.createElement('pre'); pre.className = 'log';
  const barra = document.createElement('div');
  barra.className = 'progreso indeterminado';
  barra.dataset.progreso = '';
  barra.innerHTML = '<div class="progreso-barra"><span></span></div>';
  b.append(s, barra, pre);
  lista.prepend(b);
  return b;
}

// Si una línea del registro trae un porcentaje («45 %», «[45%]», «45.2%»), la barra pasa a ese valor.
function avance(bloque, texto) {
  const todos = texto.match(/(\d{1,3}(?:[.,]\d+)?)\s?%/g);
  if (!todos) return;
  const v = parseFloat(todos[todos.length - 1].replace(',', '.'));
  const barra = bloque.querySelector('[data-progreso]');
  if (!barra || !(v >= 0 && v <= 100)) return;
  barra.classList.remove('indeterminado');
  barra.style.setProperty('--valor', String(v / 100));
  barra.setAttribute('role', 'progressbar');
  barra.setAttribute('aria-valuenow', String(Math.round(v)));
}

// ── acciones: se piden sin salir de la página ─────────────────────────────────
document.addEventListener('submit', async (ev) => {
  const f = ev.target;
  if (!f.matches('[data-accion]')) return;
  ev.preventDefault();
  const boton = ev.submitter;
  const datos = new URLSearchParams(new FormData(f, boton));
  const aviso = f.id ? document.querySelector(`[data-aviso-de="${f.id}"]`) : f.querySelector('[data-aviso]');
  if (boton) { boton.disabled = true; boton.dataset.texto = boton.textContent; boton.textContent = 'En curso'; }
  let r;
  try {
    r = await (await fetch(f.action, { method: 'POST', body: datos, headers: { 'X-Parcial': '1' } })).json();
  } catch (_) { r = { error: 'sin respuesta del servidor' }; }
  if (r.error || !r.id) {
    if (boton) { boton.disabled = false; boton.textContent = boton.dataset.texto; }
    mostrarError(boton || f, r.error || 'no se pudo');
    return;
  }
  if (boton) boton.dataset.corriendo = r.id;
});

function mostrarError(cerca, texto) {
  const p = document.createElement('p');
  p.className = 'linea-error';
  p.textContent = texto;
  cerca.insertAdjacentElement('afterend', p);
  setTimeout(() => p.remove(), 6000);
}


// ── menú del teléfono: sin JS queda abierto; con JS se pliega detrás de «Menú» ──
document.documentElement.classList.add('js');
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('.menu-boton');
  if (!b) return;
  const barra = b.closest('.barra');
  const abierto = barra.classList.toggle('menu-abierto');
  b.setAttribute('aria-expanded', String(abierto));
});

// ── tipografía: sin bloquear la página ────────────────────────────────────────
// Si Google Fonts no responde (sin internet, red lenta), queda la monoespaciada del sistema.
(function tipografia() {
  if (document.querySelector('link[data-tipografia]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.dataset.tipografia = '';
  l.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&family=VT323&display=swap';
  document.head.appendChild(l);
})();

// ── rótulos de celda: en el teléfono cada fila de tabla es una tarjeta ────────
// El servidor ya los pone (data-rotulo); esto cubre cualquier tabla que llegue sin ellos.
function rotular(raiz) {
  (raiz || document).querySelectorAll('.tabla table').forEach((t) => {
    const cab = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (!cab.length) return;
    t.querySelectorAll('tbody tr').forEach((tr) => {
      [...tr.children].forEach((td, i) => {
        if (!td.hasAttribute('data-rotulo')) td.setAttribute('data-rotulo', cab[i] || '');
      });
    });
  });
}

// ── efectos: un interruptor visible, recordado por navegador ──────────────────
// Apaga la lluvia y toda animación (html.sin-efectos). Además manda prefers-reduced-motion.
const Efectos = {
  clave: 'provision-efectos',
  reducir: matchMedia('(prefers-reduced-motion: reduce)'),
  oyentes: [],
  // Lo elegido en esta página manda; si el navegador no deja guardar (modo privado estricto, datos del sitio
  // bloqueados), el interruptor igual funciona hasta que se cierre la pestaña.
  memoria: null,
  elegido() {
    if (this.memoria !== null) return this.memoria;
    try { return localStorage.getItem(this.clave) !== 'no'; } catch (_) { return true; }
  },
  activos() { return this.elegido() && !this.reducir.matches; },
  poner(si) {
    this.memoria = si;
    try { localStorage.setItem(this.clave, si ? 'si' : 'no'); } catch (_) {}
    this.aplicar();
  },
  aplicar() {
    document.documentElement.classList.toggle('sin-efectos', !this.elegido());
    const b = document.querySelector('button.efectos');
    if (b) b.setAttribute('aria-pressed', String(this.elegido()));
    this.oyentes.forEach((f) => f(this.activos()));
  },
  alCambiar(f) { this.oyentes.push(f); },
};
Efectos.reducir.addEventListener('change', () => Efectos.aplicar());
window.Efectos = Efectos;   // lo usa lluvia.js

(function interruptor() {
  const barra = document.querySelector('.barra');
  if (!barra || barra.querySelector('button.efectos')) return;
  let extra = barra.querySelector('.barra-extra');
  if (!extra) { extra = document.createElement('div'); extra.className = 'barra-extra'; barra.appendChild(extra); }
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'efectos';
  b.textContent = 'Efectos';
  b.title = 'Lluvia y animaciones';
  b.addEventListener('click', () => Efectos.poner(!Efectos.elegido()));
  extra.prepend(b);
})();
Efectos.aplicar();

// ── modo catástrofe: el paso que se está leyendo queda marcado arriba ─────────
(function pasos() {
  const nav = document.querySelector('.pasos-nav');
  if (!nav || !('IntersectionObserver' in window)) return;
  const enlaces = new Map([...nav.querySelectorAll('a[href^="#"]')].map((a) => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver((entradas) => {
    entradas.forEach((en) => {
      if (!en.isIntersecting) return;
      enlaces.forEach((a, id) => {
        if (id === en.target.id) { a.setAttribute('aria-current', 'step'); a.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        else a.removeAttribute('aria-current');
      });
    });
  }, { rootMargin: '-30% 0px -60% 0px' });
  enlaces.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
})();

// ── descifrado: solo cuando algo cambia en vivo ───────────────────────────────
// Un estado que llega por el canal de eventos, o el título cuando la página cambia sola (llegó el
// inventario). Los caracteres de relleno son de la misma fuente monoespaciada, así el ancho no salta. El
// texto real queda en un span para lectores de pantalla y la copia animada se oculta de ellos. Sin
// efectos, el texto aparece tal cual.
const RELLENO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=<>/';
function descifrar(el) {
  if (!Efectos.activos() || el.dataset.descifrando) return;
  const real = el.textContent;
  if (!real.trim() || el.children.length) return;
  el.dataset.descifrando = '1';
  const sr = document.createElement('span'); sr.className = 'sr-only'; sr.textContent = real;
  const vis = document.createElement('span'); vis.setAttribute('aria-hidden', 'true');
  el.textContent = ''; el.append(sr, vis);
  const pasos = 14, retardo = 32;
  let n = 0;
  const tic = () => {
    n++;
    const fijos = Math.floor(real.length * n / pasos);
    vis.textContent = real.slice(0, fijos) + [...real.slice(fijos)].map((ch) =>
      ch === ' ' ? ' ' : RELLENO[(Math.random() * RELLENO.length) | 0]).join('');
    if (n < pasos) setTimeout(tic, retardo);
    else { el.textContent = real; delete el.dataset.descifrando; }
  };
  tic();
}

// Lo que el servidor reemplaza sin recargar (refrescar) se rotula; lo que cambió en vivo se descifra.
new MutationObserver((cambios) => {
  for (const c of cambios) {
    for (const n of c.addedNodes) {
      if (n.nodeType !== 1) continue;
      rotular(n.parentElement || n);
      if (n.matches('.estado') && n.closest('[data-acciones]')) descifrar(n);
      if (n.id === 'principal') n.querySelectorAll('h1').forEach(descifrar);
    }
  }
}).observe(document.body, { childList: true, subtree: true });

// El encendido de la primera carga (lo pone el <head>): se quita al terminar, para que un contenido
// reemplazado sin recargar no vuelva a encenderse.
if (document.documentElement.classList.contains('encendido')) {
  setTimeout(() => document.documentElement.classList.remove('encendido'), 450);
}

rotular();
conectar();

// Última línea: si se llegó hasta aquí, todo lo de arriba corrió (lo mira el <head>, ver CABEZA_JS en app.py).
window.provisionListo = true;
