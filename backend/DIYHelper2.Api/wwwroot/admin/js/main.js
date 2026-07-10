'use strict';

/* ============================================================================
   White-label Owner Console — bootstrap.
   Vanilla JS, native ES modules, no build step, no framework. A strict
   Content-Security-Policy forbids inline handlers and inline styles. Auth is
   a server-issued HttpOnly session cookie (dh_admin_session): the boot flow
   asks GET /admin/session who we are; a 401 anywhere shows the login overlay.
   All interpolated data is passed through escapeHtml().
   ========================================================================== */

import { el } from './ui.js';
import { setUnauthorizedHandler } from './api.js';
import { setupIdentity, wireBrandScope } from './state.js';
import { registerSection, wireTabs, showSection, brandChanged } from './router.js';
import { wireSession, bootSession, showLogin } from './session.js';
import { wireOverview, loadOverview } from './overview.js';
import { wireLeads, loadRequests } from './leads.js';
import { wireQuotes } from './quotes.js';
import { wireAssets } from './assets.js';
import { wireSchedule, loadSchedule } from './schedule.js';
import { wireTechnicians, loadTechnicians } from './technicians.js';
import { wirePricing, loadPricing } from './pricebook.js';
import { wireInventory, loadInventory } from './inventory.js';
import { wirePush, renderTemplates, showPushSection, pushBrandChanged } from './push.js';
import { wireStudio, updateStudio } from './brandstudio.js';

async function init() {
  // Section registry: node + show hook (+ brand-change hook where it differs).
  registerSection('overview', el('overview-section'), { show: loadOverview });
  registerSection('leads', el('leads-section'), { show: loadRequests });
  registerSection('schedule', el('schedule-section'), { show: loadSchedule });
  registerSection('technicians', el('technicians-section'), { show: loadTechnicians });
  registerSection('pricing', el('pricing-section'), { show: loadPricing });
  registerSection('inventory', el('inventory-section'), { show: loadInventory });
  registerSection('push', el('push-section'), { show: showPushSection, onBrandChange: pushBrandChanged });
  registerSection('studio', el('studio-section'), { show: updateStudio, onBrandChange: null });

  wireTabs();
  wireBrandScope(brandChanged);
  wireOverview();
  wireLeads();
  wireQuotes();
  wireAssets();
  wireSchedule();
  wireTechnicians();
  wirePricing();
  wireInventory();
  wirePush();
  wireStudio();
  wireSession();
  renderTemplates();

  // Any API 401 (expired/absent cookie) drops the operator at the login form.
  setUnauthorizedHandler(showLogin);

  const session = await bootSession();
  if (session) {
    await setupIdentity(session);
    showSection('overview');
  } else {
    showLogin();
  }
}

document.addEventListener('DOMContentLoaded', init);
