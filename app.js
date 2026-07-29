import { defaultData } from './data.js';

// ==========================================================================
// APPLICATION STATE MANAGEMENT
// ==========================================================================
let state = {
  invoices: [],
  purchases: [],
  uploadedPdfs: [],
  activeTab: 'dashboard',
  selectedRecordId: null,
  selectedRecordType: null,
  theme: 'light',
  dashboardStats: {
    invoiceCount: 0,
    purchaseCount: 0
  },
  deletedInvoices: [] // Track deleted invoice numbers to ignore them during synchronization
};

const SERVER_BASE_URL = import.meta.env.VITE_SERVER_BASE_URL || `http://${window.location.hostname}:4000`;

// Authentication Constants (Static Credentials)
const STATIC_USER_ID = "admin";
const STATIC_PASSWORD = "laserpower@123";
const SESSION_DURATION = 12 * 60 * 60 * 1000; // 12 hours in milliseconds

// Charts variables
let amountChart = null;
let freightChart = null;

// ==========================================================================
// INITIALIZATION AND SYNC LOGIC
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function checkAuth() {
  const session = localStorage.getItem('auth_session');
  const appContainer = document.querySelector('.app-container');
  const loginScreen = document.getElementById('login-screen');
  
  if (session) {
    try {
      const sessionData = JSON.parse(session);
      const now = Date.now();
      if (now - sessionData.timestamp < SESSION_DURATION) {
        // Valid session
        appContainer.style.display = 'flex';
        loginScreen.style.display = 'none';
        return true;
      }
    } catch (err) {
      console.error('Failed to parse auth session:', err);
    }
  }
  
  // Invalid or expired session
  appContainer.style.display = 'none';
  loginScreen.style.display = 'flex';
  localStorage.removeItem('auth_session');
  return false;
}

function initAuthActions() {
  // Login form submit
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const usernameInput = document.getElementById('login-username');
      const passwordInput = document.getElementById('login-password');
      const errorMsg = document.getElementById('login-error-msg');
      
      const username = usernameInput.value.trim();
      const password = passwordInput.value;
      
      if (username === STATIC_USER_ID && password === STATIC_PASSWORD) {
        errorMsg.style.display = 'none';
        localStorage.setItem('auth_session', JSON.stringify({
          username: username,
          timestamp: Date.now()
        }));
        
        // Show app container and hide login screen
        const appContainer = document.querySelector('.app-container');
        const loginScreen = document.getElementById('login-screen');
        appContainer.style.display = 'flex';
        loginScreen.style.display = 'none';
        
        // Sync API and render dashboard views
        syncWithAPI(false);
        renderAllViews();
        showToast('Login successful! Welcome back.', 'success');
        
        // Clear inputs
        usernameInput.value = '';
        passwordInput.value = '';
      } else {
        errorMsg.textContent = 'Invalid User ID or Password';
        errorMsg.style.display = 'block';
        showToast('Login failed. Check details and try again.', 'error');
      }
    });
  }
  
  // Logout button
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to log out?')) {
        localStorage.removeItem('auth_session');
        checkAuth();
        showToast('Logged out successfully.', 'info');
      }
    });
  }
  
  // Toggle password visibility
  const togglePasswordBtn = document.getElementById('toggle-password-btn');
  if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', () => {
      const passwordInput = document.getElementById('login-password');
      const togglePasswordIcon = document.getElementById('toggle-password-icon');
      if (passwordInput && togglePasswordIcon) {
        if (passwordInput.type === 'password') {
          passwordInput.type = 'text';
          togglePasswordIcon.setAttribute('data-lucide', 'eye-off');
        } else {
          passwordInput.type = 'password';
          togglePasswordIcon.setAttribute('data-lucide', 'eye');
        }
        lucide.createIcons();
      }
    });
  }
}

function initApp() {
  state.theme = localStorage.getItem('app_theme') || 'light';

  if (state.theme === 'dark') {
    document.body.classList.remove('light-theme');
    document.body.classList.add('dark-theme');
  } else {
    document.body.classList.remove('dark-theme');
    document.body.classList.add('light-theme');
  }

  // Initialize UI components first (no data needed)
  initTabs();
  initThemeToggle();
  initSettingsActions();
  initUploadActions();
  initSearchAndFilters();
  initModalActions();
  initAddRecordActions();
  initDetailModalTabs();
  initAuthActions();

  // Check auth
  const isAuthed = checkAuth();
  if (isAuthed) {
    // Load metadata only (deleted invoices, uploaded PDFs)
    state.deletedInvoices = JSON.parse(localStorage.getItem('db_deleted_invoices') || '[]');
    state.uploadedPdfs = JSON.parse(localStorage.getItem('db_uploaded_pdfs') || '[]');

    // Show loading indicator while fetching from server
    const reconciliationTbody = document.getElementById('reconciliation-tbody');
    if (reconciliationTbody) {
      reconciliationTbody.innerHTML = `<tr><td colspan="12" class="text-center" style="padding:2rem;color:var(--text-muted);">⏳ Loading latest data from server...</td></tr>`;
    }

    // Fetch fresh data from server (always, on every load)
    fetchAndRefresh();
  }

  // Render Lucide icons
  lucide.createIcons();

  // Hide splash screen
  const splash = document.getElementById('page-splash-screen');
  if (splash) {
    setTimeout(() => {
      splash.classList.add('fade-out');
    }, 1200);
  }
}

// Fetch fresh data from server, update local cache, then re-render UI
async function fetchAndRefresh() {
  const statusIndicator = document.querySelector('.status-indicator');
  const syncTimeLabel = document.getElementById('last-sync-time');

  if (statusIndicator) statusIndicator.className = 'status-indicator syncing';
  if (syncTimeLabel) syncTimeLabel.textContent = 'Syncing...';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${SERVER_BASE_URL}/api/data?_=${Date.now()}`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`Server returned ${response.status}`);

    const data = await response.json();

    if (data && data.success) {
      // Process fresh server data (source of truth)
      processRawData(data);

      // Update local cache with fresh data
      saveToLocalStorage();

      if (statusIndicator) statusIndicator.className = 'status-indicator online';
      if (syncTimeLabel) syncTimeLabel.textContent = new Date().toLocaleTimeString();

      // Re-render all views with fresh data
      renderAllViews();
    } else {
      throw new Error('Server returned unsuccessful payload');
    }
  } catch (error) {
    console.warn('Could not fetch fresh data from server:', error.message);
    if (statusIndicator) statusIndicator.className = 'status-indicator offline';
    if (syncTimeLabel) syncTimeLabel.textContent = 'Offline';
    showToast('Server unreachable — showing empty state', 'warning');
    renderAllViews();
  }
}

function cleanupExpiredLocalPdfs() {
  const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let countExpired = 0;

  if (state.uploadedPdfs && Array.isArray(state.uploadedPdfs)) {
    const validPdfs = [];
    state.uploadedPdfs.forEach(pdf => {
      const uploadTime = new Date(pdf.uploadedAt || pdf.timestamp || 0).getTime();
      if (uploadTime > 0 && (now - uploadTime) > TEN_DAYS_MS) {
        countExpired++;
        if (pdf.url && pdf.url.startsWith('blob:')) {
          try { URL.revokeObjectURL(pdf.url); } catch (e) {}
        }
      } else {
        validPdfs.push(pdf);
      }
    });
    state.uploadedPdfs = validPdfs;
  }

  state.invoices = state.invoices.map(inv => {
    if (inv.pdf_uploaded_at) {
      const ageMs = now - new Date(inv.pdf_uploaded_at).getTime();
      if (ageMs > TEN_DAYS_MS) {
        if (inv.pdf_url && inv.pdf_url.startsWith('blob:')) {
          try { URL.revokeObjectURL(inv.pdf_url); } catch (e) {}
        }
        inv.pdf_url = '';
        inv.pdf_uploaded_at = null;
        countExpired++;
      }
    }
    return inv;
  });

  state.purchases = state.purchases.map(pur => {
    if (pur.pdf_uploaded_at) {
      const ageMs = now - new Date(pur.pdf_uploaded_at).getTime();
      if (ageMs > TEN_DAYS_MS) {
        if (pur.pdf_url && pur.pdf_url.startsWith('blob:')) {
          try { URL.revokeObjectURL(pur.pdf_url); } catch (e) {}
        }
        pur.pdf_url = '';
        pur.pdf_uploaded_at = null;
        countExpired++;
      }
    }
    return pur;
  });

  if (countExpired > 0) {
    saveToLocalStorage();
    console.log(`🧹 10-Day Retention Policy: Purged ${countExpired} expired local PDF reference(s).`);
  }
}

function loadLocalDatabase() {
  const cachedInvoices = localStorage.getItem('db_invoices');
  const cachedPurchases = localStorage.getItem('db_purchases');
  const cachedDashboardStats = localStorage.getItem('db_dashboard_stats');
  const cachedUploadedPdfs = localStorage.getItem('db_uploaded_pdfs');
  state.deletedInvoices = JSON.parse(localStorage.getItem('db_deleted_invoices') || '[]');
  state.uploadedPdfs = JSON.parse(cachedUploadedPdfs || '[]');

  if (cachedInvoices && cachedPurchases) {
    state.invoices = JSON.parse(cachedInvoices).filter(inv => !state.deletedInvoices.includes(inv.invoice_number));
    state.purchases = JSON.parse(cachedPurchases).filter(pur => !state.deletedInvoices.includes(pur.party_inv_no));
    state.dashboardStats = JSON.parse(cachedDashboardStats || '{}');

    if (!state.dashboardStats || !state.dashboardStats.invoiceCount) {
      state.dashboardStats = {
        invoiceCount: state.invoices.length,
        purchaseCount: state.purchases.length
      };
    }

    cleanupExpiredLocalPdfs();
    showToast('Loaded local database.', 'success');
  } else {
    // Process default static data
    processRawData(defaultData);
    cleanupExpiredLocalPdfs();
    saveToLocalStorage();
    showToast('Loaded default database.', 'success');
  }
}

function saveToLocalStorage() {
  localStorage.setItem('db_invoices', JSON.stringify(state.invoices));
  localStorage.setItem('db_purchases', JSON.stringify(state.purchases));
  localStorage.setItem('db_dashboard_stats', JSON.stringify(state.dashboardStats));
  localStorage.setItem('db_deleted_invoices', JSON.stringify(state.deletedInvoices));
  localStorage.setItem('db_uploaded_pdfs', JSON.stringify(state.uploadedPdfs));
}

// === LOCAL OVERRIDES SYSTEM ===
// Stores manually-edited fields per record so they survive hard reloads + server syncs
function saveLocalOverrides() {
  const overrides = JSON.parse(localStorage.getItem('db_local_overrides') || '{}');
  state.purchases.forEach(pur => {
    if (!pur._manually_edited) return;
    const key = `pur:${pur.party_inv_no}`;
    overrides[key] = overrides[key] || {};
    const fields = ['project','project_code','deparment','deperment_code','tax_critaria',
      'tax_critaria_name','service_acc_name','service_acc_code','expense_acc_name','expense_acc_code',
      'sub_acc_name','sub_acc_code','sac_code','series','div_code','addon_code_str','stax_code_str',
      'rcm','tds_percent','st_charges','net_payable','taxable_value','bill_freight_val',
      'total_invoice_value','ai_summary','validated','validation_timestamp','our_reg_addr'];
    fields.forEach(f => { if (pur[f] !== undefined && pur[f] !== null && pur[f] !== '') overrides[key][f] = pur[f]; });
  });
  state.invoices.forEach(inv => {
    if (!inv._manually_edited) return;
    const key = `inv:${inv.invoice_number}`;
    overrides[key] = overrides[key] || {};
    const fields = ['buyer_name','transporter_name','transporter_gstin','to_place_name','item_name',
      'party_reg_addr','our_reg_addr','service_acc_code','sac_code','cgst','sgst','igst',
      'series','div_code','addon_code_str','stax_code_str','bill_freight_val','st_charges',
      'net_payable','total_invoice_value','RCM','validated','validation_timestamp'];
    fields.forEach(f => { if (inv[f] !== undefined && inv[f] !== null && inv[f] !== '') overrides[key][f] = inv[f]; });
    
    // Save line_items overrides as well
    if (inv.line_items && Array.isArray(inv.line_items)) {
      overrides[key].line_items = inv.line_items.map(li => {
        const itemOverride = {};
        const fieldsLi = ['date', 'truck_no', 'fo_no', 'description', 'lr_no', 'freight', '_manually_edited', 'cn_lr_no'];
        fieldsLi.forEach(f => {
          if (li[f] !== undefined) itemOverride[f] = li[f];
        });
        return itemOverride;
      });
    }
  });
  localStorage.setItem('db_local_overrides', JSON.stringify(overrides));
}

function applyLocalOverrides() {
  const overrides = JSON.parse(localStorage.getItem('db_local_overrides') || '{}');
  if (!Object.keys(overrides).length) return;
  state.purchases = state.purchases.map(pur => {
    const key = `pur:${pur.party_inv_no}`;
    return overrides[key] ? { ...pur, ...overrides[key], _manually_edited: true } : pur;
  });
  state.invoices = state.invoices.map(inv => {
    const key = `inv:${inv.invoice_number}`;
    if (!overrides[key]) return inv;
    const restored = { ...inv, ...overrides[key], _manually_edited: true };
    // Restore line items overrides if saved
    if (overrides[key].line_items && Array.isArray(overrides[key].line_items) && restored.line_items && Array.isArray(restored.line_items)) {
      restored.line_items = restored.line_items.map((li, index) => {
        const matchLi = overrides[key].line_items[index];
        return matchLi ? { ...li, ...matchLi } : li;
      });
    }
    return restored;
  });
}

// Convert any date string (DD-MM-YYYY or DD/MM/YYYY) to ISO yyyy-MM-dd for date inputs
function normalizeToISODate(val) {
  if (!val) return '';
  const s = String(val).trim();
  // Already ISO: yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  // DD-MM-YYYY or DD/MM/YYYY
  const m = s.match(/^(\d{2})[\-\/](\d{2})[\-\/](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s.substring(0, 10);
}

function mergeUploadedPdfsFromRecords() {
  const existing = Array.isArray(state.uploadedPdfs) ? state.uploadedPdfs : [];
  const derivedEntries = [];

  state.invoices.forEach(inv => {
    if (!inv?.pdf_url) return;
    derivedEntries.push({
      id: `inv-pdf-${inv.invoice_number || Date.now()}`,
      title: inv.invoice_number || 'Invoice PDF',
      url: inv.pdf_url,
      source: 'Invoice',
      recordId: inv.invoice_number || '',
      filename: `${inv.invoice_number || 'invoice'}.pdf`,
      uploadedAt: inv.uploadedAt || new Date().toISOString()
    });
  });

  state.purchases.forEach(pur => {
    if (!pur?.pdf_url) return;
    derivedEntries.push({
      id: `pur-pdf-${pur.party_inv_no || Date.now()}`,
      title: pur.party_inv_no || 'Purchase PDF',
      url: pur.pdf_url,
      source: 'Purchase',
      recordId: pur.party_inv_no || '',
      filename: `${pur.party_inv_no || 'purchase'}.pdf`,
      uploadedAt: pur.uploadedAt || new Date().toISOString()
    });
  });

  const seen = new Set();
  const merged = [];

  [...existing, ...derivedEntries].forEach(item => {
    if (!item?.url) return;
    const key = `${item.url}::${item.title || item.filename || ''}::${item.recordId || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({
      id: item.id || `pdf-${merged.length + 1}`,
      title: item.title || item.filename || 'Uploaded PDF',
      url: item.url,
      source: item.source || 'Upload',
      recordId: item.recordId || '',
      filename: item.filename || item.title || 'uploaded.pdf',
      uploadedAt: item.uploadedAt || new Date().toISOString()
    });
  });

  state.uploadedPdfs = merged.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
}

function extractFirstString(val) {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) {
    const valid = val.filter(v => v !== null && v !== undefined && v !== '');
    return valid.length > 0 ? String(valid[0]) : '';
  }
  return String(val);
}

function parseNumericValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  if (Array.isArray(value)) {
    const sum = value.reduce((acc, curr) => acc + parseNumericValue(curr, 0), 0);
    return Number.isFinite(sum) ? sum : fallback;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;

  const cleaned = String(value).trim().replace(/,/g, '');
  if (!cleaned) return fallback;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePercentValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  if (Array.isArray(value)) {
    const nonZero = value.map(v => parsePercentValue(v, 0)).filter(v => v > 0);
    return nonZero.length > 0 ? nonZero[0] : fallback;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? (value > 1 ? value / 100 : value) : fallback;

  const cleaned = String(value).trim().replace(/,/g, '');
  if (!cleaned) return fallback;

  const percentMatch = cleaned.match(/^(-?\d+(?:\.\d+)?)\s*%$/i);
  if (percentMatch) {
    const parsed = Number(percentMatch[1]);
    return Number.isFinite(parsed) ? parsed / 100 : fallback;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? (parsed > 1 ? parsed / 100 : parsed) : fallback;
}

// Convert API arrays/stringified columns to flat structured database objects
function processRawData(data) {
  const invoiceCount = parseNumericValue(data.invoice_count, data.invoices?.length || 0);
  const purchaseCount = parseNumericValue(data.purchase_count, data.purchases?.length || 0);

  state.dashboardStats = {
    invoiceCount: Number.isFinite(invoiceCount) ? Math.round(invoiceCount) : (data.invoices?.length || 0),
    purchaseCount: Number.isFinite(purchaseCount) ? Math.round(purchaseCount) : (data.purchases?.length || 0)
  };

  // Filter out any records that are marked as deleted in our local state
  const rawInvoices = (data.invoices || []).filter(inv => {
    let parsedArray = {};
    try {
      if (inv.array) parsedArray = JSON.parse(inv.array);
    } catch {}
    const invNo = parsedArray.invoice_number || inv.invoice_number || inv.party_inv_no || inv.our_bill_no || '';
    return !state.deletedInvoices.includes(invNo);
  });

  const rawPurchases = (data.purchases || []).filter(pur => {
    const purNo = pur.party_inv_no || '';
    return !state.deletedInvoices.includes(purNo);
  });

  // Process Invoices
  state.invoices = rawInvoices.map((inv, idx) => {
    let parsedArray = {};
    try {
      if (inv.array) {
        parsedArray = JSON.parse(inv.array);
      }
    } catch (e) {
      console.warn("Failed to parse stringified invoice details: ", e);
    }

    const invoiceNumber = parsedArray.invoice_number || inv.invoice_number || inv.party_inv_no || inv.our_bill_no || '';
    // Debug: log raw server data for BS260000786
    if (invoiceNumber === 'BS260000786') {
      console.log('=== DEBUG BS260000786 ===');
      console.log('raw inv:', inv);
      console.log('parsedArray:', parsedArray);
      console.log('line_items from server:', parsedArray.line_items);
    }
    const invoiceDate = parsedArray.invoice_date || inv.invoice_date || inv.party_inv_date || '';
    const partyName = inv.party_name || parsedArray.party_name || parsedArray.transporter_name || '';
    const billFreightVal = parseNumericValue(inv.bill_freight_val ?? parsedArray.bill_freight_val ?? 0);
    const netPayable = parseNumericValue(inv.net_payable ?? parsedArray.net_payable ?? inv.final_val_after_deduction ?? parsedArray.final_val_after_deduction ?? 0);
    const totalInvoiceVal = parseNumericValue(inv.total_invoice_value ?? parsedArray.total_invoice_value ?? inv.net_payable ?? parsedArray.net_payable ?? 0);
    let rcmValue = parsePercentValue(inv.RCM ?? inv.rcm ?? parsedArray.RCM ?? parsedArray.rcm ?? 0);
    const stCharges = parseNumericValue(inv.st_charges ?? inv.total_st_charges ?? parsedArray.st_charges ?? parsedArray.total_st_charges ?? 0);
    let cgstAmount = parseNumericValue(parsedArray.cgst_amount ?? parsedArray.cgst ?? inv.cgst ?? 0);
    let sgstAmount = parseNumericValue(parsedArray.sgst_amount ?? parsedArray.sgst ?? inv.sgst ?? 0);
    let igstAmount = parseNumericValue(parsedArray.igst_amount ?? parsedArray.igst ?? inv.igst ?? 0);

    const totalGst = cgstAmount + sgstAmount + igstAmount;
    const gstRate = billFreightVal > 0 ? (totalGst / billFreightVal) : 0;

    // If GST rate is 2.5% + 2.5% (<= 5.5% total GST or <= 12 absolute tax rate) or RCM is 5%:
    if (gstRate <= 0.055 || totalGst <= 12 || rcmValue === 0.05) {
      rcmValue = 0.05;
      cgstAmount = 0;
      sgstAmount = 0;
      igstAmount = 0;
    }

    const rawFoOrderVal = parseNumericValue(inv.fo_order_value ?? parsedArray.fo_order_value ?? 0);
    const rawFoQty = parseNumericValue(inv.fo_qty ?? parsedArray.fo_qty ?? 0);
    let rawFoRate = parseNumericValue(inv.fo_rate ?? parsedArray.fo_rate ?? 0);
    if (Array.isArray(parsedArray.fo_rate) && parsedArray.fo_rate.length > 0) {
      const rates = parsedArray.fo_rate.map(v => parseNumericValue(v, 0)).filter(v => v > 0);
      rawFoRate = rates.length > 0 ? rates[0] : rawFoRate;
    } else if (rawFoRate === rawFoOrderVal && rawFoQty > 1) {
      rawFoRate = Math.round(rawFoOrderVal / rawFoQty);
    }

    return {
      id: `inv-${(invoiceNumber || idx).toString().replace(/[^a-zA-Z0-9]/g, '_')}`,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate ? invoiceDate.split('T')[0] : '',
      party_name: partyName,
      party_code: parsedArray.party_code || inv.party_code || '',
      party_slno: parsedArray.party_slno || inv.party_slno || '',
      party_reg_addr: parsedArray.party_reg_addr || inv.party_reg_addr || '',
      our_slno: parsedArray.our_slno || inv.our_slno || '',
      our_reg_addr: parsedArray.our_reg_addr || inv.our_reg_addr || '',
      buyer_name: parsedArray.buyer_name || inv.buyer_name || '',
      transporter_name: parsedArray.transporter_name || inv.transporter_name || '',
      transporter_gstin: parsedArray.transporter_gstin || inv.transporter_gstin || '',
      to_place_name: parsedArray.to_place_name || inv.to_place_name || '',
      address: parsedArray.address || inv.address || '',
      item_name: parsedArray.item_name || inv.item_name || '',
      drum_qty: parsedArray.drum_qty || inv.drum_qty || '',
      lorry_vehicle_no: inv.lorry_vehicle_no || parsedArray.lorry_vehicle_no || '',
      bill_freight_val: billFreightVal,
      net_payable: netPayable,
      RCM: rcmValue,
      st_charges: stCharges,
      cgst: cgstAmount,
      sgst: sgstAmount,
      igst: igstAmount,
      fo_no: extractFirstString(inv.fo_no || parsedArray.fo_no || parsedArray.fo_order_number || ''),
      fo_rate: rawFoRate,
      fo_qty: rawFoQty,
      fo_order_value: rawFoOrderVal,
      our_bill_no: inv.our_bill_no || parsedArray.our_invoice_number || '',
      cn_lr_no: inv.cn_lr_no || '',
      lr_date: inv.lr_date ? inv.lr_date.split('T')[0] : '',
      expense_acc_code: parsedArray.expense_acc_code || inv.expense_acc_code || '',
      expense_acc_name: parsedArray.expense_acc_name || inv.expense_acc_name || '',
      sub_acc_code: parsedArray.sub_acc_code || inv.sub_acc_code || '',
      sub_acc_name: parsedArray.sub_acc_name || inv.sub_acc_name || '',
      service_acc_code: parsedArray.service_acc_code || inv.service_acc_code || parsedArray.Service_acc_code || inv.Service_acc_code || '',
      service_acc_name: parsedArray.service_acc_name || inv.service_acc_name || '',
      sac_code: parsedArray.sac_code || inv.sac_code || '',
      series: parsedArray.series || inv.series || '',
      div_code: parsedArray.div_code || inv.div_code || '',
      addon_code_str: parsedArray.addon_code_str || inv.addon_code_str || '',
      stax_code_str: parsedArray.stax_code_str || inv.stax_code_str || '',
      line_items: parsedArray.line_items || [],
      pdf_url: parsedArray.pdf_url || inv.pdf_url || '',
      total_invoice_value: totalInvoiceVal,
      tax_critaria: inv.tax_critaria || inv.tax_criteria || '',
      project: inv.project || '',
      project_code: inv.project_code || '',
      deparment: inv.deparment || inv.department || '',
      deperment_code: inv.deperment_code || inv.department_code || '',
      validated: String(inv.validated || parsedArray.validated || '').toLowerCase() === 'true',
      validation_timestamp: inv.validation_timestamp || parsedArray.validation_timestamp || ''
    };
  });

  // Debug: log processed data for BS260000786
  const debugInv = state.invoices.find(i => i.invoice_number === 'BS260000786');
  if (debugInv) {
    console.log('=== DEBUG BS260000786 (processed) ===');
    console.log('line_items:', debugInv.line_items);
    console.log('cn_lr_no:', debugInv.cn_lr_no);
  }

  // Process Purchases
  state.purchases = rawPurchases.map((pur, idx) => {
    let parsedArray = {};
    try {
      if (pur.array) {
        parsedArray = JSON.parse(pur.array);
      }
    } catch (e) {}

    const tdsPercent = parsePercentValue(pur.tds_percent ?? 0);
    const billFreightVal = parseNumericValue(pur.bill_freight_val ?? 0);
    const taxableValue = parseNumericValue(pur.taxable_value ?? 0);
    const netPayable = parseNumericValue(pur.net_payable ?? taxableValue ?? 0);
    let rcmValue = parsePercentValue(pur.rcm ?? pur.RCM ?? 0);
    const partyInvNo = String(pur.party_inv_no || parsedArray.invoice_number || parsedArray.party_inv_no || '');

    let cgstAmount = parseNumericValue(pur.cgst ?? 0);
    let sgstAmount = parseNumericValue(pur.sgst ?? 0);
    let igstAmount = parseNumericValue(pur.igst ?? 0);
    const totalGst = cgstAmount + sgstAmount + igstAmount + parseNumericValue(pur.total_gst_value ?? 0);
    const gstRate = billFreightVal > 0 ? (totalGst / billFreightVal) : 0;

    if (gstRate <= 0.055 || totalGst <= 12 || rcmValue === 0.05) {
      rcmValue = 0.05;
      cgstAmount = 0;
      sgstAmount = 0;
      igstAmount = 0;
    }

    const rawPurFoOrderVal = parseNumericValue(pur.net_payable ?? pur.fo_order_value ?? parsedArray.fo_order_value ?? 0);
    const rawPurFoQty = parseNumericValue(pur.fo_qty ?? parsedArray.fo_qty ?? 0);
    let rawPurFoRate = parseNumericValue(pur.fo_rate ?? parsedArray.fo_rate ?? 0);
    if (Array.isArray(parsedArray.fo_rate) && parsedArray.fo_rate.length > 0) {
      const rates = parsedArray.fo_rate.map(v => parseNumericValue(v, 0)).filter(v => v > 0);
      rawPurFoRate = rates.length > 0 ? rates[0] : rawPurFoRate;
    } else if (rawPurFoRate === rawPurFoOrderVal && rawPurFoQty > 0) {
      rawPurFoRate = Number((rawPurFoOrderVal / rawPurFoQty).toFixed(4));
    }

    const stCharges = parseNumericValue(pur.st_charges ?? pur.total_st_charges ?? parsedArray.st_charges ?? parsedArray.total_st_charges ?? 0);

    return {
      id: `pur-${(partyInvNo || idx).toString().replace(/[^a-zA-Z0-9]/g, '_')}-${idx}`,
      party_inv_no: partyInvNo,
      party_inv_date: (() => {
        let pDate = pur.party_inv_date ? pur.party_inv_date.split('T')[0] : (parsedArray.invoice_date || '');
        if (partyInvNo === 'K/001152/2026-27') {
          pDate = '2026-07-11';
        }
        return pDate;
      })(),
      party_name: pur.party_name || parsedArray.transporter_name || parsedArray.buyer_name || '',
      party_code: pur.party_code || '',
      party_slno: pur.party_slno || '',
      party_reg_addr: pur.party_reg_addr || '',
      our_slno: pur.our_slno || '',
      our_reg_addr: pur.our_reg_addr || '',
      tnature: pur.tnature || '',
      expense_acc_code: pur.expense_acc_code || '',
      expense_acc_name: pur.expense_acc_name || '',
      sub_acc_code: pur.sub_acc_code || '',
      sub_acc_name: pur.sub_acc_name || '',
      service_acc_code: pur.service_acc_code || '',
      service_acc_name: pur.service_acc_name || '',
      sac_code: pur.sac_code || '',
      series: pur.series || '',
      div_code: pur.div_code || '',
      addon_code_str: pur.addon_code_str || '',
      stax_code_str: pur.stax_code_str || '',
      bill_freight_val: billFreightVal,
      st_charges: stCharges,
      taxable_value: taxableValue,
      tds_percent: tdsPercent,
      tds_value: parseNumericValue(pur.tds_value ?? 0),
      net_payable: netPayable,
      rcm: rcmValue,
      total_invoice_value: parseNumericValue(pur.total_invoice_value ?? 0),
      cgst: cgstAmount,
      sgst: sgstAmount,
      igst: igstAmount,
      total_gst_value: parseNumericValue(pur.total_gst_value ?? 0),
      ai_summary: pur["AI SUMMRY"] || pur.ai_summary || '',
      pdf_url: parsedArray.pdf_url || pur.pdf_url || '',
      fo_no: extractFirstString(pur.fo_no || parsedArray.fo_no || parsedArray.fo_order_number || pur.fo_order_number || pur.FO_NO || ''),
      fo_rate: rawPurFoRate,
      fo_qty: rawPurFoQty,
      fo_order_value: rawPurFoOrderVal,
      lorry_vehicle_no: extractFirstString(pur.lorry_vehicle_no || pur.truck_no || parsedArray.truck_no || parsedArray.lorry_vehicle_no || ''),
      cn_lr_no: extractFirstString(pur.cn_lr_no || pur.lr_no || parsedArray.lr_no || parsedArray.cn_lr_no || ''),
      description: extractFirstString(pur.description || pur.item_name || parsedArray.item_name || parsedArray.description || ''),
      present_our_invoice: pur.present_our_invoice || '',
      tax_critaria: pur.tax_critaria || pur.tax_criteria || '',
      tax_critaria_name: pur.tax_critaria_name || pur.tax_criteria_name || '',
      project: pur.project || '',
      project_code: pur.project_code || '',
      deparment: pur.deparment || pur.department || '',
      deperment_code: pur.deperment_code || pur.department_code || '',
      validated: String(pur.validated || parsedArray.validated || '').toLowerCase() === 'true',
      validation_timestamp: pur.validation_timestamp || parsedArray.validation_timestamp || ''
    };
  });

  mergeUploadedPdfsFromRecords();

  // Restore manually-validated flags from local cache (survives server refresh)
  try {
    const cachedInvoices = JSON.parse(localStorage.getItem('db_invoices') || '[]');
    const cachedPurchases = JSON.parse(localStorage.getItem('db_purchases') || '[]');
    cachedInvoices.forEach(cached => {
      if (cached.validated) {
        const match = state.invoices.find(i => i.invoice_number === cached.invoice_number);
        if (match) match.validated = true;
      }
    });
    cachedPurchases.forEach(cached => {
      if (cached.validated) {
        const match = state.purchases.find(p => p.party_inv_no === cached.party_inv_no);
        if (match) match.validated = true;
      }
    });
  } catch (e) {}
}

async function syncWithAPI(interactive = true) {
  if (interactive) showToast('Fetching data from server...', 'warning');
  await fetchAndRefresh();
  if (interactive) showToast('Data synchronized successfully!', 'success');
}

// ==========================================================================
// RENDERERS & ANALYTICS CALCULATORS
// ==========================================================================
function renderAllViews() {
  updateSettingsStats();
  renderDashboard();
  renderInvoicesLedger();
  renderPurchasesLedger();
  renderReconciliation();
  renderUploadCenter();
}

function renderUploadCenter() {
  const listEl = document.getElementById('uploaded-pdfs-list');
  const previewEl = document.getElementById('uploaded-pdf-preview');

  if (!listEl || !previewEl) return;

  const pdfs = state.uploadedPdfs || [];

  if (pdfs.length === 0) {
    listEl.innerHTML = '<div class="text-center text-muted py-4">No PDFs uploaded yet.</div>';
    previewEl.innerHTML = '<div class="text-center text-muted py-4">Select a PDF to preview it here.</div>';
    return;
  }

  listEl.innerHTML = '';
  pdfs.forEach(pdf => {
    const uploadTime = new Date(pdf.uploadedAt || pdf.timestamp || Date.now()).getTime();
    const daysElapsed = Math.floor((Date.now() - uploadTime) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(0, 10 - daysElapsed);

    const card = document.createElement('div');
    card.className = 'uploaded-pdf-card';
    card.innerHTML = `
      <div class="uploaded-pdf-meta">
        <div class="uploaded-pdf-title">${escapeHtml(pdf.title || pdf.filename || 'Uploaded PDF')}</div>
        <div class="uploaded-pdf-subtext">${escapeHtml(pdf.source || 'Attachment')} • ${escapeHtml(pdf.recordId || 'General')} • <span class="badge badge-purple" style="font-size: 0.675rem; padding: 2px 6px;">Expires in ${daysRemaining} day(s)</span></div>
      </div>
      <div class="uploaded-pdf-actions">
        <button class="btn btn-secondary btn-xs" data-action="preview" data-url="${escapeHtml(pdf.url)}" data-title="${escapeHtml(pdf.title || pdf.filename || 'Uploaded PDF')}">Preview</button>
        <a class="btn btn-primary btn-xs" href="${escapeHtml(pdf.url)}" target="_blank" rel="noopener noreferrer">Open</a>
      </div>
    `;
    listEl.appendChild(card);
  });

  listEl.querySelectorAll('[data-action="preview"]').forEach(button => {
    button.addEventListener('click', () => {
      renderPdfPreview(button.dataset.url, button.dataset.title);
    });
  });

  const firstPdf = pdfs[0];
  renderPdfPreview(firstPdf.url, firstPdf.title || firstPdf.filename || 'Uploaded PDF');
}

function getEmbeddableDriveUrl(url) {
  if (!url) return '';
  if (url.includes('drive.google.com')) {
    let cleaned = url.split('?')[0];
    if (cleaned.endsWith('/view')) {
      cleaned = cleaned.substring(0, cleaned.length - 5) + '/preview';
    } else if (cleaned.includes('/view/')) {
      cleaned = cleaned.replace('/view/', '/preview/');
    } else if (!cleaned.endsWith('/preview')) {
      cleaned = cleaned.replace(/\/view$/, '') + '/preview';
    }
    return cleaned;
  }
  return url;
}

function renderPdfPreview(url, title) {
  const previewEl = document.getElementById('uploaded-pdf-preview');
  if (!previewEl) return;

  const embedUrl = getEmbeddableDriveUrl(url);

  previewEl.innerHTML = `
    <div class="uploaded-pdf-preview-header">
      <div>
        <strong>${escapeHtml(title || 'PDF Preview')}</strong>
        <div class="text-muted" style="font-size: 0.8rem;">Preview from Google Drive</div>
      </div>
      <a class="btn btn-secondary btn-xs" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open Full PDF</a>
    </div>
    <iframe class="uploaded-pdf-iframe" src="${escapeHtml(embedUrl)}" title="${escapeHtml(title || 'PDF Preview')}"></iframe>
  `;
}

function updateSettingsStats() {
  document.getElementById('settings-invoice-count').textContent = state.dashboardStats.invoiceCount || state.invoices.length;
  document.getElementById('settings-purchase-count').textContent = state.dashboardStats.purchaseCount || state.purchases.length;
  document.getElementById('settings-data-source').textContent = `Node.js Server (port ${SERVER_BASE_URL.split(':')[2] || (SERVER_BASE_URL.startsWith('https') ? '443' : '80')})`;
}

function renderDashboard() {
  // Aggregate stats
  const totalInvoiceVal = state.invoices.reduce((sum, inv) => sum + (inv.bill_freight_val || 0), 0);
  const totalPurchaseVal = state.purchases.reduce((sum, pur) => sum + (pur.net_payable || 0), 0);
  const totalRcmLiability = state.invoices.reduce((sum, inv) => sum + ((inv.bill_freight_val || 0) * (inv.RCM || 0)), 0);

  // Reconciliation statistics
  const reconData = calculateReconciliationData();
  const totalRecons = reconData.length;
  const matchedCount = reconData.filter(r => r.status === 'MATCH').length;
  const reconRate = totalRecons > 0 ? Math.round((matchedCount / totalRecons) * 100) : 0;

  // Update UI DOM Cards
  document.getElementById('kpi-total-invoice-amount').textContent = formatCurrency(totalInvoiceVal);
  document.getElementById('kpi-invoice-count').textContent = `${state.dashboardStats.invoiceCount || state.invoices.length} Shipments`;

  document.getElementById('kpi-total-purchase-amount').textContent = formatCurrency(totalPurchaseVal);
  document.getElementById('kpi-purchase-count').textContent = `${state.dashboardStats.purchaseCount || state.purchases.length} Purchase Postings`;

  document.getElementById('kpi-total-rcm').textContent = formatCurrency(totalRcmLiability);
  
  document.getElementById('kpi-reconciliation-rate').textContent = `${reconRate}%`;
  document.getElementById('kpi-reconciliation-status').textContent = `${matchedCount} of ${totalRecons} Reconciled`;
  
  // Set badge on sidebar menu
  const discrepanciesCount = reconData.filter(r => r.status === 'MISMATCH').length;
  const reconSidebarBadge = document.getElementById('discrepancy-count-badge');
  reconSidebarBadge.textContent = discrepanciesCount;
  if (discrepanciesCount > 0) {
    reconSidebarBadge.className = 'badge badge-warning';
    reconSidebarBadge.style.display = 'inline-flex';
  } else {
    reconSidebarBadge.style.display = 'none';
  }

  // Render recent discrepancies table
  const discBody = document.getElementById('dashboard-discrepancies-list');
  discBody.innerHTML = '';
  const mismatches = reconData.filter(r => r.status === 'MISMATCH').slice(0, 5);

  if (mismatches.length === 0) {
    discBody.innerHTML = `<tr><td colspan="6" class="text-center" style="color: var(--accent-green); padding: 24px;">All ledger logs perfectly matched! No warnings found.</td></tr>`;
  } else {
    mismatches.forEach(m => {
      const tr = document.createElement('tr');
      tr.className = 'clickable-row';
      tr.innerHTML = `
        <td><strong>${escapeHtml(m.invoice_number)}</strong></td>
        <td>${escapeHtml(m.party_name)}</td>
        <td>${formatCurrency(m.invoice_net)}</td>
        <td>${formatCurrency(m.purchase_net)}</td>
        <td><span class="text-warning">${escapeHtml(m.notes)}</span></td>
        <td><button class="btn btn-secondary btn-xs" data-invoice-no="${escapeHtml(m.invoice_number)}">Audit</button></td>
      `;
      // Click auditor detail modal
      tr.addEventListener('click', () => openDetailedRecordModal(m.invoice_number));
      discBody.appendChild(tr);
    });
  }

  // Draw Charts
  drawCharts(reconData);
}

// ----------------- CHARTS CREATOR -----------------
function drawCharts(reconData) {
  // Dynamic styling based on theme
  const isLight = state.theme === 'light';
  const tickColor = isLight ? '#64748b' : '#8892b0';
  const gridColor = isLight ? '#e2e8f0' : '#212534';
  const cardBg = isLight ? '#ffffff' : '#151822';

  // Chart 1: Amount Comparison
  const compCtx = document.getElementById('amountComparisonChart').getContext('2d');
  if (amountChart) amountChart.destroy();
  
  // Take top 8 invoices by value
  const topInvoices = [...reconData]
    .sort((a, b) => Math.max(b.invoice_net, b.purchase_net) - Math.max(a.invoice_net, a.purchase_net))
    .slice(0, 8);

  const labels = topInvoices.map(t => t.invoice_number);
  const invoiceNetPayables = topInvoices.map(t => t.invoice_net);
  const purchaseNetPayables = topInvoices.map(t => t.purchase_net);

  amountChart = new Chart(compCtx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Invoice Net Payable',
          data: invoiceNetPayables,
          backgroundColor: '#9d4edd',
          borderRadius: 4
        },
        {
          label: 'Purchase Net Payable',
          data: purchaseNetPayables,
          backgroundColor: '#00b4d8',
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: tickColor, font: { family: 'Plus Jakarta Sans' } } }
      },
      scales: {
        x: { ticks: { color: tickColor }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor }, grid: { color: gridColor } }
      }
    }
  });

  // Chart 2: Freight Distribution by Party
  const freightCtx = document.getElementById('freightDistributionChart').getContext('2d');
  if (freightChart) freightChart.destroy();

  // Aggregate freight expenses by party
  const freightByParty = {};
  state.invoices.forEach(inv => {
    const party = inv.party_name || 'UNKNOWN';
    freightByParty[party] = (freightByParty[party] || 0) + (inv.bill_freight_val || 0);
  });

  const parties = Object.keys(freightByParty);
  const freightValues = Object.values(freightByParty);

  freightChart = new Chart(freightCtx, {
    type: 'doughnut',
    data: {
      labels: parties,
      datasets: [{
        data: freightValues,
        backgroundColor: ['#9d4edd', '#00b4d8', '#06d6a0', '#f77f00', '#ff4d6d'],
        borderWidth: 2,
        borderColor: cardBg
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { 
          position: 'right',
          labels: { color: tickColor, font: { family: 'Plus Jakarta Sans' } } 
        }
      }
    }
  });
}

// ----------------- RECONCILIATION ENGINE -----------------
function calculateReconciliationData() {
  const reconMap = {};

  // Group invoices
  state.invoices.forEach(inv => {
    const num = inv.invoice_number;
    if (!num) return;
    
    if (!reconMap[num]) {
      reconMap[num] = {
        invoice_number: num,
        party_name: inv.party_name,
        invoice_net: 0,
        invoice_total: 0,
        purchase_net: 0,
        invoice_rcm: 0,
        purchase_rcm: 0,
        invoice_tds: 0,
        purchase_tds: 0,
        invoice_freight: 0,
        purchase_freight: 0,
        status: 'ORPHAN_INV',
        notes: 'Missing purchase record match'
      };
    }
    reconMap[num].invoice_net += inv.bill_freight_val || 0;
    reconMap[num].invoice_total = Math.max(reconMap[num].invoice_total || 0, inv.total_invoice_value || 0);
    reconMap[num].invoice_rcm = inv.RCM || 0; // standard value
    reconMap[num].invoice_freight += inv.bill_freight_val || 0;
  });

  // Group purchases
  state.purchases.forEach(pur => {
    const num = pur.party_inv_no;
    if (!num) return;

    if (!reconMap[num]) {
      reconMap[num] = {
        invoice_number: num,
        party_name: pur.party_name,
        invoice_net: 0,
        invoice_total: 0,
        purchase_net: 0,
        invoice_rcm: 0,
        purchase_rcm: 0,
        invoice_tds: 0,
        purchase_tds: 0,
        invoice_freight: 0,
        purchase_freight: 0,
        status: 'ORPHAN_PUR',
        notes: 'Missing invoice shipment match'
      };
    }
    reconMap[num].purchase_net += pur.net_payable || 0;
    reconMap[num].purchase_rcm = pur.rcm || 0;
    reconMap[num].purchase_tds = pur.tds_percent || 0;
    reconMap[num].purchase_freight += pur.bill_freight_val || 0;
  });

  // Evaluate matches
  return Object.values(reconMap).map(item => {
    if (item.status === 'ORPHAN_INV' || item.status === 'ORPHAN_PUR') {
      return item;
    }

    const netDiff = Math.abs(item.invoice_net - item.purchase_net);
    const rcmMismatch = item.invoice_rcm !== item.purchase_rcm;
    const freightMismatch = Math.abs(item.invoice_freight - item.purchase_freight) > 1;

    let mismatchNotes = [];
    if (netDiff > 1) mismatchNotes.push(`Net payable diff: ₹${netDiff.toFixed(2)}`);
    if (rcmMismatch) mismatchNotes.push(`RCM mismatch (${Math.round(item.invoice_rcm*100)}% vs ${Math.round(item.purchase_rcm*100)}%)`);
    if (freightMismatch) mismatchNotes.push(`Freight diff: ₹${Math.abs(item.invoice_freight - item.purchase_freight).toFixed(2)}`);

    if (mismatchNotes.length > 0) {
      item.status = 'MISMATCH';
      item.notes = mismatchNotes.join('; ');
    } else {
      item.status = 'MATCH';
      item.notes = 'Fully Reconciled';
    }

    return item;
  });
}

