// app.js - Single-file SPA implementation
// Vanilla JS, in-memory state, defensive DOM bindings

const UOMS = [
  { code: 'PCS', label: 'Pieces (PCS)' },
  { code: 'SET', label: 'Set (SET)' },
  { code: 'BOX', label: 'Box (BOX)' },
  { code: 'KG', label: 'Kilogram (KG)' },
  { code: 'G', label: 'Gram (G)' },
  { code: 'L', label: 'Liter (L)' },
  { code: 'ML', label: 'Milliliter (ML)' }
];
const MOVEMENT_PAGE_SIZE = 5;
const PO_PAGE_SIZE = 6;
let PO_CATALOG = [];

const PROFILES = [
  { name: 'Arief Setiawan', role: 'Property PIC' },
  { name: 'Zahran', role: 'Operational Manager' },
  { name: 'Audy', role: 'Operation Lead' },
  { name: 'Leon', role: 'Property Head' }
];

const state = {
  activePage: 'room-inventory',
  selectedProperty: 'Urbanview Jakarta Sudirman',
  currentUser: PROFILES[0],
  roomInventoryItems: [],
  laundryInventoryItems: [],
  stockOpnameSessions: [],
  stockOpnameLines: {},
  replenishmentRequests: [],
  incomingDocs: [],
  outgoingDocs: [],
  nextIds: { roomItem: 1, laundryItem: 1, stockOpname: 1, repl: 1, replLine: 1 }
};

let currentOpnameSessionId = null;
let currentReplId = null;
let incomingFormLines = [];
let outgoingFormLines = [];
let movementTab = 'IN'; // for UI toggle
let adjustContext = null;
let movementHistoryPage = 1;
let editingIncomingId = null;
let editingOutgoingId = null;
let recordTab = 'IN';
let replModalLines = [];
let currentReplEditingId = null;
let poSearchQuery = '';
let poSearchPage = 1;
let replModalReadOnly = false;

/* Utilities */
function safeNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function nextReplId() { return 'RR-' + String(state.nextIds.repl++).padStart(3, '0'); }
function nextReplLineId() { return 'RL-' + state.nextIds.replLine++; }
function nextIncomingId() { return 'IN-' + String(state.incomingDocs.length + 1).padStart(4, '0'); }
function nextOutgoingId() { return 'OUT-' + String(state.outgoingDocs.length + 1).padStart(4, '0'); }
function getUomLabel(code) { const found = UOMS.find(u => u.code === code); return found ? found.label : code || '-'; }
function initUomSelect(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '';
  UOMS.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.code;
    opt.textContent = u.label;
    sel.appendChild(opt);
  });
}

function deleteReplenishment(id){
  const req = state.replenishmentRequests.find(r=>r.id===id);
  if(!req) return;
  if(req.status !== 'DRAFT') return showToast('Only drafts can be deleted');
  if(req.requestorName !== state.currentUser.name) return showToast('Only submitter can delete this draft');
  const confirmed = window.confirm(`Delete ${id}?`);
  if(!confirmed) return;
  state.replenishmentRequests = state.replenishmentRequests.filter(r=>r.id!==id);
  renderReplenishmentList();
  showToast('Replenishment deleted');
}

function printReplenishment(id){
  const req = state.replenishmentRequests.find(r=>r.id===id);
  if(!req) return;
  showToast('Preparing print...');
  setTimeout(()=>window.print(), 150);
}
function getInventoryItemWithType(id, type) { return type === 'ROOM' ? state.roomInventoryItems.find(i => i.id === id) : state.laundryInventoryItems.find(i => i.id === id); }
function getCombinedInventory() { return [...state.roomInventoryItems.map(i => ({ ...i, type: 'ROOM' })), ...state.laundryInventoryItems.map(i => ({ ...i, type: 'LAUNDRY' }))]; }
function defaultUomCode() { return (UOMS[0] && UOMS[0].code) || 'PCS'; }
function isCurrentUserPropertyPIC(){ return state.currentUser.role === 'Property PIC'; }
function showToast(msg) { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 2000); }
function snapshotDoc(doc) {
  const { history, ...rest } = doc || {};
  return JSON.parse(JSON.stringify(rest));
}
function adjustInventoryForDoc(doc, direction, sign = 1) {
  if (!doc || !Array.isArray(doc.lines)) return;
  doc.lines.forEach(ln => {
    const list = ln.type === 'ROOM' ? state.roomInventoryItems : state.laundryInventoryItems;
    const item = list.find(i => i.id === ln.itemId);
    if (!item) return;
    const qty = safeNumber(ln.qty);
    const delta = (direction === 'IN' ? qty : -qty) * sign;
    item.onHand = Math.max(0, safeNumber(item.onHand) + delta);
  });
}
function addMovementLog(doc, action, detail) {
  if (!doc) return;
  doc.history = doc.history || [];
  doc.history.push({ ts: new Date().toISOString(), action, detail, snapshot: snapshotDoc(doc) });
}
function computeLast7dUsage(itemId, type){
  const today = new Date();
  const cutoff = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  return state.outgoingDocs.reduce((sum, doc) => {
    if(doc.destType !== 'DEPARTMENT') return sum;
    if(!doc.date) return sum;
    const d = new Date(doc.date);
    if(isNaN(d.getTime()) || d < cutoff) return sum;
    (doc.lines || []).forEach(ln => {
      if(ln.itemId === itemId && ln.type === type){
        sum += safeNumber(ln.qty);
      }
    });
    return sum;
  }, 0);
}
function pushMovementDoc(doc, direction) {
  if (direction === 'IN') {
    state.incomingDocs.push(doc);
  } else if (direction === 'OUT') {
    state.outgoingDocs.push(doc);
  }
}
function findMovementDoc(direction, id) {
  const list = direction === 'IN' ? state.incomingDocs : state.outgoingDocs;
  return list.find(d => d.id === id);
}
function postMovement(doc, direction) {
  doc.status = 'POSTED';
  addMovementLog(doc, 'Posted', 'New movement recorded');
  adjustInventoryForDoc(doc, direction, 1);
  pushMovementDoc(doc, direction);
  movementHistoryPage = 1;
  renderAll();
}
function discardMovement(doc, direction) {
  if (!doc || doc.status === 'DISCARDED') return;
  adjustInventoryForDoc(doc, direction, -1);
  doc.status = 'DISCARDED';
  addMovementLog(doc, 'Discarded', 'Movement discarded and stock reverted');
  movementHistoryPage = 1;
  renderAll();
}
function modifyMovement(doc, direction, newDocData) {
  if (!doc || doc.status === 'DISCARDED') return showToast('Cannot modify discarded movement');
  adjustInventoryForDoc(doc, direction, -1);
  Object.assign(doc, newDocData, { status: 'POSTED' });
  addMovementLog(doc, 'Modified', 'Movement modified by Property PIC');
  adjustInventoryForDoc(doc, direction, 1);
  movementHistoryPage = 1;
  renderAll();
}
function revertMovement(doc, direction) {
  if (!doc || !doc.history || doc.history.length < 2) { showToast('No previous version to revert'); return; }
  const targetSnapshot = doc.history[doc.history.length - 2].snapshot;
  adjustInventoryForDoc(doc, direction, -1);
  Object.keys(doc).forEach(k => { if (k !== 'history') delete doc[k]; });
  Object.assign(doc, snapshotDoc(targetSnapshot), { history: doc.history });
  addMovementLog(doc, 'Reverted', 'Reverted to previous version');
  adjustInventoryForDoc(doc, direction, 1);
  movementHistoryPage = 1;
  renderAll();
}

/* Init */
document.addEventListener('DOMContentLoaded', () => {
  seedDummyData();
  bindProfiles();
  renderPODatalist();
  bindNavigation();
  bindHeader();
  initUomSelect('roomItemUnit');
  initUomSelect('laundryItemUnit');
  initModals();
  bindRoomInventory();
  bindLaundryInventory();
  bindStockAlert();
  bindStockOpname();
  bindReplenishment();
  bindStockMovements();
  bindStockOnHand();
  bindAdjustStock();
  resetMovementForms();
  renderAll();
});

/* Seed */
function seedDummyData() {
  state.roomInventoryItems = [
    { id: 'R' + state.nextIds.roomItem++, name: 'Amenity Kit - Standard', category: 'Amenities', unit: 'PCS', mandatory: true, parPerRoom: 1, minStock: 200, maxStock: 600, onHand: 150, status: 'ACTIVE' },
    { id: 'R' + state.nextIds.roomItem++, name: '600ml Mineral Water', category: 'Beverage', unit: 'PCS', mandatory: true, parPerRoom: 2, minStock: 400, maxStock: 1000, onHand: 380, status: 'ACTIVE' },
    { id: 'R' + state.nextIds.roomItem++, name: 'Facial Tissue Box', category: 'Disposable', unit: 'BOX', mandatory: false, parPerRoom: 1, minStock: 120, maxStock: 400, onHand: 60, status: 'ACTIVE' }
  ];

  state.laundryInventoryItems = [
    { id: 'L' + state.nextIds.laundryItem++, name: 'Bedsheet Queen 300TC', category: 'Bedsheet', size: '160x200', unit: 'PCS', mandatory: true, parPerRoom: 2, minStock: 200, onHand: 180, status: 'ACTIVE' },
    { id: 'L' + state.nextIds.laundryItem++, name: 'Bath Towel 500gsm', category: 'Bath Towel', size: '70x140', unit: 'PCS', mandatory: true, parPerRoom: 2, minStock: 300, onHand: 120, status: 'ACTIVE' }
  ];

  const sid = 'S' + state.nextIds.stockOpname++;
  state.stockOpnameSessions.push({ id: sid, name: 'Monthly Room Check', coverage: 'ROOM', scheduledDate: '2025-10-31', status: 'IN_PROGRESS', createdBy: 'Reddy', createdAt: '2025-10-01', updatedAt: '2025-10-01' });
  state.stockOpnameLines[sid] = state.roomInventoryItems.map(i => ({ id: 'SL-' + i.id, itemId: i.id, itemName: i.name, type: 'ROOM', systemQty: i.onHand, countedQty: i.onHand, varianceQty: 0, notes: '' }));

  const rr = nextReplId();
  state.replenishmentRequests.push({ id: rr, property: state.selectedProperty, requestorName: 'Arief Setiawan', requestorRole: 'Property PIC', createdAt: '2025-10-05', updatedAt: '2025-10-05', status: 'DRAFT', notes: 'Initial', approvals: buildApprovalChain(), items: [ { id: nextReplLineId(), itemId: state.roomInventoryItems[0].id, itemName: state.roomInventoryItems[0].name, type: 'ROOM', currentStock: state.roomInventoryItems[0].onHand, minStock: state.roomInventoryItems[0].minStock, last7DayUsage: 80, suggestedQty: 100, requestedQty: 100, department: 'Housekeeping', mandatory: state.roomInventoryItems[0].mandatory, notes: '' } ] });

  PO_CATALOG = [
    {
      number: 'PO-2401',
      note: 'Restock amenities',
      property: state.selectedProperty,
      items: [
        { itemId: state.roomInventoryItems[0].id, type: 'ROOM', qty: 200 },
        { itemId: state.roomInventoryItems[1].id, type: 'ROOM', qty: 400 }
      ]
    },
    {
      number: 'PO-2402',
      note: 'Linen refresh',
      property: state.selectedProperty,
      items: [
        { itemId: state.laundryInventoryItems[0].id, type: 'LAUNDRY', qty: 120 },
        { itemId: state.laundryInventoryItems[1].id, type: 'LAUNDRY', qty: 200 }
      ]
    }
  ];
}

