import {
  backend as anonBackend,
  idlFactory as backendIdl,
  canisterId as backendId
} from 'declarations/backend';

import { AuthClient } from '@dfinity/auth-client';
import { HttpAgent, Actor } from '@dfinity/agent';

// ====== CONFIG: treasury for real ICP transfers (AccountIdentifier) ======
// Поставь сюда свой аккаунт (32-байтный AccountIdentifier в hex без '0x')
// оставь пустым, если хочешь оставить режим «заглушки»
const TREASURY_ACCOUNT_ID = ""; // e.g. "aabbcc..."

// ---------- UI ----------
const $events = document.getElementById('events');
const $tickets = document.getElementById('tickets');
const $search = document.getElementById('search');
const $category = document.getElementById('category');
const $date = document.getElementById('date');
const $refresh = document.getElementById('refresh');

const $plugBtn = document.getElementById('plug-btn');
const $plugStatus = document.getElementById('plug-status');
const $principal = document.getElementById('principal');
const $plugIcp = document.getElementById('plug-icp');
const $avatar = document.getElementById('avatar');

const $iiBtn = document.getElementById('ii-btn');
const $authStatus = document.getElementById('auth-status');
const $themeBtn = document.getElementById('theme-btn');
const $aiBtn = document.getElementById('ai-btn');

const $realPay = document.getElementById('real-pay');

// form
const $e_title = document.getElementById('e_title');
const $e_date = document.getElementById('e_date');
const $e_time = document.getElementById('e_time');
const $e_city = document.getElementById('e_city');
const $e_category = document.getElementById('e_category');
const $e_venue = document.getElementById('e_venue');
const $e_image = document.getElementById('e_image');
const $e_price_uah = document.getElementById('e_price_uah');
const $e_price_icp = document.getElementById('e_price_icp');
const $e_desc = document.getElementById('e_desc');
const $createBtn = document.getElementById('create-btn');
const $cancelEdit = document.getElementById('cancel-edit');

// overlay/toasts/password/ai
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');
const $toasts = document.getElementById('toasts');
const $pwdModal = document.getElementById('pwd-modal');
const $pwdInput = document.getElementById('pwd-input');
const $pwdOk = document.getElementById('pwd-ok');
const $pwdCancel = document.getElementById('pwd-cancel');
const $aiModal = document.getElementById('ai-modal');
const $aiClose = document.getElementById('ai-close');

// ---------- state ----------
let EVENTS = [];
let actor = anonBackend;
let principalText = '';
let principalRaw = null;
const host = 'https://icp0.io';
const whitelist = [backendId];
let editId = null;

// ---------- helpers ----------
function shortPrincipal(p) {
  if (!p) return '';
  return p.length > 20 ? `${p.slice(0,8)}…${p.slice(-6)}` : p;
}
function setAuthStatus(txt) { $authStatus.textContent = `Auth: ${txt}`; }
function fmtIcpE8s(e8s) { return (Number(e8s) / 1e8).toFixed(4); }
function showOverlay(show, text = 'Processing…') { overlay.style.display = show ? 'flex' : 'none'; overlayText.textContent = text; }
function showPwdModal(show) { $pwdModal.style.display = show ? 'flex' : 'none'; $pwdInput.value=''; if (show) $pwdInput.focus(); }
function showAiModal(show) { $aiModal.style.display = show ? 'flex' : 'none'; }

function toast(msg, ok=true){
  const d = document.createElement('div');
  d.className = `toast ${ok ? 'ok':'err'}`;
  d.textContent = msg;
  $toasts.append(d);
  setTimeout(()=>{ d.remove(); }, 3500);
}

function toggleTheme(){
  const el = document.documentElement;
  const cur = el.getAttribute('data-theme') || 'dark';
  el.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
  localStorage.setItem('rvra_theme', el.getAttribute('data-theme'));
}
(function initTheme(){
  const saved = localStorage.getItem('rvra_theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  $themeBtn.addEventListener('click', toggleTheme);
})();

// keyboard UX
window.addEventListener('keydown', (e)=>{
  if (e.key === '/' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); $search.focus(); }
  if ((e.key.toLowerCase()==='k') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); toggleTheme(); }
});

