/**
 * Tokopedia Browser-Rendered Adapter (Phase 30)
 *
 * Tokopedia's search page is a JS-rendered SPA. Server-side HTTP returns a
 * shell with no product data. This adapter uses CDP to render the page and
 * extract product cards from the DOM — same architecture as LazadaBrowserAdapter.
 *
 * Phase 28/29 never tested Tokopedia from Fly (only local ERR_HTTP2_PROTOCOL_ERROR).
 * The Fly Tokyo IP may not be flagged by Tokopedia's anti-bot.
 *
 * Security: same as LazadaBrowserAdapter (allowlisted URLs, localhost CDP,
 * no credentials, no CAPTCHA bypass, no anti-bot evasion).
 */
import { BaseSourceAdapter } from './base-adapter';
import {
  RawResultSet, RawPayload, RawDocument, ParsedEntities, ParsedEntity,
  CanonicalProduct, SourceHealthStatus, SourceMetadata, CapabilityMatrix,
} from '../types';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import { CdpBrowserConnection } from './lazada-browser-adapter';
import { parsePrice as parsePriceValue } from '../lib/price';

const ALLOWED_DOMAINS = ['www.tokopedia.com', 'tokopedia.com'];
const NAVIGATION_TIMEOUT_MS = 30000;
const RENDER_WAIT_MS = 12000;
const BROWSER_READY_TIMEOUT_MS = 30000;

interface ExtractedProduct {
  title: string;
  price: string | null;
  link: string | null;
  image: boolean;
}

export class TokopediaBrowserAdapter extends BaseSourceAdapter {
  readonly adapterName = 'TokopediaBrowserAdapter';
  readonly sourceName = 'Tokopedia (Browser)';
  readonly baseUrl = 'https://www.tokopedia.com';
  readonly trustTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN' = 'MEDIUM';
  readonly isActive = true;
  readonly marketplace = 'tokopedia' as const;
  readonly dataProvenance = 'REAL_PUBLIC_WEB' as const;
  readonly acquisitionMethod = 'BROWSER_RENDERED' as const;
  readonly reliabilityTier = 'C' as const;

  private readonly minIntervalMs = 10000;
  private lastSearchTime = 0;
  private browserProcess: ReturnType<typeof spawn> | null = null;
  private cdpPort = 0;

  constructor() { super(); }

