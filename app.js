// Sistema comercial — Felipe Varone Representações
// Front-end estático (GitHub Pages) + Firebase Auth (Google) + Firestore.
// Todos os dados ficam em users/{uid}/... — só o dono enxerga (ver firestore.rules).

import { firebaseConfig, ALLOWED_EMAILS } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc,
  onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, getDocs }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = d => d ? d.split('-').reverse().join('/') : '';
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2400); };

if (!firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('COLE')) {
  $('#setup').classList.remove('hidden');
  throw new Error('firebase-config.js não configurado');
}

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

// ---------- Estado ----------
const S = { uid: null, data: {}, unsub: [], route: 'painel', config: { metaComissao: 15000 } };
const COLS = ['representadas', 'produtos', 'clientes', 'negocios', 'visitas', 'pedidos'];
const col = name => collection(db, 'users', S.uid, name);
const repNome = id => (S.data.representadas || []).find(r => r.id === id)?.nome || id || '';
const repOpts = () => [['', '—'], ...(S.data.representadas || []).map(r => [r.id, r.nome])];

const ETAPAS = ['Prospecção', 'Contato feito', 'Proposta', 'Negociação', 'Fechado', 'Perdido'];
const STATUS_CLIENTE = ['Prospect', 'Cliente', 'Inativo', 'Perdido'];
const STATUS_PEDIDO = ['Digitado', 'Faturado', 'Comissão recebida', 'Cancelado'];
const STATUS_VISITA = ['Agendada', 'Realizada', 'Cancelada'];