// persist filters
(function restoreFilters(){
  const f = JSON.parse(localStorage.getItem('rvra_filters') || '{}');
  if (f.q) $search.value = f.q;
  if (f.cat) $category.value = f.cat;
  if (f.date) $date.value = f.date;
})();
function saveFilters(){
  localStorage.setItem('rvra_filters', JSON.stringify({ q:$search.value, cat:$category.value, date:$date.value }));
}
[$search,$category,$date].forEach(i => i.addEventListener('input', ()=>{ saveFilters(); renderEvents(); }));
$refresh.addEventListener('click', ()=>{ $search.value=''; $category.value='All'; $date.value=''; saveFilters(); renderEvents(); });

// identicon
function drawIdenticon(canvas, str) {
  if (!canvas || !str) return;
  const ctx = canvas.getContext('2d');
  const hash = Array.from(new TextEncoder().encode(str)).reduce((a,b)=>((a<<5)-a)+b,0) >>> 0;
  const size = 5, scale = Math.floor(canvas.width/size);
  for (let y=0; y<size; y++){
    for (let x=0; x<size; x++){
      const bit = (hash >> ((x + y*size) % 31)) & 1;
      ctx.fillStyle = bit ? '#00f0ff' : '#11162a';
      ctx.fillRect(x*scale, y*scale, scale, scale);
    }
  }
}

// ---------- II ----------
let authClient = null;

async function initAuthClient() {
  authClient = await AuthClient.create();
  if (await authClient.isAuthenticated()) {
    await useIIIdentity();
  } else {
    setAuthStatus('anonymous');
  }
}

async function loginII() {
  try {
    await authClient.login({
      identityProvider: 'https://identity.ic0.app',
      onSuccess: useIIIdentity,
    });
  } catch (e) {
    console.error('II login error:', e);
    toast('II login failed', false);
  }
}

async function logoutII() {
  try {
    await authClient.logout();
  } catch (e) {
    console.error('II logout error:', e);
  } finally {
    actor = anonBackend;
    principalText = '';
    principalRaw = null;
    setAuthStatus('anonymous');
    $principal.textContent = '';
    drawIdenticon($avatar, '');
    toast('Signed out');
    await loadTickets();
    await loadEvents();
  }
}

async function useIIIdentity() {
  const identity = authClient.getIdentity();
  const agent = new HttpAgent({ identity });
  if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    await agent.fetchRootKey();
  }
  actor = Actor.createActor(backendIdl, { agent, canisterId: backendId });
  try {
    principalRaw = identity.getPrincipal();
    principalText = principalRaw.toText();
    setAuthStatus('II connected');
    $principal.textContent = shortPrincipal(principalText);
    drawIdenticon($avatar, principalText);
    document.getElementById('profile').classList.remove('hidden');
    toast('II connected');
  } catch (e) {
    console.error('useIIIdentity error:', e);
    setAuthStatus('anonymous');
    actor = anonBackend;
  } finally {
    await loadTickets();
    await loadEvents();
  }
}

// ---------- Plug ----------
async function refreshPlugBalance() {
  if (!window.ic?.plug?.requestBalance) { $plugIcp.textContent = 'ICP: —'; return; }
  try {
    const balances = await window.ic.plug.requestBalance();
    const icp = balances?.find?.(b => b?.symbol === 'ICP');
    if (icp && typeof icp.amount !== 'undefined') {
      const dec = icp.decimals ?? 8;
      const amt = Number(icp.amount) / (10 ** dec);
      $plugIcp.textContent = `ICP: ${amt.toFixed(4)}`;
    } else {
      $plugIcp.textContent = 'ICP: 0.0000';
    }
  } catch (e) {
    console.warn('requestBalance failed', e);
    $plugIcp.textContent = 'ICP: —';
  }
}

async function updatePlugUi() {
  if (!window.ic || !window.ic.plug) {
    $plugStatus.textContent = 'Plug: not installed';
    $plugBtn.textContent = 'Get Plug';
    $plugBtn.onclick = () => window.open('https://plugwallet.ooo/', '_blank', 'noreferrer');
    $plugIcp.textContent = 'ICP: —';
    return;
  }
  const connected = await window.ic.plug.isConnected();
  if (!connected) {
    $plugStatus.textContent = 'Plug: disconnected';
    $plugBtn.textContent = 'Connect Plug';
    $plugBtn.onclick = connectPlug;
    $plugIcp.textContent = 'ICP: —';
  } else {
    const p = await window.ic.plug.getPrincipal();
    principalText = p?.toText?.() || String(p);
    principalRaw = p;
    $plugStatus.textContent = 'Plug: connected';
    $plugBtn.textContent = 'Disconnect';
    $plugBtn.onclick = disconnectPlug;
    $principal.textContent = shortPrincipal(principalText);
    drawIdenticon($avatar, principalText);
    document.getElementById('profile').classList.remove('hidden');
    actor = await window.ic.plug.createActor({ canisterId: backendId, interfaceFactory: backendIdl });
    setAuthStatus('Plug connected');
    await refreshPlugBalance();
    toast('Plug connected');
  }
}

