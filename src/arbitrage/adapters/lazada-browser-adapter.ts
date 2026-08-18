/**
 * Lazada Browser-Rendered Adapter (Phase 25/26)
 *
 * Uses Chrome DevTools Protocol (CDP) to render Lazada's JS-rendered SPA
 * search page and extract real product data from the DOM.
 *
 * Phase 26 fix: uses /json/version → browser WebSocket → Target.createTarget
 * flow instead of relying on /json returning a page target (which --headless=new
 * does not provide by default).
 *
 * Security:
 *   - Only navigates to allowlisted Lazada domains (lazada.co.id)
 *   - CDP bound to 127.0.0.1 only
 *   - No credentials, no cookies logged, no auth material
 *   - No CAPTCHA bypass, no anti-bot circumvention
 *   - Rate limited: minimum 10s between acquisitions
 *
 * Fail-closed: throws SOURCE_ERROR on any failure — never fabricates data.
 */
import { BaseSourceAdapter } from './base-adapter';
import {
  RawResultSet,
  RawPayload,
  RawDocument,
  ParsedEntities,
  ParsedEntity,
  CanonicalProduct,
  SourceHealthStatus,
  SourceMetadata,
  CapabilityMatrix,
} from '../types';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import { WebSocket } from 'ws';
import { parsePrice as parsePriceValue } from '../lib/price';

const ALLOWED_DOMAINS = ['www.lazada.co.id', 'lazada.co.id'];

interface ExtractedProduct {
  title: string;
  price: string | null;
  link: string | null;
  image: boolean;
}

const NAVIGATION_TIMEOUT_MS = 30000;
const RENDER_WAIT_MS = 12000;
const BROWSER_READY_TIMEOUT_MS = 30000;

export class LazadaBrowserAdapter extends BaseSourceAdapter {
  readonly adapterName = 'LazadaBrowserAdapter';
  readonly sourceName = 'Lazada Indonesia (Browser)';
  readonly baseUrl = 'https://www.lazada.co.id';
  readonly trustTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN' = 'MEDIUM';
  readonly isActive = true;
  readonly marketplace = 'lazada' as const;
  readonly dataProvenance = 'REAL_PUBLIC_WEB' as const;
  readonly acquisitionMethod = 'BROWSER_RENDERED' as const;
  readonly reliabilityTier = 'C' as const;

  private readonly minIntervalMs = 10000;
  private lastSearchTime = 0;
  private browserProcess: ReturnType<typeof spawn> | null = null;
  private cdpPort = 0;

  constructor() {
    super();
  }

