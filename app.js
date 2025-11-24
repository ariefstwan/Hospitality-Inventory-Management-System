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

const state = {
  activePage: 'room-inventory',
  selectedProperty: 'Urbanview Jakarta Sudirman',
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
function applyStockMovement(doc, direction) {
  if (!doc || !Array.isArray(doc.lines)) return;
  doc.lines.forEach(ln => {
    const list = ln.type === 'ROOM' ? state.roomInventoryItems : state.laundryInventoryItems;
    const item = list.find(i => i.id === ln.itemId);
    if (!item) return;
    if (direction === 'IN') {
      item.onHand = safeNumber(item.onHand) + safeNumber(ln.qty);
    } else if (direction === 'OUT') {
      const nextVal = safeNumber(item.onHand) - safeNumber(ln.qty);
      item.onHand = Math.max(0, nextVal);
    }
  });

  if (direction === 'IN') {
    state.incomingDocs.push(doc);
  } else if (direction === 'OUT') {
    state.outgoingDocs.push(doc);
  }

  renderAll();
}
function getInventoryItemWithType(id, type) { return type === 'ROOM' ? state.roomInventoryItems.find(i => i.id === id) : state.laundryInventoryItems.find(i => i.id === id); }
function getCombinedInventory() { return [...state.roomInventoryItems.map(i => ({ ...i, type: 'ROOM' })), ...state.laundryInventoryItems.map(i => ({ ...i, type: 'LAUNDRY' }))]; }
function defaultUomCode() { return (UOMS[0] && UOMS[0].code) || 'PCS'; }
function showToast(msg) { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 2000); }

/* Init */
document.addEventListener('DOMContentLoaded', () => {
  seedDummyData();
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
  state.replenishmentRequests.push({ id: rr, property: state.selectedProperty, requestorName: 'Reddy', requestorRole: 'Property Manager', createdAt: '2025-10-05', updatedAt: '2025-10-05', status: 'DRAFT', notes: 'Initial', items: [ { id: nextReplLineId(), itemId: state.roomInventoryItems[0].id, itemName: state.roomInventoryItems[0].name, type: 'ROOM', currentStock: state.roomInventoryItems[0].onHand, minStock: state.roomInventoryItems[0].minStock, last7DayUsage: 80, suggestedQty: 100, requestedQty: 100, mandatory: state.roomInventoryItems[0].mandatory, notes: '' } ] });
}

/* Rendering */
function renderAll() { document.querySelectorAll('.page').forEach(p => p.classList.remove('page--active')); const active = document.getElementById('page-' + state.activePage); if (active) active.classList.add('page--active'); renderRoomInventoryTable(); renderLaundryInventoryTable(); renderStockAlertTable(); renderStockOpnameList(); renderReplenishmentList(); renderProcurementOverview(); renderStockMovementsView(); renderStockOnHand(); }

/* Navigation/Header */
function bindNavigation() { document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => { const page = btn.getAttribute('data-page'); if (!page) return; state.activePage = page; document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b === btn)); renderAll(); })); }
function bindHeader() { const sel = document.getElementById('propertySelect'); if (!sel) return; sel.addEventListener('change', () => { state.selectedProperty = sel.value; renderAll(); }); }

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

function createReplenishmentFromAlerts() { const selected = Array.from(document.querySelectorAll('.alert-select')).filter(cb=>cb.checked).map(cb=>({ id: cb.dataset.id, type: cb.dataset.type })); if (!selected.length) return showToast('No alerts selected'); const all = buildStockAlertItems(); const lines = selected.map(s => { const a = all.find(x=>x.id===s.id && x.type===s.type); if (!a) return null; return { id: nextReplLineId(), itemId: a.id, itemName: a.name, type: a.type, currentStock: a.onHand, minStock: a.minStock, last7DayUsage: a.last7DayUsage, suggestedQty: a.suggestedQty, requestedQty: a.suggestedQty, mandatory: a.mandatory, notes: '' }; }).filter(Boolean); if (!lines.length) return showToast('No valid alert items'); const id = nextReplId(); const today = new Date().toISOString().slice(0,10); const req = { id, property: state.selectedProperty, requestorName: 'Reddy', requestorRole: 'Property Manager', createdAt: today, updatedAt: today, status: 'DRAFT', notes:'', items: lines }; state.replenishmentRequests.push(req); state.activePage = 'replenishment-requests'; document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.getAttribute('data-page') === 'replenishment-requests')); renderAll(); openReplenishmentDetail(req.id); showToast('Replenishment created from Stock Alert'); }

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
    applyStockMovement({ id: nextIncomingId(), date: today, property: state.selectedProperty, sourceType: 'OPNAME_ADJUSTMENT', reference: s.name, lines: incomingLines }, 'IN');
  }
  if(outgoingLines.length){
    applyStockMovement({ id: nextOutgoingId(), date: today, property: state.selectedProperty, destType: 'OPNAME_ADJUSTMENT', destRef: s.name, lines: outgoingLines }, 'OUT');
  }
  renderAll();
  openStockOpnameDetail(currentOpnameSessionId);
  showToast('Stock opname adjustments posted');
}