/* Rendering */
function renderAll() { document.querySelectorAll('.page').forEach(p => p.classList.remove('page--active')); const active = document.getElementById('page-' + state.activePage); if (active) active.classList.add('page--active'); renderRoomInventoryTable(); renderLaundryInventoryTable(); renderStockAlertTable(); renderStockOpnameList(); renderReplenishmentList(); renderProcurementOverview(); renderStockMovementsView(); renderStockOnHand(); updateNewReplenishmentButton(); }

/* Navigation/Header */
function bindNavigation() { document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => { const page = btn.getAttribute('data-page'); if (!page) return; state.activePage = page; document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b === btn)); renderAll(); })); }
function bindHeader() { const sel = document.getElementById('propertySelect'); if (!sel) return; sel.addEventListener('change', () => { state.selectedProperty = sel.value; renderAll(); }); }
function bindProfiles(){
  renderProfileMenu();
  renderHeaderUser();
  const toggle = document.getElementById('profileToggle');
  const menu = document.getElementById('profileMenu');
  if(toggle && menu){
    toggle.addEventListener('click', (e)=>{ e.stopPropagation(); toggleProfileMenu(); });
    document.addEventListener('click', (e)=>{
      if(menu.classList.contains('hidden')) return;
      if(menu.contains(e.target) || toggle.contains(e.target)) return;
      closeProfileMenu();
    });
    document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeProfileMenu(); });
  }
}

function renderProfileMenu(){
  const list = document.getElementById('profileMenuList');
  if(!list) return;
  list.innerHTML = '';
  PROFILES.forEach(profile => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'profile-menu__item' + (state.currentUser.name === profile.name ? ' is-active' : '');
    btn.innerHTML = `
      <div class="profile-menu__avatar">${(profile.name || 'U').charAt(0).toUpperCase()}</div>
      <div class="profile-menu__meta">
        <div class="profile-menu__name">${profile.name}</div>
        <div class="profile-menu__role">${profile.role}</div>
      </div>
    `;
    btn.addEventListener('click', ()=>{
      state.currentUser = profile;
      renderHeaderUser();
      renderProfileMenu();
      closeProfileMenu();
      renderAll();
    });
    list.appendChild(btn);
  });
}

function toggleProfileMenu(force){
  const menu = document.getElementById('profileMenu');
  const toggle = document.getElementById('profileToggle');
  if(!menu || !toggle) return;
  const shouldOpen = typeof force === 'boolean' ? force : menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !shouldOpen);
  toggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

function closeProfileMenu(){ toggleProfileMenu(false); }
function renderHeaderUser(){
  const nameEl = document.getElementById('headerUserName');
  const roleEl = document.getElementById('headerUserRole');
  const avatarEl = document.getElementById('headerAvatar');
  if(nameEl) nameEl.textContent = state.currentUser.name;
  if(roleEl) roleEl.textContent = state.currentUser.role;
  if(avatarEl) avatarEl.textContent = (state.currentUser.name || 'U').charAt(0).toUpperCase();
  const toggle = document.getElementById('profileToggle');
  if(toggle) toggle.setAttribute('aria-label', `Active profile: ${state.currentUser.name}`);
}

/* Room Inventory */
function bindRoomInventory() { const btnAdd = document.getElementById('btnAddRoomItem'); if (btnAdd) btnAdd.addEventListener('click', () => openRoomItemModal(null)); const btnSave = document.getElementById('btnSaveRoomItem'); if (btnSave) btnSave.addEventListener('click', saveRoomItemFromModal); const search = document.getElementById('roomSearchInput'); if (search) search.addEventListener('input', renderRoomInventoryTable); const cat = document.getElementById('roomCategoryFilter'); if (cat) cat.addEventListener('change', renderRoomInventoryTable); const status = document.getElementById('roomStatusFilter'); if (status) status.addEventListener('change', renderRoomInventoryTable); }

function renderRoomInventoryTable() { const tbody = document.getElementById('roomInventoryTableBody'); if (!tbody) return; tbody.innerHTML = ''; const searchVal = ((document.getElementById('roomSearchInput') || {}).value || '').toLowerCase(); const catFilter = (document.getElementById('roomCategoryFilter') || {}).value || 'all'; const statusFilter = (document.getElementById('roomStatusFilter') || {}).value || 'all'; state.roomInventoryItems.filter(item => { if (searchVal && !item.name.toLowerCase().includes(searchVal)) return false; if (catFilter !== 'all' && item.category !== catFilter) return false; if (statusFilter !== 'all' && item.status !== statusFilter) return false; return true; }).forEach(item => { const tr = document.createElement('tr'); tr.innerHTML = `
    <td>${item.name}</td>
    <td>${item.category}</td>
    <td>${getUomLabel(item.unit)}</td>
    <td><span class="badge ${item.mandatory ? 'badge--yes' : 'badge--no'}">${item.mandatory ? 'Yes' : 'No'}</span></td>
    <td>${item.parPerRoom ?? 0}</td>
    <td>${item.minStock}</td>
    <td>${item.maxStock ?? '-'}</td>
    <td>${item.onHand}</td>
    <td><span class="badge ${item.status === 'ACTIVE' ? 'badge--active' : 'badge--archived'}">${item.status}</span></td>
    <td class="table-actions-col"><button class="btn btn-secondary btn-sm" data-action="edit">Edit</button> <button class="btn btn-secondary btn-sm" data-action="adjust">Adjust</button> <button class="btn btn-secondary btn-sm" data-action="archive">Archive</button></td>
  `; tr.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => { const action = btn.getAttribute('data-action'); if (action === 'edit') openRoomItemModal(item.id); if (action === 'adjust') openAdjustStockModal(item.id, 'ROOM'); if (action === 'archive') { item.status = 'ARCHIVED'; showToast('Room item archived'); renderAll(); } })); tbody.appendChild(tr); }); }

function openRoomItemModal(id) { const modal = document.getElementById('modalRoomItem'); if (!modal) return; const title = document.getElementById('modalRoomTitle'); const form = document.getElementById('roomItemForm'); if (form) form.reset(); document.getElementById('roomItemId').value = id || ''; const onHandInfo = document.getElementById('roomOnHandInfo'); if (id) { title.textContent = 'Edit Room Item'; const item = state.roomInventoryItems.find(i => i.id === id); if (!item) return; document.getElementById('roomItemName').value = item.name; document.getElementById('roomItemCategory').value = item.category; document.getElementById('roomItemUnit').value = item.unit || 'PCS'; document.getElementById('roomItemMandatory').checked = !!item.mandatory; document.getElementById('roomParPerRoom').value = item.parPerRoom ?? 0; document.getElementById('roomMinStock').value = item.minStock ?? 0; document.getElementById('roomMaxStock').value = item.maxStock ?? ''; if (onHandInfo) onHandInfo.textContent = `Current On Hand: ${item.onHand ?? 0}`; } else { title.textContent = 'Add Room Item'; if (onHandInfo) onHandInfo.textContent = 'Current On Hand: 0'; document.getElementById('roomItemUnit').value = 'PCS'; } openModal('modalRoomItem'); }

function saveRoomItemFromModal() {
  const id = document.getElementById('roomItemId').value;
  const name = (document.getElementById('roomItemName').value || '').trim();
  if (!name) return showToast('Name required');
  const category = document.getElementById('roomItemCategory').value || '';
  const unit = document.getElementById('roomItemUnit').value || 'PCS';
  const mandatory = !!document.getElementById('roomItemMandatory').checked;
  const parPerRoom = safeNumber(document.getElementById('roomParPerRoom').value);
  const minStock = safeNumber(document.getElementById('roomMinStock').value);
  const maxStockRaw = document.getElementById('roomMaxStock').value;
  const maxStock = maxStockRaw === '' ? undefined : safeNumber(maxStockRaw);

  if (minStock < 0) return showToast('Min stock must be 0 or greater');

  if (id) {
    const it = state.roomInventoryItems.find(x => x.id === id);
    if (!it) return;
    Object.assign(it, { name, category, unit, mandatory, parPerRoom, minStock, maxStock });
    showToast('Room item updated');
  } else {
    state.roomInventoryItems.push({ id: 'R' + state.nextIds.roomItem++, name, category, unit, mandatory, parPerRoom, minStock, maxStock, onHand: 0, status: 'ACTIVE' });
    showToast('Room item added');
  }

  closeModal('modalRoomItem');
  renderAll();
}

/* Laundry Inventory */
function bindLaundryInventory() { const btnAdd = document.getElementById('btnAddLaundryItem'); if (btnAdd) btnAdd.addEventListener('click', () => openLaundryItemModal(null)); const btnSave = document.getElementById('btnSaveLaundryItem'); if (btnSave) btnSave.addEventListener('click', saveLaundryItemFromModal); const search = document.getElementById('laundrySearchInput'); if (search) search.addEventListener('input', renderLaundryInventoryTable); const cat = document.getElementById('laundryCategoryFilter'); if (cat) cat.addEventListener('change', renderLaundryInventoryTable); const status = document.getElementById('laundryStatusFilter'); if (status) status.addEventListener('change', renderLaundryInventoryTable); }

function renderLaundryInventoryTable() { const tbody = document.getElementById('laundryInventoryTableBody'); if (!tbody) return; tbody.innerHTML = ''; const searchVal = ((document.getElementById('laundrySearchInput') || {}).value || '').toLowerCase(); const catFilter = (document.getElementById('laundryCategoryFilter') || {}).value || 'all'; const statusFilter = (document.getElementById('laundryStatusFilter') || {}).value || 'all'; state.laundryInventoryItems.filter(item => { if (searchVal && !item.name.toLowerCase().includes(searchVal)) return false; if (catFilter !== 'all' && item.category !== catFilter) return false; if (statusFilter !== 'all' && item.status !== statusFilter) return false; return true; }).forEach(item => { const tr = document.createElement('tr'); tr.innerHTML = `
    <td>${item.name}</td>
    <td>${item.category}</td>
    <td>${item.size || '-'}</td>
    <td>${getUomLabel(item.unit)}</td>
    <td>${item.parPerRoom ?? 0}</td>
    <td>${item.minStock}</td>
    <td>${item.onHand}</td>
    <td><span class="badge ${item.mandatory ? 'badge--yes' : 'badge--no'}">${item.mandatory ? 'Yes' : 'No'}</span></td>
    <td><span class="badge ${item.status === 'ACTIVE' ? 'badge--active' : 'badge--archived'}">${item.status}</span></td>
    <td class="table-actions-col"><button class="btn btn-secondary btn-sm" data-action="edit">Edit</button> <button class="btn btn-secondary btn-sm" data-action="adjust">Adjust</button> <button class="btn btn-secondary btn-sm" data-action="archive">Archive</button></td>
  `; tr.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => { const action = btn.getAttribute('data-action'); if (action === 'edit') openLaundryItemModal(item.id); if (action === 'adjust') openAdjustStockModal(item.id, 'LAUNDRY'); if (action === 'archive') { item.status = 'ARCHIVED'; showToast('Laundry item archived'); renderAll(); } })); tbody.appendChild(tr); }); }