  async search(query: string, _filters?: Record<string, unknown>): Promise<RawResultSet> {
    this.logger.info(`[LazadaBrowser] query="${query}" event=browser_start`);

    if (!query || query.trim().length === 0) {
      this.logger.warn('[LazadaBrowser] Empty query provided');
      return [];
    }

    const now = Date.now();
    const elapsed = now - this.lastSearchTime;
    if (elapsed < this.minIntervalMs) {
      const wait = this.minIntervalMs - elapsed;
      this.logger.info(`[LazadaBrowser] Rate limiting: waiting ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
    this.lastSearchTime = Date.now();

    const searchUrl = `https://www.lazada.co.id/catalog/?q=${encodeURIComponent(query.trim())}`;
    this.validateUrl(searchUrl);

    const t0 = Date.now();
    let browserWs: CdpBrowserConnection | null = null;
    let targetId: string | null = null;

    try {
      // ── 1. Spawn Chromium ──
      browserWs = await this.startBrowser();
      this.logger.info(`[LazadaBrowser] event=browser_ready port=${this.cdpPort} elapsedMs=${Date.now() - t0}`);

      // ── 2. Create a PAGE target via Target.createTarget ──
      targetId = await this.createPageTarget(browserWs);
      this.logger.info(`[LazadaBrowser] event=page_target_created targetId=${targetId} elapsedMs=${Date.now() - t0}`);

      // ── 3. Attach to the page target ──
      const sessionId = await this.attachToTarget(browserWs, targetId);
      this.logger.info(`[LazadaBrowser] event=page_target_attached sessionId=${sessionId} elapsedMs=${Date.now() - t0}`);

      // ── 4. Enable Page + Runtime on the session ──
      await browserWs.send('Page.enable', {}, sessionId);
      await browserWs.send('Runtime.enable', {}, sessionId);

      // ── 5. Navigate to the Lazada search URL ──
      this.logger.info(`[LazadaBrowser] event=navigation_started url_host=www.lazada.co.id elapsedMs=${Date.now() - t0}`);
      const navResult = await browserWs.send('Page.navigate', { url: searchUrl }, sessionId);
      if (navResult.result?.errorText) {
        throw new Error(`LazadaBrowser: NAVIGATION_FAILED — ${navResult.result.errorText}`);
      }

      // ── 6. Wait for page load event ──
      await browserWs.waitForEvent('Page.loadEventFired', NAVIGATION_TIMEOUT_MS, sessionId).catch(() => {
        this.logger.warn(`[LazadaBrowser] Page.loadEventFired timeout — continuing with render wait`);
      });
      this.logger.info(`[LazadaBrowser] event=navigation_completed elapsedMs=${Date.now() - t0}`);

      // ── 7. Wait for product content deterministically (poll DOM) ──
      // Lazada renders the search result grid asynchronously via XHR after
      // initial page load. A fixed sleep is unreliable: poll for product
      // cards (data-tracking="product-card") up to a deadline instead.
      await this.waitForProductCards(browserWs, sessionId, t0);
      this.logger.info(`[LazadaBrowser] event=render_wait_completed elapsedMs=${Date.now() - t0}`);

      // ── 8. Extract products from the rendered DOM ──
      this.logger.info(`[LazadaBrowser] event=dom_extraction_started elapsedMs=${Date.now() - t0}`);
      const products = await this.extractProducts(browserWs, sessionId);
      this.logger.info(`[LazadaBrowser] event=dom_extraction_completed products=${products.length} elapsedMs=${Date.now() - t0}`);

      if (products.length === 0) {
        throw new Error('LazadaBrowser: DOM_EXTRACTION_FAILED — no product cards found in rendered DOM');
      }

      this.logger.info(`[LazadaBrowser] event=products_extracted count=${products.length} totalMs=${Date.now() - t0}`);
      const results = products.map(p => this.normalizeProduct(p, query)) as unknown as RawResultSet;
      this.logger.info(`[LazadaBrowser] event=raw_result_created count=${results.length} totalMs=${Date.now() - t0}`);
      return results;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[LazadaBrowser] event=source_error error="${msg}" elapsedMs=${Date.now() - t0}`);
      throw err;
    } finally {
      // ── Cleanup: close target, shutdown browser ──
      if (browserWs && targetId) {
        try {
          await browserWs.send('Target.closeTarget', { targetId });
          this.logger.info('[LazadaBrowser] event=page_target_closed');
        } catch { /* best effort */ }
      }
      if (browserWs) browserWs.close();
      await this.shutdownBrowser();
      this.logger.info('[LazadaBrowser] event=browser_shutdown');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Browser lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  private async startBrowser(): Promise<CdpBrowserConnection> {
    const chromium = this.findChromium();
    if (!chromium) {
      throw new Error('LazadaBrowser: BROWSER_START_FAILED — Chromium binary not found');
    }

    this.cdpPort = 9230 + Math.floor(Math.random() * 100);

    this.browserProcess = spawn(chromium, [
      `--remote-debugging-port=${this.cdpPort}`,
      `--remote-debugging-address=127.0.0.1`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-background-networking',
      '--window-size=1280,900',
    ], { stdio: 'pipe' });

    this.browserProcess.on('error', (err: Error) => {
      this.logger.error(`[LazadaBrowser] Chromium process error: ${err.message}`);
    });

    // Wait for DevTools HTTP endpoint to be ready via /json/version
    let versionInfo: any = null;
    for (let i = 0; i < BROWSER_READY_TIMEOUT_MS / 1000; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        versionInfo = await this.httpGetJson(`http://127.0.0.1:${this.cdpPort}/json/version`);
        if (versionInfo && versionInfo.webSocketDebuggerUrl) break;
      } catch { /* retry */ }
    }

    if (!versionInfo || !versionInfo.webSocketDebuggerUrl) {
      const exitCode = this.browserProcess?.exitCode;
      throw new Error(`LazadaBrowser: DEVTOOLS_NOT_READY — /json/version not available after ${BROWSER_READY_TIMEOUT_MS / 1000}s (chrome exit=${exitCode})`);
    }

    this.logger.info(`[LazadaBrowser] event=devtools_ready port=${this.cdpPort}`);

    // Connect to the BROWSER WebSocket
    const wsUrl = versionInfo.webSocketDebuggerUrl as string;
    const conn = new CdpBrowserConnection(wsUrl);
    try {
      await conn.connect();
    } catch (e) {
      throw new Error(`LazadaBrowser: BROWSER_WS_CONNECT_FAILED — ${e instanceof Error ? e.message : String(e)}`);
    }

    this.logger.info(`[LazadaBrowser] event=browser_ws_connected port=${this.cdpPort}`);
    return conn;
  }

  private async createPageTarget(ws: CdpBrowserConnection): Promise<string> {
    try {
      const result = await ws.send('Target.createTarget', { url: 'about:blank' });
      const tid = result.result?.targetId;
      if (!tid) {
        throw new Error('no targetId returned');
      }
      return tid;
    } catch (e) {
      throw new Error(`LazadaBrowser: PAGE_TARGET_CREATE_FAILED — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async attachToTarget(ws: CdpBrowserConnection, targetId: string): Promise<string> {
    try {
      const result = await ws.send('Target.attachToTarget', { targetId, flatten: true });
      const sid = result.result?.sessionId;
      if (!sid) {
        throw new Error('no sessionId returned');
      }
      return sid;
    } catch (e) {
      throw new Error(`LazadaBrowser: PAGE_TARGET_ATTACH_FAILED — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Poll the DOM for product cards until they appear or a deadline expires.
   * Lazada renders search results via XHR (React hydration) after the initial
   * page load, so a fixed sleep is unreliable.
   */
  private async waitForProductCards(ws: CdpBrowserConnection, sessionId: string, t0: number): Promise<void> {
    const deadline = Date.now() + RENDER_WAIT_MS + 10000;
    // Start with a short fixed wait to let the initial page shell settle
    await new Promise(r => setTimeout(r, 3000));

    const pollExpr = `(function(){
      var c = document.querySelectorAll('[data-tracking="product-card"], [data-item-id], a[href*="/products/"]');
      return c.length;
    })()`;

    while (Date.now() < deadline) {
      try {
        const evalResult = await ws.send('Runtime.evaluate', { expression: pollExpr, returnByValue: true }, sessionId);
        const val = evalResult.result?.result?.value ?? evalResult.result?.value;
        const count = typeof val === 'number' ? val : parseInt(String(val), 10) || 0;
        if (count > 0) {
          this.logger.info(`[LazadaBrowser] event=product_cards_detected count=${count} elapsedMs=${Date.now() - t0}`);
          // Wait an extra 2s for the cards to fully hyper and images to load
          await new Promise(r => setTimeout(r, 2000));
          return;
        }
      } catch { /* poll failure — try again */ }
      // Check for redirect to tag page and if so, try the catalog URL directly
      const urlExpr = `location.href`;
      try {
        const urlResult = await ws.send('Runtime.evaluate', { expression: urlExpr, returnByValue: true }, sessionId);
        const currentUrl = (urlResult.result?.result?.value ?? urlResult.result?.value ?? '') as string;
        if (currentUrl.includes('/tag/') || currentUrl.includes('catalog_redirect_tag=true')) {
          this.logger.warn(`[LazadaBrowser] Detected tag/redirect page, navigating to catalog directly url=${currentUrl} elapsedMs=${Date.now() - t0}`);
          // Extract the query from the URL and navigate to the catalog search URL
          const qMatch = currentUrl.match(/[?&]q=([^&]+)/);
          if (qMatch) {
            const query = decodeURIComponent(qMatch[1]);
            const catalogUrl = `https://www.lazada.co.id/catalog/?q=${encodeURIComponent(query)}`;
            this.logger.info(`[LazadaBrowser] event=redirect_navigation target=${catalogUrl} elapsedMs=${Date.now() - t0}`);
            await ws.send('Page.navigate', { url: catalogUrl }, sessionId);
            // Wait for navigation to complete
            await ws.waitForEvent('Page.loadEventFired', 15000, sessionId).catch(() => {});
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      } catch { /* URL check failure — continue polling */ }
      await new Promise(r => setTimeout(r, 2000));
    }
    this.logger.warn(`[LazadaBrowser] event=product_cards_timeout elapsedMs=${Date.now() - t0}`);
  }

  private async extractProducts(ws: CdpBrowserConnection, sessionId: string): Promise<ExtractedProduct[]> {
    const expression = `(() => {
      var r = { products: [], count: 0, captcha: false, loginReq: false, url: location.href, title: document.title, bodyLen: document.body ? document.body.innerHTML.length : 0, bodyTextPreview: '', availableClasses: [] };
      var bt = document.body ? document.body.innerText.substring(0, 2000) : '';
      r.bodyTextPreview = bt.substring(0, 500);
      if (bt.match(/captcha|punish|robot check|are you a robot|access denied|error_page|verify you are human|slider.*verify/i)) r.captcha = true;
      if (r.url.includes('/punish') || r.url.includes('tmd') || r.url.includes('x5secdata')) r.captcha = true;
      if (bt.match(/login|sign in|log in|masuk|daftar/i) && bt.length < 500 && !r.captcha) r.loginReq = true;
      // Robust selectors. Lazada product cards are identified by the stable
      // data-tracking="product-card" attribute (see page meta config:
      // /lzdse.pub.impr_prod → filter="data-tracking=product-card") with
      // data-item-id and data-sku-simple attributes. Prefer these stable
      // attributes over obfuscated CSS classes.
      var sels = [
        '[data-tracking="product-card"]',
        '[data-qa-locator="product-item"]',
        'div[data-item-id]',
        'a[href*="/products/"]',
        '[class*="product-card"]', '[class*="ProductCard"]', '[class*="product-item"]',
        '[class*="ItemCard"]', '[class*="item-card"]', '[class*="product-tile"]',
        'div[data-spm*="product"]', '[class*="gridItem"]', '[class*="grid-item"]'
      ];
      var seen = {};
      var allCards = [];
      for (var i = 0; i < sels.length; i++) {
        var cards = document.querySelectorAll(sels[i]);
        for (var c = 0; c < cards.length; c++) {
          var card = cards[c];
          // Dedupe by DOM element identity to avoid counting the same card twice
          var key = card.getAttribute && (card.getAttribute('data-item-id') || card.getAttribute('data-sku-simple') || '');
          if (key && seen[key]) continue;
          if (key) seen[key] = true;
          allCards.push(card);
        }
      }
      r.count = allCards.length;
      // If no products found, collect diagnostic: class names containing product/item/card
      if (r.count === 0) {
        var allEls = document.querySelectorAll('[class]');
        var classSet = {};
        for (var j = 0; j < Math.min(allEls.length, 500); j++) {
          var cls = allEls[j].className;
          if (typeof cls === 'string' && cls.match(/product|item|card|tile|grid/i)) {
            cls.split(/\\s+/).forEach(function(c) { if (c.match(/product|item|card|tile|grid/i)) classSet[c] = true; });
          }
        }
        r.availableClasses = Object.keys(classSet).slice(0, 30);
      }
      for (var k = 0; k < Math.min(allCards.length, 12); k++) {
        var card = allCards[k];
        var text = card.innerText || '';
        // Lazada product links use /products/<slug>-i<itemId>-s<shopId>.html
        var link = card.querySelector('a[href*="/products/"]') || card.querySelector('a[href*="-i"]');
        if (!link && card.tagName === 'A' && card.getAttribute('href')) link = card;
        var itemId = card.getAttribute('data-item-id') || card.getAttribute('data-sku-simple') || '';
        var priceEl = card.querySelector('[class*="price"], [class*="Price"], [class*="current-price"]');
        var price = priceEl ? priceEl.innerText.trim() : null;
        if (!price) { var pm = text.match(/(?:Rp|IDR)\\s*[\\d.,]+/); if (pm) price = pm[0]; }
        var titleEl = card.querySelector('[class*="title"], [class*="Title"], [class*="name"], [class*="Name"], [class*="description"]');
        var title = titleEl ? titleEl.innerText.trim() : text.substring(0, 150).replace(/\\n/g, ' ');
        // If itemId is available but no link, construct the canonical product URL
        var href = link ? link.href : null;
        if (!href && itemId) href = 'https://www.lazada.co.id/products/i' + itemId + '.html';
        r.products.push({ title: title, price: price, link: href, image: !!card.querySelector('img'), itemId: itemId });
      }
      return JSON.stringify(r);
    })()`;

    const evalResult = await ws.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    const cdpResult = evalResult.result?.result || evalResult.result;
    const val = cdpResult?.value;
    if (!val) {
      throw new Error('LazadaBrowser: DOM_EXTRACTION_FAILED — Runtime.evaluate returned no value');
    }

    let data: any;
    try {
      data = typeof val === 'string' ? JSON.parse(val) : val;
    } catch {
      throw new Error('LazadaBrowser: DOM_EXTRACTION_FAILED — failed to parse extraction result');
    }

    if (data.captcha) {
      throw new Error('LazadaBrowser: CAPTCHA_REQUIRED — CAPTCHA detected on page');
    }
    // Check URL for Lazada anti-bot punish/security challenge
    if (data.url && (data.url.includes('/punish') || data.url.includes('tmd') || data.url.includes('x5secdata'))) {
      throw new Error(`LazadaBrowser: CAPTCHA_REQUIRED — Lazada anti-bot punish page detected (URL contains security challenge marker)`);
    }
    if (data.loginReq) {
      throw new Error('LazadaBrowser: LOGIN_REQUIRED — login page detected');
    }

    // Log diagnostic info when 0 products found
    if (data.count === 0) {
      this.logger.warn(`[LazadaBrowser] event=dom_diagnostic title="${data.title || 'none'}" url="${data.url || 'none'}" bodyLen=${data.bodyLen || 0} bodyText="${(data.bodyTextPreview || '').substring(0, 200)}" availableClasses=${JSON.stringify(data.availableClasses || [])}`);
    }

    return data.products || [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private validateUrl(url: string): void {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error(`LazadaBrowser: invalid URL ${url}`); }
    if (!ALLOWED_DOMAINS.includes(parsed.hostname)) {
      throw new Error(`LazadaBrowser: URL domain ${parsed.hostname} is not allowlisted`);
    }
  }

  private normalizeProduct(p: ExtractedProduct, query: string): Record<string, unknown> {
    return {
      url: p.link || '',
      title: p.title || '',
      price: this.parsePrice(p.price),
      currency: 'IDR',
      seller: null,
      sellerId: null,
      rating: null,
      reviewCount: null,
      soldCount: null,
      image: null,
      productId: this.extractProductId(p.link),
      rawMetadata: { query, source: 'lazada', acquisition: 'BROWSER_RENDERED', title: p.title, price: p.price, link: p.link },
    };
  }

  private parsePrice(priceVal: unknown): number | null {
    return parsePriceValue(priceVal);
  }

  private extractProductId(url: string | null): string | null {
    if (!url) return null;
    const match = url.match(/pdp-i(\d+)/);
    return match ? match[1] : null;
  }

  private findChromium(): string | null {
    const candidates = [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/local/bin/chromium',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c; } catch { /* skip */ }
    }
    return null;
  }

  private async shutdownBrowser(): Promise<void> {
    if (this.browserProcess) {
      try { this.browserProcess.kill('SIGTERM'); } catch { /* ignore */ }
      // Wait briefly for graceful exit
      await new Promise(r => setTimeout(r, 500));
      try {
        if (this.browserProcess.exitCode === null) {
          this.browserProcess.kill('SIGKILL');
        }
      } catch { /* ignore */ }
      this.browserProcess = null;
    }
  }

  private httpGetJson(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      http.get(url, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('JSON parse failed')); } });
      }).on('error', reject);
    });
  }