async function connectPlug() {
  try {
    await window.ic.plug.requestConnect({ whitelist, host });
    if (!window.ic.plug.agent) {
      await window.ic.plug.createAgent({ whitelist, host });
    }
  } catch (e) {
    console.error('Plug connect error:', e);
    toast('Plug connect failed', false);
  } finally {
    await updatePlugUi();
    await loadTickets();
    await loadEvents();
  }
}

async function disconnectPlug() {
  try {
    if (window.ic?.plug?.disconnect) await window.ic.plug.disconnect();
  } catch (e) {
    console.error('Plug disconnect error:', e);
  } finally {
    actor = anonBackend;
    setAuthStatus('anonymous');
    principalText = '';
    principalRaw = null;
    document.getElementById('profile').classList.add('hidden');
    drawIdenticon($avatar, '');
    await updatePlugUi();
    await loadTickets();
    await loadEvents();
    toast('Plug disconnected');
  }
}

// ---------- App ----------
function eventMatches(e) {
  const q = ($search.value || '').trim().toLowerCase();
  const cat = $category.value || 'All';
  const d = $date.value || '';
  if (q && !(e.title.toLowerCase().includes(q) || e.city.toLowerCase().includes(q))) return false;
  if (cat !== 'All' && e.category !== cat) return false;
  if (d && e.date !== d) return false;
  return true;
}

function el(tag, cls, txt) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt) n.textContent = txt;
  return n;
}

async function loadEvents() {
  try {
    const list = await actor.get_events(); // важно: читаем текущим актором
    EVENTS = list;
    renderEvents();
  } catch (e) {
    console.error('get_events failed', e);
    try {
      const list = await anonBackend.get_events();
      EVENTS = list;
      renderEvents();
    } catch (e2) {
      console.error('anon get_events failed', e2);
      $events.innerHTML = '';
      $events.append(el('div','card','Cannot load events.'));
    }
  }
}

function ownerCanEdit(ev) {
  const created = ev.created_by && Array.isArray(ev.created_by) ? ev.created_by[0] : null;
  if (!created) return true; // seeded events: editable by anyone
  if (!principalText) return false;
  try {
    const toText = created?.toText ? created.toText() : String(created);
    return toText === principalText;
  } catch {
    return false;
  }
}

async function renderEvents() {
  $events.innerHTML = '';
  const filtered = EVENTS.filter(eventMatches);
  if (!filtered.length) {
    $events.append(el('div','card','No events found.'));
    return;
  }
  for (const ev of filtered) {
    const card = el('div','card event');
    const img = el('img'); img.src = ev.image; img.alt = ev.title;
    const h3 = el('h3', null, ev.title);
    const p1 = el('p', null, `Date: ${ev.date} ${ev.time}`);
    const p2 = el('p', null, `City: ${ev.city}`);
    const p3 = el('p', null, `Venue: ${ev.venue}`);
    const row = el('div','row');
    row.append(
      el('span','tag', ev.category),
      el('span','tag', `${ev.price_uah} UAH`),
      el('span','tag', `${fmtIcpE8s(ev.price_e8s)} ICP`)
    );

    const btns = el('div','row');
    const buyBtn = el('button','btn','Buy ticket');
    buyBtn.addEventListener('click', () => buy(ev, buyBtn));
    btns.append(buyBtn);

    if (ownerCanEdit(ev)) {
      const editBtn = el('button','btn outline','Edit');
      editBtn.addEventListener('click', () => beginEdit(ev));
      const delBtn = el('button','btn outline','Delete');
      delBtn.addEventListener('click', () => confirmDeleteEvent(ev.id));
      btns.append(editBtn, delBtn);
    }

    card.append(img,h3,p1,p2,p3,row,btns);
    $events.append(card);
  }
}