function openLaundryItemModal(id) { const modal = document.getElementById('modalLaundryItem'); if (!modal) return; const title = document.getElementById('modalLaundryTitle'); const form = document.getElementById('laundryItemForm'); if (form) form.reset(); document.getElementById('laundryItemId').value = id || ''; const onHandInfo = document.getElementById('laundryOnHandInfo'); if (id) { title.textContent = 'Edit Laundry Item'; const it = state.laundryInventoryItems.find(x => x.id === id); if (!it) return; document.getElementById('laundryItemName').value = it.name; document.getElementById('laundryItemCategory').value = it.category; document.getElementById('laundryItemSize').value = it.size || ''; document.getElementById('laundryItemUnit').value = it.unit || 'PCS'; document.getElementById('laundryItemMandatory').checked = !!it.mandatory; document.getElementById('laundryParPerRoom').value = it.parPerRoom ?? 0; document.getElementById('laundryMinStock').value = it.minStock ?? 0; if (onHandInfo) onHandInfo.textContent = `Current On Hand: ${it.onHand ?? 0}`; } else { title.textContent = 'Add Laundry Item'; if (onHandInfo) onHandInfo.textContent = 'Current On Hand: 0'; document.getElementById('laundryItemUnit').value = 'PCS'; } openModal('modalLaundryItem'); }

function saveLaundryItemFromModal() {
  const id = document.getElementById('laundryItemId').value;
  const name = (document.getElementById('laundryItemName').value || '').trim();
  if (!name) return showToast('Name required');
  const category = document.getElementById('laundryItemCategory').value || '';
  const size = document.getElementById('laundryItemSize').value || '';
  const unit = document.getElementById('laundryItemUnit').value || 'PCS';
  const mandatory = !!document.getElementById('laundryItemMandatory').checked;
  const parPerRoom = safeNumber(document.getElementById('laundryParPerRoom').value);
  const minStock = safeNumber(document.getElementById('laundryMinStock').value);

  if (minStock < 0) return showToast('Min stock must be 0 or greater');

  if (id) {
    const it = state.laundryInventoryItems.find(x => x.id === id);
    if (!it) return;
    Object.assign(it, { name, category, size, unit, mandatory, parPerRoom, minStock });
    showToast('Laundry item updated');
  } else {
    state.laundryInventoryItems.push({ id: 'L' + state.nextIds.laundryItem++, name, category, size, unit, mandatory, parPerRoom, minStock, onHand: 0, status: 'ACTIVE' });
    showToast('Laundry item added');
  }

  closeModal('modalLaundryItem');
  renderAll();
}

/* Stock Alert */
function bindStockAlert() { const filter = document.getElementById('alertStatusFilter'); if (filter) filter.addEventListener('change', renderStockAlertTable); const selectAll = document.getElementById('selectAllAlerts'); if (selectAll) selectAll.addEventListener('change', handleSelectAllAlerts); const btnCreate = document.getElementById('btnCreateReplenishmentFromAlert'); if (btnCreate) btnCreate.addEventListener('click', createReplenishmentFromAlerts); }

function buildStockAlertItems() {
  const out = [];
  const add = (item, type) => {
    if (!item) return;
    // Only include active items with positive minStock and onHand below minStock
    if (item.status !== 'ACTIVE') return;
    const minStock = safeNumber(item.minStock);
    const onHand = safeNumber(item.onHand);
    if (minStock <= 0) return;
    if (onHand >= minStock) return;
    const critical = onHand <= (minStock / 2);
    const suggestedQty = Math.max(minStock * 2 - onHand, 0);
    out.push({
      id: item.id,
      name: item.name,
      type,
      onHand,
      minStock,
      mandatory: !!item.mandatory,
      status: critical ? 'critical' : 'below',
      last7DayUsage: Math.max(Math.round(minStock / 6), 5),
      suggestedQty
    });
  };
  state.roomInventoryItems.forEach(i => add(i, 'ROOM'));
  state.laundryInventoryItems.forEach(i => add(i, 'LAUNDRY'));
  return out;
}