  async search(query: string, _filters?: Record<string, unknown>): Promise<RawResultSet> {
    this.logger.info(`[TokopediaBrowser] query="${query}" event=browser_start`);
    if (!query || query.trim().length === 0) { return []; }

    const now = Date.now();
    const elapsed = now - this.lastSearchTime;
    if (elapsed < this.minIntervalMs) {
      await new Promise(r => setTimeout(r, this.minIntervalMs - elapsed));
    }
    this.lastSearchTime = Date.now();

    const searchUrl = `https://www.tokopedia.com/search?q=${encodeURIComponent(query.trim())}&st=product`;
    this.validateUrl(searchUrl);

    const t0 = Date.now();
    let browserWs: CdpBrowserConnection | null = null;
    let targetId: string | null = null;

    try {
      browserWs = await this.startBrowser();
      this.logger.info(`[TokopediaBrowser] event=browser_ready port=${this.cdpPort} elapsedMs=${Date.now() - t0}`);
      targetId = await this.createPageTarget(browserWs);
      this.logger.info(`[TokopediaBrowser] event=page_target_created targetId=${targetId} elapsedMs=${Date.now() - t0}`);
      const sessionId = await this.attachToTarget(browserWs, targetId);
      this.logger.info(`[TokopediaBrowser] event=page_target_attached sessionId=${sessionId} elapsedMs=${Date.now() - t0}`);
      await browserWs.send('Page.enable', {}, sessionId);
      await browserWs.send('Runtime.enable', {}, sessionId);
      this.logger.info(`[TokopediaBrowser] event=navigation_started url_host=www.tokopedia.com elapsedMs=${Date.now() - t0}`);
      const navResult = await browserWs.send('Page.navigate', { url: searchUrl }, sessionId);
      if (navResult.result?.errorText) { throw new Error(`TokopediaBrowser: NAVIGATION_FAILED — ${navResult.result.errorText}`); }
      await browserWs.waitForEvent('Page.loadEventFired', NAVIGATION_TIMEOUT_MS, sessionId).catch(() => {
        this.logger.warn('[TokopediaBrowser] Page.loadEventFired timeout — continuing');
      });
      this.logger.info(`[TokopediaBrowser] event=navigation_completed elapsedMs=${Date.now() - t0}`);
      await new Promise(r => setTimeout(r, RENDER_WAIT_MS));
      this.logger.info(`[TokopediaBrowser] event=render_wait_completed elapsedMs=${Date.now() - t0}`);
      this.logger.info(`[TokopediaBrowser] event=dom_extraction_started elapsedMs=${Date.now() - t0}`);
      const products = await this.extractProducts(browserWs, sessionId);
      this.logger.info(`[TokopediaBrowser] event=dom_extraction_completed products=${products.length} elapsedMs=${Date.now() - t0}`);
      if (products.length === 0) { throw new Error('TokopediaBrowser: DOM_EXTRACTION_FAILED — no product cards found in rendered DOM'); }
      this.logger.info(`[TokopediaBrowser] event=products_extracted count=${products.length} totalMs=${Date.now() - t0}`);
      const results = products.map(p => this.normalizeProduct(p, query)) as unknown as RawResultSet;
      this.logger.info(`[TokopediaBrowser] event=raw_result_created count=${results.length} totalMs=${Date.now() - t0}`);
      return results;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[TokopediaBrowser] event=source_error error="${msg}" elapsedMs=${Date.now() - t0}`);
      throw err;
    } finally {
      if (browserWs && targetId) { try { await browserWs.send('Target.closeTarget', { targetId }); } catch { /* ignore */ } }
      if (browserWs) browserWs.close();
      await this.shutdownBrowser();
      this.logger.info('[TokopediaBrowser] event=browser_shutdown');
    }
  }

  private async startBrowser(): Promise<CdpBrowserConnection> {
    const chromium = this.findChromium();
    if (!chromium) { throw new Error('TokopediaBrowser: BROWSER_START_FAILED — Chromium not found'); }
    this.cdpPort = 9230 + Math.floor(Math.random() * 100);
    this.browserProcess = spawn(chromium, [
      `--remote-debugging-port=${this.cdpPort}`, `--remote-debugging-address=127.0.0.1`,
      '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-background-networking', '--window-size=1280,900',
    ], { stdio: 'pipe' });
    this.browserProcess.on('error', (err: Error) => { this.logger.error(`[TokopediaBrowser] Chromium error: ${err.message}`); });
    let versionInfo: any = null;
    for (let i = 0; i < BROWSER_READY_TIMEOUT_MS / 1000; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try { versionInfo = await this.httpGetJson(`http://127.0.0.1:${this.cdpPort}/json/version`); if (versionInfo?.webSocketDebuggerUrl) break; } catch { /* retry */ }
    }
    if (!versionInfo?.webSocketDebuggerUrl) {
      throw new Error(`TokopediaBrowser: DEVTOOLS_NOT_READY after ${BROWSER_READY_TIMEOUT_MS / 1000}s (exit=${this.browserProcess?.exitCode})`);
    }
    this.logger.info(`[TokopediaBrowser] event=devtools_ready port=${this.cdpPort}`);
    const conn = new CdpBrowserConnection(versionInfo.webSocketDebuggerUrl);
    try { await conn.connect(); } catch (e) { throw new Error(`TokopediaBrowser: BROWSER_WS_CONNECT_FAILED — ${e instanceof Error ? e.message : String(e)}`); }
    this.logger.info(`[TokopediaBrowser] event=browser_ws_connected port=${this.cdpPort}`);
    return conn;
  }

  private async createPageTarget(ws: CdpBrowserConnection): Promise<string> {
    try { const r = await ws.send('Target.createTarget', { url: 'about:blank' }); const tid = r.result?.targetId; if (!tid) throw new Error('no targetId'); return tid; }
    catch (e) { throw new Error(`TokopediaBrowser: PAGE_TARGET_CREATE_FAILED — ${e instanceof Error ? e.message : String(e)}`); }
  }
  private async attachToTarget(ws: CdpBrowserConnection, targetId: string): Promise<string> {
    try { const r = await ws.send('Target.attachToTarget', { targetId, flatten: true }); const sid = r.result?.sessionId; if (!sid) throw new Error('no sessionId'); return sid; }
    catch (e) { throw new Error(`TokopediaBrowser: PAGE_TARGET_ATTACH_FAILED — ${e instanceof Error ? e.message : String(e)}`); }
  }