async function maybeRealTransfer(ev){
  // реальная оплата ICP через Plug (если включен тумблер и задан TREASURY_ACCOUNT_ID)
  if (!$realPay.checked) return true; // пропускаем, если выключено
  if (!window.ic?.plug?.requestTransfer) { toast('Plug transfer API not available', false); return false; }
  if (!TREASURY_ACCOUNT_ID) { toast('No treasury account set', false); return false; }

  try{
    await window.ic.plug.requestTransfer({
      to: TREASURY_ACCOUNT_ID,
      amount: BigInt(ev.price_e8s),
      memo: `rvra-${ev.id}-${Date.now()}`,
    });
    return true;
  }catch(e){
    console.error('requestTransfer failed', e);
    toast('Payment cancelled or failed', false);
    return false;
  }
}

async function buy(ev, btn) {
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Processing…';
  try {
    if (actor === anonBackend) {
      toast('Please sign in with II or connect Plug to buy.', false);
      return;
    }
    showOverlay(true, $realPay.checked ? 'Transferring ICP…' : 'Minting ticket…');
    await sleep(400);

    if ($realPay.checked) {
      const ok = await maybeRealTransfer(ev);
      if (!ok) return;
    }

    const t = await actor.buy_ticket(BigInt(ev.id)); // u64 -> BigInt
    await loadTickets();
    toast('Ticket minted ✓', true);
  } catch (e) {
    console.error(e);
    toast(parseErr(e, 'Failed to buy ticket'), false);
  } finally {
    showOverlay(false);
    btn.disabled = false;
    btn.textContent = orig;
  }
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function parseErr(e, fallback) { const s = (''+e).toLowerCase?.() || String(e); if (s.includes('anonymous')) return 'Please sign in.'; if (s.includes('invalid password')) return 'Invalid password'; return fallback; }

// ---------- Tickets ----------
async function loadTickets() {
  try {
    const list = await actor.get_my_tickets();
    $tickets.innerHTML = '';
    if (!list.length) {
      $tickets.append(el('div', null, 'You have no tickets yet.'));
      return;
    }
    for (const t of list) {
      const box = el('div','ticket');
      const left = el('div');
      left.append(
        el('h4', null, t.title),
        el('small', null, `Date: ${t.date} ${t.time}`),
        el('small', null, `City: ${t.city}`),
        el('small', null, `Venue: ${t.venue}`),
        el('small', null, `Category: ${t.category}`),
        el('small', null, `Price: ${t.price_uah} UAH / ${fmtIcpE8s(t.price_e8s)} ICP`)
      );
      const right = el('div');
      const canvas = el('canvas');
      right.append(canvas);
      box.append(left, right);

      try { QRCode.toCanvas(canvas, t.qr_code, { width: 150 }); } catch {}

      const row = el('div','row');
      const del = el('button','btn outline','Delete ticket');
      del.addEventListener('click', async ()=>{
        if (!confirm('Delete this ticket?')) return;
        try{
          await actor.delete_ticket(t.id);
          await loadTickets();
          toast('Ticket deleted');
        }catch(e){
          console.error(e);
          toast('Failed to delete ticket', false);
        }
      });
      row.append(del);
      box.append(row);

      $tickets.append(box);
    }
  } catch (e) {
    console.error('loadTickets error:', e);
    $tickets.innerHTML = '';
    $tickets.append(el('div', null, 'Cannot fetch tickets (are you connected?).'));
  }
}

// ---------- Create / Edit / Delete Event ----------
function readForm() {
  const title = ($e_title.value || '').trim();
  const date = ($e_date.value || '').trim();
  const time = ($e_time.value || '').trim();
  const city = ($e_city.value || '').trim();
  const category = ($e_category.value || '').trim();
  const venue = ($e_venue.value || '').trim();
  const image = ($e_image.value || '').trim();
  const description = ($e_desc.value || '').trim();
  const price_uah = Math.max(0, Math.floor(Number($e_price_uah.value || 0)));
  const icpFloat = Number($e_price_icp.value || 0);
  const price_e8s = Math.max(0, Math.round(icpFloat * 1e8));
  return { title, date, time, city, category, venue, image, description, price_uah, price_e8s };
}
function clearForm() {
  [$e_title,$e_date,$e_time,$e_city,$e_category,$e_venue,$e_image,$e_price_uah,$e_price_icp,$e_desc].forEach(i => i.value = '');
}
function fillForm(ev) {
  $e_title.value = ev.title || '';
  $e_date.value = ev.date || '';
  $e_time.value = ev.time || '';
  $e_city.value = ev.city || '';
  $e_category.value = ev.category || '';
  $e_venue.value = ev.venue || '';
  $e_image.value = ev.image || '';
  $e_price_uah.value = ev.price_uah || 0;
  $e_price_icp.value = (Number(ev.price_e8s) / 1e8) || 0;
  $e_desc.value = ev.description || '';
}
function beginEdit(ev) {
  editId = ev.id;
  fillForm(ev);
  $createBtn.textContent = 'Save changes';
  $createBtn.dataset.mode = 'edit';
  $cancelEdit.classList.remove('hidden');
}
$cancelEdit.addEventListener('click', () => {
  editId = null; clearForm();
  $createBtn.textContent = 'Create';
  delete $createBtn.dataset.mode;
  $cancelEdit.classList.add('hidden');
});

async function confirmDeleteEvent(id) {
  if (!confirm('Delete this event? This action cannot be undone.')) return;
  try {
    await actor.delete_event(BigInt(id));
    await loadEvents();
    toast('Event deleted');
    if (editId === id) {
      editId = null; clearForm();
      $createBtn.textContent = 'Create';
      delete $createBtn.dataset.mode;
      $cancelEdit.classList.add('hidden');
    }
  } catch (e) {
    console.error(e);
    toast('Failed to delete (are you the creator?)', false);
  }
}

// password flow
function askPassword() {
  return new Promise((resolve)=>{
    showPwdModal(true);
    const ok = () => { showPwdModal(false); resolve($pwdInput.value || ''); cleanup(); };
    const cancel = () => { showPwdModal(false); resolve(null); cleanup(); };
    const cleanup = () => {
      $pwdOk.removeEventListener('click', ok);
      $pwdCancel.removeEventListener('click', cancel);
      $pwdInput.removeEventListener('keydown', onKey);
    };
    const onKey = (e)=>{ if(e.key==='Enter') ok(); if(e.key==='Escape') cancel(); };
    $pwdOk.addEventListener('click', ok);
    $pwdCancel.addEventListener('click', cancel);
    $pwdInput.addEventListener('keydown', onKey);
  });
}

$createBtn.addEventListener('click', async () => {
  const data = readForm();
  if (!data.title || !data.date || !data.time || !data.city || !data.category) {
    alert('Please fill Title, Date, Time, City, Category.');
    return;
  }
  try {
    if ($createBtn.dataset.mode === 'edit' && editId != null) {
      const ev = await actor.update_event(BigInt(editId), data);
      await loadEvents();
      toast(`Event updated: ${ev.title}`);
      editId = null; clearForm();
      $createBtn.textContent = 'Create';
      delete $createBtn.dataset.mode;
      $cancelEdit.classList.add('hidden');
    } else {
      const pwd = await askPassword();
      if (pwd == null) return;
      const ev = await actor.create_event_pwd(pwd, data);
      clearForm();
      await loadEvents();
      toast(`Event created: ${ev.title}`);
    }
  } catch (e) {
    console.error(e);
    const s = (''+e).toLowerCase();
    if (s.includes('invalid password')) toast('Invalid password', false);
    else if (s.includes('only the creator')) toast('Denied: only the creator', false);
    else toast('Failed to submit.', false);
  }
});

// filters also re-render
[$search, $category, $date].forEach(i => i.addEventListener('input', renderEvents));

// AI modal
$aiBtn.addEventListener('click', ()=> showAiModal(true));
$aiClose.addEventListener('click', ()=> showAiModal(false));
$aiModal.addEventListener('click', (e)=>{ if (e.target === $aiModal) showAiModal(false); });

// ---------- init ----------
async function init() {
  await initAuthClient();
  await updatePlugUi();
  $iiBtn.onclick = async () => {
    if (authClient && (await authClient.isAuthenticated())) {
      await logoutII();
      $iiBtn.textContent = 'Sign in with II';
    } else {
      await loginII();
      $iiBtn.textContent = 'Sign out';
    }
  };
  await loadEvents();
  await loadTickets();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