function renderStockAlertTable() {
  const tbody = document.getElementById('stockAlertTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const filter = (document.getElementById('alertStatusFilter') || {}).value || 'all';
  const rows = buildStockAlertItems().filter(r => filter === 'all' ? true : r.status === filter);
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
    <td><input type="checkbox" class="alert-select" data-id="${r.id}" data-type="${r.type}"></td>
    <td>${r.name}</td>
    <td>${r.type}</td>
    <td>${r.onHand}</td>
    <td>${r.minStock}</td>
    <td><span class="badge ${r.status === 'critical' ? 'badge--critical' : 'badge--below'}">${r.status === 'critical' ? 'Critical' : 'Below Min'}</span></td>
    <td><span class="badge ${r.mandatory ? 'badge--yes' : 'badge--no'}">${r.mandatory ? 'Yes' : 'No'}</span></td>
    <td>${r.suggestedQty}</td>
    <td>${r.last7DayUsage}</td>
  `;
    tbody.appendChild(tr);
  });

  // Disable select-all when no rows
  const sa = document.getElementById('selectAllAlerts');
  if (sa) sa.disabled = rows.length === 0;

  document.querySelectorAll('.alert-select').forEach(cb => cb.addEventListener('change', updateAlertSelectionState));
  updateAlertSelectionState();
}

function handleSelectAllAlerts(e) { const checked = !!e.target.checked; document.querySelectorAll('.alert-select').forEach(cb=>cb.checked = checked); updateAlertSelectionState(); }
function updateAlertSelectionState() { const any = Array.from(document.querySelectorAll('.alert-select')).some(cb => cb.checked); const btn = document.getElementById('btnCreateReplenishmentFromAlert'); if (btn) btn.disabled = !any; const all = document.querySelectorAll('.alert-select'); const allChecked = all.length && Array.from(all).every(cb=>cb.checked); const sa = document.getElementById('selectAllAlerts'); if (sa) sa.checked = !!allChecked; }

function createReplenishmentFromAlerts() { const selected = Array.from(document.querySelectorAll('.alert-select')).filter(cb=>cb.checked).map(cb=>({ id: cb.dataset.id, type: cb.dataset.type })); if (!selected.length) return showToast('No alerts selected'); const all = buildStockAlertItems(); const lines = selected.map(s => { const a = all.find(x=>x.id===s.id && x.type===s.type); if (!a) return null; return { id: nextReplLineId(), itemId: a.id, itemName: a.name, type: a.type, currentStock: a.onHand, minStock: a.minStock, last7DayUsage: a.last7DayUsage, suggestedQty: a.suggestedQty, requestedQty: a.suggestedQty, mandatory: a.mandatory, notes: '' }; }).filter(Boolean); if (!lines.length) return showToast('No valid alert items'); const id = nextReplId(); const today = new Date().toISOString().slice(0,10); const req = { id, property: state.selectedProperty, requestorName: state.currentUser.name, requestorRole: state.currentUser.role, createdAt: today, updatedAt: today, status: 'DRAFT', notes:'', approvals: buildApprovalChain(), items: lines }; state.replenishmentRequests.push(req); state.activePage = 'replenishment-requests'; document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.getAttribute('data-page') === 'replenishment-requests')); renderAll(); openReplenishmentModal(req.id); showToast('Replenishment created from Stock Alert'); }

/* Stock Opname */
function bindStockOpname() { const btnNew = document.getElementById('btnNewStockOpname'); if (btnNew) btnNew.addEventListener('click', ()=>openModal('modalStockOpname')); const btnCreate = document.getElementById('btnCreateStockOpname'); if (btnCreate) btnCreate.addEventListener('click', createStockOpnameSession); const btnSubmit = document.getElementById('btnSubmitOpname'); if (btnSubmit) btnSubmit.addEventListener('click', submitStockOpname); const btnApprove = document.getElementById('btnApproveOpname'); if (btnApprove) btnApprove.addEventListener('click', approveStockOpname); }

function renderStockOpnameList() { const tbody = document.getElementById('stockOpnameTableBody'); if (!tbody) return; tbody.innerHTML = ''; state.stockOpnameSessions.forEach(s => { const tr = document.createElement('tr'); tr.innerHTML = `
    <td>${s.name}</td>
    <td>${s.coverage}</td>
    <td>${s.scheduledDate || '-'}</td>
    <td>${s.status}</td>
    <td>${s.createdBy}</td>
    <td>${s.updatedAt || s.createdAt}</td>
    <td class="table-actions-col"><button class="btn btn-secondary btn-sm" data-id="${s.id}">View</button></td>
  `; tr.querySelector('button').addEventListener('click', ()=>openStockOpnameDetail(s.id)); tbody.appendChild(tr); }); }

function createStockOpnameSession() {
  const name = ((document.getElementById('opnameNameInput') || {}).value || '').trim();
  if (!name) return showToast('Please provide a name');
  const coverage = (document.getElementById('opnameCoverageInput') || {}).value || 'ROOM';
  const date = (document.getElementById('opnameDateInput') || {}).value || new Date().toISOString().slice(0,10);
  const id = 'S' + state.nextIds.stockOpname++;
  const today = new Date().toISOString().slice(0,10);
  const s = { id, name, coverage, scheduledDate: date, status: 'IN_PROGRESS', createdBy: 'Reddy', createdAt: today, updatedAt: today };
  state.stockOpnameSessions.push(s);

  if (coverage === 'ROOM') {
    state.stockOpnameLines[id] = state.roomInventoryItems.map(i => ({ id: 'SL-' + i.id, itemId: i.id, itemName: i.name, type: 'ROOM', systemQty: i.onHand, countedQty: i.onHand, varianceQty: 0, notes: '' }));
  } else if (coverage === 'LAUNDRY') {
    state.stockOpnameLines[id] = state.laundryInventoryItems.map(i => ({ id: 'SL-' + i.id, itemId: i.id, itemName: i.name, type: 'LAUNDRY', systemQty: i.onHand, countedQty: i.onHand, varianceQty: 0, notes: '' }));
  } else {
    // BOTH - include both lists with correct types
    const roomLines = state.roomInventoryItems.map(i => ({ id: 'SL-' + i.id, itemId: i.id, itemName: i.name, type: 'ROOM', systemQty: i.onHand, countedQty: i.onHand, varianceQty: 0, notes: '' }));
    const laundryLines = state.laundryInventoryItems.map(i => ({ id: 'SL-' + i.id, itemId: i.id, itemName: i.name, type: 'LAUNDRY', systemQty: i.onHand, countedQty: i.onHand, varianceQty: 0, notes: '' }));
    state.stockOpnameLines[id] = [...roomLines, ...laundryLines];
  }

  closeModal('modalStockOpname');
  renderAll();
  openStockOpnameDetail(id);
  showToast('Stock opname session created');
}

function openStockOpnameDetail(id) { const s = state.stockOpnameSessions.find(x=>x.id===id); if (!s) return; currentOpnameSessionId = id; const panel = document.getElementById('stockOpnameDetailPanel'); if (panel) panel.classList.remove('hidden'); document.getElementById('detailOpnameTitle').textContent = s.name; document.getElementById('detailOpnameMeta').textContent = `${s.coverage} • Status: ${s.status} • Scheduled: ${s.scheduledDate}`; const tbody = document.getElementById('stockOpnameLinesTableBody'); if (!tbody) return; tbody.innerHTML = ''; const lines = state.stockOpnameLines[id] || []; lines.forEach((ln,idx)=>{ const tr = document.createElement('tr'); tr.innerHTML = `
    <td>${ln.itemName}</td>
    <td>${ln.type}</td>
    <td>${ln.systemQty}</td>
    <td><input type="number" class="input input--inline" value="${ln.countedQty}" data-line-index="${idx}" ${s.status!=='IN_PROGRESS'?'readonly':''}></td>
    <td class="variance-cell">${ln.varianceQty}</td>
    <td><input type="text" class="input input--inline" value="${ln.notes||''}" data-notes-index="${idx}" ${s.status!=='IN_PROGRESS'?'readonly':''}></td>
  `; tbody.appendChild(tr); }); tbody.querySelectorAll('input[data-line-index]').forEach(inp=>inp.addEventListener('input',(e)=>{ const idx = Number(e.target.dataset.lineIndex); const val = safeNumber(e.target.value); const linesRef = state.stockOpnameLines[currentOpnameSessionId]||[]; if (!linesRef[idx]) return; linesRef[idx].countedQty = val; linesRef[idx].varianceQty = val - linesRef[idx].systemQty; const vc = e.target.closest('tr').querySelector('.variance-cell'); if (vc) vc.textContent = linesRef[idx].varianceQty; })); tbody.querySelectorAll('input[data-notes-index]').forEach(inp=>inp.addEventListener('input',(e)=>{ const idx = Number(e.target.dataset.notesIndex); const linesRef = state.stockOpnameLines[currentOpnameSessionId]||[]; if (!linesRef[idx]) return; linesRef[idx].notes = e.target.value; })); const submitBtn = document.getElementById('btnSubmitOpname'); const approveBtn = document.getElementById('btnApproveOpname'); if (s.status==='IN_PROGRESS'){ if(submitBtn) submitBtn.disabled = false; if(approveBtn) approveBtn.disabled = true; } else if (s.status==='PENDING_APPROVAL'){ if(submitBtn) submitBtn.disabled = true; if(approveBtn) approveBtn.disabled = false; } else { if(submitBtn) submitBtn.disabled = true; if(approveBtn) approveBtn.disabled = true; } }

function submitStockOpname(){ if(!currentOpnameSessionId) return showToast('No session selected'); const s = state.stockOpnameSessions.find(x=>x.id===currentOpnameSessionId); if(!s) return; s.status='PENDING_APPROVAL'; s.updatedAt = new Date().toISOString().slice(0,10); renderAll(); openStockOpnameDetail(currentOpnameSessionId); showToast('Stock opname submitted for approval'); }

function approveStockOpname(){
  if(!currentOpnameSessionId) return showToast('No session');
  const s = state.stockOpnameSessions.find(x=>x.id===currentOpnameSessionId);
  if(!s) return;
  const lines = state.stockOpnameLines[currentOpnameSessionId]||[];
  const incomingLines = [];
  const outgoingLines = [];
  const today = new Date().toISOString().slice(0,10);
  lines.forEach(line=>{
    const diff = safeNumber(line.countedQty) - safeNumber(line.systemQty);
    const invItem = getInventoryItemWithType(line.itemId, line.type);
    const uom = (invItem && invItem.unit) || defaultUomCode();
    if(diff > 0){
      incomingLines.push({ itemId: line.itemId, itemName: line.itemName, type: line.type, uom, qty: diff });
    } else if (diff < 0){
      outgoingLines.push({ itemId: line.itemId, itemName: line.itemName, type: line.type, uom, qty: Math.abs(diff) });
    }
    line.systemQty = safeNumber(line.countedQty);
    line.varianceQty = 0;
  });
  s.status='POSTED';
  s.updatedAt = today;
  if(incomingLines.length){
    postMovement({ id: nextIncomingId(), date: today, property: state.selectedProperty, sourceType: 'OPNAME_ADJUSTMENT', poNumber: '-', note: s.name, lines: incomingLines, bastAttachment: { name: 'Opname', size: 0, type: 'AUTO' }, history: [] }, 'IN');
  }
  if(outgoingLines.length){
    postMovement({ id: nextOutgoingId(), date: today, property: state.selectedProperty, destType: 'OPNAME_ADJUSTMENT', destRef: s.name, note: s.name, lines: outgoingLines, history: [] }, 'OUT');
  }
  renderAll();
  openStockOpnameDetail(currentOpnameSessionId);
  showToast('Stock opname adjustments posted');
}

/* Replenishment */
function bindReplenishment(){
  const newBtn = document.getElementById('btnNewReplenishment');
  if(newBtn) newBtn.addEventListener('click', ()=>openReplenishmentModal(null));
  const saveBtn = document.getElementById('btnReplSave');
  if(saveBtn) saveBtn.addEventListener('click', saveReplenishmentFromModal);
  const addLineBtn = document.getElementById('btnReplAddLine');
  if(addLineBtn) addLineBtn.addEventListener('click', addReplModalLine);
  const itemSel = document.getElementById('replModalItemSelect');
  if(itemSel) itemSel.addEventListener('change', updateReplUsageDisplay);
  const btnSubmit = document.getElementById('btnReplSubmit');
  if(btnSubmit) btnSubmit.addEventListener('click', submitReplenishmentForApproval);
  const btnApprove = document.getElementById('btnReplApprove');
  if(btnApprove) btnApprove.addEventListener('click', approveReplenishment);
  const btnReject = document.getElementById('btnReplReject');
  if(btnReject) btnReject.addEventListener('click', rejectReplenishment);
  const btnDelete = document.getElementById('btnReplDelete');
  if(btnDelete) btnDelete.addEventListener('click', ()=>deleteReplenishment(currentReplEditingId));
  const btnPrint = document.getElementById('btnReplPrint');
  if(btnPrint) btnPrint.addEventListener('click', ()=>printReplenishment(currentReplEditingId));
}

function updateNewReplenishmentButton(){
  const newBtn = document.getElementById('btnNewReplenishment');
  if(!newBtn) return;
  newBtn.classList.toggle('hidden', !isCurrentUserPropertyPIC());
}

function renderReplenishmentList(){
  const tbody = document.getElementById('replenishmentTableBody');
  if(!tbody) return;
  tbody.innerHTML='';
  state.replenishmentRequests
    .filter(req => req.status !== 'DRAFT' || req.requestorName === state.currentUser.name)
    .forEach(req=>{
    const canEdit = req.status === 'DRAFT' && req.requestorName === state.currentUser.name && isCurrentUserPropertyPIC();
    const tr = document.createElement('tr');
    tr.innerHTML = `
    <td>${req.id}</td>
    <td>${req.property}</td>
    <td>${req.requestorName}</td>
    <td>${req.items.length}</td>
    <td>${req.status}</td>
    <td>${req.createdAt}</td>
    <td>${req.updatedAt}</td>
    <td class="table-actions-col">
      <button class="btn btn-secondary btn-sm" data-action="view" data-id="${req.id}">View</button>
      ${canEdit ? `<button class="btn btn-secondary btn-sm" data-action="edit" data-id="${req.id}">Edit</button>` : ''}
      <button class="btn btn-secondary btn-sm" data-action="print" data-id="${req.id}">Print</button>
    </td>
  `;
    tr.querySelectorAll('button').forEach(btn => btn.addEventListener('click', ()=>{
      const action = btn.dataset.action;
      if(action === 'view') openReplenishmentModal(req.id, { readOnly: true });
      if(action === 'edit') openReplenishmentModal(req.id, { readOnly: false });
      if(action === 'print') printReplenishment(req.id);
    }));
    tbody.appendChild(tr);
  });
}
function openReplenishmentDetail(id) {
  const req = state.replenishmentRequests.find(r => r.id === id);
  if (!req) return;
  currentReplId = id;
  const panel = document.getElementById('replenishmentDetailPanel');
  if (panel) panel.classList.remove('hidden');
  document.getElementById('replDetailTitle').textContent = 'Replenishment Request ' + req.id;
  document.getElementById('replDetailMeta').textContent = `${req.property} • ${req.status} • Created: ${req.createdAt}`;
  document.getElementById('replPropertyInput').value = req.property || '';
  document.getElementById('replRequestorInput').value = req.requestorName || '';
  document.getElementById('replRoleInput').value = req.requestorRole || '';
  document.getElementById('replDateInput').value = req.createdAt || '';
  document.getElementById('replNotesInput').value = req.notes || '';

  const tbody = document.getElementById('replItemsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  req.items.forEach((ln, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
    <td><input class="input input--inline" data-name-index="${idx}" value="${ln.itemName || ''}" ${req.status!=='DRAFT'?'readonly':''}></td>
    <td>
      <select data-type-index="${idx}" ${req.status!=='DRAFT'?'disabled':''}>
        <option value="ROOM" ${ln.type==='ROOM'?'selected':''}>ROOM</option>
        <option value="LAUNDRY" ${ln.type==='LAUNDRY'?'selected':''}>LAUNDRY</option>
      </select>
    </td>
    <td><input type="number" class="input input--inline" data-current-index="${idx}" value="${ln.currentStock || 0}" ${req.status!=='DRAFT'?'readonly':''}></td>
    <td><input type="number" class="input input--inline" data-min-index="${idx}" value="${ln.minStock || 0}" ${req.status!=='DRAFT'?'readonly':''}></td>
    <td><input type="number" class="input input--inline" data-last7-index="${idx}" value="${ln.last7DayUsage || 0}" ${req.status!=='DRAFT'?'readonly':''}></td>
    <td><input type="number" class="input input--inline" data-suggested-index="${idx}" value="${ln.suggestedQty || 0}" ${req.status!=='DRAFT'?'readonly':''}></td>
    <td><input type="number" class="input input--inline" data-requested-index="${idx}" value="${ln.requestedQty || 0}" ${req.status!=='DRAFT'?'readonly':''}></td>
    <td style="text-align:center;"><input type="checkbox" data-mandatory-index="${idx}" ${ln.mandatory?'checked':''} ${req.status!=='DRAFT'?'disabled':''}></td>
    <td><input type="text" class="input input--inline" data-notes-index="${idx}" value="${ln.notes || ''}" ${req.status!=='DRAFT'?'readonly':''}></td>
    `;
    tbody.appendChild(tr);
  });

  // Wire up change listeners for editable fields
  tbody.querySelectorAll('[data-name-index]').forEach(inp => inp.addEventListener('input', e => {
    const idx = Number(e.target.dataset.nameIndex);
    req.items[idx].itemName = e.target.value;
  }));
  tbody.querySelectorAll('[data-type-index]').forEach(sel => sel.addEventListener('change', e => {
    const idx = Number(e.target.dataset.typeIndex);
    req.items[idx].type = e.target.value;
  }));
  tbody.querySelectorAll('[data-current-index]').forEach(inp => inp.addEventListener('input', e => {
    const idx = Number(e.target.dataset.currentIndex);
    req.items[idx].currentStock = safeNumber(e.target.value);
  }));
  tbody.querySelectorAll('[data-min-index]').forEach(inp => inp.addEventListener('input', e => {
    const idx = Number(e.target.dataset.minIndex);
    req.items[idx].minStock = safeNumber(e.target.value);
  }));
  tbody.querySelectorAll('[data-last7-index]').forEach(inp => inp.addEventListener('input', e => {
    const idx = Number(e.target.dataset.last7Index);
    req.items[idx].last7DayUsage = safeNumber(e.target.value);
  }));
  tbody.querySelectorAll('[data-suggested-index]').forEach(inp => inp.addEventListener('input', e => {
    const idx = Number(e.target.dataset.suggestedIndex);
    req.items[idx].suggestedQty = safeNumber(e.target.value);
  }));
  tbody.querySelectorAll('[data-requested-index]').forEach(inp => inp.addEventListener('input', e => {
    const idx = Number(e.target.dataset.requestedIndex);
    req.items[idx].requestedQty = safeNumber(e.target.value);
  }));
  tbody.querySelectorAll('[data-mandatory-index]').forEach(cb => cb.addEventListener('change', e => {
    const idx = Number(e.target.dataset.mandatoryIndex);
    req.items[idx].mandatory = !!e.target.checked;
  }));
  tbody.querySelectorAll('[data-notes-index]').forEach(inp => inp.addEventListener('input', e => {
    const idx = Number(e.target.dataset.notesIndex);
    req.items[idx].notes = e.target.value;
  }));
}