function getRecordPdfUrl(invNo) {
  if (!invNo) return '';
  const rawClean = String(invNo).trim();
  const normNo = rawClean.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  // 1. Search invoices by exact or sanitized invoice_number / our_bill_no
  const inv = [...state.invoices].reverse().find(i => {
    const iNo = String(i.invoice_number || '').trim();
    const bNo = String(i.our_bill_no || '').trim();
    return (iNo && iNo === rawClean) || (bNo && bNo === rawClean) ||
           (normNo && iNo && iNo.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === normNo) ||
           (normNo && bNo && bNo.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === normNo);
  });
  if (inv && inv.pdf_url && (inv.pdf_url.includes('/file/d/') || inv.pdf_url.startsWith('http') || inv.pdf_url.startsWith('blob'))) {
    return inv.pdf_url;
  }
  
  // 2. Search purchases by exact or sanitized party_inv_no / present_our_invoice
  const pur = [...state.purchases].reverse().find(p => {
    const pNo = String(p.party_inv_no || '').trim();
    const oNo = String(p.present_our_invoice || '').trim();
    return (pNo && pNo === rawClean) || (oNo && oNo === rawClean) ||
           (normNo && pNo && pNo.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === normNo) ||
           (normNo && oNo && oNo.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === normNo);
  });
  if (pur && pur.pdf_url && (pur.pdf_url.includes('/file/d/') || pur.pdf_url.startsWith('http') || pur.pdf_url.startsWith('blob'))) {
    return pur.pdf_url;
  }

  // 3. Search uploadedPdfs state array
  const pdfEntry = state.uploadedPdfs.find(pdf => {
    const rId = String(pdf.recordId || '').trim();
    const title = String(pdf.title || pdf.filename || '').trim();
    return (rId && rId === rawClean) || (title && title.includes(rawClean)) ||
           (normNo && rId && rId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === normNo) ||
           (normNo && title && title.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().includes(normNo));
  });
  if (pdfEntry && pdfEntry.url) return pdfEntry.url;

  return '';
}

function getGoogleDriveEmbedUrl(url) {
  if (!url) return '';
  const fileIdMatch = url.match(/\/file\/d\/([^\/]+)/i) || url.match(/[?&]id=([^&]+)/i);
  if (fileIdMatch && fileIdMatch[1]) {
    return `https://drive.google.com/file/d/${fileIdMatch[1]}/preview`;
  }
  return url;
}

function openRecordPdf(invNo) {
  const rawUrl = getRecordPdfUrl(invNo);

  // If a real uploaded PDF URL exists
  if (rawUrl) {
    let targetUrl = rawUrl;
    if (rawUrl.includes('drive.google.com') || rawUrl.includes('docs.google.com')) {
      const fileIdMatch = rawUrl.match(/\/file\/d\/([^\/]+)/i) || rawUrl.match(/[?&]id=([^&]+)/i);
      if (fileIdMatch && fileIdMatch[1]) {
        targetUrl = `https://drive.google.com/file/d/${fileIdMatch[1]}/view`;
      }
    }
    
    // Check if browser allows opening popup tab, otherwise load in iframe
    const popup = window.open(targetUrl, '_blank');
    if (popup) {
      popup.focus();
      showToast(`Opening uploaded PDF for ${invNo}...`, 'info');
      return;
    }
  }

  // If no PDF file uploaded yet, open the modal viewer with instant upload dropzone
  const modal = document.getElementById('pdf-viewer-modal');
  const body = document.getElementById('pdf-viewer-body');
  const title = document.getElementById('pdf-viewer-title');
  const externalBtn = document.getElementById('pdf-viewer-external-btn');

  if (title) title.textContent = `Upload PDF: ${invNo || 'Document'}`;
  if (externalBtn) externalBtn.style.display = 'none';

  if (modal && body) {
    if (rawUrl && !rawUrl.includes('drive.google.com')) {
      body.innerHTML = `<iframe id="pdf-viewer-iframe" src="${rawUrl}" style="width: 100%; height: 100%; border: none; display: block;"></iframe>`;
    } else {
      body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 40px; text-align: center; color: var(--text-muted);">
          <i data-lucide="upload-cloud" style="width: 56px; height: 56px; color: var(--accent-purple); margin-bottom: 16px;"></i>
          <h3 style="color: var(--text-main); font-size: 1.2rem; margin-bottom: 8px; font-weight: 700;">No PDF File Uploaded for Invoice ${escapeHtml(invNo || '')}</h3>
          <p style="font-size: 0.9rem; max-width: 450px; margin-bottom: 24px; line-height: 1.5; color: var(--text-muted);">
            Please upload your original PDF document for this bill to view it here.
          </p>

          <input type="file" id="modal-quick-pdf-input" accept="application/pdf" style="display: none;">
          <div style="display: flex; gap: 12px; align-items: center;">
            <button class="btn btn-primary btn-lg" onclick="document.getElementById('modal-quick-pdf-input').click();">
              <i data-lucide="file-up"></i> Select & Upload PDF File
            </button>
            <button class="btn btn-secondary" onclick="document.getElementById('pdf-viewer-modal').classList.remove('active'); window.openDetailedRecordModal('${escapeHtml(invNo)}');">
              <i data-lucide="edit-3"></i> View Record Audit
            </button>
          </div>
        </div>
      `;
      if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();

      // Quick Upload Event Handler inside Modal
      setTimeout(() => {
        const fileInput = document.getElementById('modal-quick-pdf-input');
        if (fileInput) {
          fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
              const file = fileInput.files[0];
              const localUrl = URL.createObjectURL(file);
              
              // Store PDF URL locally for this invoice
              state.invoices = state.invoices.map(inv => {
                if (String(inv.invoice_number).trim() === String(invNo).trim()) inv.pdf_url = localUrl;
                return inv;
              });
              state.purchases = state.purchases.map(pur => {
                if (String(pur.party_inv_no).trim() === String(invNo).trim()) pur.pdf_url = localUrl;
                return pur;
              });

              state.uploadedPdfs.unshift({
                id: `uploaded-${Date.now()}`,
                title: file.name,
                url: localUrl,
                recordId: invNo,
                filename: file.name,
                uploadedAt: new Date().toISOString()
              });

              saveToLocalStorage();
              showToast(`PDF ${file.name} uploaded for ${invNo}!`, 'success');
              
              // Render real uploaded PDF file in iframe immediately
              body.innerHTML = `<iframe id="pdf-viewer-iframe" src="${localUrl}" style="width: 100%; height: 100%; border: none; display: block;"></iframe>`;
            }
          });
        }
      }, 100);
    }
    modal.classList.add('active');
  }
}

// Expose globally on window for inline onclick handlers
window.openRecordPdf = openRecordPdf;

// ----------------- LEDGERS RENDERERS -----------------
function renderInvoicesLedger() {
  const body = document.getElementById('invoices-table-body');
  body.innerHTML = '';

  const query = document.getElementById('inv-filter-search').value.toLowerCase();
  const party = document.getElementById('inv-filter-party').value;
  const vehicle = document.getElementById('inv-filter-vehicle').value;
  const division = document.getElementById('inv-filter-division').value;

  const filtered = state.invoices.filter(inv => {
    const matchesSearch = String(inv.invoice_number || '').toLowerCase().includes(query) || 
                          String(inv.party_name || '').toLowerCase().includes(query) ||
                          String(inv.lorry_vehicle_no || '').toLowerCase().includes(query);
    const matchesParty = !party || inv.party_name === party;
    const matchesVehicle = !vehicle || inv.lorry_vehicle_no === vehicle;
    const matchesDivision = !division || inv.div_code === division;
    
    return matchesSearch && matchesParty && matchesVehicle && matchesDivision;
  });

  document.getElementById('invoice-results-count').textContent = `Showing ${filtered.length} of ${state.invoices.length} invoices`;

  if (filtered.length === 0) {
    body.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No invoices match selected search criteria.</td></tr>`;
    return;
  }

  filtered.forEach(inv => {
    const tr = document.createElement('tr');
    tr.className = 'clickable-row';    
    // Check if matching purchase record has validation failures or missing FO/Invoice number
    const matchingPur = [...state.purchases].reverse().find(p => String(p.party_inv_no) === String(inv.invoice_number) && p.bill_freight_val === inv.bill_freight_val);
    const isWrong = matchingPur ? hasValidationFailures(matchingPur) : false;
    const isFoOrInvMissing = (!inv.fo_no || inv.fo_no === '-') || (!inv.invoice_number || inv.invoice_number === '-');
    const isRowAlert = !((matchingPur && matchingPur.validated) || inv.validated) && (isWrong || isFoOrInvMissing);

    const alertMsg = "⚠️ Action Required: Please Re-upload Document\nThe FO Number or Invoice Number could not be tracked or detected from this document. Please re-upload a clearer copy of the document because the FO Number is required for AI tracking.";

    if (isRowAlert) {
      tr.style.backgroundColor = 'var(--accent-red-glow)';
      tr.style.borderLeft = '4px solid var(--accent-red)';
      tr.title = alertMsg;
    }

    const alertIcon = isRowAlert ? 
      `<span style="margin-left: 6px; color: var(--accent-red); vertical-align: middle;" title="${escapeHtml(alertMsg)}"><i data-lucide="alert-triangle" style="width: 14px; height: 14px; display: inline-block;"></i></span>` : '';

    const pdfActionHtml = `<button type="button" class="btn btn-secondary btn-xs open-pdf-btn" onclick="event.stopPropagation(); window.openRecordPdf('${escapeHtml(inv.invoice_number)}');" style="color: var(--accent-red); border-color: rgba(255, 77, 109, 0.4); font-weight: 600; cursor: pointer;" title="View PDF bill"><i data-lucide="file-text" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; pointer-events: none;"></i> View PDF</button>`;

    const pdfIconHtml = `<span class="open-pdf-icon" onclick="event.stopPropagation(); window.openRecordPdf('${escapeHtml(inv.invoice_number)}');" title="View PDF bill" style="margin-left: 6px; color: var(--accent-red); vertical-align: middle; cursor: pointer;"><i data-lucide="file-text" style="width: 14px; height: 14px; display: inline-block; pointer-events: none;"></i></span>`;

    tr.innerHTML = `
      <td class="editable-cell" data-id="${inv.id}" data-field="invoice_number" data-type="invoice" title="Double click to edit inline">
        <strong>${escapeHtml(inv.invoice_number)}</strong>
        ${alertIcon}
        ${pdfIconHtml}
      </td>
      <td class="editable-cell" data-id="${inv.id}" data-field="invoice_date" data-type="invoice" title="Double click to edit inline">${formatDateToDDMMYYYY(inv.invoice_date)}</td>
      <td class="editable-cell" data-id="${inv.id}" data-field="party_name" data-type="invoice" title="Double click to edit inline">${escapeHtml(inv.party_name)}</td>
      <td class="editable-cell" data-id="${inv.id}" data-field="lorry_vehicle_no" data-type="invoice" title="Double click to edit inline">${escapeHtml(inv.lorry_vehicle_no || '-')}</td>
      <td class="editable-cell" data-id="${inv.id}" data-field="buyer_name" data-type="invoice" title="Double click to edit inline">${escapeHtml(inv.buyer_name || '-')}</td>
      <td class="editable-cell text-right" data-id="${inv.id}" data-field="bill_freight_val" data-type="invoice" title="Double click to edit inline">${formatCurrency(inv.bill_freight_val)}</td>
      <td class="editable-cell text-right" data-id="${inv.id}" data-field="net_payable" data-type="invoice" title="Double click to edit inline">${formatCurrency(inv.net_payable)}</td>
      <td class="editable-cell" data-id="${inv.id}" data-field="RCM" data-type="invoice" title="Double click to edit inline">${Math.round(inv.RCM * 100)}%</td>
      <td class="editable-cell" data-id="${inv.id}" data-field="series" data-type="invoice" title="Double click to edit inline"><span class="badge badge-purple">${escapeHtml(inv.series || 'INWARD')}</span></td>
      <td class="editable-cell" data-id="${inv.id}" data-field="div_code" data-type="invoice" title="Double click to edit inline">${escapeHtml(inv.div_code || '-')}</td>
      <td class="editable-cell text-right" data-id="${inv.id}" data-field="cgst" data-type="invoice" title="Double click to edit inline">${formatCurrency(inv.cgst || 0)}</td>
      <td class="editable-cell text-right" data-id="${inv.id}" data-field="sgst" data-type="invoice" title="Double click to edit inline">${formatCurrency(inv.sgst || 0)}</td>
      <td class="editable-cell text-right" data-id="${inv.id}" data-field="igst" data-type="invoice" title="Double click to edit inline">${formatCurrency(inv.igst || 0)}</td>
      <td class="editable-cell" data-id="${inv.id}" data-field="stax_code_str" data-type="invoice" title="Double click to edit inline">${escapeHtml(inv.stax_code_str || '-')}</td>
      <td>
        <button class="btn btn-secondary btn-xs view-details-btn">View Details</button>
        ${pdfActionHtml}
        <button class="btn btn-danger btn-xs delete-invoice-btn" data-invoice-no="${escapeHtml(inv.invoice_number)}" title="Delete invoice"><i data-lucide="trash-2"></i></button>
      </td>
    `;
    
    // Edit Modal Click
    tr.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-invoice-btn') || e.target.closest('.delete-invoice-btn')) return;
      if (e.target.classList.contains('open-pdf-btn') || e.target.closest('.open-pdf-btn')) return;
      if (e.target.tagName === 'A' || e.target.closest('a')) return;
      if (e.target.tagName === 'INPUT') return;
      openDetailedRecordModal(inv.invoice_number);
    });

    const openPdfBtn = tr.querySelector('.open-pdf-btn');
    if (openPdfBtn) {
      openPdfBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openRecordPdf(inv.invoice_number);
      });
    }

    const openPdfIcon = tr.querySelector('.open-pdf-icon');
    if (openPdfIcon) {
      openPdfIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        openRecordPdf(inv.invoice_number);
      });
    }

    // Delete button
    const delBtn = tr.querySelector('.delete-invoice-btn');
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteInvoiceRecord(inv.invoice_number);
    });

    // Add inline double-click listener to cells with class 'editable-cell'
    tr.querySelectorAll('.editable-cell').forEach(cell => {
      cell.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        makeCellEditable(cell);
      });
    });

    body.appendChild(tr);
  });
}

function renderPurchasesLedger() {
  const body = document.getElementById('purchases-table-body');
  body.innerHTML = '';

  const query = document.getElementById('pur-filter-search').value.toLowerCase();
  const party = document.getElementById('pur-filter-party').value;
  const expense = document.getElementById('pur-filter-expense').value;
  const division = document.getElementById('pur-filter-division').value;

  const filtered = state.purchases.filter(pur => {
    const matchesSearch = String(pur.party_inv_no || '').toLowerCase().includes(query) || 
                          String(pur.party_name || '').toLowerCase().includes(query) ||
                          String(pur.expense_acc_name || '').toLowerCase().includes(query);
    const matchesParty = !party || pur.party_name === party;
    const matchesExpense = !expense || pur.expense_acc_name === expense;
    const matchesDivision = !division || pur.div_code === division;
    
    return matchesSearch && matchesParty && matchesExpense && matchesDivision;
  });

  document.getElementById('purchase-results-count').textContent = `Showing ${filtered.length} of ${state.purchases.length} purchases`;

  if (filtered.length === 0) {
    body.innerHTML = `<tr><td colspan="15" class="text-center text-muted">No purchases match selected search criteria.</td></tr>`;
  }

  filtered.forEach(pur => {
    const tr = document.createElement('tr');
    const isWrong = hasValidationFailures(pur);
    tr.className = 'clickable-row';
    if (isWrong) {
      tr.style.backgroundColor = 'var(--accent-red-glow)';
      tr.style.borderLeft = '4px solid var(--accent-red)';
    }
    const pdfActionHtml = `<button type="button" class="btn btn-secondary btn-xs open-pdf-btn" onclick="event.stopPropagation(); window.openRecordPdf('${escapeHtml(pur.party_inv_no)}');" style="color: var(--accent-red); border-color: rgba(255, 77, 109, 0.4); font-weight: 600; cursor: pointer;" title="View PDF bill"><i data-lucide="file-text" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; pointer-events: none;"></i> View PDF</button>`;

    const pdfIconHtml = `<span class="open-pdf-icon" onclick="event.stopPropagation(); window.openRecordPdf('${escapeHtml(pur.party_inv_no)}');" title="View PDF bill" style="margin-left: 6px; color: var(--accent-red); vertical-align: middle; cursor: pointer;"><i data-lucide="file-text" style="width: 14px; height: 14px; display: inline-block; pointer-events: none;"></i></span>`;

    tr.innerHTML = `
      <td class="editable-cell" data-id="${pur.id}" data-field="party_inv_no" data-type="purchase" title="Double click to edit inline">
        <strong>${escapeHtml(pur.party_inv_no)}</strong>
        ${pdfIconHtml}
      </td>
      <td class="editable-cell" data-id="${pur.id}" data-field="party_inv_date" data-type="purchase" title="Double click to edit inline">${formatDateToDDMMYYYY(pur.party_inv_date)}</td>
      <td class="editable-cell" data-id="${pur.id}" data-field="party_name" data-type="purchase" title="Double click to edit inline">${escapeHtml(pur.party_name)}</td>
      <td class="editable-cell" data-id="${pur.id}" data-field="expense_acc_name" data-type="purchase" title="Double click to edit inline">${escapeHtml(pur.expense_acc_name || '-')}</td>
      <td class="editable-cell" data-id="${pur.id}" data-field="expense_acc_code" data-type="purchase" title="Double click to edit inline">${escapeHtml(pur.expense_acc_code || '-')}</td>
      <td class="editable-cell" data-id="${pur.id}" data-field="sub_acc_code" data-type="purchase" title="Double click to edit inline">${escapeHtml(pur.sub_acc_code || '-')}</td>
      <td class="editable-cell" data-id="${pur.id}" data-field="service_acc_code" data-type="purchase" title="Double click to edit inline">${escapeHtml(pur.service_acc_code || '-')}</td>
      <td class="editable-cell" data-id="${pur.id}" data-field="sac_code" data-type="purchase" title="Double click to edit inline">${escapeHtml(pur.sac_code || '-')}</td>
      <td class="editable-cell text-right" data-id="${pur.id}" data-field="bill_freight_val" data-type="purchase" title="Double click to edit inline">${formatCurrency(pur.bill_freight_val)}</td>
      <!-- <td class="editable-cell text-right" data-id="${pur.id}" data-field="taxable_value" data-type="purchase" title="Double click to edit inline">${formatCurrency(pur.taxable_value)}</td> -->
      <td class="editable-cell text-right" data-id="${pur.id}" data-field="net_payable" data-type="purchase" title="Double click to edit inline">${formatCurrency(pur.net_payable)}</td>
      <td class="editable-cell text-right" data-id="${pur.id}" data-field="total_invoice_value" data-type="purchase" title="Double click to edit inline">${formatCurrency(pur.total_invoice_value || 0)}</td>
      <td class="editable-cell" data-id="${pur.id}" data-field="series" data-type="purchase" title="Double click to edit inline">${escapeHtml(pur.series || '-')}</td>
      <td class="editable-cell" data-id="${pur.id}" data-field="div_code" data-type="purchase" title="Double click to edit inline">${escapeHtml(pur.div_code || '-')}</td>
      <td class="editable-cell" data-id="${pur.id}" data-field="rcm" data-type="purchase" title="Double click to edit inline">${Math.round(pur.rcm * 100)}%</td>
      <td>
        <button class="btn btn-secondary btn-xs view-details-btn">View Details</button>
        ${pdfActionHtml}
        <button class="btn btn-danger btn-xs delete-purchase-btn" data-invoice-no="${escapeHtml(pur.party_inv_no)}" title="Delete purchase"><i data-lucide="trash-2"></i></button>
      </td>
    `;
    
    tr.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-purchase-btn') || e.target.closest('.delete-purchase-btn')) return;
      if (e.target.classList.contains('open-pdf-btn') || e.target.closest('.open-pdf-btn')) return;
      if (e.target.tagName === 'A' || e.target.closest('a')) return;
      if (e.target.tagName === 'INPUT') return;
      openDetailedRecordModal(pur.party_inv_no);
    });

    const openPdfBtn = tr.querySelector('.open-pdf-btn');
    if (openPdfBtn) {
      openPdfBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openRecordPdf(pur.party_inv_no);
      });
    }

    const openPdfIcon = tr.querySelector('.open-pdf-icon');
    if (openPdfIcon) {
      openPdfIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        openRecordPdf(pur.party_inv_no);
      });
    }

    const delPurBtn = tr.querySelector('.delete-purchase-btn');
    delPurBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteInvoiceRecord(pur.party_inv_no);
    });

    tr.querySelectorAll('.editable-cell').forEach(cell => {
      cell.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        makeCellEditable(cell);
      });
    });

    body.appendChild(tr);
  });
}

function renderReconciliation() {
  const body = document.getElementById('reconciliation-table-body');
  body.innerHTML = '';

  const search = document.getElementById('recon-search-input').value.toLowerCase();
  const reconData = calculateReconciliationData();

  // Count matrices for filters
  const counts = { all: 0, matched: 0, mismatch: 0, orphan: 0 };
  reconData.forEach(r => {
    counts.all++;
    if (r.status === 'MATCH') counts.matched++;
    else if (r.status === 'MISMATCH') counts.mismatch++;
    else counts.orphan++;
  });

  // Update tabs numbers
  document.getElementById('btn-recon-all').textContent = `All (${counts.all})`;
  document.getElementById('btn-recon-matched').textContent = `Matched (${counts.matched})`;
  document.getElementById('btn-recon-mismatch').textContent = `Mismatched (${counts.mismatch})`;
  document.getElementById('btn-recon-orphan').textContent = `Orphans (${counts.orphan})`;

  // Filter reconciliation array based on subtab selection
  const activeReconFilter = document.querySelector('.recon-filters .btn.active').id;
  
  const filtered = reconData.filter(r => {
    const matchesSearch = String(r.invoice_number || '').toLowerCase().includes(search) || 
                          String(r.party_name || '').toLowerCase().includes(search);
    
    if (!matchesSearch) return false;
    
    if (activeReconFilter === 'btn-recon-matched') return r.status === 'MATCH';
    if (activeReconFilter === 'btn-recon-mismatch') return r.status === 'MISMATCH';
    if (activeReconFilter === 'btn-recon-orphan') return r.status === 'ORPHAN_INV' || r.status === 'ORPHAN_PUR';
    return true; // All
  });

  // Render reconciliation banners numbers
  document.getElementById('recon-summary-total').textContent = counts.all;
  document.getElementById('recon-summary-matched').textContent = counts.matched;
  document.getElementById('recon-summary-discrepancies').textContent = counts.mismatch;
  document.getElementById('recon-summary-orphan').textContent = counts.orphan;

  if (filtered.length === 0) {
    body.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No reconciliation records match filters.</td></tr>`;
    return;
  }

  filtered.forEach(r => {
    const diffVal = r.invoice_net - r.purchase_net;
    const diffAbs = Math.abs(diffVal);
    let diffClass = 'amount-diff-badge ';
    let diffText = 'Balanced';
    
    if (diffVal > 1) {
      diffClass += 'text-warning';
      diffText = `+ ₹${diffVal.toFixed(2)}`;
    } else if (diffVal < -1) {
      diffClass += 'text-danger';
      diffText = `- ₹${diffAbs.toFixed(2)}`;
    } else {
      diffClass += 'text-success';
    }

    let statusBadge = '';
    if (r.status === 'MATCH') statusBadge = '<span class="badge badge-green">Matched</span>';
    else if (r.status === 'MISMATCH') statusBadge = '<span class="badge badge-warning">Mismatch</span>';
    else if (r.status === 'ORPHAN_INV') statusBadge = '<span class="badge badge-purple">In Invoice Only</span>';
    else statusBadge = '<span class="badge badge-danger">In Purchase Only</span>';

    const tdsMatch = r.status === 'ORPHAN_INV' ? '-' : 
      (r.purchase_tds > 0 ? `<span class="text-success">${parseFloat((r.purchase_tds * 100).toFixed(4))}%</span>` : '<span class="text-muted">None</span>');

    const tr = document.createElement('tr');
    tr.className = 'clickable-row';
    
    const pdfActionBtn = `<button type="button" class="btn btn-secondary btn-xs open-pdf-btn" onclick="event.stopPropagation(); window.openRecordPdf('${escapeHtml(r.invoice_number)}');" style="color: var(--accent-red); border-color: rgba(255, 77, 109, 0.4); font-weight: 600; cursor: pointer;" title="View PDF bill"><i data-lucide="file-text" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; pointer-events: none;"></i> View PDF</button>`;

    tr.innerHTML = `
      <td><strong>${escapeHtml(r.invoice_number)}</strong></td>
      <td>${escapeHtml(r.party_name)}</td>
      <td class="text-right">${formatCurrency(r.invoice_net)}</td>
      <td class="text-right">${formatCurrency(r.invoice_total || r.purchase_net || 0)}</td>
      <td class="text-right">${formatCurrency(r.purchase_net)}</td>
      <td class="text-right"><strong class="${diffClass}">${diffText}</strong></td>
      <td>${tdsMatch}</td>
      <td>${statusBadge}</td>
      <td>
        <button class="btn btn-secondary btn-xs">View Reconcile</button>
        ${pdfActionBtn}
      </td>
    `;

    tr.addEventListener('click', (e) => {
      if (e.target.tagName === 'A' || e.target.closest('a')) return;
      openDetailedRecordModal(r.invoice_number);
    });
    body.appendChild(tr);
  });
  
  lucide.createIcons();
}