  private async extractProducts(ws: CdpBrowserConnection, sessionId: string): Promise<ExtractedProduct[]> {
    const expression = `(() => {
      var r = { products: [], count: 0, captcha: false, loginReq: false, url: location.href, title: document.title, bodyLen: document.body ? document.body.innerHTML.length : 0, bodyTextPreview: '', availableClasses: [] };
      var bt = document.body ? document.body.innerText.substring(0, 2000) : '';
      r.bodyTextPreview = bt.substring(0, 500);
      if (bt.match(/captcha|punish|robot check|are you a robot|access denied|error_page|verify you are human|slider.*verify/i)) r.captcha = true;
      if (r.url.includes('/punish') || r.url.includes('tmd') || r.url.includes('x5secdata')) r.captcha = true;
      if (bt.match(/login|sign in|log in|masuk|daftar/i) && bt.length < 500 && !r.captcha) r.loginReq = true;
      // Tokopedia product card selectors
      var sels = [
        '[data-testid="divProductWrapper"]', '[data-testid*="product"]',
        'div.css-1clrlwl', 'div.css-1do4j64', 'div.css-1slfhw',
        '[class*="product-card"]', '[class*="ProductCard"]', '[class*="product-item"]',
        '[class*="ItemCard"]', '[class*="item-card"]', '[class*="product-tile"]',
        'div[data-testid="divProductWrapper"] a', 'a[href*="/p/"]'
      ];
      var allCards = [];
      for (var i = 0; i < sels.length; i++) {
        var cards = document.querySelectorAll(sels[i]);
        if (cards.length > 0) { allCards = allCards.concat(Array.prototype.slice.call(cards)); }
      }
      r.count = allCards.length;
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
      for (var k = 0; k < Math.min(allCards.length, 10); k++) {
        var card = allCards[k];
        var text = card.innerText || '';
        var link = card.querySelector('a[href]');
        var priceEl = card.querySelector('[class*="price"], [class*="Price"]');
        var price = priceEl ? priceEl.innerText.trim() : null;
        if (!price) { var pm = text.match(/(?:Rp|IDR)\\s*[\\d.,]+/); if (pm) price = pm[0]; }
        var titleEl = card.querySelector('[class*="title"], [class*="Title"], [class*="name"], [class*="Name"]');
        var title = titleEl ? titleEl.innerText.trim() : text.substring(0, 150).replace(/\\n/g, ' ');
        r.products.push({ title: title, price: price, link: link ? link.href : null, image: !!card.querySelector('img') });
      }
      return JSON.stringify(r);
    })()`;
    const evalResult = await ws.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    const cdpResult = evalResult.result?.result || evalResult.result;
    const val = cdpResult?.value;
    if (!val) { throw new Error('TokopediaBrowser: DOM_EXTRACTION_FAILED — no value returned'); }
    let data: any;
    try { data = typeof val === 'string' ? JSON.parse(val) : val; } catch { throw new Error('TokopediaBrowser: DOM_EXTRACTION_FAILED — parse error'); }
    if (data.captcha) { throw new Error('TokopediaBrowser: CAPTCHA_REQUIRED — anti-bot page detected'); }
    if (data.loginReq) { throw new Error('TokopediaBrowser: LOGIN_REQUIRED — login page detected'); }
    if (data.count === 0) {
      this.logger.warn(`[TokopediaBrowser] event=dom_diagnostic title="${data.title || 'none'}" url="${data.url || 'none'}" bodyLen=${data.bodyLen || 0} bodyText="${(data.bodyTextPreview || '').substring(0, 200)}" availableClasses=${JSON.stringify(data.availableClasses || [])}`);
    }
    return data.products || [];
  }