function saveReplenishmentFromDetail(){ if(!currentReplId) return showToast('No request open'); const req = state.replenishmentRequests.find(r=>r.id===currentReplId); if(!req) return; req.property = document.getElementById('replPropertyInput').value || req.property; req.requestorName = document.getElementById('replRequestorInput').value || req.requestorName; req.requestorRole = document.getElementById('replRoleInput').value || req.requestorRole; req.createdAt = document.getElementById('replDateInput').value || req.createdAt; req.notes = document.getElementById('replNotesInput').value || req.notes; req.updatedAt = new Date().toISOString().slice(0,10); req.status = 'DRAFT'; showToast('Replenishment saved (draft)'); renderReplenishmentList(); openReplenishmentDetail(req.id); }

// New modal-based replenishment handling
function openReplenishmentModal(id, opts = {}){
  const isNew = !id;
  currentReplEditingId = id || nextReplId();
  const today = new Date().toISOString().slice(0,10);
  const existing = state.replenishmentRequests.find(r=>r.id===id);
  if(existing && existing.status === 'DRAFT' && existing.requestorName !== state.currentUser.name) return;
  const req = existing || { id: currentReplEditingId, property: state.selectedProperty, requestorName: state.currentUser.name, requestorRole: state.currentUser.role, createdAt: today, updatedAt: today, status: 'DRAFT', items: [], deliveryDate: '', neededDate: '', approvals: buildApprovalChain() };
  req.approvals = req.approvals && req.approvals.length ? req.approvals : buildApprovalChain();
  replModalLines = (req.items || []).map(ln => {
    const inv = getInventoryItemWithType(ln.itemId, ln.type) || getCombinedInventory().find(x=>x.id===ln.itemId);
    const qty = ln.qty ?? ln.requestedQty ?? ln.suggestedQty ?? 0;
    return { ...ln, qty, department: ln.department || 'Housekeeping', unit: ln.unit || (inv && inv.unit) || defaultUomCode(), last7DayUsage: computeLast7dUsage(ln.itemId, ln.type) };
  });
  const requestedReadOnly = !!opts.readOnly;
  const canEdit = (!existing && isCurrentUserPropertyPIC()) || (existing && req.status === 'DRAFT' && req.requestorName === state.currentUser.name && isCurrentUserPropertyPIC());
  replModalReadOnly = requestedReadOnly || !canEdit;
  const title = document.getElementById('replModalTitle'); if(title) title.textContent = isNew ? 'New Replenishment Request' : `Replenishment ${req.id}`;
  const createdBy = document.getElementById('replModalCreatedBy'); if(createdBy) createdBy.value = req.requestorName || state.currentUser.name || '';
  const reqDate = document.getElementById('replModalRequestDate'); if(reqDate) reqDate.value = req.createdAt || today;
  const delDate = document.getElementById('replModalDeliveryDate'); if(delDate) delDate.value = req.deliveryDate || '';
  const needDate = document.getElementById('replModalNeededDate'); if(needDate) needDate.value = req.neededDate || '';
  populateReplItemSelect();
  renderReplModalLines();
  renderApprovalChips(req);
  updateApprovalButtons(req);
  applyReplenishmentFormLock(replModalReadOnly);
  openModal('modalReplenishment');
}

function applyReplenishmentFormLock(isReadOnly){
  const fields = [
    'replModalCreatedBy',
    'replModalRequestDate',
    'replModalDeliveryDate',
    'replModalNeededDate',
    'replModalItemSelect',
    'replModalQty',
    'replModalDept'
  ];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.disabled = isReadOnly;
  });
  const addBtn = document.getElementById('btnReplAddLine'); if(addBtn) addBtn.disabled = isReadOnly;
}

function populateReplItemSelect(){
  const sel = document.getElementById('replModalItemSelect');
  if(!sel) return;
  sel.innerHTML='';
  getCombinedInventory().forEach(it=>{
    const opt = document.createElement('option');
    opt.value = it.id;
    opt.textContent = `${it.name} (${it.type})`;
    sel.appendChild(opt);
  });
  updateReplUsageDisplay();
}

function addReplModalLine(){
  const itemSel = document.getElementById('replModalItemSelect');
  const qtyInput = document.getElementById('replModalQty');
  const deptSel = document.getElementById('replModalDept');
  const unitInput = document.getElementById('replModalUnit');
  if(!itemSel || !qtyInput || !deptSel) return;
  if(replModalReadOnly) return;
  const itemId = itemSel.value;
  const qty = safeNumber(qtyInput.value);
  if(!itemId || qty <= 0) return showToast('Select item and quantity');
  const item = getCombinedInventory().find(i=>i.id===itemId);
  const last7 = computeLast7dUsage(itemId, item ? item.type : 'ROOM');
  const line = {
    id: nextReplLineId(),
    itemId,
    itemName: item ? item.name : 'Unknown',
    type: item ? item.type : 'ROOM',
    unit: item ? item.unit : defaultUomCode(),
    qty,
    department: deptSel.value || 'Housekeeping',
    last7DayUsage: last7
  };
  replModalLines.push(line);
  qtyInput.value = '';
  const usageInput = document.getElementById('replModalUsage'); if(usageInput) usageInput.value = last7 || 0;
  if(unitInput) unitInput.value = item ? item.unit : '';
  renderReplModalLines();
}

function renderReplModalLines(){
  const tbody = document.getElementById('replModalLinesBody');
  if(!tbody) return;
  tbody.innerHTML='';
  const inventory = getCombinedInventory();
  const deptOptions = ['Housekeeping','Front Office','F&B','Engineering'];
  replModalLines.forEach((ln, idx)=>{
    const options = inventory.map(it=>`<option value="${it.id}" ${ln.itemId===it.id?'selected':''}>${it.name} (${it.type})</option>`).join('');
    const deptOpts = deptOptions.map(d=>`<option value="${d}" ${ln.department===d?'selected':''}>${d}</option>`).join('');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select class="input" data-line-item="${idx}" ${replModalReadOnly?'disabled':''}>${options}</select></td>
      <td>${ln.unit || '-'}</td>
      <td><input type="number" min="1" class="input input--inline" data-line-qty="${idx}" value="${ln.qty || 0}" ${replModalReadOnly?'disabled':''}></td>
      <td><select class="input" data-line-dept="${idx}" ${replModalReadOnly?'disabled':''}>${deptOpts}</select></td>
      <td>${ln.last7DayUsage || 0}</td>
      <td>${replModalReadOnly ? '' : `<button class="btn btn-secondary btn-sm" data-remove-line="${idx}">Remove</button>`}</td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-remove-line]').forEach(btn => btn.addEventListener('click', e=>{
    const idx = Number(e.target.dataset.removeLine);
    replModalLines.splice(idx,1);
    renderReplModalLines();
  }));
  tbody.querySelectorAll('[data-line-qty]').forEach(inp => inp.addEventListener('input', e=>{
    const idx = Number(e.target.dataset.lineQty);
    const line = replModalLines[idx]; if(!line) return;
    line.qty = safeNumber(e.target.value);
  }));
  tbody.querySelectorAll('[data-line-dept]').forEach(sel => sel.addEventListener('change', e=>{
    const idx = Number(e.target.dataset.lineDept);
    const line = replModalLines[idx]; if(!line) return;
    line.department = e.target.value;
  }));
  tbody.querySelectorAll('[data-line-item]').forEach(sel => sel.addEventListener('change', e=>{
    const idx = Number(e.target.dataset.lineItem);
    const line = replModalLines[idx]; if(!line) return;
    const itemId = e.target.value;
    const item = getCombinedInventory().find(it=>it.id===itemId);
    if(!item) return;
    line.itemId = item.id;
    line.itemName = item.name;
    line.type = item.type;
    line.unit = item.unit;
    line.last7DayUsage = computeLast7dUsage(item.id, item.type);
    renderReplModalLines();
  }));
}

function updateReplUsageDisplay(){
  const itemSel = document.getElementById('replModalItemSelect');
  const usageInput = document.getElementById('replModalUsage');
  const unitInput = document.getElementById('replModalUnit');
  if(!itemSel || !usageInput) return;
  const itemId = itemSel.value;
  const item = getCombinedInventory().find(i=>i.id===itemId);
  const last7 = itemId ? computeLast7dUsage(itemId, item ? item.type : 'ROOM') : 0;
  usageInput.value = last7 || 0;
  if(unitInput) unitInput.value = (item && item.unit) || '';
}

function saveReplenishmentFromModal(){
  const createdBy = (document.getElementById('replModalCreatedBy') || {}).value || '';
  const requestDate = (document.getElementById('replModalRequestDate') || {}).value || new Date().toISOString().slice(0,10);
  const deliveryDate = (document.getElementById('replModalDeliveryDate') || {}).value || '';
  const neededDate = (document.getElementById('replModalNeededDate') || {}).value || '';
  if(replModalReadOnly) return showToast('Read-only mode');
  if(!createdBy) return showToast('Created By is required');
  if(!replModalLines.length) return showToast('Add at least one item line');
  const existing = state.replenishmentRequests.find(r=>r.id===currentReplEditingId);
  if(existing && existing.requestorName !== state.currentUser.name) return showToast('Only submitter can save this draft');
  const payload = {
    id: currentReplEditingId || nextReplId(),
    property: state.selectedProperty,
    requestorName: createdBy,
    requestorRole: state.currentUser.role,
    createdAt: requestDate,
    updatedAt: new Date().toISOString().slice(0,10),
    status: existing ? existing.status : 'DRAFT',
    deliveryDate,
    neededDate,
    approvals: existing && existing.approvals ? existing.approvals : buildApprovalChain(),
    items: replModalLines.map(ln=>({
      ...ln,
      unit: ln.unit || defaultUomCode(),
      requestedQty: ln.qty,
      last7DayUsage: computeLast7dUsage(ln.itemId, ln.type)
    }))
  };
  if(existing){
    Object.assign(existing, payload);
  } else {
    state.replenishmentRequests.push(payload);
  }
  closeModal('modalReplenishment');
  renderAll();
  showToast('Replenishment saved');
}

function buildApprovalChain(){
  return [
    { name: 'Zahran', role: 'Operational Manager', status: 'PENDING', at: null },
    { name: 'Audy', role: 'Operation Lead', status: 'PENDING', at: null },
    { name: 'Leon', role: 'Property Head', status: 'PENDING', at: null }
  ];
}

function resetReplenishmentApprovals(req){
  if(!req || !Array.isArray(req.approvals)) return;
  req.approvals.forEach(ap => { ap.status = 'PENDING'; ap.at = null; });
}

function renderApprovalChips(req){
  const container = document.getElementById('replApprovalBadges');
  if(!container) return;
  container.innerHTML='';
  (req.approvals || []).forEach(ap=>{
    const div = document.createElement('div');
    const cls = ap.status === 'APPROVED' ? 'approval-chip--approved' : ap.status === 'REJECTED' ? 'approval-chip--rejected' : 'approval-chip--pending';
    div.className = `approval-chip ${cls}`;
    div.textContent = `${ap.name} (${ap.role}) - ${ap.status}`;
    container.appendChild(div);
  });
}

function nextPendingApprover(req){
  return (req.approvals || []).find(ap=>ap.status === 'PENDING');
}