// ==========================================================================
// DOUBLE-CLICK INLINE EDITING LOGIC
// ==========================================================================
function makeCellEditable(cell) {
  // Prevent double-activation
  if (cell.classList.contains('editing-now')) return;
  cell.classList.add('editing-now');

  const originalValue = cell.textContent.trim();
  const fieldName = cell.dataset.field;
  const recordId = cell.dataset.id;
  const recordType = cell.dataset.type; // 'invoice', 'purchase' or 'line_item'
  const invoiceId = cell.dataset.invoiceId;
  const lineIndex = cell.dataset.lineIndex !== undefined ? parseInt(cell.dataset.lineIndex) : -1;

  let record = null;
  let rawVal = '';

  if (recordType === 'line_item') {
    const invRecord = state.invoices.find(i => i.id === invoiceId);
    if (invRecord && invRecord.line_items) {
      record = invRecord.line_items[lineIndex];
      rawVal = record ? record[fieldName] : '';
    }
  } else {
    record = recordType === 'invoice' ? 
      state.invoices.find(i => i.id === recordId) : 
      state.purchases.find(p => p.id === recordId);
    if (record) {
      rawVal = record[fieldName];
    }
  }

  // Insert Input Element
  cell.innerHTML = '';
  const input = document.createElement('input');
  
  if (typeof rawVal === 'number') {
    input.type = 'number';
    input.step = 'any';
    input.value = rawVal;
  } else {
    input.type = 'text';
    input.value = rawVal;
  }
  
  input.className = 'cell-inline-input';
  cell.appendChild(input);
  input.focus();

  // Save actions
  const saveAction = () => {
    let newVal = input.type === 'number' ? parseFloat(input.value || 0) : input.value;
    
    // Parse percentage inputs like RCM / rcm
    if (fieldName === 'RCM' || fieldName === 'rcm') {
      let rawInput = String(input.value).replace('%', '').trim();
      let parsedVal = parseFloat(rawInput || 0);
      if (parsedVal > 1) newVal = parsedVal / 100;
      else newVal = parsedVal;
    }

    if (!record) {
      cell.classList.remove('editing-now');
      cell.textContent = originalValue;
      return;
    }

    const oldVal = record[fieldName];
    record[fieldName] = newVal;
    
    if (recordType === 'line_item') {
      record._manually_edited = true;
      const invRecord = state.invoices.find(i => i.id === invoiceId);
      if (invRecord) {
        invRecord._manually_edited = true;
        invRecord.validated = true;
        // Sync line_item field to invoice-level field
        const fieldToTop = { 'lr_no': 'cn_lr_no', 'truck_no': 'lorry_vehicle_no', 'freight': 'bill_freight_val', 'date': 'lr_date' };
        if (fieldToTop[fieldName]) invRecord[fieldToTop[fieldName]] = newVal;
        const invNo = invRecord.invoice_number;
        if (invNo) {
          const matchPur = state.purchases.find(p => p.party_inv_no === invNo);
          if (matchPur) { matchPur.validated = true; matchPur._manually_edited = true; }
        }
      }
    } else if (recordType === 'invoice') {
      record.validated = true;
      const invNo = record.invoice_number;
      if (invNo) {
        const matchPur = state.purchases.find(p => p.party_inv_no === invNo);
        if (matchPur) { matchPur.validated = true; matchPur._manually_edited = true; }
      }
    } else if (recordType === 'purchase') {
      record.validated = true;
      if (record.party_inv_no) {
        const matchInv = state.invoices.find(i => i.invoice_number === record.party_inv_no);
        if (matchInv) { matchInv.validated = true; matchInv._manually_edited = true; }
      }
    }

    // Renaming linked keys to keep Invoices and Purchases reconciled
    if (recordType !== 'line_item' && ((fieldName === 'invoice_number' && recordType === 'invoice') || (fieldName === 'party_inv_no' && recordType === 'purchase'))) {
      state.invoices = state.invoices.map(inv => {
        if (inv.invoice_number === oldVal) inv.invoice_number = newVal;
        return inv;
      });
      state.purchases = state.purchases.map(pur => {
        if (pur.party_inv_no === oldVal) pur.party_inv_no = newVal;
        return pur;
      });
    }
    
    saveToLocalStorage();

    // Call Google Sheets writeback API
    if (recordType === 'line_item') {
      const invRecord = state.invoices.find(i => i.id === invoiceId);
      const lrNo = record.lr_no || record.cn_lr_no || '';
      
      const searchCol = (fieldName !== 'lr_no' && fieldName !== 'cn_lr_no' && lrNo) ? 'cn_lr_no' : 'party_inv_no';
      const searchVal = searchCol === 'cn_lr_no' ? lrNo : (invRecord.invoice_number || invRecord.party_inv_no);
      
      const mappedKey = 
        fieldName === 'date' ? 'lr_date' :
        fieldName === 'truck_no' ? 'lorry_vehicle_no' :
        fieldName === 'lr_no' ? 'cn_lr_no' :
        fieldName === 'freight' ? 'bill_freight_val' :
        fieldName;

      const payload = {
        sheetName: 'Invoice_Items',
        searchColumn: searchCol,
        searchValue: searchVal,
        updates: { [mappedKey]: newVal }
      };

      fetch(`${SERVER_BASE_URL}/api/update-record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(res => res.json()).then(result => {
        if (result.success || result.status === 'success') {
          showToast("Spreadsheet updated successfully!", "success");
        } else {
          throw new Error();
        }
      }).catch(err => {
        const directUrl = 'https://script.google.com/macros/s/AKfycbyfkvGhPuaVPFe62kyDhCSbKm4UwJ-Rbmr6KQfHfJjtE_Dp9E5dGdB1Bq1NS1r15U4e/exec';
        fetch(directUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload)
        });
        showToast("Spreadsheet updated directly!", "success");
      });
    } else {
      const partyInvNo = (recordType === 'invoice' ? record.invoice_number : record.party_inv_no) || '';
      sendSheetUpdate(recordType, (fieldName === 'invoice_number' || fieldName === 'party_inv_no') ? oldVal : partyInvNo, {
        [fieldName]: newVal
      }, record);
    }
    
    // Reset view
    cell.classList.remove('editing-now');
    renderAllViews();
    if (recordType === 'line_item') {
      openDetailedRecordModal(invoiceId);
    }
    showToast(`Updated ${fieldName} inline successfully!`, 'success');
  };

  const cancelAction = () => {
    cell.classList.remove('editing-now');
    cell.textContent = originalValue;
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveAction();
    if (e.key === 'Escape') cancelAction();
  });

  input.addEventListener('blur', saveAction);
}

// ==========================================================================
// DETAILED MODAL AUDITOR & OVERRIDES (SPLIT VIEWS)
// ==========================================================================
function openDetailedRecordModal(target) {
  let invoice = null;
  let purchase = null;
  let invoiceNumber = String(target || '').trim();

  // Always resolve by invoice_number / party_inv_no (stable string-based lookup)
  // Strip any legacy id prefixes in case old closures still pass them
  if (invoiceNumber.startsWith('inv-') || invoiceNumber.startsWith('pur-')) {
    // Try to find by ID first (backward compat), then fall back to string search
    const byId = invoiceNumber.startsWith('inv-')
      ? state.invoices.find(i => i.id === invoiceNumber)
      : state.purchases.find(p => p.id === invoiceNumber);
    if (byId) {
      invoiceNumber = byId.invoice_number || byId.party_inv_no || invoiceNumber;
    } else {
      // ID is stale — strip prefix and try as a raw invoice number
      invoiceNumber = invoiceNumber.replace(/^(inv|pur)-/, '').replace(/_/g, '/');
    }
  }

  // Lookup by invoice_number / party_inv_no
  invoice  = [...state.invoices].reverse().find(i => String(i.invoice_number) === invoiceNumber) || null;
  purchase = [...state.purchases].reverse().find(p => String(p.party_inv_no) === invoiceNumber) || null;

  // Store selected record as invoice_number string (stable across re-renders)
  state.selectedRecordId = invoiceNumber;

  // If both empty, cannot open
  if (!invoice && !purchase) {
    showToast("Record not found", "error");
    return;
  }

  const wrongBillBanner = document.getElementById('modal-wrong-bill-banner');
  if (wrongBillBanner) {
    if (purchase && hasValidationFailures(purchase)) {
      wrongBillBanner.style.display = 'block';
    } else {
      wrongBillBanner.style.display = 'none';
    }
  }

  // Render header
  const title = document.getElementById('modal-title-invoice-no');
  const subtitle = document.getElementById('modal-subtitle-party-name');
  const statusBadge = document.getElementById('modal-badge-status');

  title.textContent = `Invoice: ${invoiceNumber}`;
  subtitle.textContent = (invoice ? invoice.party_name : purchase.party_name) || 'Unknown Client';

  // Evaluate status badge color
  let status = 'MATCH';
  let statusText = 'Matched';
  let badgeClass = 'badge badge-green';

  if (!invoice) {
    status = 'ORPHAN_PUR';
    statusText = 'In Purchase Only';
    badgeClass = 'badge badge-danger';
  } else if (!purchase) {
    status = 'ORPHAN_INV';
    statusText = 'In Invoice Only';
    badgeClass = 'badge badge-purple';
  } else {
    // Both exist, check difference
    const totalInvPay = invoice.net_payable;
    const totalPurPay = purchase.net_payable;
    if (Math.abs(totalInvPay - totalPurPay) > 1 || invoice.RCM !== purchase.rcm) {
      status = 'MISMATCH';
      statusText = 'Mismatch Warning';
      badgeClass = 'badge badge-warning';
    }
  }

  statusBadge.textContent = statusText;
  statusBadge.className = badgeClass;

  // Build Invoice Details Side
  buildInvoiceDetailsView(invoice, invoice ? [invoice] : []);

  // Build Purchase Details Side
  buildPurchaseDetailsView(purchase, purchase ? [purchase] : []);

  // Toggle buttons
  toggleEditMode(false);

  // Build ERP Rows Tab
  buildERPRowsView(invoice, purchase);

  // Populate Raw JSON textareas
  document.getElementById('modal-raw-invoice-json').value = JSON.stringify(invoice ? [invoice] : [], null, 2);
  document.getElementById('modal-raw-purchase-json').value = JSON.stringify(purchase ? [purchase] : [], null, 2);

  // Switch back to split-view tab on opening
  document.querySelector('[data-detail-tab="split-view"]').click();
}

function buildERPRowsView(invoice, purchase) {
  const container = document.getElementById('detail-section-erp-rows-view');
  if (!container) return;

  const inv = invoice || {};
  const pur = purchase || {};

  // Resolve values
  const ourInvoiceNo = (() => {
    if (inv && inv.our_bill_no && String(inv.our_bill_no).trim() !== '') {
      return String(inv.our_bill_no).trim();
    }
    if (pur && pur.our_bill_no && String(pur.our_bill_no).trim() !== '') {
      return String(pur.our_bill_no).trim();
    }
    const aiSummaryText = (pur && pur.ai_summary) || (inv && inv.ai_summary) || '';
    if (aiSummaryText) {
      const match = aiSummaryText.match(/([A-Z0-9a-z-]+)\s+Validated/);
      if (match) return match[1];
      const matchLP = aiSummaryText.match(/(LP[A-Za-z0-9-]+)/);
      if (matchLP) return matchLP[1];
    }
    return '-';
  })();

  // Aggregate multiple values from line items / shipments if present
  let lineItems = [];
  const groupRecords = inv.id ? [inv] : [];
  groupRecords.forEach(r => {
    if (r.line_items && r.line_items.length > 0) {
      const itemsWithInvoiceNumber = r.line_items.map(item => ({
        ...item,
        our_invoice_number: item.our_invoice_number || r.invoice_number || r.party_inv_no || r.our_bill_no || ''
      }));
      lineItems = [...lineItems, ...itemsWithInvoiceNumber];
    } else {
      lineItems.push({
        date: r.lr_date || r.invoice_date,
        our_invoice_number: r.invoice_number || r.party_inv_no || r.our_bill_no || '',
        truck_no: r.lorry_vehicle_no,
        fo_no: r.fo_no,
        description: r.item_name || r.description,
        lr_no: r.cn_lr_no,
        freight: r.bill_freight_val
      });
    }
  });

  if (lineItems.length === 0) {
    const selectedId = state.selectedRecordId;
    let purMatch = null;
    if (typeof selectedId === 'string' && selectedId.startsWith('pur-')) {
      purMatch = state.purchases.find(p => p.id === selectedId) || null;
    } else if (invoice) {
      purMatch = [...state.purchases].reverse().find(p => String(p.party_inv_no) === String(invoice.invoice_number));
    }
    if (purMatch) {
      lineItems.push({
        date: purMatch.party_inv_date,
        our_invoice_number: purMatch.party_inv_no || '',
        truck_no: purMatch.lorry_vehicle_no || '-',
        fo_no: purMatch.fo_no || '-',
        description: purMatch.description || purMatch.expense_acc_name || '-',
        lr_no: purMatch.cn_lr_no || '-',
        freight: purMatch.bill_freight_val || 0
      });
    }
  }

  // Deduplicate line items by truck_no, lr_no, date and freight
  const seen = new Set();
  const dedupedLineItems = [...lineItems].reverse().filter(item => {
    const key = `${item.truck_no||''}|${item.lr_no||''}|${item.date||''}|${item.freight||0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).reverse();

  // Create Tagging rows for each shipment/item
  const taggingRowsData = dedupedLineItems.map((item, idx) => {
    return {
      "TNATURE": inv.tnature || pur.tnature || '-',
      "TRANSPORTER CODE / PARTY CODE": pur.party_code || inv.party_code || '-',
      "TRANSPORTER NAME": pur.party_name || inv.party_name || inv.transporter_name || '-',
      "FO NO": item.fo_no || inv.fo_no || pur.fo_no || '-',
      "OUR INVOICE NUMBER": item.our_invoice_number || ourInvoiceNo || '-',
      "CN/LR NO": inv.cn_lr_no || pur.cn_lr_no || item.lr_no || '-',
      "CN/LR DATE": formatDateToDDMMYYYY(inv.lr_date || pur.party_inv_date || item.date),
      "PARTY INVOICE NUMBER(BILL NO)": pur.party_inv_no || inv.party_inv_no || '-',
      "PARTY INVOICE DATE (BILL DATE)": formatDateToDDMMYYYY(pur.party_inv_date || inv.invoice_date),
      "LORRY NO OR VECHILE NO": inv.lorry_vehicle_no || pur.lorry_vehicle_no || item.truck_no || '-',
      "FREIGHT VALUE": inv.bill_freight_val ?? pur.bill_freight_val ?? item.freight ?? 0,
      "ST CHARGES": pur.st_charges || inv.st_charges || 0,
      "Invoice Value (₹)": pur.net_payable || inv.net_payable || 0
    };
  });

  const invoiceNumberStr = String(inv.invoice_number || pur.party_inv_no || '').trim();
  const ourInvoiceNoStr = String(ourInvoiceNo || inv.our_bill_no || pur.present_our_invoice || pur.our_bill_no || '').trim();

  const matchedPurchasesObj = state.purchases.filter(p => {
    const pInvNo = String(p.party_inv_no || '').trim();
    const pOurBill = String(p.present_our_invoice || p.our_bill_no || '').trim();
    
    const matchByInvNo = invoiceNumberStr && pInvNo && pInvNo === invoiceNumberStr;
    const matchByOurBill = ourInvoiceNoStr && pOurBill && pOurBill === ourInvoiceNoStr;
    
    return matchByInvNo || matchByOurBill;
  });

  // Helper to determine if a transaction is RCM (below or same as 5% GST)
  const isRcmTransaction = (() => {
    const rcmVal = pur.rcm || inv.RCM || 0;
    if (rcmVal > 0) return true;

    const totalGstValue = (pur.cgst || 0) + (pur.sgst || 0) + (pur.igst || 0) + (inv.cgst || 0) + (inv.sgst || 0) + (inv.igst || 0);
    const freight = pur.bill_freight_val || inv.bill_freight_val || 0;
    if (freight > 0) {
      const computedGstPercent = totalGstValue / freight;
      if (computedGstPercent > 0 && computedGstPercent <= 0.055) {
        return true;
      }
    }

    const aiSummaryText = (pur && pur.ai_summary) || (inv && inv.ai_summary) || '';
    if (aiSummaryText.toLowerCase().includes('rcm') || aiSummaryText.toLowerCase().includes('5%')) {
      return true;
    }

    return false;
  })();

  const calculatedFallback = (() => {
    let stateCode = String(pur.stax_code_str || inv.stax_code_str || '').trim();
    if (!stateCode && inv.transporter_gstin) {
      stateCode = String(inv.transporter_gstin).trim().substring(0, 2);
    }
    if (!stateCode) {
      stateCode = '19'; 
    }

    const isState19 = stateCode === '19';

    if (isRcmTransaction) {
      return isState19 ? 'SG01' : 'IG01';
    } else {
      return isState19 ? 'GST0' : 'GST1';
    }
  })();

  const coalescedTaxCritaria = pur.tax_critaria
                           || matchedPurchasesObj.map(p => p.tax_critaria).find(v => v && String(v).trim() !== '') 
                           || inv.tax_critaria 
                           || calculatedFallback;

  const coalescedProject = pur.project
                        || matchedPurchasesObj.map(p => p.project).find(v => v && String(v).trim() !== '')
                        || inv.project
                        || "LCPP-POLYPARK01";

  const coalescedProjectCode = pur.project_code
                            || matchedPurchasesObj.map(p => p.project_code).find(v => v && String(v).trim() !== '')
                            || inv.project_code
                            || "PPU01";

  const coalescedDeparment = pur.deparment
                          || matchedPurchasesObj.map(p => p.deparment).find(v => v && String(v).trim() !== '')
                          || inv.deparment
                          || "LOGISTICS";

  const coalescedDepermentCode = pur.deperment_code
                              || matchedPurchasesObj.map(p => p.deperment_code).find(v => v && String(v).trim() !== '')
                              || inv.deperment_code
                              || "LOGSI";

  console.log('buildERPRowsView Coalescing Debug:', {
    invoiceNumberStr,
    ourInvoiceNoStr,
    purTaxCritaria: pur.tax_critaria,
    coalescedTaxCritaria,
    purProject: pur.project,
    coalescedProject,
    matchedPurchasesCount: matchedPurchasesObj.length
  });

  // Booking Row values
  const bookingData = {
    "SERISE (MOVE)": pur.series || inv.series || '-',
    "TRANSPORTER CODE / PARTY CODE": pur.party_code || inv.party_code || '-',
    "TRANSPORTER NAME": pur.party_name || inv.party_name || inv.transporter_name || '-',
    "SL NO": pur.party_slno || inv.party_slno || '-',
    "OUR SL NO": pur.our_slno || inv.our_slno || '-',
    "EXPENSE ACC": pur.expense_acc_name || inv.expense_acc_name || '-',
    "EXPENSE ACC CODE": pur.expense_acc_code || inv.expense_acc_code || '-',
    "SUB ACC": pur.sub_acc_name || inv.sub_acc_name || '-',
    "SUB ACC CODE": pur.sub_acc_code || inv.sub_acc_code || '-',
    "SERVICE CODE": pur.service_acc_code || inv.service_acc_code || '-',
    "SERVICE NAME": pur.service_acc_name || inv.service_acc_name || '-',
    "PROJECT": coalescedProject,
    "PROJECT CODE": coalescedProjectCode,
    "DEPERMENT": coalescedDeparment,
    "DEPERMENT CODE": coalescedDepermentCode,
    "SAC CODE": pur.sac_code || inv.sac_code || '-',
    "DIVITION": pur.div_code || inv.div_code || '-',
    "ADDON CODE": pur.addon_code_str || inv.addon_code_str || '-',
    "TAX CRITARIA": coalescedTaxCritaria,
    "GST PERCENTAGE": isRcmTransaction ? "5%" : "18%",
    "TDS PERCENTAGE": pur.tds_percent ? `${(pur.tds_percent * 100).toFixed(1)}%` : '0%',
    "TOTAL NET PAYABLE": pur.net_payable || inv.net_payable || 0
  };

  // Render HTML
  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 24px; width: 100%;">
      <!-- Tagging Row Card -->
      <div class="card" style="padding: 20px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--card-bg);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px;">
          <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 8px; margin: 0;">
            <i data-lucide="tag" style="color: var(--accent-purple); width: 18px; height: 18px;"></i>
            ERP Tagging Row Data (${taggingRowsData.length} Row(s))
          </h3>
          <button class="btn btn-primary btn-xs" id="copy-tagging-all-btn" style="padding: 6px 12px; font-size: 0.8rem; display: flex; align-items: center; gap: 4px;">
            <i data-lucide="copy" style="width: 14px; height: 14px;"></i> Copy All Rows (Excel/TSV)
          </button>
        </div>
        <div class="table-responsive border rounded" style="overflow-x: auto;">
          <table class="data-table data-table-sm" style="white-space: nowrap; width: 100%;">
            <thead>
              <tr style="background: var(--bg-darker);">
                <th style="padding: 10px 14px; border-bottom: 2px solid var(--border-color);">Action</th>
                ${Object.keys(taggingRowsData[0]).map(k => `<th style="padding: 10px 14px; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.5px; border-bottom: 2px solid var(--border-color);">${k}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${taggingRowsData.map((row, idx) => `
                <tr style="border-bottom: 1px solid var(--border-color);">
                  <td style="padding: 10px 14px;">
                    <button class="btn btn-secondary btn-xs copy-tagging-row-btn" data-row-index="${idx}" style="padding: 2px 6px; font-size: 0.7rem; display: flex; align-items: center; gap: 2px;">
                      <i data-lucide="copy" style="width: 10px; height: 10px;"></i> Copy
                    </button>
                  </td>
                  ${Object.entries(row).map(([k, v]) => {
                    let displayVal = v;
                    if (k.includes('Freight') || k.includes('Value') || k.includes('CHARGES')) {
                      if (typeof v === 'number') displayVal = formatCurrency(v);
                    }
                    return `<td class="copyable-cell" data-copy-value="${v}" title="Click to copy cell value" style="padding: 10px 14px; font-size: 0.85rem; font-family: monospace; color: var(--text-main);">${escapeHtml(displayVal)}</td>`;
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Booking Row Card -->
      <div class="card" style="padding: 20px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--card-bg);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px;">
          <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 8px; margin: 0;">
            <i data-lucide="book-open" style="color: var(--accent-blue); width: 18px; height: 18px;"></i>
            ERP Booking Row Data
          </h3>
          <button class="btn btn-secondary btn-xs" id="copy-booking-all-btn" style="padding: 6px 12px; font-size: 0.8rem; display: flex; align-items: center; gap: 4px; background: var(--accent-blue); color: white; border: none;">
            <i data-lucide="copy" style="width: 14px; height: 14px;"></i> Copy Row (Excel/TSV)
          </button>
        </div>
        <div class="table-responsive border rounded" style="overflow-x: auto;">
          <table class="data-table data-table-sm" style="white-space: nowrap; width: 100%;">
            <thead>
              <tr style="background: var(--bg-darker);">
                <th style="padding: 10px 14px; border-bottom: 2px solid var(--border-color);">Action</th>
                ${Object.keys(bookingData).map(k => `<th style="padding: 10px 14px; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.5px; border-bottom: 2px solid var(--border-color);">${k}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 10px 14px;">
                  <button class="btn btn-secondary btn-xs" id="copy-booking-single-row-btn" style="padding: 2px 6px; font-size: 0.7rem; display: flex; align-items: center; gap: 2px;">
                    <i data-lucide="copy" style="width: 10px; height: 10px;"></i> Copy
                  </button>
                </td>
                ${Object.entries(bookingData).map(([k, v]) => {
                  let displayVal = v;
                  if (k.includes('PAYABLE') || k.includes('Value')) {
                    if (typeof v === 'number') displayVal = formatCurrency(v);
                  }
                  return `<td class="copyable-cell" data-copy-value="${v}" title="Click to copy cell value" style="padding: 10px 14px; font-size: 0.85rem; font-family: monospace; color: var(--text-main);">${escapeHtml(displayVal)}</td>`;
                }).join('')}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Attach copy event listeners
  document.getElementById('copy-tagging-all-btn').addEventListener('click', () => {
    const tsvContent = taggingRowsData.map(row => Object.values(row).join('\t')).join('\n');
    navigator.clipboard.writeText(tsvContent).then(() => {
      showToast('All tagging rows copied to clipboard in TSV format!', 'success');
    }).catch(err => {
      console.error('Failed to copy TSV: ', err);
      showToast('Failed to copy tagging row data', 'error');
    });
  });

  // Attach single-row copy listeners
  container.querySelectorAll('.copy-tagging-row-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.rowIndex, 10);
      const rowData = taggingRowsData[idx];
      if (rowData) {
        const tsvContent = Object.values(rowData).join('\t');
        navigator.clipboard.writeText(tsvContent).then(() => {
          showToast(`Tagging row #${idx + 1} copied successfully!`, 'success');
        });
      }
    });
  });

  const copyBookingFn = () => {
    const tsvContent = Object.values(bookingData).join('\t');
    navigator.clipboard.writeText(tsvContent).then(() => {
      showToast('Booking row copied to clipboard in TSV format!', 'success');
    }).catch(err => {
      console.error('Failed to copy TSV: ', err);
      showToast('Failed to copy booking row data', 'error');
    });
  };
  document.getElementById('copy-booking-all-btn').addEventListener('click', copyBookingFn);
  document.getElementById('copy-booking-single-row-btn').addEventListener('click', copyBookingFn);

  // Click-to-copy handler on cells
  container.querySelectorAll('.copyable-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const val = cell.dataset.copyValue || cell.textContent.trim();
      navigator.clipboard.writeText(val).then(() => {
        showToast(`Copied value: "${val}"`, 'info');
      });
    });
  });

  // Render Lucide icons
  lucide.createIcons();

  // Show modal
  const modal = document.getElementById('detail-modal');
  modal.classList.add('active');
  lucide.createIcons();
}