  // — BaseSourceAdapter required stubs —
  async fetch(_target: string): Promise<RawPayload> { throw new Error('Not supported'); }
  async parse(_rawDocument: RawDocument): Promise<ParsedEntities> { throw new Error('Not supported'); }

  /**
   * Normalize a raw product (from search() extraction) into a CanonicalProduct.
   * The browser adapter already has all product data from the rendered DOM —
   * no fetch/parse cycle is needed. The discovery service calls this directly
   * with the raw product object from search().
   */
  async normalize(parsedData: ParsedEntity): Promise<CanonicalProduct> {
    const raw = parsedData as any;
    const title: string = raw.title || '';
    const price: number | null =
      typeof raw.price === 'number'
        ? (Number.isFinite(raw.price) ? raw.price : null)
        : this.parsePrice(raw.price);
    const url: string = raw.url || raw.link || '';
    const productId: string = this.extractProductId(url) || '';

    return {
      id: `lazada_${productId}_${Date.now()}` as any,
      canonicalTitle: title,
      brand: null,
      model: null,
      categoryId: null,
      standardUnit: 'piece',
      standardWeightGrams: null,
      standardDimensionsCm: null,
      sku: productId || null,
      barcode: null,
      priceInIdr: price,
      currencyConverted: false,
      moq: 1,
      packageQuantity: 1,
      packageUnit: 'piece',
      sourceId: 'lazada-browser' as any,
      supplierProductId: null,
      marketplaceListingId: productId as any,
      sellerId: null,
      sellerName: null,
      marketplaceListingUrl: url,
      observedAt: new Date().toISOString() as any,
      confidence: 0.8,
      dataLineage: {
        sourceId: 'lazada-browser' as any,
        rawDocumentId: `lazada_${productId}` as any,
        rawEvidenceHash: raw.rawMetadata ? JSON.stringify(raw.rawMetadata).length.toString() : '0',
        extractionMethod: 'BROWSER_RENDERED',
        observedAt: new Date().toISOString() as any,
        confidence: 0.8,
        evidenceHierarchyLevel: 3 as 1 | 2 | 3 | 4 | 5 | 6,
      },
      dataProvenance: 'REAL_PUBLIC_WEB',
      acquisitionMethod: 'BROWSER_RENDERED',
      retrievedAt: new Date().toISOString() as any,
    };
  }
  computeCrawlPriority(): number { return 50; }
  getCapabilities(): CapabilityMatrix {
    return {
      supportsDiscover: false, supportsSearch: true, supportsFetch: false,
      supportsParse: false, supportsNormalize: false, supportsHealthCheck: true,
      extras: { acquisitionMethod: 'BROWSER_RENDERED' },
    };
  }
  async getHealth(): Promise<SourceHealthStatus> {
    return { isHealthy: true, statusCode: null, latencyMs: null, errorMessage: null, checkedAt: new Date().toISOString(), errorCount24h: 0 };
  }
  getMetadata(): SourceMetadata {
    return { id: 'lazada-browser' as any, name: this.sourceName, adapterName: this.adapterName, baseUrl: this.baseUrl, isActive: this.isActive, trustTier: this.trustTier, createdAt: new Date().toISOString() as any };
  }
}