function updateApprovalButtons(req){
  const btnApprove = document.getElementById('btnReplApprove');
  const btnReject = document.getElementById('btnReplReject');
  const btnSubmit = document.getElementById('btnReplSubmit');
  const btnSave = document.getElementById('btnReplSave');
  const btnDelete = document.getElementById('btnReplDelete');
  const btnPrint = document.getElementById('btnReplPrint');
  const isDraft = req.status === 'DRAFT';
  const isRejected = req.status === 'REJECTED';
  const isSubmitter = req.requestorName === state.currentUser.name;
  const pending = nextPendingApprover(req);
  const canAct = req.status === 'IN_REVIEW' && pending && pending.name === state.currentUser.name;
  const canSubmit = !replModalReadOnly && isSubmitter && (isDraft || isRejected);
  if(btnSubmit) btnSubmit.classList.toggle('hidden', !canSubmit);
  if(btnSave) btnSave.classList.toggle('hidden', replModalReadOnly || !(isSubmitter && (isDraft || isRejected)));
  if(btnDelete) btnDelete.classList.toggle('hidden', replModalReadOnly || !(isDraft && isSubmitter));
  if(btnPrint) btnPrint.classList.toggle('hidden', !replModalReadOnly);
  if(btnApprove) btnApprove.classList.toggle('hidden', !canAct);
  if(btnReject) btnReject.classList.toggle('hidden', !canAct);
}

function submitReplenishmentForApproval(){
  const createdBy = (document.getElementById('replModalCreatedBy') || {}).value || '';
  const requestDate = (document.getElementById('replModalRequestDate') || {}).value || new Date().toISOString().slice(0,10);
  const deliveryDate = (document.getElementById('replModalDeliveryDate') || {}).value || '';
  const neededDate = (document.getElementById('replModalNeededDate') || {}).value || '';
  if(replModalReadOnly) return showToast('Read-only mode');
  if(!createdBy) return showToast('Created By is required');
  if(!replModalLines.length) return showToast('Add at least one item line');

  let req = state.replenishmentRequests.find(r=>r.id===currentReplEditingId);
  const itemsPayload = replModalLines.map(ln=>({
    ...ln,
    unit: ln.unit || defaultUomCode(),
    requestedQty: ln.qty,
    last7DayUsage: computeLast7dUsage(ln.itemId, ln.type)
  }));

  if(!req){
    req = {
      id: currentReplEditingId || nextReplId(),
      property: state.selectedProperty,
      requestorName: createdBy,
      requestorRole: state.currentUser.role,
      createdAt: requestDate,
      updatedAt: requestDate,
      status: 'DRAFT',
      deliveryDate,
      neededDate,
      approvals: buildApprovalChain(),
      items: itemsPayload
    };
    state.replenishmentRequests.push(req);
    currentReplEditingId = req.id;
  }

  if(req.requestorName !== state.currentUser.name) return showToast('Only submitter can submit this draft');
  if(req.status !== 'DRAFT' && req.status !== 'REJECTED') return showToast('Already submitted');
  if(req.status === 'REJECTED') resetReplenishmentApprovals(req);

  req.property = state.selectedProperty;
  req.requestorName = createdBy;
  req.requestorRole = state.currentUser.role;
  req.createdAt = requestDate;
  req.deliveryDate = deliveryDate;
  req.neededDate = neededDate;
  req.items = itemsPayload;
  req.status = 'IN_REVIEW';
  req.updatedAt = new Date().toISOString().slice(0,10);
  showToast('Submitted for approval');
  renderApprovalChips(req);
  updateApprovalButtons(req);
  renderReplenishmentList();
}

function approveReplenishment(){
  const req = state.replenishmentRequests.find(r=>r.id===currentReplEditingId);
  if(!req) return;
  const pending = nextPendingApprover(req);
  if(!pending || pending.name !== state.currentUser.name) return showToast('Not authorized to approve now');
  pending.status = 'APPROVED';
  pending.at = new Date().toISOString().slice(0,10);
  const stillPending = nextPendingApprover(req);
  req.status = stillPending ? 'IN_REVIEW' : 'APPROVED';
  req.updatedAt = new Date().toISOString().slice(0,10);
  renderApprovalChips(req);
  updateApprovalButtons(req);
  renderReplenishmentList();
  showToast('Approved');
}

function rejectReplenishment(){
  const req = state.replenishmentRequests.find(r=>r.id===currentReplEditingId);
  if(!req) return;
  const pending = nextPendingApprover(req);
  if(!pending || pending.name !== state.currentUser.name) return showToast('Not authorized to reject now');
  pending.status = 'REJECTED';
  pending.at = new Date().toISOString().slice(0,10);
  req.status = 'REJECTED';
  req.updatedAt = new Date().toISOString().slice(0,10);
  renderApprovalChips(req);
  updateApprovalButtons(req);
  renderReplenishmentList();
  showToast('Rejected');
}

/* Procurement Overview */
function renderProcurementOverview(){
  const selectedCountry = (document.getElementById('overviewCountryFilter') || {}).value || 'all';
  const selectedBrand = (document.getElementById('overviewBrandFilter') || {}).value || 'all';
  // For now we don't filter by country/brand because data is global, but variables are ready
  const alerts = buildStockAlertItems();
  const critical = alerts.filter(a=>a.status==='critical');
  const mandatoryBelow = alerts.filter(a=>a.mandatory);
  const totalShortage = alerts.reduce((s,a)=>s+Math.max(a.minStock - a.onHand,0),0);
  const elKCritical = document.getElementById('kpiCriticalItems'); if(elKCritical) elKCritical.textContent = critical.length;
  const elKMand = document.getElementById('kpiMandatoryBelow'); if(elKMand) elKMand.textContent = mandatoryBelow.length;
  const elShort = document.getElementById('kpiTotalShortage'); if(elShort) elShort.textContent = totalShortage;

  const tbody = document.getElementById('overviewTableBody'); if(!tbody) return; tbody.innerHTML='';
  alerts.forEach(a=>{
    const shortage = Math.max(a.minStock - a.onHand,0);
    if(shortage<=0) return;
    const onlyMandatory = (document.getElementById('overviewMandatoryOnly') || {}).checked;
    if(onlyMandatory && !a.mandatory) return;
    // future: use selectedCountry/selectedBrand to filter
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${a.name}</td><td>${a.type}</td><td><span class="badge ${a.mandatory?'badge--yes':'badge--no'}">${a.mandatory?'Yes':'No'}</span></td><td>${shortage}</td>`;
    tbody.appendChild(tr);
  });

  const toggle = document.getElementById('overviewMandatoryOnly');
  if(toggle){ toggle.removeEventListener('change', renderProcurementOverview); toggle.addEventListener('change', renderProcurementOverview); }
  const cf = document.getElementById('overviewCountryFilter'); if(cf){ cf.removeEventListener('change', renderProcurementOverview); cf.addEventListener('change', renderProcurementOverview); }
  const bf = document.getElementById('overviewBrandFilter'); if(bf){ bf.removeEventListener('change', renderProcurementOverview); bf.addEventListener('change', renderProcurementOverview); }
}

/* Stock Movements */
function bindStockMovements(){
  const openIn = document.getElementById('btnOpenIncomingModal'); if(openIn) openIn.addEventListener('click', ()=>{ resetMovementForms('IN'); openModal('modalIncoming'); });
  const openOut = document.getElementById('btnOpenOutgoingModal'); if(openOut) openOut.addEventListener('click', ()=>{ resetMovementForms('OUT'); openModal('modalOutgoing'); });
  const btnAddIn = document.getElementById('btnAddIncomingLine'); if(btnAddIn) btnAddIn.addEventListener('click', ()=>{ addMovementLine('IN'); });
  const btnAddOut = document.getElementById('btnAddOutgoingLine'); if(btnAddOut) btnAddOut.addEventListener('click', ()=>{ addMovementLine('OUT'); });
  const btnPostIn = document.getElementById('btnPostIncoming'); if(btnPostIn) btnPostIn.addEventListener('click', postIncomingDocument);
  const btnPostOut = document.getElementById('btnPostOutgoing'); if(btnPostOut) btnPostOut.addEventListener('click', postOutgoingDocument);
  const btnResetIn = document.getElementById('btnResetIncoming'); if(btnResetIn) btnResetIn.addEventListener('click', ()=>resetMovementForms('IN'));
  const btnResetOut = document.getElementById('btnResetOutgoing'); if(btnResetOut) btnResetOut.addEventListener('click', ()=>resetMovementForms('OUT'));
  bindPOPicker();
  const dirFilter = document.getElementById('movementDirectionFilter'); if(dirFilter) dirFilter.addEventListener('change', ()=>{ movementHistoryPage = 1; renderMovementHistory(); });
  const searchInput = document.getElementById('movementSearchInput'); if(searchInput) searchInput.addEventListener('input', ()=>{ movementHistoryPage = 1; renderMovementHistory(); });
  const prevBtn = document.getElementById('movementPrevPage'); if(prevBtn) prevBtn.addEventListener('click', ()=>{ movementHistoryPage = Math.max(1, movementHistoryPage-1); renderMovementHistory(); });
  const nextBtn = document.getElementById('movementNextPage'); if(nextBtn) nextBtn.addEventListener('click', ()=>{ movementHistoryPage = movementHistoryPage+1; renderMovementHistory(); });
  document.querySelectorAll('[data-record-tab]').forEach(btn => btn.addEventListener('click', ()=>{ recordTab = btn.dataset.recordTab || 'IN'; updateRecordTabs(); }));
}

function bindPOPicker(){
  const search = document.getElementById('incomingPOSearch');
  const moreBtn = document.getElementById('poDropdownMore');
  const dropdown = document.getElementById('poDropdown');
  if(search){
    search.addEventListener('focus', ()=>{
      poSearchPage = 1;
      poSearchQuery = search.value || '';
      renderPODatalist();
      openPODropdown();
    });
    search.addEventListener('input', ()=>{
      poSearchPage = 1;
      poSearchQuery = search.value || '';
      renderPODatalist();
      openPODropdown();
    });
  }
  if(moreBtn){
    moreBtn.addEventListener('click', ()=>{
      poSearchPage += 1;
      renderPODatalist();
      openPODropdown();
    });
  }
  document.addEventListener('click', (e)=>{
    if(!dropdown || !search) return;
    if(dropdown.contains(e.target) || search.contains(e.target)) return;
    closePODropdown();
  });
}

function openPODropdown(){
  const dd = document.getElementById('poDropdown');
  if(dd) dd.classList.remove('hidden');
}

function closePODropdown(){
  const dd = document.getElementById('poDropdown');
  if(dd) dd.classList.add('hidden');
}

function selectPO(poNumber){
  const hidden = document.getElementById('incomingPONumber');
  const search = document.getElementById('incomingPOSearch');
  if(hidden) hidden.value = poNumber || '';
  if(search) search.value = poNumber || '';
  closePODropdown();
  handlePOSelection();
}

function updateMovementTabs(){
  document.querySelectorAll('[data-movement-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.movementTab === movementTab));
  document.querySelectorAll('[data-movement-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.movementPanel !== movementTab));
}

function resetMovementForms(direction){
  const today = new Date().toISOString().slice(0,10);
  const doIn = !direction || direction === 'IN';
  const doOut = !direction || direction === 'OUT';
  if(doIn){
    const inDate = document.getElementById('incomingDate'); if(inDate) inDate.value = today;
    const inProp = document.getElementById('incomingProperty'); if(inProp) inProp.value = state.selectedProperty;
    const src = document.getElementById('incomingSourceType'); if(src) src.value = 'WITH_PO';
    const po = document.getElementById('incomingPONumber'); if(po) po.value = '';
    const poSearch = document.getElementById('incomingPOSearch'); if(poSearch) poSearch.value = '';
    poSearchQuery = '';
    poSearchPage = 1;
    const note = document.getElementById('incomingNote'); if(note) note.value = '';
    const bast = document.getElementById('incomingBast'); if(bast) bast.value = '';
    incomingFormLines = [];
    editingIncomingId = null;
    addMovementLine('IN');
    renderMovementLines('IN');
  }
  if(doOut){
    const outDate = document.getElementById('outgoingDate'); if(outDate) outDate.value = today;
    const outProp = document.getElementById('outgoingProperty'); if(outProp) outProp.value = state.selectedProperty;
    const dest = document.getElementById('outgoingDestType'); if(dest) dest.value = 'DEPARTMENT';
    const outgoingDestRef = document.getElementById('outgoingDestRef'); if(outgoingDestRef) outgoingDestRef.value = '';
    const outNote = document.getElementById('outgoingNote'); if(outNote) outNote.value = '';
    outgoingFormLines = [];
    editingOutgoingId = null;
    addMovementLine('OUT');
    renderMovementLines('OUT');
  }
}

function addMovementLine(direction){
  const allItems = getCombinedInventory();
  const firstItem = allItems[0];
  const line = firstItem ? { itemId: firstItem.id, itemName: firstItem.name, type: firstItem.type, uom: firstItem.unit, qty: 0 } : { itemId: null, itemName: '', type: 'ROOM', uom: defaultUomCode(), qty: 0 };
  if(direction === 'IN'){ incomingFormLines.push(line); } else { outgoingFormLines.push(line); }
  renderMovementLines(direction);
}

function renderMovementLines(direction){
  const tbodyId = direction === 'IN' ? 'incomingLinesTableBody' : 'outgoingLinesTableBody';
  const tbody = document.getElementById(tbodyId);
  if(!tbody) return;
  const lines = direction === 'IN' ? incomingFormLines : outgoingFormLines;
  tbody.innerHTML = '';
  const allItems = getCombinedInventory();
  if(!allItems.length){
    tbody.innerHTML = '<tr><td colspan="3">No inventory items available.</td></tr>';
    return;
  }
  if(!lines.length && allItems.length){ addMovementLine(direction); return; }
  lines.forEach((ln, idx)=>{
    const tr = document.createElement('tr');
    const options = allItems.map(it => `<option value="${it.id}" ${ln.itemId===it.id?'selected':''}>${it.name} (${it.type})</option>`).join('');
    const uomLabel = getUomLabel(ln.uom);
    tr.innerHTML = `
      <td>
        <select class="input input--inline" data-mv-item="${direction}-${idx}">
          ${options}
        </select>
      </td>
      <td class="movement-uom">${uomLabel}</td>
      <td><input type="number" min="0" class="input input--inline" data-mv-qty="${direction}-${idx}" value="${ln.qty || 0}"></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-mv-item]').forEach(sel => sel.addEventListener('change',(e)=>{
    const [dir,index] = e.target.dataset.mvItem.split('-');
    const idxNum = Number(index);
    const arr = dir === 'IN' ? incomingFormLines : outgoingFormLines;
    const it = getCombinedInventory().find(x=>x.id===e.target.value);
    if(!arr[idxNum] || !it) return;
    arr[idxNum].itemId = it.id;
    arr[idxNum].itemName = it.name;
    arr[idxNum].type = it.type;
    arr[idxNum].uom = it.unit;
    renderMovementLines(dir);
  }));

  tbody.querySelectorAll('[data-mv-qty]').forEach(inp => inp.addEventListener('input',(e)=>{
    const [dir,index] = e.target.dataset.mvQty.split('-');
    const idxNum = Number(index);
    const arr = dir === 'IN' ? incomingFormLines : outgoingFormLines;
    if(!arr[idxNum]) return;
    arr[idxNum].qty = safeNumber(e.target.value);
  }));
}