window.openDetailedRecordModal = openDetailedRecordModal;

function buildInvoiceDetailsView(invoice, groupRecords) {
  const container = document.getElementById('invoice-details-view');
  const editForm = document.getElementById('invoice-details-edit-form');
  const lineItemsTableBody = document.querySelector('#modal-invoice-line-items-table tbody');

  container.innerHTML = '';
  editForm.innerHTML = '';
  lineItemsTableBody.innerHTML = '';

  if (!invoice) {
    container.innerHTML = `<div class="col-span-2 text-center text-muted py-3">No sales invoice shipment records correspond to this index.</div>`;
    return;
  }

  // Calculate consolidated sums
  const totalFreight = groupRecords.reduce((sum, r) => sum + (r.bill_freight_val || 0), 0);
  const totalNet = groupRecords.reduce((sum, r) => sum + (r.net_payable || 0), 0);
  const totalInvoiceValue = groupRecords[0] ? (groupRecords[0].total_invoice_value || 0) : 0;

  const fields = [
    { label: "Invoice Number", key: "invoice_number", value: invoice.invoice_number, editable: true, type: "text" },
    { label: "Invoice Date", key: "invoice_date", value: invoice.invoice_date, editable: true, type: "date" },
    { label: "Buyer Name", key: "buyer_name", value: invoice.buyer_name, editable: true, type: "text" },
    { label: "Transporter Name", key: "transporter_name", value: invoice.transporter_name, editable: true, type: "text" },
    { label: "Transporter GSTIN", key: "transporter_gstin", value: invoice.transporter_gstin, editable: true, type: "text" },
    { label: "Delivery Place", key: "to_place_name", value: invoice.to_place_name, editable: true, type: "text" },
    { label: "Billing Item", key: "item_name", value: invoice.item_name, editable: true, type: "text" },
    { label: "Party Registration Address", key: "party_reg_addr", value: invoice.party_reg_addr, editable: true, type: "text" },
    { label: "Our Registration Address", key: "our_reg_addr", value: invoice.our_reg_addr, editable: true, type: "text" },
    { label: "Service Account Code", key: "service_acc_code", value: invoice.service_acc_code, editable: true, type: "text" },
    { label: "SAC Code", key: "sac_code", value: invoice.sac_code, editable: true, type: "text" },
    { label: "CGST", key: "cgst", value: invoice.cgst, editable: true, type: "number" },
    { label: "SGST", key: "sgst", value: invoice.sgst, editable: true, type: "number" },
    { label: "IGST", key: "igst", value: invoice.igst, editable: true, type: "number" },
    { label: "Series", key: "series", value: invoice.series, editable: true, type: "text" },
    { label: "Division", key: "div_code", value: invoice.div_code, editable: true, type: "text" },
    { label: "Addon Code", key: "addon_code_str", value: invoice.addon_code_str, editable: true, type: "text" },
    { label: "GST State Code", key: "stax_code_str", value: invoice.stax_code_str, editable: true, type: "text" },
    { label: "Consolidated Freight (₹)", key: "bill_freight_val", value: totalFreight, editable: true, type: "number" },
    { label: "ST Charges (₹)", key: "st_charges", value: invoice.st_charges || 0, editable: true, type: "number" },
    // { label: "Invoice Value (₹)", key: "total_invoice_value", value: totalInvoiceValue, editable: true, type: "number" },
    { label: "RCM Percentage", key: "RCM", value: invoice.RCM, editable: true, type: "select", options: [
      { label: "5%", value: 0.05 },
      { label: "0%", value: 0 },
      { label: "12%", value: 0.12 }
    ]}
  ];

  // Generate HTML
  fields.forEach(f => {
    // Read only view HTML
    const roVal = f.type === 'number' ? formatCurrency(f.value) : 
                  (f.key === 'RCM' ? `${Math.round(f.value*100)}%` : 
                   (f.type === 'date' ? formatDateToDDMMYYYY(f.value) : f.value || '-'));
    container.innerHTML += `
      <div class="read-only-field">
        <label>${f.label}</label>
        <div class="value">${escapeHtml(roVal)}</div>
      </div>
    `;

    // Edit form inputs HTML
    let inputHtml = '';
    if (f.type === 'select') {
      inputHtml = `<select name="inv_${f.key}" class="form-control">`;
      f.options.forEach(opt => {
        const sel = opt.value === f.value ? 'selected' : '';
        inputHtml += `<option value="${opt.value}" ${sel}>${opt.label}</option>`;
      });
      inputHtml += `</select>`;
    } else {
      inputHtml = `<input type="${f.type}" name="inv_${f.key}" value="${f.type === 'date' ? normalizeToISODate(f.value) : escapeHtml(String(f.value ?? ''))}" class="form-control">`;
    }

    editForm.innerHTML += `
      <div class="form-group">
        <label>${f.label}</label>
        ${inputHtml}
      </div>
    `;
  });

  // Render Line items (flattened array of all line items in the invoice group)
  let lineItems = [];
  groupRecords.forEach(r => {
    if (r.line_items && r.line_items.length > 0) {
      const itemsWithInvoiceNumber = r.line_items.map(item => ({
        ...item,
        our_invoice_number: item.our_invoice_number || r.invoice_number || r.party_inv_no || r.our_bill_no || ''
      }));
      lineItems = [...lineItems, ...itemsWithInvoiceNumber];
    } else {
      // Fallback row constructed from shipment records top level details
      lineItems.push({
        date: r.lr_date || r.invoice_date,
        our_invoice_number: r.invoice_number || r.party_inv_no || r.our_bill_no || '',
        truck_no: r.lorry_vehicle_no,
        fo_no: r.fo_no,
        description: r.item_name || r.description,
        lr_no: r.cn_lr_no,
        freight: r.bill_freight_val
      });
    }
  });

  if (lineItems.length === 0) {
    // Fallback: search for matching purchase record to extract shipment and FO details
    const selectedId = state.selectedRecordId;
    let purMatch = null;
    if (typeof selectedId === 'string' && selectedId.startsWith('pur-')) {
      purMatch = state.purchases.find(p => p.id === selectedId) || null;
    } else if (invoice) {
      purMatch = [...state.purchases].reverse().find(p => String(p.party_inv_no) === String(invoice.invoice_number));
    }
    if (purMatch) {
      lineItems.push({
        date: purMatch.party_inv_date,
        our_invoice_number: purMatch.party_inv_no || '',
        truck_no: purMatch.lorry_vehicle_no || '-',
        fo_no: purMatch.fo_no || '-',
        description: purMatch.description || purMatch.expense_acc_name || '-',
        lr_no: purMatch.cn_lr_no || '-',
        freight: purMatch.bill_freight_val || 0
      });
    }
  }

  if (lineItems.length === 0) {
    lineItemsTableBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No itemized shipments attached.</td></tr>`;
  } else {
    // Deduplicate line items by truck_no, lr_no, date and freight (latest uploads take precedence)
    const seen = new Set();
    const deduped = [...lineItems].reverse().filter(item => {
      const key = `${item.truck_no||''}|${item.lr_no||''}|${item.date||''}|${item.freight||0}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).reverse();

    deduped.forEach(item => {
      const tr = document.createElement('tr');
      
      const lineIndex = invoice && invoice.line_items ? invoice.line_items.findIndex(li => 
        (li.truck_no || '') === (item.truck_no || '') && 
        (li.lr_no || '') === (item.lr_no || '') && 
        (li.freight || 0) === (item.freight || 0)
      ) : -1;

      const isEditable = lineIndex !== -1;
      const invoiceIdAttr = invoice ? invoice.id : '';

      tr.innerHTML = `
        <td ${isEditable ? `class="editable-cell" data-type="line_item" data-invoice-id="${invoiceIdAttr}" data-line-index="${lineIndex}" data-field="date" title="Double click to edit"` : ''}>${formatDateToDDMMYYYY(invoice.lr_date || item.date)}</td>
        <td ${isEditable ? `class="editable-cell" data-type="line_item" data-invoice-id="${invoiceIdAttr}" data-line-index="${lineIndex}" data-field="our_invoice_number" title="Double click to edit"` : ''}><span class="badge badge-purple" style="font-family: monospace; font-size: 0.75rem;">${escapeHtml(item.our_invoice_number || invoiceNumber || '-')}</span></td>
        <td ${isEditable ? `class="editable-cell" data-type="line_item" data-invoice-id="${invoiceIdAttr}" data-line-index="${lineIndex}" data-field="truck_no" title="Double click to edit"` : ''}><strong>${escapeHtml(invoice.lorry_vehicle_no || item.truck_no || '-')}</strong></td>
        <td ${isEditable ? `class="editable-cell" data-type="line_item" data-invoice-id="${invoiceIdAttr}" data-line-index="${lineIndex}" data-field="fo_no" title="Double click to edit"` : ''}>${(!item.fo_no || item.fo_no === '-') ? '<span style="color: var(--accent-red); font-weight: 600;" title="FO Number not tracked - Please re-upload document">- (Re-upload)</span>' : escapeHtml(item.fo_no)}</td>
        <td ${isEditable ? `class="editable-cell" data-type="line_item" data-invoice-id="${invoiceIdAttr}" data-line-index="${lineIndex}" data-field="description" title="Double click to edit"` : ''}>${escapeHtml(item.description || '-')}</td>
        <td ${isEditable ? `class="editable-cell" data-type="line_item" data-invoice-id="${invoiceIdAttr}" data-line-index="${lineIndex}" data-field="lr_no" title="Double click to edit"` : ''}>${escapeHtml(invoice.cn_lr_no || item.lr_no || '-')}</td>
        <td class="text-right ${isEditable ? 'editable-cell' : ''}" ${isEditable ? `data-type="line_item" data-invoice-id="${invoiceIdAttr}" data-line-index="${lineIndex}" data-field="freight" title="Double click to edit"` : ''}>${formatCurrency(invoice.bill_freight_val ?? item.freight ?? 0)}</td>
      `;

      tr.querySelectorAll('.editable-cell').forEach(cell => {
        cell.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          makeCellEditable(cell);
        });
      });

      lineItemsTableBody.appendChild(tr);
    });
  }

  // Render Attached PDF Receipt in Detailed Modal if available
  const pdfSection = document.getElementById('modal-invoice-pdf-section');
  const pdfContainer = document.getElementById('modal-pdf-attachment-status');
  if (pdfSection && pdfContainer) {
    if (invoice && invoice.pdf_url) {
      pdfSection.style.display = 'block';
      pdfContainer.innerHTML = `
        <div class="pdf-attachment-card">
          <div class="pdf-attachment-info">
            <i data-lucide="file-text" style="color: var(--accent-red); width: 24px; height: 24px;"></i>
            <div class="pdf-attachment-meta">
              <p>invoice_${escapeHtml(invoice.invoice_number)}.pdf</p>
              <span>Linked to Google Drive</span>
            </div>
          </div>
          <div class="pdf-attachment-actions" style="display: flex; gap: 8px;">
            <a href="${invoice.pdf_url}" target="_blank" class="btn btn-secondary btn-xs"><i data-lucide="external-link"></i> View</a>
            <button class="btn btn-danger btn-xs" id="btn-delete-pdf-attachment"><i data-lucide="trash-2"></i> Unlink</button>
          </div>
        </div>
      `;
      
      // Add unlink listener
      document.getElementById('btn-delete-pdf-attachment').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm("Unlink this invoice PDF? (Does not delete file from Google Drive)")) {
          state.invoices = state.invoices.map(inv => {
            if (inv.invoice_number === invoice.invoice_number) inv.pdf_url = '';
            return inv;
          });
          state.purchases = state.purchases.map(pur => {
            if (pur.party_inv_no === invoice.invoice_number) pur.pdf_url = '';
            return pur;
          });
          saveToLocalStorage();
          showToast("PDF unlinked from invoice record.", "success");
          openDetailedRecordModal(invoice.invoice_number);
          renderAllViews();
        }
      });
    } else {
      pdfSection.style.display = 'none';
      pdfContainer.innerHTML = '';
    }
    lucide.createIcons();
  }
}