// ---------- Definição dos módulos (formulários e tabelas) ----------
const MOD = {
  clientes: {
    titulo: 'Clientes', singular: 'cliente', busca: ['nome', 'razao', 'cnpj', 'cidade', 'bairro', 'telefone', 'comprador', 'obs'],
    filtros: [['status', 'Status', () => STATUS_CLIENTE], ['uf', 'UF', () => ['PR', 'SC', 'RS', 'SP']], ['origem', 'Origem', () => [...new Set((S.data.clientes || []).map(c => c.origem).filter(Boolean))]], ['rep', 'Representada', () => (S.data.representadas || []).map(r => r.id), repNome]],
    colunas: [['nome', 'Nome'], ['cidade', 'Cidade', c => `${esc(c.cidade)}${c.uf ? '/' + esc(c.uf) : ''}`], ['telefone', 'Telefone', c => waLink(c.telefone)], ['canal', 'Canal'], ['status', 'Status', c => tagStatus(c.status)], ['representadas', 'Representadas', c => (c.representadas || []).map(r => `<span class="tag">${esc(repNome(r))}</span>`).join(' ')], ['curva', 'Curva']],
    campos: [['nome', 'Nome fantasia', 'text', true], ['razao', 'Razão social'], ['cnpj', 'CNPJ'], ['status', 'Status', 'select', false, () => STATUS_CLIENTE],
      ['telefone', 'Telefone / WhatsApp'], ['email', 'E-mail', 'email'], ['comprador', 'Comprador / contato'], ['canal', 'Canal'],
      ['endereco', 'Endereço'], ['bairro', 'Bairro'], ['cidade', 'Cidade'], ['uf', 'UF'], ['segmento', 'Segmento'], ['curva', 'Curva / prioridade'],
      ['origem', 'Origem'], ['representadas', 'Representadas que atende', 'checks', false, () => (S.data.representadas || []).map(r => [r.id, r.nome]), 'full'], ['obs', 'Observações', 'textarea', false, null, 'full']],
    filtroExtra: (c, f) => !f.rep || (c.representadas || []).includes(f.rep),
  },
  negocios: {
    titulo: 'Pipeline', singular: 'negociação', busca: ['clienteNome', 'titulo', 'proximoPasso', 'obs', 'contato'],
    campos: [['clienteNome', 'Cliente', 'cliente', true], ['representadaId', 'Representada', 'select', false, repOpts], ['titulo', 'Assunto / produto'], ['valor', 'Valor estimado (R$)', 'number'],
      ['etapa', 'Etapa', 'select', false, () => ETAPAS], ['contato', 'Contato'], ['proximoPasso', 'Próximo passo'], ['dataProximo', 'Data do próximo passo', 'date'], ['obs', 'Observações', 'textarea', false, null, 'full']],
  },
  visitas: {
    titulo: 'Visitas', singular: 'visita', busca: ['clienteNome', 'endereco', 'objetivo', 'resultado'],
    filtros: [['status', 'Status', () => STATUS_VISITA]],
    colunas: [['data', 'Data', v => `${fmtDate(v.data)} ${esc(v.hora || '')}`], ['clienteNome', 'Cliente'], ['endereco', 'Endereço', v => v.endereco ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.endereco)}" target="_blank" onclick="event.stopPropagation()">${esc(v.endereco)}</a>` : ''], ['objetivo', 'Objetivo', null, 'wrap'], ['status', 'Status', v => tagStatus(v.status)]],
    campos: [['data', 'Data', 'date', true], ['hora', 'Hora', 'time'], ['clienteNome', 'Cliente', 'cliente', true], ['endereco', 'Endereço'], ['status', 'Status', 'select', false, () => STATUS_VISITA],
      ['objetivo', 'Objetivo', 'textarea', false, null, 'full'], ['resultado', 'Resultado / o que foi combinado', 'textarea', false, null, 'full']],
    ordem: (a, b) => (b.data + (b.hora || '')).localeCompare(a.data + (a.hora || '')),
  },
  pedidos: {
    titulo: 'Pedidos', singular: 'pedido', busca: ['clienteNome', 'numero', 'obs'],
    filtros: [['status', 'Status', () => STATUS_PEDIDO], ['representadaId', 'Representada', () => (S.data.representadas || []).map(r => r.id), repNome], ['mes', 'Mês', () => [...new Set((S.data.pedidos || []).map(p => (p.data || '').slice(0, 7)).filter(Boolean))].sort().reverse(), m => m.split('-').reverse().join('/')]],
    colunas: [['data', 'Data', p => fmtDate(p.data)], ['clienteNome', 'Cliente'], ['representadaId', 'Representada', p => esc(repNome(p.representadaId))], ['numero', 'Nº'], ['valor', 'Valor', p => brl(p.valor), 'num'], ['comissaoPct', '%', p => (Number(p.comissaoPct) || 0).toLocaleString('pt-BR') + '%', 'num'], ['comissaoValor', 'Comissão', p => brl(comissao(p)), 'num'], ['status', 'Status', p => tagStatus(p.status)]],
    campos: [['data', 'Data do pedido', 'date', true], ['clienteNome', 'Cliente', 'cliente', true], ['representadaId', 'Representada', 'select', true, repOpts], ['numero', 'Nº do pedido / NF'],
      ['valor', 'Valor do pedido (R$)', 'number', true], ['comissaoPct', 'Comissão (%)', 'number'], ['status', 'Status', 'select', false, () => STATUS_PEDIDO], ['previsaoPagamento', 'Previsão de pagamento da comissão', 'date'],
      ['obs', 'Observações', 'textarea', false, null, 'full']],
    filtroExtra: (p, f) => !f.mes || (p.data || '').startsWith(f.mes),
    ordem: (a, b) => (b.data || '').localeCompare(a.data || ''),
    rodape: rows => { const v = rows.filter(p => p.status !== 'Cancelado'); return `Total: <b>${brl(v.reduce((s, p) => s + (+p.valor || 0), 0))}</b> · Comissão: <b>${brl(v.reduce((s, p) => s + comissao(p), 0))}</b>`; },
    antesSalvar: d => { if (!d.comissaoPct && d.representadaId) d.comissaoPct = (S.data.representadas || []).find(r => r.id === d.representadaId)?.comissaoPct || 0; d.comissaoValor = comissao(d); },
  },
  representadas: {
    titulo: 'Representadas', singular: 'representada', busca: ['nome', 'segmento', 'contato', 'obs'],
    colunas: [['nome', 'Nome'], ['segmento', 'Segmento', null, 'wrap'], ['contato', 'Contato', null, 'wrap'], ['telefone', 'Telefone', r => waLink(r.telefone)], ['comissaoPct', 'Comissão', r => r.comissaoPct ? r.comissaoPct.toLocaleString('pt-BR') + '%' : '<span class="tag orange">a confirmar</span>', 'num'], ['pedidoMinimo', 'Pedido mínimo'], ['prazo', 'Prazo']],
    campos: [['nome', 'Nome', 'text', true], ['segmento', 'Segmento / linhas'], ['contato', 'Contato (nome / cargo)'], ['telefone', 'Telefone'], ['email', 'E-mail', 'email'],
      ['comissaoPct', 'Comissão padrão (%)', 'number'], ['pedidoMinimo', 'Pedido mínimo'], ['prazo', 'Prazo de pagamento'], ['obs', 'Condições e observações', 'textarea', false, null, 'full']],
  },
  produtos: {
    titulo: 'Produtos', singular: 'produto', busca: ['descricao', 'codigo', 'ean', 'marca'], pagina: 100,
    filtros: [['representadaId', 'Representada', () => (S.data.representadas || []).map(r => r.id), repNome], ['marca', 'Marca', () => [...new Set((S.data.produtos || []).map(p => p.marca).filter(Boolean))].sort()]],
    colunas: [['representadaId', 'Representada', p => esc(repNome(p.representadaId))], ['codigo', 'Código'], ['descricao', 'Descrição', null, 'wrap'], ['marca', 'Marca'], ['embalagem', 'Embalagem'], ['ean', 'EAN'], ['preco', 'Preço', p => brl(p.preco), 'num']],
    campos: [['representadaId', 'Representada', 'select', true, repOpts], ['codigo', 'Código'], ['descricao', 'Descrição', 'text', true, null, 'full'], ['marca', 'Marca'], ['ean', 'EAN / código de barras'],
      ['embalagem', 'Embalagem'], ['preco', 'Preço (R$)', 'number'], ['obs', 'Observações', 'textarea', false, null, 'full']],
  },
};