/**
 * CDP Browser-level WebSocket connection.
 * Supports both browser-level commands and session-scoped commands
 * (via sessionId for Target.attachToTarget flatten mode).
 * Exported for reuse by other browser adapters (Tokopedia, etc.).
 */
export class CdpBrowserConnection {
  private ws: WebSocket;
  private msgId = 0;
  private pending = new Map<number, (result: any) => void>();
  private events: any[] = [];

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 100 * 1024 * 1024 });
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      setTimeout(() => reject(new Error('CDP connect timeout')), 10000);
    });

    this.ws.on('message', (msg: Buffer) => {
      const obj = JSON.parse(msg.toString());
      // In flatten mode, responses include sessionId; the id matches the request
      if (obj.id && this.pending.has(obj.id)) {
        this.pending.get(obj.id)!(obj);
        this.pending.delete(obj.id);
      }
      // Events: store with their sessionId for filtering
      if (obj.method) this.events.push(obj);
    });
  }

  /**
   * Send a CDP command. If sessionId is provided, it's included in the message
   * (flatten mode) so the command is routed to the attached target.
   */
  async send(method: string, params: any = {}, sessionId?: string): Promise<any> {
    const id = ++this.msgId;
    const msg: any = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify(msg));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * Wait for a specific CDP event, optionally filtered by sessionId.
   */
  async waitForEvent(method: string, timeout = 30000, sessionId?: string): Promise<any> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = this.events.find(
          e => e.method === method && (!sessionId || e.sessionId === sessionId)
        );
        if (found) { resolve(found); return; }
        if (Date.now() - start > timeout) { reject(new Error(`Event timeout: ${method}`)); return; }
        setTimeout(check, 300);
      };
      check();
    });
  }

  close(): void {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}