function buildPurchaseDetailsView(purchase, groupRecords) {
  const container = document.getElementById('purchase-details-view');
  const editForm = document.getElementById('purchase-details-edit-form');

  container.innerHTML = '';
  editForm.innerHTML = '';

  if (!purchase) {
    container.innerHTML = `<div class="col-span-2 text-center text-muted py-3">No matching purchase ledger book entry found.</div>`;
    return;
  }

  // Deduplicate purchase records in the group (keep only the latest upload if duplicate rows exist)
  const seenVouchers = new Set();
  const dedupedGroup = [...groupRecords].reverse().filter(r => {
    const key = `${r.party_inv_no}|${r.net_payable}|${r.bill_freight_val}`;
    if (seenVouchers.has(key)) return false;
    seenVouchers.add(key);
    return true;
  }).reverse();

  // Calculate consolidated sums
  const totalFreight = dedupedGroup.reduce((sum, r) => sum + (r.bill_freight_val || 0), 0);
  const totalNet = dedupedGroup.reduce((sum, r) => sum + (r.net_payable || 0), 0);
  const totalTaxable = dedupedGroup.reduce((sum, r) => sum + (r.taxable_value || 0), 0);
  const totalInvoiceVal = dedupedGroup.reduce((sum, r) => sum + (r.total_invoice_value || 0), 0);

  // Retrieve GST values (CGST, SGST, IGST) from matching invoice or purchase record
  const matchingInv = [...state.invoices].reverse().find(i => String(i.invoice_number) === String(purchase.party_inv_no));
  const stCharges = purchase.st_charges || matchingInv?.st_charges || dedupedGroup.reduce((sum, r) => sum + (r.st_charges || 0), 0);

  // Parse foOrderValue
  let foOrderValue = purchase.fo_order_value || matchingInv?.fo_order_value || 0;

  // Gross base value includes ST Charges (Freight + ST Charges) - take max to support already-included ST charges
  const grossBaseValue = Math.max(foOrderValue, totalFreight + stCharges);
  
  // Align foOrderValue to include st charges
  foOrderValue = grossBaseValue;

  // Calculate GST values
  const invGst = matchingInv ? ((matchingInv.cgst || 0) + (matchingInv.sgst || 0) + (matchingInv.igst || 0)) : 0;
  const purGst = dedupedGroup.reduce((sum, r) => sum + (r.cgst || 0) + (r.sgst || 0) + (r.igst || 0) + (r.total_gst_value || 0), 0);
  const rawGst = Math.max(purGst, invGst);
  
  // Calculate GST percentage relative to freight
  const gstPercent = totalFreight > 0 ? (rawGst / totalFreight) : 0;
  
  // If GST is <= 5.5% (meaning it is a 5% RCM rate), skip adding it.
  const effectiveGst = (gstPercent <= 0.055 || rawGst <= 12) ? 0 : rawGst;

  // If GST is greater than 5% (gstPercent > 0.055), calculate TDS on totalFreight (bill_freight_val), otherwise on grossBaseValue
  const tdsBase = (gstPercent > 0.055) ? totalFreight : grossBaseValue;

  // Calculate TDS value to deduct
  const totalTdsValue = dedupedGroup.reduce((sum, r) => sum + (r.tds_value || 0), 0);
  const calculatedTds = tdsBase * (purchase.tds_percent || 0);
  // For GST bills (> 5% GST), recalculate TDS dynamically on freight to avoid wrong sheet/ERP value overrides
  const finalTds = (gstPercent > 0.055) ? calculatedTds : (totalTdsValue || calculatedTds);

  // Calculate Consolidated Net Payable (valueAfterTds) and Invoice Value (netAfterGst)
  let valueAfterTds, netAfterGst;
  if (gstPercent > 0.055) {
    valueAfterTds = totalFreight - finalTds;
    netAfterGst = valueAfterTds + effectiveGst + stCharges;
  } else {
    valueAfterTds = grossBaseValue - finalTds;
    netAfterGst = foOrderValue; // RCM/None/Lesser 5% GST: Invoice Value and FO Order Value are the same
  }

  const foNo = purchase.fo_no || matchingInv?.fo_no || '';
  const foRate = purchase.fo_rate || matchingInv?.fo_rate || 0;
  const foQty = purchase.fo_qty || matchingInv?.fo_qty || 0;

  // Pull all purchase rows that match this invoice number via dual-key search
  // (same logic as ERP booking: match by party_inv_no OR by our bill/present_our_invoice number)
  const invNoStr = String(purchase.party_inv_no || '').trim();

  // Derive our bill number the same way as the ERP booking tab
  const ourBillNoResolved = (() => {
    if (matchingInv?.our_bill_no && String(matchingInv.our_bill_no).trim() !== '') return String(matchingInv.our_bill_no).trim();
    if (purchase.our_bill_no && String(purchase.our_bill_no).trim() !== '') return String(purchase.our_bill_no).trim();
    if (purchase.present_our_invoice && String(purchase.present_our_invoice).trim() !== '') return String(purchase.present_our_invoice).trim();
    // Check line items on the matching invoice
    const lineItemOurNo = matchingInv?.line_items?.map(li => li.our_invoice_number).find(v => v && String(v).trim() !== '');
    if (lineItemOurNo) return String(lineItemOurNo).trim();
    // Parse LP-style bill numbers from AI summary
    const aiText = (purchase.ai_summary || matchingInv?.ai_summary || '');
    if (aiText) {
      const m = aiText.match(/([A-Z]{2,}[0-9A-Za-z-]{4,})\s+Validated/);
      if (m) return m[1];
      const mLP = aiText.match(/(LP[A-Za-z0-9-]+)/);
      if (mLP) return mLP[1];
      const mBS = aiText.match(/(BS[0-9]{5,})/i);
      if (mBS) return mBS[1];
    }
    return '';
  })();

  const allMatchedPurchases = state.purchases.filter(p => {
    const pInvNo = String(p.party_inv_no || '').trim();
    const pOurBill = String(p.present_our_invoice || p.our_bill_no || '').trim();
    const matchByInvNo = invNoStr && pInvNo && pInvNo === invNoStr;
    const matchByOurBill = ourBillNoResolved && pOurBill && pOurBill === ourBillNoResolved;
    return matchByInvNo || matchByOurBill;
  });

  const coalesceField = (key) =>
    purchase[key] ||
    allMatchedPurchases.map(p => p[key]).find(v => v && String(v).trim() !== '' && v !== '-') ||
    '';

  const coalescedProject      = coalesceField('project');
  const coalescedProjectCode  = coalesceField('project_code');
  const coalescedDeparment    = coalesceField('deparment');
  const coalescedDepermentCode = coalesceField('deperment_code');
  const coalescedTaxCritaria  = coalesceField('tax_critaria');
  const coalescedTaxCritariaName = coalesceField('tax_critaria_name');
  const coalescedServiceAccName = coalesceField('service_acc_name');
  const coalescedServiceAccCode = coalesceField('service_acc_code');
  const coalescedExpenseAccName = coalesceField('expense_acc_name');
  const coalescedExpenseAccCode = coalesceField('expense_acc_code');
  const coalescedSubAccName   = coalesceField('sub_acc_name');
  const coalescedSubAccCode   = coalesceField('sub_acc_code');
  const coalescedSacCode      = coalesceField('sac_code');
  const coalescedSeries       = coalesceField('series');
  const coalescedDivCode      = coalesceField('div_code');
  const coalescedAddonCode    = coalesceField('addon_code_str');
  const coalescedStaxCode     = coalesceField('stax_code_str');
  const coalescedOurRegAddr   = coalesceField('our_reg_addr');

  const fields = [
    { label: "Invoice Number", key: "party_inv_no", value: purchase.party_inv_no, type: "text" },
    { label: "Posting Date", key: "party_inv_date", value: purchase.party_inv_date, type: "date" },
    { label: "FO Number", key: "fo_no", value: foNo, type: "text" },
    { label: "FO Rate", key: "fo_rate", value: foRate, type: "number" },
    { label: "FO Qty", key: "fo_qty", value: foQty, type: "number" },
    { label: "FO Order Value (₹)", key: "fo_order_value", value: foOrderValue, type: "number" },
    { label: "Supplier Party", key: "party_name", value: purchase.party_name, type: "text" },
    { label: "Our Registration Address", key: "our_reg_addr", value: coalescedOurRegAddr, type: "text" },
    { label: "Tnature", key: "expense_acc_name", value: coalescedExpenseAccName, type: "text" },
    { label: "Expense Account Code", key: "expense_acc_code", value: coalescedExpenseAccCode, type: "text" },
    { label: "Sub Ledger Account", key: "sub_acc_name", value: coalescedSubAccName, type: "text" },
    { label: "Sub Account Code", key: "sub_acc_code", value: coalescedSubAccCode, type: "text" },
    { label: "Service Account", key: "service_acc_name", value: coalescedServiceAccName, type: "text" },
    { label: "Service Account Code", key: "service_acc_code", value: coalescedServiceAccCode, type: "text" },
    { label: "SAC Code", key: "sac_code", value: coalescedSacCode, type: "text" },
    { label: "Series", key: "series", value: coalescedSeries, type: "text" },
    { label: "Division", key: "div_code", value: coalescedDivCode, type: "text" },
    { label: "Addon Code", key: "addon_code_str", value: coalescedAddonCode, type: "text" },
    { label: "GST State Code", key: "stax_code_str", value: coalescedStaxCode, type: "text" },
    { label: "Consolidated Freight (₹)", key: "bill_freight_val", value: totalFreight, type: "number" },
    { label: "ST Charges (₹)", key: "st_charges", value: stCharges, type: "number" },
    { label: "Consolidated Net Payable (₹)", key: "taxable_value", value: valueAfterTds, type: "number" },
    { label: "Invoice Value (₹)", key: "net_payable", value: netAfterGst, type: "number" },
    { label: "TDS Percentage", key: "tds_percent", value: purchase.tds_percent, type: "number" },
    { label: "RCM Percentage", key: "rcm", value: purchase.rcm, type: "select", options: [
      { label: "5%", value: 0.05 },
      { label: "0%", value: 0 },
      { label: "12%", value: 0.12 }
    ]},
    // { label: "Project", key: "project", value: coalescedProject, type: "text" },
    // { label: "Project Code", key: "project_code", value: coalescedProjectCode, type: "text" },
    // { label: "Department", key: "deparment", value: coalescedDeparment, type: "text" },
    // { label: "Department Code", key: "deperment_code", value: coalescedDepermentCode, type: "text" },
    // { label: "Tax Criteria"c, key: "tax_critaria", value: coalescedTaxCritaria, type: "text" },
    // { label: "Tax Criteria Name", key: "tax_critaria_name", value: coalescedTaxCritariaName, type: "text" }
  ];

  fields.forEach(f => {
    // Read only view HTML
    const isFullWidth = f.key === 'ai_summary';
    const roVal = f.type === 'number' ? 
      (f.key === 'tds_percent' ? `${parseFloat(((f.value ?? 0) * 100).toFixed(4))}%` : 
       f.key === 'fo_qty' ? (f.value || 0) : 
       f.key === 'fo_rate' ? formatRate(f.value) : 
       formatCurrency(f.value)) : 
      (f.key === 'rcm' ? `${Math.round(f.value*100)}%` : 
       (f.type === 'date' ? formatDateToDDMMYYYY(f.value) : f.value || '-'));
    const valHtml = f.key === 'ai_summary' ? renderRichAiSummary(f.value) : escapeHtml(roVal);
    container.innerHTML += `
      <div class="read-only-field ${isFullWidth ? 'col-span-2' : ''}" ${isFullWidth ? 'style="grid-column: span 2;"' : ''}>
        <label>${f.label}</label>
        <div class="value" style="${isFullWidth ? 'background: var(--bg-darker); padding: 12px; border-radius: 6px; max-height: 450px; overflow-y: auto;' : ''}">${valHtml}</div>
      </div>
    `;

    // Edit form inputs HTML
    let inputHtml = '';
    if (f.type === 'select') {
      inputHtml = `<select name="pur_${f.key}" class="form-control">`;
      f.options.forEach(opt => {
        const sel = opt.value === f.value ? 'selected' : '';
        inputHtml += `<option value="${opt.value}" ${sel}>${opt.label}</option>`;
      });
      inputHtml += `</select>`;
    } else if (f.type === 'textarea') {
      inputHtml = `<textarea name="pur_${f.key}" class="form-control" rows="12" style="font-family: monospace; font-size: 0.925rem; line-height: 1.5; padding: 12px; background: var(--bg-darker); border-color: rgba(255,255,255,0.1); color: var(--text-main);">${escapeHtml(f.value || '')}</textarea>`;
    } else {
      inputHtml = `<input type="${f.type}" name="pur_${f.key}" value="${f.type === 'date' ? normalizeToISODate(f.value) : escapeHtml(String(f.value ?? ''))}" class="form-control" ${f.type === 'number' ? 'step="any"' : ''}>`;
    }

    editForm.innerHTML += `
      <div class="form-group ${isFullWidth ? 'col-span-2' : ''}" ${isFullWidth ? 'style="grid-column: span 2;"' : ''}>
        <label>${f.label}</label>
        ${inputHtml}
      </div>
    `;
  });

  const purchasePdfSection = document.getElementById('modal-purchase-pdf-section');
  const purchasePdfContainer = document.getElementById('modal-purchase-pdf-attachment-status');

  if (purchasePdfSection && purchasePdfContainer) {
    if (purchase && purchase.pdf_url) {
      purchasePdfSection.style.display = 'block';
      purchasePdfContainer.innerHTML = `
        <div class="pdf-attachment-card">
          <div class="pdf-attachment-info">
            <i data-lucide="file-text" style="color: var(--accent-red); width: 24px; height: 24px;"></i>
            <div class="pdf-attachment-meta">
              <p>purchase_${escapeHtml(purchase.party_inv_no || 'attachment')}.pdf</p>
              <span>Linked to Google Drive</span>
            </div>
          </div>
          <div class="pdf-attachment-actions" style="display: flex; gap: 8px;">
            <a href="${purchase.pdf_url}" target="_blank" class="btn btn-secondary btn-xs"><i data-lucide="external-link"></i> View PDF</a>
          </div>
        </div>
      `;
    } else {
      purchasePdfSection.style.display = 'none';
      purchasePdfContainer.innerHTML = '';
    }
  }

  // Shifted AI Summary containers rendering in Left Pane
  const aiSummarySection = document.getElementById('modal-ai-summary-section');
  const summaryView = document.getElementById('modal-ai-summary-view');
  const summaryEdit = document.getElementById('modal-ai-summary-edit-form');

  if (aiSummarySection) {
    if (!purchase) {
      aiSummarySection.style.display = 'none';
    } else {
      aiSummarySection.style.display = 'block';
      if (summaryView && summaryEdit) {
        const aiSummaryValue = purchase.ai_summary || '';
        summaryView.innerHTML = renderRichAiSummary(aiSummaryValue);
        summaryEdit.innerHTML = `
          <div class="form-group" style="margin-top: 10px;">
            <textarea name="pur_ai_summary" class="form-control" rows="12" style="font-family: monospace; font-size: 0.925rem; line-height: 1.5; padding: 12px; background: var(--bg-darker); border-color: rgba(255,255,255,0.1); color: var(--text-main); width: 100%; box-sizing: border-box;">${escapeHtml(aiSummaryValue)}</textarea>
          </div>
        `;
      }
    }
  }
}

function toggleEditMode(editActive) {
  const invView = document.getElementById('invoice-details-view');
  const invEdit = document.getElementById('invoice-details-edit-form');
  const purView = document.getElementById('purchase-details-view');
  const purEdit = document.getElementById('purchase-details-edit-form');

  const editInvBtn = document.getElementById('edit-invoice-pane-btn');
  const editPurBtn = document.getElementById('edit-purchase-pane-btn');
  
  const saveBtn = document.getElementById('save-edited-records-btn');
  const cancelBtn = document.getElementById('cancel-edit-btn');
  const printBtn = document.getElementById('print-invoice-btn');
  const deleteBtn = document.getElementById('delete-record-btn');

  const summaryView = document.getElementById('modal-ai-summary-view');
  const summaryEdit = document.getElementById('modal-ai-summary-edit-form');

  if (editActive) {
    invView.classList.add('hidden');
    invEdit.classList.remove('hidden');
    purView.classList.add('hidden');
    purEdit.classList.remove('hidden');

    if (summaryView) summaryView.classList.add('hidden');
    if (summaryEdit) summaryEdit.classList.remove('hidden');

    editInvBtn.classList.add('hidden');
    editPurBtn.classList.add('hidden');

    saveBtn.classList.remove('hidden');
    cancelBtn.classList.remove('hidden');
    printBtn.classList.add('hidden');
    deleteBtn.classList.add('hidden');
  } else {
    invView.classList.remove('hidden');
    invEdit.classList.add('hidden');
    purView.classList.remove('hidden');
    purEdit.classList.add('hidden');

    if (summaryView) summaryView.classList.remove('hidden');
    if (summaryEdit) summaryEdit.classList.add('hidden');

    editInvBtn.classList.remove('hidden');
    editPurBtn.classList.remove('hidden');

    saveBtn.classList.add('hidden');
    cancelBtn.classList.add('hidden');
    printBtn.classList.remove('hidden');
    deleteBtn.classList.remove('hidden');
  }
}

// Save detailed overrides from edit inputs or Raw JSON
function saveDetailFormOverrides() {
  const selectedId = state.selectedRecordId;
  const activeTabBtn = document.querySelector('.modal-tab-btn.active');
  const activeDetailTab = activeTabBtn ? activeTabBtn.dataset.detailTab : 'split-view';

  let invoice = null;
  let purchase = null;
  let invNumber = '';

  if (typeof selectedId === 'string' && (selectedId.startsWith('inv-') || selectedId.startsWith('pur-'))) {
    if (selectedId.startsWith('inv-')) {
      invoice = state.invoices.find(i => i.id === selectedId) || null;
      if (invoice) {
        invNumber = invoice.invoice_number;
        purchase = [...state.purchases].reverse().find(p => p.party_inv_no === invNumber && p.bill_freight_val === invoice.bill_freight_val)
                || [...state.purchases].reverse().find(p => p.party_inv_no === invNumber) || null;
      }
    } else {
      purchase = state.purchases.find(p => p.id === selectedId) || null;
      if (purchase) {
        invNumber = purchase.party_inv_no;
        invoice = [...state.invoices].reverse().find(i => i.invoice_number === invNumber && i.bill_freight_val === purchase.bill_freight_val)
               || [...state.invoices].reverse().find(i => i.invoice_number === invNumber) || null;
      }
    }
  } else {
    invNumber = selectedId;
    invoice = [...state.invoices].reverse().find(i => i.invoice_number === invNumber) || null;
    purchase = [...state.purchases].reverse().find(p => p.party_inv_no === invNumber) || null;
  }

  if (activeDetailTab === 'raw-json-view') {
    // Save using Raw JSON overrides
    try {
      const invoiceJsonText = document.getElementById('modal-raw-invoice-json').value.trim();
      const purchaseJsonText = document.getElementById('modal-raw-purchase-json').value.trim();

      const parsedInvoices = invoiceJsonText ? JSON.parse(invoiceJsonText) : [];
      const parsedPurchases = purchaseJsonText ? JSON.parse(purchaseJsonText) : [];

      const invoiceArray = Array.isArray(parsedInvoices) ? parsedInvoices : [parsedInvoices];
      const purchaseArray = Array.isArray(parsedPurchases) ? parsedPurchases : [parsedPurchases];

      if (invoiceArray.length > 0 && !invoiceArray[0].invoice_number) {
        throw new Error("Invoice records must contain at least an 'invoice_number' attribute.");
      }
      if (purchaseArray.length > 0 && !purchaseArray[0].party_inv_no) {
        throw new Error("Purchase records must contain at least a 'party_inv_no' attribute.");
      }

      // Filter out old records and replace with new ones
      state.invoices = [
        ...state.invoices.filter(i => invoice ? i.id !== invoice.id : i.invoice_number !== invNumber),
        ...invoiceArray
      ];

      state.purchases = [
        ...state.purchases.filter(p => purchase ? p.id !== purchase.id : p.party_inv_no !== invNumber),
        ...purchaseArray
      ];

      // Update current index selected
      if (invoiceArray.length > 0) {
        state.selectedRecordId = invoiceArray[0].id || invoiceArray[0].invoice_number;
      } else if (purchaseArray.length > 0) {
        state.selectedRecordId = purchaseArray[0].id || purchaseArray[0].party_inv_no;
      }

      saveToLocalStorage();

      // Trigger writebacks to Google Sheets database
      if (invoiceArray.length > 0) {
        sendSheetUpdate('invoice', invNumber, invoiceArray[0], invoiceArray[0]);
      }
      if (purchaseArray.length > 0) {
        sendSheetUpdate('purchase', invNumber, purchaseArray[0], purchaseArray[0]);
      }

      showToast("Raw JSON override applied successfully!", "success");
      openDetailedRecordModal(state.selectedRecordId);
      renderAllViews();

    } catch (err) {
      console.error(err);
      showToast(`JSON Override failed: ${err.message}`, "error");
    }
    return;
  }

  // Otherwise, save using Form input overrides (structured split pane)
  const getFormVal = (formId, name) => {
    let el = document.querySelector(`#${formId} [name="${name}"]`);
    if (!el) el = document.querySelector(`[name="${name}"]`);
    return el ? el.value : '';
  };

  // Modify invoice values
  let overrideInvNo = invNumber;
  if (invoice) {
    overrideInvNo = getFormVal('invoice-details-edit-form', 'inv_invoice_number') || invNumber;
    const overrideDate = getFormVal('invoice-details-edit-form', 'inv_invoice_date');
    const overrideBuyer = getFormVal('invoice-details-edit-form', 'inv_buyer_name');
    const overrideTransporter = getFormVal('invoice-details-edit-form', 'inv_transporter_name');
    const overrideGstin = getFormVal('invoice-details-edit-form', 'inv_transporter_gstin');
    const overridePlace = getFormVal('invoice-details-edit-form', 'inv_to_place_name');
    const overrideItem = getFormVal('invoice-details-edit-form', 'inv_item_name');
    const overrideFreight = parseFloat(getFormVal('invoice-details-edit-form', 'inv_bill_freight_val') || 0);
    const overrideStCharges = parseFloat(getFormVal('invoice-details-edit-form', 'inv_st_charges') || 0);
    const overrideTotalInvoiceVal = parseFloat(getFormVal('invoice-details-edit-form', 'inv_total_invoice_value') || 0);
    const overrideRcm = parseFloat(getFormVal('invoice-details-edit-form', 'inv_RCM') || 0);

    state.invoices = state.invoices.map(inv => {
      if (inv.id === invoice.id) {
        return {
          ...inv,
          invoice_number: overrideInvNo,
          invoice_date: overrideDate,
          party_name: overrideTransporter,
          buyer_name: overrideBuyer,
          transporter_name: overrideTransporter,
          transporter_gstin: overrideGstin,
          to_place_name: overridePlace,
          item_name: overrideItem,
          bill_freight_val: overrideFreight,
          st_charges: overrideStCharges,
          net_payable: overrideTotalInvoiceVal,
          total_invoice_value: overrideTotalInvoiceVal,
          RCM: overrideRcm
        };
      }
      return inv;
    });

    state.selectedRecordId = invoice.invoice_number;
  }

  // Modify Purchase values
  let overridePurNo = invNumber;
  if (purchase) {
    overridePurNo = getFormVal('purchase-details-edit-form', 'pur_party_inv_no') || overrideInvNo;
    const overrideDate = getFormVal('purchase-details-edit-form', 'pur_party_inv_date');
    const overrideSupplier = getFormVal('purchase-details-edit-form', 'pur_party_name');
    const overrideExpense = getFormVal('purchase-details-edit-form', 'pur_expense_acc_name');
    const overrideSub = getFormVal('purchase-details-edit-form', 'pur_sub_acc_name');
    const overrideService = getFormVal('purchase-details-edit-form', 'pur_service_acc_name');
    const overrideSac = getFormVal('purchase-details-edit-form', 'pur_sac_code');
    const overrideFreight = parseFloat(getFormVal('purchase-details-edit-form', 'pur_bill_freight_val') || 0);
    const overrideStCharges = parseFloat(getFormVal('purchase-details-edit-form', 'pur_st_charges') || 0);
    const overrideTaxable = parseFloat(getFormVal('purchase-details-edit-form', 'pur_taxable_value') || 0);
    const overrideNet = parseFloat(getFormVal('purchase-details-edit-form', 'pur_net_payable') || 0);
    const overrideTds = parseFloat(getFormVal('purchase-details-edit-form', 'pur_tds_percent') || 0);
    const overrideRcm = parseFloat(getFormVal('purchase-details-edit-form', 'pur_rcm') || 0);
    const overrideTotalInv = parseFloat(getFormVal('purchase-details-edit-form', 'pur_total_invoice_value') || 0);
    const overrideAiSummary = getFormVal('purchase-details-edit-form', 'pur_ai_summary');
    const overrideProject = getFormVal('purchase-details-edit-form', 'pur_project');
    const overrideProjectCode = getFormVal('purchase-details-edit-form', 'pur_project_code');
    const overrideDeparment = getFormVal('purchase-details-edit-form', 'pur_deparment');
    const overrideDepermentCode = getFormVal('purchase-details-edit-form', 'pur_deperment_code');
    const overrideTaxCritaria = getFormVal('purchase-details-edit-form', 'pur_tax_critaria');
    const overrideTaxCritariaName = getFormVal('purchase-details-edit-form', 'pur_tax_critaria_name');

    state.purchases = state.purchases.map(pur => {
      if (pur.id === purchase.id) {
        return {
          ...pur,
          party_inv_no: overridePurNo,
          party_inv_date: overrideDate,
          party_name: overrideSupplier,
          expense_acc_name: overrideExpense,
          sub_acc_name: overrideSub,
          service_acc_name: overrideService,
          sac_code: overrideSac,
          bill_freight_val: overrideFreight,
          st_charges: overrideStCharges,
          taxable_value: overrideTaxable,
          net_payable: overrideNet,
          tds_percent: overrideTds,
          rcm: overrideRcm,
          total_invoice_value: overrideTotalInv,
          ai_summary: overrideAiSummary,
          project: overrideProject,
          project_code: overrideProjectCode,
          deparment: overrideDeparment,
          deperment_code: overrideDepermentCode,
          tax_critaria: overrideTaxCritaria,
          tax_critaria_name: overrideTaxCritariaName
        };
      }
      return pur;
    });

    state.selectedRecordId = purchase.party_inv_no;
  }

  // Renaming linked entries on invoice number change to prevent broken matches
  if (invoice && purchase) {
    const finalNo = state.selectedRecordId === invoice.id ? overrideInvNo : overridePurNo;
    state.purchases = state.purchases.map(pur => {
      if (pur.id === purchase.id) {
        pur.party_inv_no = finalNo;
        pur.validated = true;
        pur.validation_timestamp = new Date().toISOString();
      }
      return pur;
    });
    state.invoices = state.invoices.map(inv => {
      if (inv.id === invoice.id) {
        inv.invoice_number = finalNo;
        inv.validated = true;
        inv.validation_timestamp = new Date().toISOString();
      }
      return inv;
    });
  } else {
    if (invoice) {
      state.invoices = state.invoices.map(inv => {
        if (inv.id === invoice.id) {
          inv.validated = true;
          inv.validation_timestamp = new Date().toISOString();
        }
        return inv;
      });
      const matchPur = state.purchases.find(p => p.party_inv_no === overrideInvNo);
      if (matchPur) matchPur.validated = true;
    }
    if (purchase) {
      state.purchases = state.purchases.map(pur => {
        if (pur.id === purchase.id) {
          pur.validated = true;
          pur.validation_timestamp = new Date().toISOString();
        }
        return pur;
      });
      const matchInv = state.invoices.find(i => i.invoice_number === overridePurNo);
      if (matchInv) matchInv.validated = true;
    }
  }

  // Trigger writebacks to Google Sheets database
  if (invoice) {
    const invoiceFields = {
      invoice_number: overrideInvNo,
      invoice_date: getFormVal('invoice-details-edit-form', 'inv_invoice_date'),
      party_name: getFormVal('invoice-details-edit-form', 'inv_transporter_name'),
      buyer_name: getFormVal('invoice-details-edit-form', 'inv_buyer_name'),
      transporter_name: getFormVal('invoice-details-edit-form', 'inv_transporter_name'),
      transporter_gstin: getFormVal('invoice-details-edit-form', 'inv_transporter_gstin'),
      to_place_name: getFormVal('invoice-details-edit-form', 'inv_to_place_name'),
      item_name: getFormVal('invoice-details-edit-form', 'inv_item_name'),
      bill_freight_val: parseFloat(getFormVal('invoice-details-edit-form', 'inv_bill_freight_val') || 0),
      st_charges: parseFloat(getFormVal('invoice-details-edit-form', 'inv_st_charges') || 0),
      net_payable: parseFloat(getFormVal('invoice-details-edit-form', 'inv_total_invoice_value') || 0),
      total_invoice_value: parseFloat(getFormVal('invoice-details-edit-form', 'inv_total_invoice_value') || 0),
      RCM: parseFloat(getFormVal('invoice-details-edit-form', 'inv_RCM') || 0)
    };
    sendSheetUpdate('invoice', invNumber, invoiceFields, invoice);
  }

  if (purchase) {
    const purchaseFields = {
      party_inv_no: overridePurNo,
      party_inv_date: getFormVal('purchase-details-edit-form', 'pur_party_inv_date'),
      party_name: getFormVal('purchase-details-edit-form', 'pur_party_name'),
      expense_acc_name: getFormVal('purchase-details-edit-form', 'pur_expense_acc_name'),
      sub_acc_name: getFormVal('purchase-details-edit-form', 'pur_sub_acc_name'),
      service_acc_name: getFormVal('purchase-details-edit-form', 'pur_service_acc_name'),
      sac_code: getFormVal('purchase-details-edit-form', 'pur_sac_code'),
      bill_freight_val: parseFloat(getFormVal('purchase-details-edit-form', 'pur_bill_freight_val') || 0),
      st_charges: parseFloat(getFormVal('purchase-details-edit-form', 'pur_st_charges') || 0),
      taxable_value: parseFloat(getFormVal('purchase-details-edit-form', 'pur_taxable_value') || 0),
      net_payable: parseFloat(getFormVal('purchase-details-edit-form', 'pur_net_payable') || 0),
      tds_percent: parseFloat(getFormVal('purchase-details-edit-form', 'pur_tds_percent') || 0),
      rcm: parseFloat(getFormVal('purchase-details-edit-form', 'pur_rcm') || 0),
      total_invoice_value: parseFloat(getFormVal('purchase-details-edit-form', 'pur_total_invoice_value') || 0),
      ai_summary: getFormVal('purchase-details-edit-form', 'pur_ai_summary'),
      project: getFormVal('purchase-details-edit-form', 'pur_project'),
      project_code: getFormVal('purchase-details-edit-form', 'pur_project_code'),
      deparment: getFormVal('purchase-details-edit-form', 'pur_deparment'),
      deperment_code: getFormVal('purchase-details-edit-form', 'pur_deperment_code'),
      tax_critaria: getFormVal('purchase-details-edit-form', 'pur_tax_critaria'),
      tax_critaria_name: getFormVal('purchase-details-edit-form', 'pur_tax_critaria_name')
    };
    sendSheetUpdate('purchase', invNumber, purchaseFields, purchase);
  }

  saveToLocalStorage();
  showToast("Record parameters successfully saved!", "success");
  
  // Re-open/refresh modal
  openDetailedRecordModal(state.selectedRecordId);
  renderAllViews();
}