const NAV = [['painel', '📊', 'Painel'], ['clientes', '🏪', 'Clientes'], ['negocios', '🎯', 'Pipeline'], ['visitas', '📍', 'Visitas'], ['pedidos', '🧾', 'Pedidos'], ['representadas', '🏭', 'Representadas'], ['produtos', '📦', 'Produtos'], ['dados', '💾', 'Importar / backup']];

// ---------- Utilidades de exibição ----------
function comissao(p) { return Math.round((Number(p.valor) || 0) * (Number(p.comissaoPct) || 0)) / 100; }
function waLink(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length < 10) return esc(tel);
  const n = d.startsWith('55') ? d : '55' + d.slice(-11);
  return `<a href="https://wa.me/${n}" target="_blank" onclick="event.stopPropagation()">${esc(tel)}</a>`;
}
function tagStatus(s) {
  const m = { Cliente: 'green', Fechado: 'green', Realizada: 'green', Faturado: 'blue', 'Comissão recebida': 'green', Perdido: 'red', Cancelado: 'red', Cancelada: 'red', Inativo: 'orange', Prospect: 'blue', Agendada: 'orange', Digitado: 'orange' };
  return s ? `<span class="tag ${m[s] || ''}">${esc(s)}</span>` : '';
}

// ---------- Autenticação ----------
$('#btnLogin').onclick = async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { $('#loginMsg').textContent = 'Não foi possível entrar: ' + e.message; }
};
$('#btnLogout').onclick = () => signOut(auth);
$('#btnMenu').onclick = () => $('#side').classList.toggle('open');

onAuthStateChanged(auth, user => {
  S.unsub.forEach(u => u()); S.unsub = []; S.data = {};
  if (!user) { $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); return; }
  if (ALLOWED_EMAILS?.length && !ALLOWED_EMAILS.includes(user.email)) {
    $('#loginMsg').textContent = `O e-mail ${user.email} não tem acesso a este sistema.`; signOut(auth); return;
  }
  S.uid = user.uid;
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#userBox').textContent = user.email;
  COLS.forEach(c => S.unsub.push(onSnapshot(col(c), snap => {
    S.data[c] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (S.route === c || S.route === 'painel' || (S.route === 'negocios' && c === 'clientes')) render();
  }, err => toast('Erro ao ler ' + c + ': ' + err.code))));
  S.unsub.push(onSnapshot(doc(db, 'users', S.uid, 'config', 'geral'), d => { if (d.exists()) S.config = { ...S.config, ...d.data() }; if (S.route === 'painel') render(); }));
  go(location.hash.slice(1) || 'painel');
});