function buildMovementDoc(lines){
  return lines.filter(ln => ln.itemId && safeNumber(ln.qty) > 0).map(ln => {
    const inv = getInventoryItemWithType(ln.itemId, ln.type) || getCombinedInventory().find(x=>x.id===ln.itemId);
    return { itemId: ln.itemId, itemName: (inv && inv.name) || ln.itemName || 'Unknown', type: ln.type, uom: (inv && inv.unit) || ln.uom || defaultUomCode(), qty: safeNumber(ln.qty) };
  });
}
function renderPODatalist(){
  const list = document.getElementById('poDropdownList');
  const moreBtn = document.getElementById('poDropdownMore');
  if(!list) return;
  const query = (poSearchQuery || '').trim().toLowerCase();
  const filtered = PO_CATALOG.filter(po => {
    if(!query) return true;
    return `${po.number} ${po.note || ''}`.toLowerCase().includes(query);
  });
  const visible = filtered.slice(0, poSearchPage * PO_PAGE_SIZE);
  list.innerHTML = '';
  if(!visible.length){
    list.innerHTML = '<div class="po-dropdown__empty">No matching PO</div>';
  } else {
    visible.forEach(po => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'po-option';
      btn.dataset.value = po.number;
      btn.innerHTML = `<div class="po-option__number">${po.number}</div><div class="po-option__note">${po.note || 'No note'}</div>`;
      btn.addEventListener('click', ()=>selectPO(po.number));
      list.appendChild(btn);
    });
  }
  if(moreBtn){
    const hasMore = filtered.length > visible.length;
    moreBtn.classList.toggle('hidden', !hasMore);
  }
}
function handlePOSelection(){
  const poNumber = (document.getElementById('incomingPONumber') || {}).value || '';
  const po = PO_CATALOG.find(p => p.number === poNumber);
  if(!po) return;
  incomingFormLines = po.items.map(it => {
    const inv = getInventoryItemWithType(it.itemId, it.type) || getCombinedInventory().find(x=>x.id===it.itemId);
    return { itemId: it.itemId, itemName: (inv && inv.name) || 'Unknown', type: it.type, uom: (inv && inv.unit) || defaultUomCode(), qty: safeNumber(it.qty) };
  });
  const noteEl = document.getElementById('incomingNote'); if(noteEl) noteEl.value = po.note || '';
  renderMovementLines('IN');
  showToast('PO items loaded');
}

function postIncomingDocument(){
  const payloadLines = buildMovementDoc(incomingFormLines);
  if(!payloadLines.length) return showToast('Add at least one incoming line with qty');
  const sourceType = (document.getElementById('incomingSourceType') || {}).value || 'WITH_PO';
  const poNumber = (document.getElementById('incomingPONumber') || {}).value || '';
  const note = (document.getElementById('incomingNote') || {}).value || '';
  const bastInput = document.getElementById('incomingBast');
  const bastFile = bastInput && bastInput.files && bastInput.files[0];
  const existing = editingIncomingId ? findMovementDoc('IN', editingIncomingId) : null;
  if(!bastFile && !(existing && existing.bastAttachment)) return showToast('BAST attachment is required before posting incoming');
  if(sourceType === 'WITH_PO' && !poNumber) return showToast('Select PO number');
  if(sourceType === 'ADJUSTMENT' && !note.toLowerCase().includes('inter')) return showToast('Adjustment is only for inter-storage. Add note.');
  const doc = {
    id: editingIncomingId || nextIncomingId(),
    date: (document.getElementById('incomingDate') || {}).value || new Date().toISOString().slice(0,10),
    property: (document.getElementById('incomingProperty') || {}).value || state.selectedProperty,
    sourceType,
    poNumber: poNumber || '-',
    note,
    bastAttachment: bastFile ? { name: bastFile.name, size: bastFile.size, type: bastFile.type, uploadedAt: new Date().toISOString() } : (existing && existing.bastAttachment),
    lines: payloadLines,
    history: existing ? existing.history : []
  };
  if(existing){
    modifyMovement(existing, 'IN', doc);
    showToast('Incoming movement updated');
  } else {
    postMovement(doc, 'IN');
    showToast('Incoming posted');
  }
  resetMovementForms('IN');
  closeModal('modalIncoming');
}

function postOutgoingDocument(){
  const payloadLines = buildMovementDoc(outgoingFormLines);
  if(!payloadLines.length) return showToast('Add at least one outgoing line with qty');
  const destType = (document.getElementById('outgoingDestType') || {}).value || 'DEPARTMENT';
  const destRef = (document.getElementById('outgoingDestRef') || {}).value || '';
  const note = (document.getElementById('outgoingNote') || {}).value || '';
  if(destType === 'ADJUSTMENT' && !note.toLowerCase().includes('inter')) return showToast('Adjustment is only for inter-storage. Add note.');
  const existing = editingOutgoingId ? findMovementDoc('OUT', editingOutgoingId) : null;
  const doc = {
    id: editingOutgoingId || nextOutgoingId(),
    date: (document.getElementById('outgoingDate') || {}).value || new Date().toISOString().slice(0,10),
    property: (document.getElementById('outgoingProperty') || {}).value || state.selectedProperty,
    destType,
    destRef,
    note,
    lines: payloadLines,
    history: existing ? existing.history : []
  };
  if(existing){
    modifyMovement(existing, 'OUT', doc);
    showToast('Outgoing movement updated');
  } else {
    postMovement(doc, 'OUT');
    showToast('Outgoing posted');
  }
  resetMovementForms('OUT');
  closeModal('modalOutgoing');
}

function renderStockMovementsView(){
  const inProp = document.getElementById('incomingProperty'); if(inProp) inProp.value = state.selectedProperty;
  const outProp = document.getElementById('outgoingProperty'); if(outProp) outProp.value = state.selectedProperty;
  renderMovementLines('IN');
  renderMovementLines('OUT');
  renderMovementDocLists();
  renderMovementHistory();
  updateRecordTabs();
}

function renderMovementDocLists(){
  const inTbody = document.getElementById('incomingDocsTableBody');
  if(inTbody){
    inTbody.innerHTML='';
    state.incomingDocs.slice().reverse().forEach(doc=>{
      const totalQty = doc.lines.reduce((s,l)=>s+safeNumber(l.qty),0);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${doc.id}</td><td>${doc.date}</td><td>${doc.property}</td><td>${doc.poNumber || '-'}</td><td><span class="badge ${doc.status==='POSTED'?'badge--active':'badge--archived'}">${doc.status||'-'}</span></td><td>${doc.lines.length}</td><td>${totalQty}</td><td class="table-actions-col"><button class="btn btn-secondary btn-sm" data-mv-action="view" data-dir="IN" data-id="${doc.id}">View</button> <button class="btn btn-secondary btn-sm" data-mv-action="modify" data-dir="IN" data-id="${doc.id}">Modify</button> <button class="btn btn-secondary btn-sm" data-mv-action="discard" data-dir="IN" data-id="${doc.id}">Discard</button> <button class="btn btn-secondary btn-sm" data-mv-action="revert" data-dir="IN" data-id="${doc.id}">Revert</button></td>`;
      inTbody.appendChild(tr);
    });
  }
  const outTbody = document.getElementById('outgoingDocsTableBody');
  if(outTbody){
    outTbody.innerHTML='';
    state.outgoingDocs.slice().reverse().forEach(doc=>{
      const totalQty = doc.lines.reduce((s,l)=>s+safeNumber(l.qty),0);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${doc.id}</td><td>${doc.date}</td><td>${doc.property}</td><td>${doc.destRef || '-'}</td><td><span class="badge ${doc.status==='POSTED'?'badge--active':'badge--archived'}">${doc.status||'-'}</span></td><td>${doc.lines.length}</td><td>${totalQty}</td><td class="table-actions-col"><button class="btn btn-secondary btn-sm" data-mv-action="view" data-dir="OUT" data-id="${doc.id}">View</button> <button class="btn btn-secondary btn-sm" data-mv-action="modify" data-dir="OUT" data-id="${doc.id}">Modify</button> <button class="btn btn-secondary btn-sm" data-mv-action="discard" data-dir="OUT" data-id="${doc.id}">Discard</button> <button class="btn btn-secondary btn-sm" data-mv-action="revert" data-dir="OUT" data-id="${doc.id}">Revert</button></td>`;
      outTbody.appendChild(tr);
    });
  }
  document.querySelectorAll('[data-mv-action]').forEach(btn => btn.addEventListener('click', handleMovementAction));
}