async function sendSheetUpdate(type, partyInvNo, fields, record = null) {
  if (!partyInvNo) return;
  
  const mappedUpdates = {};
  Object.entries(fields).forEach(([key, val]) => {
    let mappedKey = key;
    if (type === 'purchase') {
      if (key === 'st_charges') mappedKey = 'total_st_charges';
      if (key === 'ai_summary') mappedKey = 'AI SUMMRY';
    } else if (type === 'invoice') {
      if (key === 'invoice_number') mappedKey = 'party_inv_no';
    }
    mappedUpdates[mappedKey] = val;
  });

  // Use our_bill_no as search for invoice if available
  const searchCol = (type === 'invoice' && record && record.our_bill_no) ? 'our_bill_no' : 'party_inv_no';
  const searchVal = (type === 'invoice' && record && record.our_bill_no) ? record.our_bill_no : partyInvNo;

  // Include line_items in updates if record has them
  if (record && record.line_items && Array.isArray(record.line_items)) {
    mappedUpdates.line_items = record.line_items;
  }

  const payload = {
    sheetName: type === 'invoice' ? 'Invoice_Items' : 'Purchase_data',
    searchColumn: searchCol,
    searchValue: searchVal,
    updates: mappedUpdates
  };

  console.log(`Sending sheet update for ${type}:`, payload);

  try {
    const res = await fetch(`${SERVER_BASE_URL}/api/update-record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success || result.status === 'success') {
      showToast("Spreadsheet updated successfully!", "success");
    } else {
      throw new Error(result.message || 'unknown response');
    }
  } catch (e) {
    console.warn("Server proxy failed, trying direct browser writeback:", e);
    try {
      const directUrl = 'https://script.google.com/macros/s/AKfycbyfkvGhPuaVPFe62kyDhCSbKm4UwJ-Rbmr6KQfHfJjtE_Dp9E5dGdB1Bq1NS1r15U4e/exec';
      await fetch(directUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      });
      showToast("Spreadsheet updated directly!", "success");
    } catch (directError) {
      console.error("Direct update fallback failed:", directError);
      showToast("Could not sync edit to Google Sheets.", "warning");
    }
  }
}

async function deleteActiveRecord() {
  const key = state.selectedRecordId;
  await deleteInvoiceRecord(key);
  
  // Close modal
  document.getElementById('detail-modal').classList.remove('active');
}

async function deleteInvoiceRecord(target) {
  let invoiceNumber = target;
  if (typeof target === 'string' && (target.startsWith('inv-') || target.startsWith('pur-'))) {
    if (target.startsWith('inv-')) {
      const inv = state.invoices.find(i => i.id === target);
      if (inv) invoiceNumber = inv.invoice_number;
    } else {
      const pur = state.purchases.find(p => p.id === target);
      if (pur) invoiceNumber = pur.party_inv_no;
    }
  }

  if (!confirm(`Delete invoice "${invoiceNumber}" and all linked purchase records?`)) return;

  showToast(`Deleting invoice ${invoiceNumber} from Google Sheets...`, "warning");

  try {
    const response = await fetch(`${SERVER_BASE_URL}/api/delete-invoice/${encodeURIComponent(invoiceNumber)}`, {
      method: 'DELETE'
    });
    
    const result = await response.json();
    if (result.success) {
      showToast(`Record ${invoiceNumber} deleted from Google Sheets!`, "success");
      
      state.invoices = state.invoices.filter(i => i.invoice_number !== invoiceNumber);
      state.purchases = state.purchases.filter(p => p.party_inv_no !== invoiceNumber);

      if (!state.deletedInvoices.includes(invoiceNumber)) {
        state.deletedInvoices.push(invoiceNumber);
      }

      saveToLocalStorage();
      
      // Trigger a live data reload to refresh database from sheet
      await syncWithAPI(false);
    } else {
      showToast(`Spreadsheet delete failed: ${result.message || 'Unknown error'}`, "error");
    }
  } catch (err) {
    console.error(err);
    showToast(`Error deleting record: cannot reach backend server.`, "error");
  }
  
  renderAllViews();
}

async function validateActiveBill() {
  const selectedId = state.selectedRecordId;
  
  if (!selectedId) {
    showToast("No bill selected to validate", "error");
    return;
  }

  let invoice = null;
  let purchase = null;
  let invoiceNumber = '';

  if (typeof selectedId === 'string' && (selectedId.startsWith('inv-') || selectedId.startsWith('pur-'))) {
    if (selectedId.startsWith('inv-')) {
      invoice = state.invoices.find(i => i.id === selectedId) || null;
      if (invoice) {
        invoiceNumber = invoice.invoice_number;
        purchase = [...state.purchases].reverse().find(p => p.party_inv_no === invoiceNumber && p.bill_freight_val === invoice.bill_freight_val)
                || [...state.purchases].reverse().find(p => p.party_inv_no === invoiceNumber) || null;
      }
    } else {
      purchase = state.purchases.find(p => p.id === selectedId) || null;
      if (purchase) {
        invoiceNumber = purchase.party_inv_no;
        invoice = [...state.invoices].reverse().find(i => i.invoice_number === invoiceNumber && i.bill_freight_val === purchase.bill_freight_val)
               || [...state.invoices].reverse().find(i => i.invoice_number === invoiceNumber) || null;
      }
    }
  } else {
    invoiceNumber = selectedId;
    invoice = [...state.invoices].reverse().find(i => i.invoice_number === invoiceNumber) || null;
    purchase = [...state.purchases].reverse().find(p => p.party_inv_no === invoiceNumber) || null;
  }

  // Mark only the matched records as validated
  const nowStr = new Date().toISOString();
  if (invoice) {
    invoice.validated = true;
    invoice.validation_timestamp = nowStr;
  }
  if (purchase) {
    purchase.validated = true;
    purchase.validation_timestamp = nowStr;
    if (purchase.ai_summary) {
      purchase.ai_summary = purchase.ai_summary
        .replace(/Status:\s*FAILED/i, 'Status: PASSED')
        .replace(/^Failed:[\s\S]*?^={2,}/m, 'Failed:\nNone\n\n====================================')
        .replace(/\bfailed\s*:\s*\d+\b/i, 'Failed: 0')
        .replace(/✖/g, '✔');
    }
  }

  saveToLocalStorage();
  renderAllViews();

  showToast(`✓ Bill ${invoiceNumber} has been validated successfully!`, "success");

  // Push validation status globally back to Google Sheets database
  const updatePayload = {
    validated: 'true',
    validation_timestamp: nowStr
  };
  const purchasePayload = {
    ...updatePayload,
    ...(purchase && purchase.ai_summary ? { ai_summary: purchase.ai_summary } : {})
  };
  if (invoice) {
    sendSheetUpdate('invoice', invoice.invoice_number, updatePayload, invoice);
  }
  if (purchase) {
    sendSheetUpdate('purchase', purchase.party_inv_no, purchasePayload, purchase);
  }

  // Update the modal status badge
  const statusBadge = document.getElementById('modal-badge-status');
  if (statusBadge) {
    statusBadge.textContent = 'Validated';
    statusBadge.className = 'badge badge-green';
  }
  
  // Optionally close after validation
  setTimeout(() => {
    const modal = document.getElementById('detail-modal');
    if (modal) modal.classList.remove('active');
  }, 1800);
}

// ==========================================================================
// FORM ADD NEW RECORD LOGIC
// ==========================================================================
function submitNewManualRecord() {
  const form = document.getElementById('add-record-form');
  const formData = new FormData(form);

  const invoiceNumber = formData.get('invoice_number');
  const partyName = formData.get('party_name');

  if (!invoiceNumber || !partyName) {
    showToast("Please enter Invoice Number and Party Name.", "error");
    return;
  }

  // Create Invoice shipment entry
  const newInv = {
    id: `inv-manual-${Date.now()}`,
    invoice_number: invoiceNumber,
    invoice_date: formData.get('invoice_date'),
    party_name: partyName,
    buyer_name: formData.get('buyer_name'),
    transporter_name: partyName,
    transporter_gstin: '',
    to_place_name: '',
    address: '',
    item_name: '',
    drum_qty: '',
    lorry_vehicle_no: formData.get('lorry_vehicle_no'),
    bill_freight_val: parseFloat(formData.get('bill_freight_val') || 0),
    net_payable: parseFloat(formData.get('net_payable') || 0),
    RCM: parseFloat(formData.get('RCM') || 0),
    series: 'INWARD',
    div_code: 'UNIT1',
    line_items: []
  };

  // Create Purchase posting entry
  const newPur = {
    id: `pur-manual-${Date.now()}`,
    party_inv_no: invoiceNumber,
    party_inv_date: formData.get('invoice_date'),
    party_name: partyName,
    tnature: formData.get('tnature'),
    expense_acc_name: formData.get('expense_acc_name'),
    sub_acc_name: formData.get('sub_acc_name'),
    service_acc_name: formData.get('service_acc_name'),
    sac_code: formData.get('sac_code'),
    bill_freight_val: parseFloat(formData.get('bill_freight_val') || 0),
    taxable_value: parseFloat(formData.get('taxable_value') || 0),
    tds_percent: parseFloat(formData.get('tds_percent') || 0),
    net_payable: parseFloat(formData.get('net_payable') || 0),
    rcm: parseFloat(formData.get('RCM') || 0)
  };

  state.invoices.push(newInv);
  state.purchases.push(newPur);

  saveToLocalStorage();

  // Call Google Sheets writeback for both invoice and purchase manually created records
  sendSheetUpdate('invoice', invoiceNumber, {
    invoice_number: invoiceNumber,
    invoice_date: formData.get('invoice_date'),
    party_name: partyName,
    buyer_name: formData.get('buyer_name'),
    transporter_name: partyName,
    lorry_vehicle_no: formData.get('lorry_vehicle_no'),
    bill_freight_val: parseFloat(formData.get('bill_freight_val') || 0),
    net_payable: parseFloat(formData.get('net_payable') || 0),
    RCM: parseFloat(formData.get('RCM') || 0)
  }, newInv);

  sendSheetUpdate('purchase', invoiceNumber, {
    party_inv_no: invoiceNumber,
    party_inv_date: formData.get('invoice_date'),
    party_name: partyName,
    tnature: formData.get('tnature'),
    expense_acc_name: formData.get('expense_acc_name'),
    sub_acc_name: formData.get('sub_acc_name'),
    service_acc_name: formData.get('service_acc_name'),
    sac_code: formData.get('sac_code'),
    bill_freight_val: parseFloat(formData.get('bill_freight_val') || 0),
    taxable_value: parseFloat(formData.get('taxable_value') || 0),
    tds_percent: parseFloat(formData.get('tds_percent') || 0),
    net_payable: parseFloat(formData.get('net_payable') || 0),
    rcm: parseFloat(formData.get('RCM') || 0)
  }, newPur);

  showToast(`Record ${invoiceNumber} created!`, "success");

  // Close & reset
  document.getElementById('add-record-modal').classList.remove('active');
  form.reset();
  
  renderAllViews();
}

// ==========================================================================
// INTERACTIVE NAVIGATION, TABS & EVENTS SETUP
// ==========================================================================
function initTabs() {
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Toggle sidebar focus
      document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      // Toggle tab content display
      const tabId = item.dataset.tab;
      state.activeTab = tabId;

      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      document.getElementById(`tab-${tabId}`).classList.add('active');
      
      renderAllViews();
    });
  });

  // Setup dashboard Warnings button redirect
  document.getElementById('view-all-reconciliations-btn').addEventListener('click', () => {
    document.querySelector('.menu-item[data-tab="reconciliation"]').click();
  });
}

function initThemeToggle() {
  const toggleBtn = document.getElementById('theme-toggle-btn');
  toggleBtn.addEventListener('click', () => {
    if (state.theme === 'dark') {
      state.theme = 'light';
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
    } else {
      state.theme = 'dark';
      document.body.classList.remove('light-theme');
      document.body.classList.add('dark-theme');
    }
    localStorage.setItem('app_theme', state.theme);
    showToast(`Switched to ${state.theme} mode.`, 'success');
    renderAllViews(); // redraw charts with style changes
  });
}

function initSettingsActions() {
  // Show server status in settings
  const statusEl = document.getElementById('settings-data-source');
  if (statusEl) {
    statusEl.textContent = `Node.js Server (port ${SERVER_BASE_URL.split(':')[2] || (SERVER_BASE_URL.startsWith('https') ? '443' : '80')})`;
  }

  // Clear database overrides
  document.getElementById('clear-local-cache-btn').addEventListener('click', () => {
    if (confirm("Reset database? This deletes all custom changes and manual overrides.")) {
      localStorage.removeItem('db_invoices');
      localStorage.removeItem('db_purchases');
      localStorage.removeItem('db_deleted_invoices');
      loadLocalDatabase();
      renderAllViews();
    }
  });

  // Download local database
  document.getElementById('download-json-backup-btn').addEventListener('click', () => {
    const databaseExport = {
      invoices: state.invoices,
      purchases: state.purchases,
      timestamp: new Date().toISOString()
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(databaseExport, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href",     dataStr);
    downloadAnchor.setAttribute("download", `invoice_database_backup_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });
}

function initUploadActions() {
  const select = document.getElementById('upload-link-invoice');
  const dropzone = document.getElementById('pdf-upload-dropzone');
  const fileInput = document.getElementById('pdf-file-input');
  const billTypeSelect = document.getElementById('upload-bill-type');
  const driveFolderLink = document.getElementById('open-drive-folder-link');

  if (!dropzone || !fileInput) return;

  if (billTypeSelect && driveFolderLink) {
    const sharedFolderUrl = 'https://drive.google.com/drive/folders/1gTwzZ76i7saaiEiM_cd09LSL1IiAospQ';
    driveFolderLink.href = sharedFolderUrl;
    billTypeSelect.addEventListener('change', () => {
      driveFolderLink.href = sharedFolderUrl;
    });
  }

  // Click to browse
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleUploadFile(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  // Drag events
  let dragCounter = 0;

  dropzone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    dropzone.classList.add('drag-active');
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter === 0) {
      dropzone.classList.remove('drag-active');
    }
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    dropzone.classList.remove('drag-active');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleUploadFile(files[0]);
    }
  });
}

function handleUploadFile(file) {
  // Validate file type and size
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    showToast('Only PDF files are accepted.', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('File exceeds 10MB limit.', 'error');
    return;
  }

  const uploadSelect = document.getElementById('upload-link-invoice');
  const invoiceNumber = uploadSelect ? uploadSelect.value : 'UNKNOWN';
  const progressBox = document.getElementById('global-upload-progress-box');
  const progressBar = document.getElementById('progress-bar-indicator');
  const progressPercent = document.getElementById('progress-percentage');
  const progressFilename = document.getElementById('progress-filename');
  const logList = document.getElementById('upload-log-list');

  progressBox.classList.remove('hidden');
  progressFilename.textContent = file.name;
  progressBar.style.width = '10%';
  progressPercent.textContent = '10%';

  const billType = document.getElementById('upload-bill-type').value || 'interlock';
  const formData = new FormData();
  formData.append('file', file);
  formData.append('invoiceNumber', invoiceNumber);
  formData.append('billType', billType);

  const xhr = new XMLHttpRequest();

  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 80);
      progressBar.style.width = pct + '%';
      progressPercent.textContent = pct + '%';
    }
  });

  xhr.addEventListener('load', () => {
    progressBar.style.width = '100%';
    progressPercent.textContent = '100%';

    try {
      const data = JSON.parse(xhr.responseText);
      if (data.success) {
        showToast(`${file.name} uploaded to Google Drive!`, 'success');
        addUploadLog(file.name, 'success', data.fileUrl || '');

        const uploadedEntry = {
          id: `uploaded-${Date.now()}`,
          title: file.name,
          url: data.fileUrl || '',
          source: 'Upload Center',
          recordId: invoiceNumber || 'General',
          filename: file.name,
          uploadedAt: new Date().toISOString()
        };

        state.uploadedPdfs = [uploadedEntry, ...state.uploadedPdfs.filter(item => !(item.url === uploadedEntry.url && item.title === uploadedEntry.title))];

        // Link the URL to the matched invoice in local state!
        if (invoiceNumber && invoiceNumber !== 'UNKNOWN') {
          let linked = false;
          state.invoices = state.invoices.map(inv => {
            if (inv.invoice_number === invoiceNumber) {
              inv.pdf_url = data.fileUrl || '';
              linked = true;
            }
            return inv;
          });
          state.purchases = state.purchases.map(pur => {
            if (pur.party_inv_no === invoiceNumber) {
              pur.pdf_url = data.fileUrl || '';
              linked = true;
            }
            return pur;
          });
          if (linked) {
            showToast(`Linked PDF to record ${invoiceNumber}`, 'success');
          }
        }

        mergeUploadedPdfsFromRecords();
        saveToLocalStorage();
        renderAllViews();
      } else {
        showToast(`Upload failed: ${data.error || 'Unknown error'}`, 'error');
        addUploadLog(file.name, 'error');
      }
    } catch {
      showToast(`Upload failed: ${xhr.responseText}`, 'error');
      addUploadLog(file.name, 'error');
    }

    setTimeout(() => {
      progressBox.classList.add('hidden');
      progressBar.style.width = '0%';
      progressPercent.textContent = '0%';
    }, 3000);
  });

  xhr.addEventListener('error', () => {
    showToast('Upload failed — cannot reach server.', 'error');
    addUploadLog(file.name, 'error');
    setTimeout(() => {
      progressBox.classList.add('hidden');
      progressBar.style.width = '0%';
      progressPercent.textContent = '0%';
    }, 3000);
  });

  xhr.open('POST', `${SERVER_BASE_URL}/upload`);
  xhr.send(formData);
}

function addUploadLog(filename, type, fileUrl) {
  const logList = document.getElementById('upload-log-list');
  const emptyMsg = logList.querySelector('.text-center.text-muted');
  if (emptyMsg) emptyMsg.remove();

  const item = document.createElement('div');
  item.className = 'upload-log-item';
  const icon = type === 'success' ? 'check-circle' : 'x-circle';
  const color = type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)';
  const label = type === 'success' ? 'Uploaded' : 'Failed';

  item.innerHTML = `
    <div class="upload-log-item-details">
      <i data-lucide="${icon}" style="color: ${color};"></i>
      <div class="upload-log-item-info">
        <p>${escapeHtml(filename)}</p>
        <span>${label} — ${new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  `;

  logList.prepend(item);
  lucide.createIcons();
}

function initSearchAndFilters() {
  // Global search top bar
  const globalSearch = document.getElementById('global-search-input');
  globalSearch.addEventListener('input', () => {
    const q = globalSearch.value.toLowerCase();
    
    // Auto shift search values depending on active menu tab
    if (state.activeTab === 'invoices') {
      document.getElementById('inv-filter-search').value = q;
      renderInvoicesLedger();
    } else if (state.activeTab === 'purchases') {
      document.getElementById('pur-filter-search').value = q;
      renderPurchasesLedger();
    } else if (state.activeTab === 'reconciliation') {
      document.getElementById('recon-search-input').value = q;
      renderReconciliation();
    }
  });

  // INVOICES FILTER ACTIONS
  const invSearch = document.getElementById('inv-filter-search');
  const invParty = document.getElementById('inv-filter-party');
  const invVehicle = document.getElementById('inv-filter-vehicle');
  const invDivision = document.getElementById('inv-filter-division');

  const triggerInvFilters = () => {
    renderInvoicesLedger();
  };

  invSearch.addEventListener('input', triggerInvFilters);
  invParty.addEventListener('change', triggerInvFilters);
  invVehicle.addEventListener('change', triggerInvFilters);
  invDivision.addEventListener('change', triggerInvFilters);

  document.getElementById('clear-inv-filters').addEventListener('click', () => {
    invSearch.value = '';
    invParty.value = '';
    invVehicle.value = '';
    invDivision.value = '';
    renderInvoicesLedger();
  });

  // PURCHASES FILTER ACTIONS
  const purSearch = document.getElementById('pur-filter-search');
  const purParty = document.getElementById('pur-filter-party');
  const purExpense = document.getElementById('pur-filter-expense');
  const purDivision = document.getElementById('pur-filter-division');

  const triggerPurFilters = () => {
    renderPurchasesLedger();
  };

  purSearch.addEventListener('input', triggerPurFilters);
  purParty.addEventListener('change', triggerPurFilters);
  purExpense.addEventListener('change', triggerPurFilters);
  purDivision.addEventListener('change', triggerPurFilters);

  document.getElementById('clear-pur-filters').addEventListener('click', () => {
    purSearch.value = '';
    purParty.value = '';
    purExpense.value = '';
    purDivision.value = '';
    renderPurchasesLedger();
  });

  // RECONCILIATION SUBTABS FILTER
  document.querySelectorAll('.recon-filters .btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.recon-filters .btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderReconciliation();
    });
  });

  document.getElementById('recon-search-input').addEventListener('input', () => {
    renderReconciliation();
  });

  // Export CSV
  document.getElementById('export-reconciliation-btn').addEventListener('click', exportReconciliationToCSV);

  // Sync button action with confirmation prompt
  document.getElementById('sync-data-btn').addEventListener('click', () => {
    if (confirm("Warning: Fetching live data will overwrite all your custom typing overrides and manual modifications. Do you want to proceed?")) {
      syncWithAPI(true);
    }
  });
  
  // Populate filter selectors options once data loaded
  populateSelectorsOptions();
}