// ---------- Navegação ----------
window.addEventListener('hashchange', () => go(location.hash.slice(1)));
function go(r) {
  S.route = NAV.some(n => n[0] === r) ? r : 'painel';
  S.filtro = {}; S.busca = ''; S.pag = 0;
  $('#nav').innerHTML = NAV.map(([id, ic, t]) => `<a href="#${id}" class="${id === S.route ? 'on' : ''}">${ic} ${t}</a>`).join('');
  $('#side').classList.remove('open');
  render();
}
function render() {
  const r = S.route;
  $('#pageTitle').textContent = NAV.find(n => n[0] === r)[2];
  $('#pageActions').innerHTML = '';
  if (r === 'painel') return renderPainel();
  if (r === 'dados') return renderDados();
  if (r === 'negocios') return renderKanban();
  renderLista(r);
}

// ---------- Painel ----------
function renderPainel() {
  const ped = (S.data.pedidos || []).filter(p => p.status !== 'Cancelado');
  const mes = today().slice(0, 7);
  const doMes = ped.filter(p => (p.data || '').startsWith(mes));
  const comMes = doMes.reduce((s, p) => s + comissao(p), 0);
  const vendMes = doMes.reduce((s, p) => s + (+p.valor || 0), 0);
  const aReceber = ped.filter(p => p.status === 'Faturado' || p.status === 'Digitado').reduce((s, p) => s + comissao(p), 0);
  const meta = +S.config.metaComissao || 15000;
  const pct = Math.min(100, Math.round(comMes / meta * 100));
  const neg = S.data.negocios || [];
  const abertos = neg.filter(n => !['Fechado', 'Perdido'].includes(n.etapa));
  const atrasados = abertos.filter(n => n.dataProximo && n.dataProximo < today()).sort((a, b) => a.dataProximo.localeCompare(b.dataProximo));
  const proximos = abertos.filter(n => n.dataProximo && n.dataProximo >= today()).sort((a, b) => a.dataProximo.localeCompare(b.dataProximo)).slice(0, 8);
  const vis = (S.data.visitas || []).filter(v => v.status === 'Agendada' && v.data >= today()).sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora)).slice(0, 8);
  const porRep = {}; doMes.forEach(p => { porRep[p.representadaId] = (porRep[p.representadaId] || 0) + comissao(p); });
  const cli = S.data.clientes || [];

  $('#pageActions').innerHTML = `<button class="btn small" id="btnMeta">Meta: ${brl(meta)}</button> <button class="btn primary" id="btnPed">+ Pedido</button>`;
  $('#btnPed').onclick = () => abrirForm('pedidos', null);
  $('#btnMeta').onclick = async () => {
    const v = prompt('Meta de comissão mensal (R$):', meta);
    if (v && !isNaN(+v.replace(',', '.'))) { await setDoc(doc(db, 'users', S.uid, 'config', 'geral'), { metaComissao: +v.replace(',', '.') }, { merge: true }); toast('Meta atualizada'); }
  };
  $('#view').innerHTML = `
  <div class="grid kpis">
    <div class="card kpi"><small>Comissão do mês</small><b>${brl(comMes)}</b><span>${pct}% da meta de ${brl(meta)}</span><div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="card kpi"><small>Vendido no mês</small><b>${brl(vendMes)}</b><span>${doMes.length} pedido(s)</span></div>
    <div class="card kpi"><small>Comissão a receber</small><b>${brl(aReceber)}</b><span>pedidos digitados + faturados</span></div>
    <div class="card kpi"><small>Pipeline aberto</small><b>${brl(abertos.reduce((s, n) => s + (+n.valor || 0), 0))}</b><span>${abertos.length} negociação(ões)</span></div>
    <div class="card kpi"><small>Clientes</small><b>${cli.filter(c => c.status === 'Cliente').length}</b><span>${cli.filter(c => c.status === 'Prospect').length} prospects na base</span></div>
  </div>
  <div class="grid two">
    <div class="card"><h3>⚠️ Follow-ups atrasados (${atrasados.length})</h3>${listaNeg(atrasados.slice(0, 8), true) || '<p class="muted">Nada atrasado. 👏</p>'}</div>
    <div class="card"><h3>📅 Próximos passos</h3>${listaNeg(proximos) || '<p class="muted">Sem próximos passos com data.</p>'}</div>
    <div class="card"><h3>📍 Próximas visitas</h3>${vis.length ? `<ul class="list">${vis.map(v => `<li><span><b>${esc(v.clienteNome)}</b><br><small class="muted">${esc(v.endereco || '')}</small></span><span class="tag orange">${fmtDate(v.data)} ${esc(v.hora || '')}</span></li>`).join('')}</ul>` : '<p class="muted">Nenhuma visita agendada.</p>'}</div>
    <div class="card"><h3>🏭 Comissão do mês por representada</h3>${Object.keys(porRep).length ? `<ul class="list">${Object.entries(porRep).sort((a, b) => b[1] - a[1]).map(([r, v]) => `<li><span>${esc(repNome(r))}</span><b>${brl(v)}</b></li>`).join('')}</ul>` : '<p class="muted">Nenhum pedido lançado neste mês.</p>'}</div>
  </div>`;
}
function listaNeg(arr, late) {
  if (!arr.length) return '';
  return `<ul class="list">${arr.map(n => `<li><span><b>${esc(n.clienteNome)}</b> <small class="muted">· ${esc(repNome(n.representadaId))}</small><br><small>${esc(n.proximoPasso || '')}</small></span><span class="tag ${late ? 'red' : 'blue'}">${fmtDate(n.dataProximo)}</span></li>`).join('')}</ul>`;
}