function getAllMovementRows(){
  const rows = [];
  state.incomingDocs.forEach(doc => rows.push({ ...doc, direction: 'IN' }));
  state.outgoingDocs.forEach(doc => rows.push({ ...doc, direction: 'OUT' }));
  return rows.sort((a,b)=> (b.date || '').localeCompare(a.date || ''));
}

function renderMovementHistory(){
  const tbody = document.getElementById('movementHistoryTableBody');
  if(!tbody) return;
  const dirFilter = (document.getElementById('movementDirectionFilter') || {}).value || 'ALL';
  const search = ((document.getElementById('movementSearchInput') || {}).value || '').toLowerCase();
  const rows = getAllMovementRows().filter(r => {
    if(dirFilter !== 'ALL' && r.direction !== dirFilter) return false;
    if(search && !(`${r.id}${r.property || ''}`.toLowerCase().includes(search))) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / MOVEMENT_PAGE_SIZE));
  movementHistoryPage = Math.min(movementHistoryPage, totalPages);
  const start = (movementHistoryPage - 1) * MOVEMENT_PAGE_SIZE;
  const slice = rows.slice(start, start + MOVEMENT_PAGE_SIZE);
  tbody.innerHTML = '';
  slice.forEach(doc => {
    const totalQty = (doc.lines || []).reduce((s,l)=>s+safeNumber(l.qty),0);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${doc.id}</td><td>${doc.direction}</td><td>${doc.date}</td><td>${doc.property || '-'}</td><td><span class="badge ${doc.status==='POSTED'?'badge--active':'badge--archived'}">${doc.status || '-'}</span></td><td>${(doc.lines || []).length}</td><td>${totalQty}</td><td class="table-actions-col"><button class="btn btn-secondary btn-sm" data-mv-action="view" data-dir="${doc.direction}" data-id="${doc.id}">View</button> <button class="btn btn-secondary btn-sm" data-mv-action="modify" data-dir="${doc.direction}" data-id="${doc.id}">Modify</button> <button class="btn btn-secondary btn-sm" data-mv-action="discard" data-dir="${doc.direction}" data-id="${doc.id}">Discard</button> <button class="btn btn-secondary btn-sm" data-mv-action="revert" data-dir="${doc.direction}" data-id="${doc.id}">Revert</button></td>`;
    tbody.appendChild(tr);
  });
  document.querySelectorAll('#movementHistoryTableBody [data-mv-action]').forEach(btn => btn.addEventListener('click', handleMovementAction));
  const info = document.getElementById('movementPageInfo'); if(info) info.textContent = `Page ${movementHistoryPage} / ${totalPages}`;
}

function updateRecordTabs(){
  document.querySelectorAll('[data-record-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.recordTab === recordTab));
  document.querySelectorAll('[data-record-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.recordPanel !== recordTab));
  document.querySelectorAll('[data-record-action]').forEach(btn => btn.classList.toggle('hidden', btn.dataset.recordAction !== recordTab));
}

function handleMovementAction(e){
  const action = e.target.getAttribute('data-mv-action');
  const dir = e.target.getAttribute('data-dir');
  const id = e.target.getAttribute('data-id');
  const doc = findMovementDoc(dir, id);
  if(!doc) return;
  if(action === 'view') return openMovementDetail(doc, dir);
  if(action === 'modify') return startEditMovement(doc, dir);
  if(action === 'discard') return discardMovement(doc, dir);
  if(action === 'revert') return revertMovement(doc, dir);
}

function openMovementDetail(doc, direction){
  const title = document.getElementById('movementDetailTitle'); if(title) title.textContent = `${direction} ${doc.id}`;
  const meta = document.getElementById('movementDetailMeta'); if(meta) meta.textContent = `${doc.property || '-'} • ${doc.date || '-'} • Status: ${doc.status || '-'}${doc.bastAttachment ? ' • BAST: ' + doc.bastAttachment.name : ''}`;
  const tbody = document.getElementById('movementDetailLines'); if(tbody){ tbody.innerHTML=''; (doc.lines || []).forEach(ln => { const tr = document.createElement('tr'); tr.innerHTML = `<td>${ln.itemName}</td><td>${ln.type}</td><td>${ln.qty}</td><td>${getUomLabel(ln.uom)}</td>`; tbody.appendChild(tr); }); }
  const logList = document.getElementById('movementDetailLogs'); if(logList){ logList.innerHTML=''; (doc.history || []).slice().reverse().forEach(log => { const li = document.createElement('li'); li.textContent = `${log.ts || ''} — ${log.action}: ${log.detail || ''}`; logList.appendChild(li); }); }
  openModal('modalMovementDetail');
}

function startEditMovement(doc, direction){
  if(direction === 'IN'){
    editingIncomingId = doc.id;
    const inDate = document.getElementById('incomingDate'); if(inDate) inDate.value = doc.date || '';
    const inProp = document.getElementById('incomingProperty'); if(inProp) inProp.value = doc.property || state.selectedProperty;
    const src = document.getElementById('incomingSourceType'); if(src) src.value = doc.sourceType || 'WITH_PO';
    const po = document.getElementById('incomingPONumber'); if(po) po.value = doc.poNumber || '';
    const poSearch = document.getElementById('incomingPOSearch'); if(poSearch) poSearch.value = doc.poNumber || '';
    poSearchQuery = doc.poNumber || '';
    poSearchPage = 1;
    renderPODatalist();
    const note = document.getElementById('incomingNote'); if(note) note.value = doc.note || '';
    incomingFormLines = (doc.lines || []).map(ln => ({ ...ln }));
    renderMovementLines('IN');
    openModal('modalIncoming');
  } else {
    editingOutgoingId = doc.id;
    const outDate = document.getElementById('outgoingDate'); if(outDate) outDate.value = doc.date || '';
    const outProp = document.getElementById('outgoingProperty'); if(outProp) outProp.value = doc.property || state.selectedProperty;
    const dest = document.getElementById('outgoingDestType'); if(dest) dest.value = doc.destType || 'DEPARTMENT';
    const destRef = document.getElementById('outgoingDestRef'); if(destRef) destRef.value = doc.destRef || '';
    const note = document.getElementById('outgoingNote'); if(note) note.value = doc.note || '';
    outgoingFormLines = (doc.lines || []).map(ln => ({ ...ln }));
    renderMovementLines('OUT');
    openModal('modalOutgoing');
  }
  showToast('Loaded movement for modification');
}

function renderRecentMovements(){
  const tbody = document.getElementById('movementRecentTableBody');
  if(!tbody) return;
  tbody.innerHTML = '';
  const rows = [];
  state.incomingDocs.forEach(doc => { doc.lines.forEach(ln => rows.push({ date: doc.date, id: doc.id, dir: 'IN', itemName: ln.itemName, qty: ln.qty, uom: ln.uom, property: doc.property })); });
  state.outgoingDocs.forEach(doc => { doc.lines.forEach(ln => rows.push({ date: doc.date, id: doc.id, dir: 'OUT', itemName: ln.itemName, qty: ln.qty, uom: ln.uom, property: doc.property })); });
  rows.sort((a,b)=> (b.date||'').localeCompare(a.date||''));
  rows.slice(0,10).forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.date}</td><td>${r.id}</td><td><span class="badge ${r.dir==='IN'?'badge--yes':'badge--no'}">${r.dir}</span></td><td>${r.itemName}</td><td>${r.qty}</td><td>${getUomLabel(r.uom)}</td><td>${r.property}</td>`;
    tbody.appendChild(tr);
  });
}

/* Stock On Hand Report */
function bindStockOnHand() { const btn = document.getElementById('btnPrintStockOnHand'); if(btn) btn.addEventListener('click', ()=>window.print()); }

function renderStockOnHand(){
  const tbody = document.getElementById('stockOnHandTableBody');
  if(!tbody) return;
  tbody.innerHTML = '';
  const items = getCombinedInventory();
  items.forEach(it => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${it.name}</td><td>${it.type}</td><td>${getUomLabel(it.unit)}</td><td>${it.onHand ?? 0}</td><td>${it.minStock ?? '-'}</td><td>${it.maxStock ?? '-'}</td><td><span class="badge ${it.mandatory?'badge--yes':'badge--no'}">${it.mandatory?'Yes':'No'}</span></td>`;
    tbody.appendChild(tr);
  });
}

/* Adjust Stock (manual) */
function bindAdjustStock(){ const btn = document.getElementById('btnSubmitAdjustStock'); if(btn) btn.addEventListener('click', submitAdjustStock); }

function openAdjustStockModal(itemId, type){
  const item = getInventoryItemWithType(itemId, type);
  if(!item) return;
  adjustContext = { itemId, type };
  document.getElementById('adjustItemId').value = itemId;
  document.getElementById('adjustItemType').value = type;
  const nameEl = document.getElementById('adjustItemName'); if(nameEl) nameEl.textContent = `${item.name} (${type})`;
  const curEl = document.getElementById('adjustCurrent'); if(curEl) curEl.textContent = `Current On Hand: ${item.onHand ?? 0} ${getUomLabel(item.unit)}`;
  const targetEl = document.getElementById('adjustTargetQty'); if(targetEl) targetEl.value = item.onHand ?? 0;
  const reasonEl = document.getElementById('adjustReason'); if(reasonEl) reasonEl.value = '';
  openModal('modalAdjustStock');
}

function submitAdjustStock(){
  const itemId = (document.getElementById('adjustItemId') || {}).value;
  const type = (document.getElementById('adjustItemType') || {}).value;
  const targetQty = safeNumber((document.getElementById('adjustTargetQty') || {}).value);
  const reason = (document.getElementById('adjustReason') || {}).value || 'Adjustment';
  if(!reason.toLowerCase().includes('inter')) return showToast('Adjustment is only meant inter-storage. Mention inter-storage in reason.');
  const item = getInventoryItemWithType(itemId, type);
  if(!item) return;
  const diff = targetQty - safeNumber(item.onHand);
  if(diff === 0){ showToast('No adjustment needed'); closeModal('modalAdjustStock'); return; }
  const line = { itemId: item.id, itemName: item.name, type, uom: item.unit, qty: Math.abs(diff) };
  const today = new Date().toISOString().slice(0,10);
  if(diff > 0){
    postMovement({ id: nextIncomingId(), date: today, property: state.selectedProperty, sourceType: 'ADJUSTMENT', poNumber: '-', note: reason, bastAttachment: { name: 'Adjustment', size: 0, type: 'AUTO' }, lines: [line], history: [] }, 'IN');
  } else {
    postMovement({ id: nextOutgoingId(), date: today, property: state.selectedProperty, destType: 'ADJUSTMENT', destRef: reason, note: reason, lines: [line], history: [] }, 'OUT');
  }
  closeModal('modalAdjustStock');
  showToast('Adjustment posted');
}

/* Modals */
function initModals(){ document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', ()=>{ const id = btn.getAttribute('data-close-modal'); if(id) closeModal(id); })); document.querySelectorAll('.modal__backdrop').forEach(b => b.addEventListener('click', ()=>{ const m = b.closest('.modal'); if(m && m.id) closeModal(m.id); })); }
function openModal(id){ const m = document.getElementById(id); if(!m) return; m.classList.remove('hidden'); }
function closeModal(id){ const m = document.getElementById(id); if(!m) return; m.classList.add('hidden'); }