/* Replenishment */
function bindReplenishment(){ const saveBtn = document.getElementById('btnSaveReplenishment'); if(saveBtn) saveBtn.addEventListener('click', saveReplenishmentFromDetail); const newBtn = document.getElementById('btnNewReplenishment'); if(newBtn) newBtn.addEventListener('click', ()=>{ const id = nextReplId(); const today = new Date().toISOString().slice(0,10); const req = { id, property: state.selectedProperty, requestorName: 'Reddy', requestorRole: 'Property Manager', createdAt: today, updatedAt: today, status: 'DRAFT', notes:'', items: [] }; state.replenishmentRequests.push(req); state.activePage='replenishment-requests'; document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active', b.getAttribute('data-page')==='replenishment-requests')); renderAll(); openReplenishmentDetail(id); }); const addLineBtn = document.getElementById('btnAddReplenishmentLine'); if(addLineBtn) addLineBtn.addEventListener('click', ()=>{ if(!currentReplId) return; const req = state.replenishmentRequests.find(r=>r.id===currentReplId); if(!req) return; req.items.push({ id: nextReplLineId(), itemId: null, itemName: 'Manual Item', type: 'ROOM', currentStock:0, minStock:0, last7DayUsage:0, suggestedQty:0, requestedQty:0, mandatory:false, notes:'' }); openReplenishmentDetail(currentReplId); }); }

function renderReplenishmentList(){ const tbody = document.getElementById('replenishmentTableBody'); if(!tbody) return; tbody.innerHTML=''; state.replenishmentRequests.forEach(req=>{ const tr = document.createElement('tr'); tr.innerHTML = `
    <td>${req.id}</td>
    <td>${req.property}</td>
    <td>${req.requestorName}</td>
    <td>${req.items.length}</td>
    <td>${req.status}</td>
    <td>${req.createdAt}</td>
    <td>${req.updatedAt}</td>
    <td class="table-actions-col"><button class="btn btn-secondary btn-sm" data-id="${req.id}">View</button></td>
  `; tr.querySelector('button').addEventListener('click', ()=>openReplenishmentDetail(req.id)); tbody.appendChild(tr); }); const panel = document.getElementById('replenishmentDetailPanel'); if(panel) panel.classList.add('hidden'); }
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
  document.querySelectorAll('[data-movement-tab]').forEach(btn => btn.addEventListener('click', ()=>{ movementTab = btn.dataset.movementTab; updateMovementTabs(); }));
  const btnAddIn = document.getElementById('btnAddIncomingLine'); if(btnAddIn) btnAddIn.addEventListener('click', ()=>{ addMovementLine('IN'); });
  const btnAddOut = document.getElementById('btnAddOutgoingLine'); if(btnAddOut) btnAddOut.addEventListener('click', ()=>{ addMovementLine('OUT'); });
  const btnPostIn = document.getElementById('btnPostIncoming'); if(btnPostIn) btnPostIn.addEventListener('click', postIncomingDocument);
  const btnPostOut = document.getElementById('btnPostOutgoing'); if(btnPostOut) btnPostOut.addEventListener('click', postOutgoingDocument);
}

function updateMovementTabs(){
  document.querySelectorAll('[data-movement-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.movementTab === movementTab));
  document.querySelectorAll('[data-movement-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.movementPanel !== movementTab));
}

function resetMovementForms(){
  const today = new Date().toISOString().slice(0,10);
  const inDate = document.getElementById('incomingDate'); if(inDate) inDate.value = today;
  const outDate = document.getElementById('outgoingDate'); if(outDate) outDate.value = today;
  const inProp = document.getElementById('incomingProperty'); if(inProp) inProp.value = state.selectedProperty;
  const outProp = document.getElementById('outgoingProperty'); if(outProp) outProp.value = state.selectedProperty;
  const src = document.getElementById('incomingSourceType'); if(src) src.value = 'WITH_PO';
  const dest = document.getElementById('outgoingDestType'); if(dest) dest.value = 'DEPARTMENT';
  const incomingReference = document.getElementById('incomingReference'); if(incomingReference) incomingReference.value = '';
  const outgoingDestRef = document.getElementById('outgoingDestRef'); if(outgoingDestRef) outgoingDestRef.value = '';
  incomingFormLines = [];
  outgoingFormLines = [];
  addMovementLine('IN');
  addMovementLine('OUT');
  renderMovementLines('IN');
  renderMovementLines('OUT');
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

function postIncomingDocument(){
  const payloadLines = buildMovementDoc(incomingFormLines);
  if(!payloadLines.length) return showToast('Add at least one incoming line with qty');
  const doc = {
    id: nextIncomingId(),
    date: (document.getElementById('incomingDate') || {}).value || new Date().toISOString().slice(0,10),
    property: (document.getElementById('incomingProperty') || {}).value || state.selectedProperty,
    sourceType: (document.getElementById('incomingSourceType') || {}).value || 'WITH_PO',
    reference: (document.getElementById('incomingReference') || {}).value || '',
    lines: payloadLines
  };
  applyStockMovement(doc, 'IN');
  showToast('Incoming posted');
  resetMovementForms();
}

function postOutgoingDocument(){
  const payloadLines = buildMovementDoc(outgoingFormLines);
  if(!payloadLines.length) return showToast('Add at least one outgoing line with qty');
  const doc = {
    id: nextOutgoingId(),
    date: (document.getElementById('outgoingDate') || {}).value || new Date().toISOString().slice(0,10),
    property: (document.getElementById('outgoingProperty') || {}).value || state.selectedProperty,
    destType: (document.getElementById('outgoingDestType') || {}).value || 'DEPARTMENT',
    destRef: (document.getElementById('outgoingDestRef') || {}).value || '',
    lines: payloadLines
  };
  applyStockMovement(doc, 'OUT');
  showToast('Outgoing posted');
  resetMovementForms();
}

function renderStockMovementsView(){
  updateMovementTabs();
  const inProp = document.getElementById('incomingProperty'); if(inProp) inProp.value = state.selectedProperty;
  const outProp = document.getElementById('outgoingProperty'); if(outProp) outProp.value = state.selectedProperty;
  renderMovementLines('IN');
  renderMovementLines('OUT');
  renderMovementDocLists();
  renderRecentMovements();
}

function renderMovementDocLists(){
  const inTbody = document.getElementById('incomingDocsTableBody'); if(inTbody){ inTbody.innerHTML=''; state.incomingDocs.slice(-5).reverse().forEach(doc=>{ const totalQty = doc.lines.reduce((s,l)=>s+safeNumber(l.qty),0); const tr = document.createElement('tr'); tr.innerHTML = `<td>${doc.id}</td><td>${doc.date}</td><td>${doc.property}</td><td>${doc.reference || '-'}</td><td>${doc.lines.length}</td><td>${totalQty}</td>`; inTbody.appendChild(tr); }); }
  const outTbody = document.getElementById('outgoingDocsTableBody'); if(outTbody){ outTbody.innerHTML=''; state.outgoingDocs.slice(-5).reverse().forEach(doc=>{ const totalQty = doc.lines.reduce((s,l)=>s+safeNumber(l.qty),0); const tr = document.createElement('tr'); tr.innerHTML = `<td>${doc.id}</td><td>${doc.date}</td><td>${doc.property}</td><td>${doc.destRef || '-'}</td><td>${doc.lines.length}</td><td>${totalQty}</td>`; outTbody.appendChild(tr); }); }
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
function bindStockOnHand() { /* placeholder for future filters */ }

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
  const item = getInventoryItemWithType(itemId, type);
  if(!item) return;
  const diff = targetQty - safeNumber(item.onHand);
  if(diff === 0){ showToast('No adjustment needed'); closeModal('modalAdjustStock'); return; }
  const line = { itemId: item.id, itemName: item.name, type, uom: item.unit, qty: Math.abs(diff) };
  const today = new Date().toISOString().slice(0,10);
  if(diff > 0){
    applyStockMovement({ id: nextIncomingId(), date: today, property: state.selectedProperty, sourceType: 'ADJUSTMENT', reference: reason, lines: [line] }, 'IN');
  } else {
    applyStockMovement({ id: nextOutgoingId(), date: today, property: state.selectedProperty, destType: 'ADJUSTMENT', destRef: reason, lines: [line] }, 'OUT');
  }
  closeModal('modalAdjustStock');
  showToast('Adjustment posted');
}

/* Modals */
function initModals(){ document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', ()=>{ const id = btn.getAttribute('data-close-modal'); if(id) closeModal(id); })); document.querySelectorAll('.modal__backdrop').forEach(b => b.addEventListener('click', ()=>{ const m = b.closest('.modal'); if(m && m.id) closeModal(m.id); })); }
function openModal(id){ const m = document.getElementById(id); if(!m) return; m.classList.remove('hidden'); }
function closeModal(id){ const m = document.getElementById(id); if(!m) return; m.classList.add('hidden'); }