// ---------- Lista genérica ----------
function renderLista(nome) {
  const M = MOD[nome];
  const all = S.data[nome];
  $('#pageActions').innerHTML = `<button class="btn" id="btnCsv">Exportar CSV</button> <button class="btn primary" id="btnNovo">+ Novo ${M.singular}</button>`;
  if (!all) { $('#view').innerHTML = '<div class="empty">Carregando…</div>'; return; }
  const f = S.filtro;
  const q = norm(S.busca).split(/\s+/).filter(Boolean);
  let rows = all.filter(r => {
    if (q.length) { const hay = norm(M.busca.map(k => r[k]).join(' ')); if (!q.every(w => hay.includes(w))) return false; }
    for (const [k] of (M.filtros || [])) { if (f[k] && k !== 'rep' && k !== 'mes' && r[k] !== f[k]) return false; }
    return M.filtroExtra ? M.filtroExtra(r, f) : true;
  });
  rows.sort(M.ordem || ((a, b) => norm(a[M.colunas[0][0]]).localeCompare(norm(b[M.colunas[0][0]]))));
  const porPag = M.pagina || 50, pags = Math.max(1, Math.ceil(rows.length / porPag));
  S.pag = Math.min(S.pag || 0, pags - 1);
  const vis = rows.slice(S.pag * porPag, (S.pag + 1) * porPag);

  $('#view').innerHTML = `
  <div class="toolbar">
    <input type="search" id="busca" placeholder="Buscar ${M.titulo.toLowerCase()}…" value="${esc(S.busca)}">
    ${(M.filtros || []).map(([k, lbl, opts, fmt]) => `<select data-f="${k}"><option value="">${lbl}: todos</option>${opts().map(o => `<option value="${esc(o)}" ${f[k] === o ? 'selected' : ''}>${esc(fmt ? fmt(o) : o)}</option>`).join('')}</select>`).join('')}
  </div>
  <div class="tablewrap">${vis.length ? `<table><thead><tr>${M.colunas.map(c => `<th class="${c[3] || ''}">${c[1]}</th>`).join('')}</tr></thead>
  <tbody>${vis.map(r => `<tr data-id="${r.id}">${M.colunas.map(([k, , fn, cls]) => `<td class="${cls || ''}">${fn ? fn(r) : esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : `<div class="empty">Nenhum registro encontrado.</div>`}
  <div class="pager"><span>${rows.length} registro(s)${M.rodape ? ' · ' + M.rodape(rows) : ''}</span>
  <span>${pags > 1 ? `<button class="btn small" id="pPrev" ${S.pag ? '' : 'disabled'}>‹</button> ${S.pag + 1}/${pags} <button class="btn small" id="pNext" ${S.pag < pags - 1 ? '' : 'disabled'}>›</button>` : ''}</span></div></div>`;

  const b = $('#busca'); b.oninput = () => { S.busca = b.value; S.pag = 0; renderLista(nome); const nb = $('#busca'); nb.focus(); nb.setSelectionRange(nb.value.length, nb.value.length); };
  $('#view').querySelectorAll('select[data-f]').forEach(s => s.onchange = () => { S.filtro[s.dataset.f] = s.value; S.pag = 0; renderLista(nome); });
  $('#view').querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => abrirForm(nome, all.find(r => r.id === tr.dataset.id)));
  if ($('#pPrev')) { $('#pPrev').onclick = () => { S.pag--; renderLista(nome); }; $('#pNext').onclick = () => { S.pag++; renderLista(nome); }; }
  $('#btnNovo').onclick = () => abrirForm(nome, null);
  $('#btnCsv').onclick = () => baixarCsv(nome, rows);
}

// ---------- Pipeline (kanban) ----------
function renderKanban() {
  const neg = S.data.negocios;
  $('#pageActions').innerHTML = `<button class="btn primary" id="btnNovo">+ Nova negociação</button>`;
  $('#btnNovo').onclick = () => abrirForm('negocios', null);
  if (!neg) { $('#view').innerHTML = '<div class="empty">Carregando…</div>'; return; }
  const q = norm(S.busca);
  const fil = neg.filter(n => !q || norm([n.clienteNome, n.titulo, n.proximoPasso, repNome(n.representadaId)].join(' ')).includes(q));
  $('#view').innerHTML = `<div class="toolbar"><input type="search" id="busca" placeholder="Buscar negociação…" value="${esc(S.busca)}"></div>
  <div class="kanban">${ETAPAS.map(e => { const it = fil.filter(n => (n.etapa || 'Prospecção') === e); return `
    <div class="col" data-etapa="${e}"><h4><span>${e}</span><span class="muted">${it.length} · ${brl(it.reduce((s, n) => s + (+n.valor || 0), 0))}</span></h4>
    ${it.map(n => `<div class="deal" draggable="true" data-id="${n.id}"><b>${esc(n.clienteNome)}</b><small>${esc(repNome(n.representadaId) || n.titulo || '')}${n.valor ? ' · ' + brl(n.valor) : ''}</small>
    ${n.proximoPasso ? `<small class="${n.dataProximo && n.dataProximo < today() ? 'late' : ''}">→ ${esc(n.proximoPasso)}${n.dataProximo ? ' · ' + fmtDate(n.dataProximo) : ''}</small>` : ''}</div>`).join('')}</div>`; }).join('')}</div>
  <p class="muted small">Arraste os cartões entre as colunas para mudar a etapa. Clique para editar.</p>`;
  const b = $('#busca'); b.oninput = () => { S.busca = b.value; renderKanban(); const nb = $('#busca'); nb.focus(); nb.setSelectionRange(nb.value.length, nb.value.length); };
  $('#view').querySelectorAll('.deal').forEach(d => {
    d.onclick = () => abrirForm('negocios', neg.find(n => n.id === d.dataset.id));
    d.ondragstart = e => e.dataTransfer.setData('id', d.dataset.id);
  });
  $('#view').querySelectorAll('.col').forEach(c => {
    c.ondragover = e => { e.preventDefault(); c.classList.add('drop'); };
    c.ondragleave = () => c.classList.remove('drop');
    c.ondrop = async e => { e.preventDefault(); c.classList.remove('drop'); const id = e.dataTransfer.getData('id'); await updateDoc(doc(col('negocios'), id), { etapa: c.dataset.etapa, atualizadoEm: serverTimestamp() }); toast('Etapa: ' + c.dataset.etapa); };
  });
}

// ---------- Formulário (modal) ----------
function abrirForm(nome, reg) {
  const M = MOD[nome], novo = !reg || !reg.id, r = reg || defaults(nome);
  const dlg = $('#modal'), form = $('#modalForm');
  form.innerHTML = `<h3>${novo ? 'Novo ' + M.singular : 'Editar ' + M.singular}</h3><div class="fields">
  ${M.campos.map(([k, lbl, tipo = 'text', obrig, opts, cls]) => {
    const v = r[k] ?? '';
    let inp;
    if (tipo === 'select') inp = `<select name="${k}" ${obrig ? 'required' : ''}>${opts().map(o => { const [val, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select>`;
    else if (tipo === 'textarea') inp = `<textarea name="${k}">${esc(v)}</textarea>`;
    else if (tipo === 'checks') inp = `<div class="checks">${opts().map(([val, t]) => `<label><input type="checkbox" name="${k}" value="${esc(val)}" ${(v || []).includes(val) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>`;
    else if (tipo === 'cliente') inp = `<input name="${k}" list="dlClientes" value="${esc(v)}" ${obrig ? 'required' : ''} autocomplete="off"><datalist id="dlClientes">${(S.data.clientes || []).slice().sort((a, b) => (a.status === 'Cliente' ? -1 : 1) - (b.status === 'Cliente' ? -1 : 1)).slice(0, 2000).map(c => `<option value="${esc(c.nome)}">${esc(c.cidade || '')}</option>`).join('')}</datalist>`;
    else inp = `<input name="${k}" type="${tipo}" ${tipo === 'number' ? 'step="0.01"' : ''} value="${esc(v)}" ${obrig ? 'required' : ''}>`;
    return `<label class="${cls || ''}">${lbl}${obrig ? ' *' : ''}${inp}</label>`;
  }).join('')}</div>
  <div class="modal-actions"><span>${novo ? '' : '<button type="button" class="btn danger" id="btnDel">Excluir</button>'}${nome === 'clientes' && !novo ? ' <button type="button" class="btn" id="btnNeg">+ Negociação</button> <button type="button" class="btn" id="btnVis">+ Visita</button>' : ''}</span>
  <span style="display:flex;gap:6px"><button type="button" class="btn" id="btnCancel">Cancelar</button> <button type="submit" class="btn primary" value="ok">Salvar</button></span></div>`;
  dlg.showModal();
  $('#btnCancel').onclick = () => dlg.close();
  if (nome === 'pedidos') {
    const sel = form.elements.representadaId, pct = form.elements.comissaoPct;
    sel.onchange = () => { const rp = (S.data.representadas || []).find(x => x.id === sel.value); if (rp && rp.comissaoPct) pct.value = rp.comissaoPct; };
  }
  if ((nome === 'visitas') && form.elements.endereco) {
    form.elements.clienteNome.onchange = () => { const c = (S.data.clientes || []).find(x => x.nome === form.elements.clienteNome.value); if (c && !form.elements.endereco.value) form.elements.endereco.value = [c.endereco, c.bairro, c.cidade].filter(Boolean).join(', '); };
  }
  if (!novo) {
    $('#btnDel').onclick = async () => { if (confirm('Excluir este registro?')) { await deleteDoc(doc(col(nome), reg.id)); dlg.close(); toast('Excluído'); } };
    if ($('#btnNeg')) {
      $('#btnNeg').onclick = () => { dlg.close(); abrirForm('negocios', { ...defaults('negocios'), clienteNome: reg.nome, contato: [reg.comprador, reg.telefone].filter(Boolean).join(' ') , id: undefined }); };
      $('#btnVis').onclick = () => { dlg.close(); abrirForm('visitas', { ...defaults('visitas'), clienteNome: reg.nome, endereco: [reg.endereco, reg.bairro, reg.cidade].filter(Boolean).join(', '), id: undefined }); };
    }
  }
  form.onsubmit = async e => {
    e.preventDefault();
    const d = {};
    M.campos.forEach(([k, , tipo = 'text']) => {
      if (tipo === 'checks') d[k] = [...form.querySelectorAll(`input[name="${k}"]:checked`)].map(i => i.value);
      else if (tipo === 'number') d[k] = form.elements[k].value === '' ? 0 : Number(form.elements[k].value);
      else d[k] = form.elements[k].value.trim();
    });
    M.antesSalvar?.(d);
    d.atualizadoEm = serverTimestamp();
    try {
      if (reg && reg.id) await updateDoc(doc(col(nome), reg.id), d);
      else { d.criadoEm = serverTimestamp(); await addDoc(col(nome), d); }
      dlg.close(); toast('Salvo ✔');
    } catch (err) { toast('Erro ao salvar: ' + err.code); }
  };
}
function defaults(nome) {
  return { negocios: { etapa: 'Prospecção' }, visitas: { data: today(), status: 'Agendada' }, pedidos: { data: today(), status: 'Digitado' }, clientes: { status: 'Prospect', representadas: [] } }[nome] || {};
}

// ---------- CSV ----------
function baixarCsv(nome, rows) {
  const M = MOD[nome], ks = M.campos.map(c => c[0]);
  const linhas = [ks.map(k => M.campos.find(c => c[0] === k)[1]).join(';'), ...rows.map(r => ks.map(k => { let v = r[k]; if (Array.isArray(v)) v = v.map(repNome).join(', '); if (k === 'representadaId') v = repNome(v); return `"${String(v ?? '').replace(/"/g, '""')}"`; }).join(';'))];
  baixar(`${nome}_${today()}.csv`, '\ufeff' + linhas.join('\n'), 'text/csv');
}
function baixar(nomeArq, conteudo, tipo) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo })); a.download = nomeArq; a.click(); URL.revokeObjectURL(a.href);
}

// ---------- Importar / backup ----------
function renderDados() {
  const cont = COLS.map(c => `<li><span>${c}</span><b>${(S.data[c] || []).length}</b></li>`).join('');
  $('#view').innerHTML = `<div class="grid two" style="margin-top:0">
  <div class="card"><h3>📥 Importar dados</h3>
    <p class="muted">Selecione o arquivo <code>seed_felipe_varone.json</code> (está na sua pasta REPRESENTAÇÃO\\Sistema) ou um backup gerado aqui. O arquivo é lido no seu computador e enviado direto para o seu Firebase — ele nunca vai para o GitHub.</p>
    <label class="checks" style="margin:10px 0"><label><input type="checkbox" id="chkLimpar"> Apagar os dados atuais antes de importar</label></label>
    <input type="file" id="arq" accept=".json">
    <p id="impMsg" class="small"></p></div>
  <div class="card"><h3>💾 Backup</h3><p class="muted">Baixe uma cópia de todos os seus dados (JSON). Recomendado uma vez por semana.</p>
    <button class="btn primary" id="btnBackup">Baixar backup completo</button>
    <h3 style="margin-top:22px">Registros no sistema</h3><ul class="list">${cont}</ul></div></div>`;
  $('#btnBackup').onclick = () => { const out = { versao: 1, geradoEm: today() }; COLS.forEach(c => out[c] = (S.data[c] || []).map(({ atualizadoEm, criadoEm, ...r }) => r)); baixar(`backup_sistema_${today()}.json`, JSON.stringify(out), 'application/json'); };
  $('#arq').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const msg = $('#impMsg');
    let data; try { data = JSON.parse(await file.text()); } catch { msg.textContent = 'Arquivo inválido.'; return; }
    const total = COLS.reduce((s, c) => s + (data[c] || []).length, 0);
    if (!confirm(`Importar ${total} registros?${$('#chkLimpar').checked ? '\nOs dados atuais serão APAGADOS antes.' : ''}`)) return;
    try {
      if ($('#chkLimpar').checked) for (const c of COLS) { const snap = await getDocs(col(c)); await emLotes(snap.docs, (b, d) => b.delete(d.ref), n => msg.textContent = `Apagando ${c}… ${n}`); }
      let feitos = 0;
      for (const c of COLS) {
        const itens = data[c] || [];
        await emLotes(itens, (b, it) => { const { id, ...r } = it; const ref = id ? doc(col(c), String(id)) : doc(col(c)); b.set(ref, { ...r, criadoEm: serverTimestamp() }); }, n => { msg.textContent = `Importando ${c}… ${feitos + n}/${total}`; });
        feitos += itens.length;
      }
      msg.textContent = `✔ ${total} registros importados.`; toast('Importação concluída');
    } catch (err) { msg.textContent = 'Erro na importação: ' + (err.code || err.message); }
  };
}
async function emLotes(itens, fn, progresso) {
  for (let i = 0; i < itens.length; i += 400) {
    const b = writeBatch(db); itens.slice(i, i + 400).forEach(it => fn(b, it)); await b.commit(); progresso(Math.min(i + 400, itens.length));
  }
}