  private validateUrl(url: string): void {
    let parsed: URL; try { parsed = new URL(url); } catch { throw new Error(`TokopediaBrowser: invalid URL ${url}`); }
    if (!ALLOWED_DOMAINS.includes(parsed.hostname)) { throw new Error(`TokopediaBrowser: domain ${parsed.hostname} not allowlisted`); }
  }
  private normalizeProduct(p: ExtractedProduct, query: string): Record<string, unknown> {
    return {
      url: p.link || '', title: p.title || '', price: this.parsePrice(p.price), currency: 'IDR',
      seller: null, sellerId: null, rating: null, reviewCount: null, soldCount: null, image: null,
      productId: this.extractProductId(p.link),
      rawMetadata: { query, source: 'tokopedia', acquisition: 'BROWSER_RENDERED', title: p.title, price: p.price, link: p.link },
    };
  }
  private parsePrice(priceStr: unknown): number | null {
    return parsePriceValue(priceStr);
  }
  private extractProductId(url: string | null): string | null {
    if (!url) return null; const m = url.match(/\/p\/(\d+)/); return m ? m[1] : null;
  }
  private findChromium(): string | null {
    const candidates = ['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/local/bin/chromium',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'];
    for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* skip */ } } return null;
  }
  private async shutdownBrowser(): Promise<void> {
    if (this.browserProcess) { try { this.browserProcess.kill('SIGTERM'); } catch { /* ignore */ } await new Promise(r => setTimeout(r, 500));
      try { if (this.browserProcess.exitCode === null) this.browserProcess.kill('SIGKILL'); } catch { /* ignore */ } this.browserProcess = null; }
  }
  private httpGetJson(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      http.get(url, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d))}catch{reject(new Error('parse fail'))}}); }).on('error', reject);
    });
  }
  async fetch(_t: string): Promise<RawPayload> { throw new Error('Not supported'); }
  async parse(_r: RawDocument): Promise<ParsedEntities> { throw new Error('Not supported'); }
  async normalize(parsedData: ParsedEntity): Promise<CanonicalProduct> {
    const raw = parsedData as any;
    const title = raw.title || '';
    const price: number | null =
      typeof raw.price === 'number'
        ? (Number.isFinite(raw.price) ? raw.price : null)
        : this.parsePrice(raw.price);
    const url = raw.url || raw.link || '';
    const productId = this.extractProductId(url) || '';
    return {
      id: `tokopedia_${productId}_${Date.now()}` as any, canonicalTitle: title, brand: null, model: null,
      categoryId: null, standardUnit: 'piece', standardWeightGrams: null, standardDimensionsCm: null,
      sku: productId || null, barcode: null, priceInIdr: price, currencyConverted: false, moq: 1,
      packageQuantity: 1, packageUnit: 'piece', sourceId: 'tokopedia-browser' as any, supplierProductId: null,
      marketplaceListingId: productId as any, sellerId: null, sellerName: null, marketplaceListingUrl: url,
      observedAt: new Date().toISOString() as any, confidence: 0.8,
      dataLineage: { sourceId: 'tokopedia-browser' as any, rawDocumentId: `tokopedia_${productId}` as any,
        rawEvidenceHash: raw.rawMetadata ? JSON.stringify(raw.rawMetadata).length.toString() : '0',
        extractionMethod: 'BROWSER_RENDERED', observedAt: new Date().toISOString() as any,
        confidence: 0.8, evidenceHierarchyLevel: 3 as 1|2|3|4|5|6 },
      dataProvenance: 'REAL_PUBLIC_WEB', acquisitionMethod: 'BROWSER_RENDERED',
      retrievedAt: new Date().toISOString() as any,
    };
  }
  computeCrawlPriority(): number { return 50; }
  getCapabilities(): CapabilityMatrix {
    return { supportsDiscover: false, supportsSearch: true, supportsFetch: false, supportsParse: false,
      supportsNormalize: false, supportsHealthCheck: true, extras: { acquisitionMethod: 'BROWSER_RENDERED' } };
  }
  async getHealth(): Promise<SourceHealthStatus> {
    return { isHealthy: true, statusCode: null, latencyMs: null, errorMessage: null, checkedAt: new Date().toISOString(), errorCount24h: 0 };
  }
  getMetadata(): SourceMetadata {
    return { id: 'tokopedia-browser' as any, name: this.sourceName, adapterName: this.adapterName,
      baseUrl: this.baseUrl, isActive: this.isActive, trustTier: this.trustTier, createdAt: new Date().toISOString() as any };
  }
}