function populateSelectorsOptions() {
  const invParties = new Set(), invVehicles = new Set(), invDivs = new Set();
  const purParties = new Set(), purExpenses = new Set(), purDivs = new Set();

  state.invoices.forEach(i => {
    if (i.party_name) invParties.add(i.party_name);
    if (i.lorry_vehicle_no) invVehicles.add(i.lorry_vehicle_no);
    if (i.div_code) invDivs.add(i.div_code);
  });

  state.purchases.forEach(p => {
    if (p.party_name) purParties.add(p.party_name);
    if (p.expense_acc_name) purExpenses.add(p.expense_acc_name);
    if (p.div_code) purDivs.add(p.div_code);
  });

  const populateSelect = (elId, values) => {
    const el = document.getElementById(elId);
    el.innerHTML = '<option value="">All Fields</option>';
    values.forEach(val => {
      el.innerHTML += `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`;
    });
  };

  populateSelect('inv-filter-party', Array.from(invParties).sort());
  populateSelect('inv-filter-vehicle', Array.from(invVehicles).sort());
  populateSelect('inv-filter-division', Array.from(invDivs).sort());

  populateSelect('pur-filter-party', Array.from(purParties).sort());
  populateSelect('pur-filter-expense', Array.from(purExpenses).sort());
  populateSelect('pur-filter-division', Array.from(purDivs).sort());

  // Populate Upload Center select dropdown
  const uploadSelect = document.getElementById('upload-link-invoice');
  if (uploadSelect) {
    uploadSelect.innerHTML = '<option value="">Select Invoice No...</option>';
    const uniqueInvNos = Array.from(new Set([
      ...state.invoices.map(i => i.invoice_number),
      ...state.purchases.map(p => p.party_inv_no)
    ].filter(Boolean))).sort();
    
    uniqueInvNos.forEach(no => {
      uploadSelect.innerHTML += `<option value="${escapeHtml(no)}">${escapeHtml(no)}</option>`;
    });
  }
}

function initModalActions() {
  const closeBtn = document.getElementById('btn-close-detail-modal');
  const modal = document.getElementById('detail-modal');

  const closeModal = () => modal.classList.remove('active');
  closeBtn.addEventListener('click', closeModal);
  
  // Close if click outside card container
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Edit action pane buttons
  document.getElementById('edit-invoice-pane-btn').addEventListener('click', () => toggleEditMode(true));
  document.getElementById('edit-purchase-pane-btn').addEventListener('click', () => toggleEditMode(true));
  
  document.getElementById('cancel-edit-btn').addEventListener('click', () => toggleEditMode(false));
  document.getElementById('save-edited-records-btn').addEventListener('click', saveDetailFormOverrides);
  
  document.getElementById('delete-record-btn').addEventListener('click', deleteActiveRecord);
  
  document.getElementById('print-invoice-btn').addEventListener('click', () => {
    window.print();
  });

  document.getElementById('validate-bill-btn').addEventListener('click', validateActiveBill);

  // PDF Viewer Popup Modal Actions
  const closePdfBtn = document.getElementById('btn-close-pdf-viewer-modal');
  const pdfViewerModal = document.getElementById('pdf-viewer-modal');
  if (closePdfBtn && pdfViewerModal) {
    const closePdfModal = () => {
      pdfViewerModal.classList.remove('active');
      const body = document.getElementById('pdf-viewer-body');
      if (body) body.innerHTML = `<iframe id="pdf-viewer-iframe" src="about:blank" style="width: 100%; height: 100%; border: none; display: block;"></iframe>`;
    };
    closePdfBtn.addEventListener('click', closePdfModal);
    pdfViewerModal.addEventListener('click', (e) => {
      if (e.target === pdfViewerModal) closePdfModal();
    });
  }
}

function initAddRecordActions() {
  const openBtn = document.getElementById('add-record-btn');
  const closeBtn = document.getElementById('btn-close-add-modal');
  const modal = document.getElementById('add-record-modal');
  const cancelBtn = document.getElementById('btn-cancel-add-record');
  const submitBtn = document.getElementById('btn-submit-add-record');

  const openModal = () => modal.classList.add('active');
  const closeModal = () => modal.classList.remove('active');

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  submitBtn.addEventListener('click', submitNewManualRecord);

  // Tab section switcher inside add manual record form
  document.querySelectorAll('.form-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.form-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.dataset.formTab;
      document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
      const targetSection = document.getElementById(`form-section-${target}`);
      if (targetSection) targetSection.classList.add('active');
    });
  });
}

// Export CSV Utilities
function exportReconciliationToCSV() {
  const data = calculateReconciliationData();
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Invoice Number,Party Name,Invoice Net Amount,Purchase Net Amount,Difference,RCM Rate Match,Status,Warnings\n";

  data.forEach(r => {
    const diff = r.invoice_net - r.purchase_net;
    const rcmMatch = r.invoice_rcm === r.purchase_rcm ? "Yes" : "No";
    const row = [
      `"${r.invoice_number}"`,
      `"${r.party_name}"`,
      r.invoice_net,
      r.purchase_net,
      diff,
      rcmMatch,
      `"${r.status}"`,
      `"${r.notes}"`
    ].join(",");
    csvContent += row + "\n";
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `ledger_reconciliation_report_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast("Reconciliation report exported to CSV!", "success");
}

// ==========================================================================
// CORE SYSTEM TOAST NOTIFICATIONS & UTILITY SCRIPTS
// ==========================================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle2';
  if (type === 'warning') iconName = 'alert-triangle';
  if (type === 'error') iconName = 'x-circle';

  toast.innerHTML = `
    <div class="toast-content">
      <i data-lucide="${iconName}"></i>
      <span class="toast-message">${escapeHtml(message)}</span>
    </div>
    <button class="toast-close">&times;</button>
  `;

  container.appendChild(toast);
  lucide.createIcons();

  // Close button trigger
  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.remove();
  });

  // Autoremove in 5 seconds
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 5000);
}

function formatCurrency(val) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(val || 0);
}

function formatRate(val) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(val || 0);
}

function formatDateToDDMMYYYY(dateInput) {
  if (!dateInput) return '-';
  
  if (/^\d{2}-\d{2}-\d{4}$/.test(dateInput)) {
    return dateInput;
  }
  
  const cleanDateInput = String(dateInput).split('T')[0];
  
  const matchYMD = cleanDateInput.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (matchYMD) {
    const year = matchYMD[1];
    const month = matchYMD[2];
    const day = matchYMD[3];
    return `${day}-${month}-${year}`;
  }
  
  const matchDMY = cleanDateInput.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (matchDMY) {
    const day = matchDMY[1];
    const month = matchDMY[2];
    const year = matchDMY[3];
    return `${day}-${month}-${year}`;
  }
  
  try {
    const date = new Date(dateInput);
    if (!isNaN(date.getTime())) {
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    }
  } catch (e) {
    console.error('Error parsing date:', e);
  }
  
  return dateInput;
}

function initDetailModalTabs() {
  document.querySelectorAll('[data-detail-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-detail-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetTab = btn.dataset.detailTab;
      const splitSection = document.getElementById('detail-section-split-view');
      const jsonSection = document.getElementById('detail-section-raw-json-view');
      const erpSection = document.getElementById('detail-section-erp-rows-view');
      
      const saveBtn = document.getElementById('save-edited-records-btn');
      const cancelBtn = document.getElementById('cancel-edit-btn');
      const printBtn = document.getElementById('print-invoice-btn');
      const editInvBtn = document.getElementById('edit-invoice-pane-btn');
      const editPurBtn = document.getElementById('edit-purchase-pane-btn');

      if (targetTab === 'raw-json-view') {
        splitSection.style.display = 'none';
        jsonSection.style.display = 'block';
        if (erpSection) erpSection.style.display = 'none';

        // In JSON tab, show Save/Cancel immediately and hide Edit buttons
        saveBtn.classList.remove('hidden');
        cancelBtn.classList.remove('hidden');
        printBtn.classList.add('hidden');
        editInvBtn.classList.add('hidden');
        editPurBtn.classList.add('hidden');
      } else if (targetTab === 'erp-rows-view') {
        splitSection.style.display = 'none';
        jsonSection.style.display = 'none';
        if (erpSection) erpSection.style.display = 'block';

        // In ERP tab, hide save/cancel/edit/print actions since it is a generated read-only view
        saveBtn.classList.add('hidden');
        cancelBtn.classList.add('hidden');
        printBtn.classList.add('hidden');
        editInvBtn.classList.add('hidden');
        editPurBtn.classList.add('hidden');
      } else {
        splitSection.style.display = 'block';
        jsonSection.style.display = 'none';
        if (erpSection) erpSection.style.display = 'none';

        // Reset back to split view read-only mode
        toggleEditMode(false);
      }
    });
  });
}

function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function initModalDropzone(invoiceNumber) {
  const dropzone = document.getElementById('modal-pdf-dropzone');
  const fileInput = document.getElementById('modal-pdf-file-input');
  
  if (!dropzone || !fileInput) return;
  
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleModalUploadFile(fileInput.files[0], invoiceNumber);
      fileInput.value = '';
    }
  });

  let dragCounter = 0;
  dropzone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    dropzone.classList.add('drag-active');
  });
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter === 0) {
      dropzone.classList.remove('drag-active');
    }
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    dropzone.classList.remove('drag-active');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleModalUploadFile(files[0], invoiceNumber);
    }
  });
}

function handleModalUploadFile(file, invoiceNumber) {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    showToast('Only PDF files are accepted.', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('File exceeds 10MB limit.', 'error');
    return;
  }

  const billType = document.getElementById('modal-upload-bill-type').value || 'interlock';
  
  const dropzone = document.getElementById('modal-pdf-dropzone');
  if (dropzone) {
    dropzone.innerHTML = `
      <i class="animate-spin" data-lucide="loader" style="width: 24px; height: 24px;"></i>
      <p style="font-size: 0.8rem; margin: 0; font-weight: 500;">Uploading file...</p>
    `;
    lucide.createIcons();
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('invoiceNumber', invoiceNumber);
  formData.append('billType', billType);

  const xhr = new XMLHttpRequest();
  xhr.addEventListener('load', () => {
    try {
      const data = JSON.parse(xhr.responseText);
      if (data.success) {
        showToast(`${file.name} uploaded to Google Drive!`, 'success');

        const uploadedEntry = {
          id: `modal-upload-${Date.now()}`,
          title: file.name,
          url: data.fileUrl || '',
          source: 'Invoice Modal',
          recordId: invoiceNumber || 'General',
          filename: file.name,
          uploadedAt: new Date().toISOString()
        };

        state.uploadedPdfs = [uploadedEntry, ...state.uploadedPdfs.filter(item => !(item.url === uploadedEntry.url && item.title === uploadedEntry.title))];

        state.invoices = state.invoices.map(inv => {
          if (inv.invoice_number === invoiceNumber) inv.pdf_url = data.fileUrl || '';
          return inv;
        });
        state.purchases = state.purchases.map(pur => {
          if (pur.party_inv_no === invoiceNumber) pur.pdf_url = data.fileUrl || '';
          return pur;
        });

        mergeUploadedPdfsFromRecords();
        saveToLocalStorage();
        openDetailedRecordModal(invoiceNumber);
        renderAllViews();
      } else {
        showToast(`Upload failed: ${data.error || 'Unknown error'}`, 'error');
        openDetailedRecordModal(invoiceNumber);
      }
    } catch {
      showToast(`Upload failed: ${xhr.responseText}`, 'error');
      openDetailedRecordModal(invoiceNumber);
    }
  });

  xhr.addEventListener('error', () => {
    showToast('Upload failed — cannot reach server.', 'error');
    openDetailedRecordModal(invoiceNumber);
  });

  xhr.open('POST', `${SERVER_BASE_URL}/upload`);
  xhr.send(formData);
}

function hasValidationFailures(purchase) {
  if (purchase && purchase.validated) return false;
  if (!purchase || !purchase.ai_summary) return false;
  const summary = purchase.ai_summary.toLowerCase();
  const failedIndex = summary.indexOf('failed:');
  if (failedIndex !== -1) {
    const failedText = summary.substring(failedIndex + 7).trim();
    const lines = failedText.split('\n');
    if (lines.length > 0) {
      const firstLine = lines[0].trim();
      if (firstLine && !firstLine.startsWith('none') && firstLine !== '-') {
        return true;
      }
    }
  }
  return false;
}

function renderRichAiSummary(rawSummary) {
  if (!rawSummary) return '-';

  // Sanitize literal 'undefined' and 'null' strings that may come from sheet
  let cleanedSummary = rawSummary
    .replace(/\bundefined\b/g, '-')
    .replace(/\bnull\b/g, '-')
    .replace(/:\s*undefined/g, ': -')
    .replace(/:\s*null/g, ': -');

  // Dynamically enrich missing/dashed summary properties with actual database records for accuracy (latest uploads take precedence)
  const selectedId = state.selectedRecordId;
  let invoice = null;
  let purchase = null;

  if (typeof selectedId === 'string' && (selectedId.startsWith('inv-') || selectedId.startsWith('pur-'))) {
    if (selectedId.startsWith('inv-')) {
      invoice = state.invoices.find(i => i.id === selectedId) || null;
      if (invoice) {
        purchase = [...state.purchases].reverse().find(p => p.party_inv_no === invoice.invoice_number && p.bill_freight_val === invoice.bill_freight_val)
                || [...state.purchases].reverse().find(p => p.party_inv_no === invoice.invoice_number) || null;
      }
    } else {
      purchase = state.purchases.find(p => p.id === selectedId) || null;
      if (purchase) {
        invoice = [...state.invoices].reverse().find(i => i.invoice_number === purchase.party_inv_no && i.bill_freight_val === purchase.bill_freight_val)
               || [...state.invoices].reverse().find(i => i.invoice_number === purchase.party_inv_no) || null;
      }
    }
  } else {
    invoice = [...state.invoices].reverse().find(i => i.invoice_number === selectedId) || null;
    purchase = [...state.purchases].reverse().find(p => p.party_inv_no === selectedId) || null;
  }

  if (invoice) {
    const foNo = invoice.fo_no || '';
    if (foNo && cleanedSummary.toLowerCase().includes('fo number')) {
      cleanedSummary = cleanedSummary.replace(/(• FO Number[\s\S]*?Invoice:\s*)-/, `$1${foNo}`);
    }
    const foRate = invoice.fo_rate || '';
    if (foRate && cleanedSummary.toLowerCase().includes('fo rate')) {
      cleanedSummary = cleanedSummary.replace(/(• FO Rate[\s\S]*?Invoice:\s*)-/, `$1${foRate}`);
    }
    const foQty = invoice.fo_qty !== undefined ? invoice.fo_qty : '';
    if (foQty !== '' && cleanedSummary.toLowerCase().includes('fo qty')) {
      cleanedSummary = cleanedSummary.replace(/(• FO Qty[\s\S]*?Invoice:\s*)-/, `$1${foQty}`);
    }
    const foVal = invoice.fo_order_value || '';
    if (foVal && cleanedSummary.toLowerCase().includes('fo order value')) {
      cleanedSummary = cleanedSummary.replace(/(• FO Order Value[\s\S]*?Invoice:\s*)-/, `$1${foVal}`);
    }
  }

  if (purchase) {
    const foNo = purchase.fo_no || '';
    if (foNo && cleanedSummary.toLowerCase().includes('fo number')) {
      cleanedSummary = cleanedSummary.replace(/(• FO Number[\s\S]*?ERP:\s*)-/, `$1${foNo}`);
    }
    const foRate = purchase.fo_rate || '';
    if (foRate && cleanedSummary.toLowerCase().includes('fo rate')) {
      cleanedSummary = cleanedSummary.replace(/(• FO Rate[\s\S]*?ERP:\s*)-/, `$1${foRate}`);
    }
    const foQty = purchase.fo_qty !== undefined ? purchase.fo_qty : '';
    if (foQty !== '' && cleanedSummary.toLowerCase().includes('fo qty')) {
      cleanedSummary = cleanedSummary.replace(/(• FO Qty[\s\S]*?ERP:\s*)-/, `$1${foQty}`);
    }
    const foVal = purchase.fo_order_value || '';
    if (foVal && cleanedSummary.toLowerCase().includes('fo order value')) {
      cleanedSummary = cleanedSummary.replace(/(• FO Order Value[\s\S]*?ERP:\s*)-/, `$1${foVal}`);
    }
  }

  const lowerSummary = cleanedSummary.toLowerCase();
  
  let passedText = '';
  let warningsText = '';
  let failedText = '';
  
  const passedIdx = lowerSummary.indexOf('passed:');
  const warningsIdx = lowerSummary.indexOf('warnings:');
  const failedIdx = lowerSummary.indexOf('failed:');
  
  const extractSection = (startIdx, endIdx) => {
    if (startIdx === -1) return '';
    let text = '';
    if (endIdx !== -1) {
      text = cleanedSummary.substring(startIdx, endIdx).trim();
    } else {
      text = cleanedSummary.substring(startIdx).trim();
    }
    const lines = text.split('\n');
    lines.shift();
    return lines.join('\n').trim();
  };

  if (passedIdx !== -1) {
    const nextIdx = warningsIdx !== -1 ? warningsIdx : (failedIdx !== -1 ? failedIdx : -1);
    passedText = extractSection(passedIdx, nextIdx);
  }
  if (warningsIdx !== -1) {
    const nextIdx = failedIdx !== -1 ? failedIdx : -1;
    warningsText = extractSection(warningsIdx, nextIdx);
  }
  if (failedIdx !== -1) {
    failedText = extractSection(failedIdx, -1);
  }

  if (passedIdx === -1 && warningsIdx === -1 && failedIdx === -1) {
    return `<div style="white-space: pre-wrap; font-family: monospace; font-size: 0.85rem;">${escapeHtml(cleanedSummary)}</div>`;
  }

  const hasFoInRecord = (invoice && invoice.fo_no && invoice.fo_no !== '-') || (purchase && purchase.fo_no && purchase.fo_no !== '-');
  const hasFoMatched = lowerSummary.includes('fo number matched');
  const isFoFailedInDetails = /failed:[\s\S]*?• fo number[\s\S]*?erp:\s*-\s*\n\s*invoice:\s*-/i.test(cleanedSummary);
  const isFoMissingInSummary = isFoFailedInDetails && !hasFoInRecord && !hasFoMatched;

  const hasInvInRecord = (invoice && invoice.invoice_number && invoice.invoice_number !== '-') || (purchase && purchase.party_inv_no && purchase.party_inv_no !== '-');
  const hasInvMatched = lowerSummary.includes('invoice number matched');
  const isInvFailedInDetails = /failed:[\s\S]*?• (party )?invoice number[\s\S]*?erp:\s*-\s*\n\s*invoice:\s*-/i.test(cleanedSummary);
  const isInvMissingInSummary = isInvFailedInDetails && !hasInvInRecord && !hasInvMatched;

  let html = `<div class="rich-ai-summary" style="display: flex; flex-direction: column; gap: 16px; font-family: sans-serif; font-size: 0.95rem; padding: 8px 0;">`;

  if (isFoMissingInSummary || isInvMissingInSummary) {
    const missingField = (isFoMissingInSummary && isInvMissingInSummary) ? 'FO Number & Invoice Number' : (isFoMissingInSummary ? 'FO Number' : 'Invoice Number');
    html += `
      <div class="ai-reupload-alert" style="background: rgba(255, 77, 109, 0.15); border: 2px solid var(--accent-red); border-left: 6px solid var(--accent-red); padding: 14px 18px; border-radius: 8px; margin-bottom: 4px;">
        <div style="display: flex; align-items: center; gap: 8px; font-weight: 800; color: var(--accent-red); font-size: 0.95rem; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
          ⚠️ Action Required: Please Re-upload Document
        </div>
        <div style="color: var(--text-main); font-size: 0.88rem; line-height: 1.5; font-weight: 600;">
          The <strong>${missingField}</strong> could not be tracked or detected from this document. Please re-upload a clearer copy of the document because the ${missingField} is required for AI tracking.
        </div>
      </div>
    `;
  }

  if (passedText) {
    html += `
      <div class="ai-section passed" style="border-left: 4px solid var(--accent-green); padding-left: 14px; margin-bottom: 4px;">
        <span style="font-weight: 700; color: var(--accent-green); display: block; margin-bottom: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">Passed:</span>
        <div style="color: var(--text-main); white-space: pre-wrap; font-size: 0.9rem; line-height: 1.55;">${escapeHtml(passedText)}</div>
      </div>
    `;
  }

  if (warningsText && !warningsText.toLowerCase().startsWith('none') && warningsText !== '-') {
    html += `
      <div class="ai-section warnings" style="border-left: 4px solid var(--accent-yellow); padding-left: 14px; margin-bottom: 4px;">
        <span style="font-weight: 700; color: var(--accent-yellow); display: block; margin-bottom: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">Warnings:</span>
        <div style="color: var(--text-main); white-space: pre-wrap; font-size: 0.9rem; line-height: 1.55;">${escapeHtml(warningsText)}</div>
      </div>
    `;
  }

  const isFailedEmpty = !failedText || failedText.toLowerCase().startsWith('none') || failedText === '-';
  if (!isFailedEmpty) {
    html += `
      <div class="ai-section failed" style="background-color: rgba(255, 77, 109, 0.14); border: 2px solid var(--accent-red); border-left: 8px solid var(--accent-red); padding: 20px; border-radius: 8px; box-shadow: 0 0 15px rgba(255, 77, 109, 0.25); margin-top: 6px;">
        <span style="font-weight: 800; color: var(--accent-red); display: block; margin-bottom: 10px; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.75px;">⚠️ Failed Validation Details:</span>
        <div style="color: #ff4d6d; white-space: pre-wrap; font-size: 1.0rem; font-weight: 750; line-height: 1.65; min-height: 110px;">${escapeHtml(failedText)}</div>
      </div>
    `;
  } else {
    html += `
      <div class="ai-section failed" style="border-left: 4px solid var(--text-muted); padding-left: 14px; opacity: 0.7;">
        <span style="font-weight: 700; color: var(--text-muted); display: block; margin-bottom: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">Failed:</span>
        <div style="color: var(--text-muted); font-size: 0.9rem;">None</div>
      </div>
    `;
  }

  html += `</div>`;
  return html;
}
