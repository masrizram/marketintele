/**
 * Base Source Adapter — shared infrastructure for all marketplace/supplier adapters.
 *
 * Provides rate limiting, SSRF firewall, content hashing, retry with jitter,
 * and crawl prioritization computation.
 */

import axios from 'axios';
import * as axiosRetryModule from 'axios-retry';
const axiosRetry = (axiosRetryModule as any).default || axiosRetryModule;
import { ulid } from 'ulid';
import pino from 'pino';
import { lookup as dnsLookup } from 'dns/promises';
import { isIP } from 'net';
import { config } from '../../config';
import { logger } from '../lib/logger';
import {
  SourceAdapter,
  SourceMetadata,
  CapabilityMatrix,
  RawPayload,
  RawDocument,
  ParsedEntities,
  ParsedEntity,
  CanonicalProduct,
  SourceHealthStatus,
  CrawlPrioritizationInput,
  computeSourceEconomicValue,
} from '../types';
import { sha256 } from '../lib/hash';
import { delay, jitter } from '../lib/utils';

export abstract class BaseSourceAdapter implements SourceAdapter {
  readonly abstract adapterName: string;
  readonly abstract sourceName: string;
  readonly abstract baseUrl: string | null;
  readonly abstract trustTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';
  readonly abstract isActive: boolean;

  protected readonly logger: pino.Logger;
  protected readonly rateLimiterMap: Map<string, number> = new Map();
  protected readonly maxConcurrentPerDomain = config.maxConcurrentRequests;

  constructor() {
    this.logger = logger;
  }

  abstract search(query: string, _filters?: Record<string, unknown>): Promise<unknown>;
  abstract fetch(target: string): Promise<RawPayload>;
  abstract parse(rawDocument: RawDocument): Promise<ParsedEntities>;
  abstract normalize(parsedData: ParsedEntity): Promise<CanonicalProduct>;

  discover?(): Promise<string[]>;
  healthCheck?(): Promise<SourceHealthStatus>;

  getMetadata(): SourceMetadata {
    return {
      id: ulid(),
      name: this.sourceName,
      adapterName: this.adapterName,
      baseUrl: this.baseUrl,
      isActive: this.isActive,
      trustTier: this.trustTier,
      createdAt: new Date().toISOString(),
    };
  }

  getCapabilities(): CapabilityMatrix {
    return {
      supportsDiscover: !!this.discover,
      supportsSearch: true,
      supportsFetch: true,
      supportsParse: true,
      supportsNormalize: true,
      supportsHealthCheck: !!this.healthCheck,
      extras: {},
    };
  }

  protected async throttle(domain: string): Promise<void> {
    const now = Date.now();
    const last = this.rateLimiterMap.get(domain) || 0;
    const minInterval = 1000;
    const elapsed = now - last;
    if (elapsed < minInterval) {
      await delay(minInterval - elapsed);
    }
    this.rateLimiterMap.set(domain, Date.now());
  }

  /**
   * SSRF firewall — validates that a URL does not resolve to a private,
   * loopback, link-local, or otherwise reserved IP range.
   *
   * This performs DNS resolution to defend against DNS-rebinding and
   * redirect-to-private-IP attacks (AUDIT §15.2).  A hostname that
   * *looks* public (e.g. "evil.com") but resolves to 127.0.0.1 is
   * blocked.
   *
   * NOTE: axios follows redirects by default.  Callers should set
   * `maxRedirects` appropriately and treat any redirect as untrusted
   * (re-validate the final URL).  The fetchWithRetry helper caps
   * maxRedirects to limit exposure.
   */
  protected async isSafeUrl(url: string): Promise<boolean> {
    if (!config.ssrfFirewallEnabled) return true;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      this.logger.warn(`SSRF firewall: cannot parse URL ${url}`);
      return false;
    }

    const hostname = parsed.hostname;

    // Only HTTP(S) are allowed — block file://, ftp://, javascript:, data:, etc.
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      this.logger.warn(`SSRF firewall: unsupported protocol ${protocol} for ${url}`);
      return false;
    }

    // Fast path: if the hostname is already a literal IP, validate it
    // directly.  Otherwise resolve DNS and validate every returned A/AAAA.
    const literalType = isIP(hostname);
    const addressesToCheck: string[] = [];

    if (literalType !== 0) {
      addressesToCheck.push(hostname);
    } else {
      // Block obvious private hostnames before DNS lookup
      const blockedHostnamePatterns = [
        /^localhost$/i,
        /^0\.0\.0\.0$/,
        /^metadata\.google\.internal$/i, // cloud metadata endpoint
      ];
      if (blockedHostnamePatterns.some((p) => p.test(hostname))) {
        this.logger.warn(`SSRF firewall blocked hostname: ${url}`);
        return false;
      }

      try {
        const records = await dnsLookup(hostname, { all: true });
        for (const r of records) {
          addressesToCheck.push(r.address);
        }
      } catch {
        this.logger.warn(`SSRF firewall: DNS resolution failed for ${hostname}`);
        return false;
      }
    }

    if (addressesToCheck.length === 0) {
      this.logger.warn(`SSRF firewall: no DNS records for ${hostname}`);
      return false;
    }

    for (const ip of addressesToCheck) {
      if (this.isPrivateIp(ip)) {
        this.logger.warn(`SSRF firewall blocked private/reserved IP ${ip} for ${url}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Comprehensive private / reserved IP range check (IPv4 + IPv6).
   * Covers: loopback, private, link-local, CGNAT, cloud metadata,
   * benchmarking, documentation, and unique-local ranges.
   */
  protected isPrivateIp(ip: string): boolean {
    const v = isIP(ip);
    if (v === 4) {
      const parts = ip.split('.').map(Number);
      const [a, b] = parts;
      // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16 (link-local)
      // 172.16.0.0/12 (private), 192.168.0.0/16 (private)
      // 100.64.0.0/10 (CGNAT), 192.0.2.0/24 (TEST-NET-1),
      // 198.51.100.0/24 (TEST-NET-2), 203.0.113.0/24 (TEST-NET-3)
      // 224.0.0.0/4 (multicast), 240.0.0.0/4 (reserved)
      if (a === 0 || a === 10 || a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 192 && b === 0 && parts[2] === 2) return true;
      if (a === 198 && b === 51 && parts[2] === 100) return true;
      if (a === 203 && b === 0 && parts[2] === 113) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
      if (a >= 224) return true;
      return false;
    }
    if (v === 6) {
      const lc = ip.toLowerCase();
      // ::1 (loopback), fe80::/10 (link-local), fc00::/7 (unique-local),
      // ff00::/8 (multicast), :: (unspecified)
      if (lc === '::1' || lc === '::') return true;
      if (lc.startsWith('fe8') || lc.startsWith('fe9') ||
          lc.startsWith('fea') || lc.startsWith('feb')) return true;
      if (lc.startsWith('fc') || lc.startsWith('fd')) return true;
      if (lc.startsWith('ff')) return true;
      // IPv4-mapped IPv6 (::ffff:a.b.c.d) — extract and re-check
      const mapped = lc.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
      if (mapped) return this.isPrivateIp(mapped[1]);
      return false;
    }
    return false;
  }

  protected computeContentHash(body: string): string {
    return sha256(body);
  }

  protected async fetchWithRetry(
    url: string,
    axiosConfig: any,
    maxRetries = 3,
  ): Promise<any> {
    axiosRetry(axios, {
      retries: maxRetries,
      retryCondition: (err: any) => {
        return err.response?.status === 429 || err.response?.status === 503;
      },
      retryDelay: (retryCount: number) =>
        jitter(1000 * Math.pow(2, retryCount - 1), 10000),
      shouldResetTimeout: true,
    });

    // SSRF redirect firewall (IDEA §41 / AUDIT §44):
    // Disable axios auto-redirect and manually follow each redirect,
    // re-validating EVERY redirect destination through isSafeUrl().
    // This blocks redirect-to-private-IP and DNS-rebinding-via-redirect attacks
    // that would bypass the initial isSafeUrl() check.
    const MAX_SAFE_REDIRECTS = 3;
    const mergedConfig = {
      maxRedirects: 0, // we handle redirects manually
      ...axiosConfig,
    };

    let currentUrl = url;
    for (let redirectCount = 0; redirectCount <= MAX_SAFE_REDIRECTS; redirectCount++) {
      // Re-validate the current URL on every hop (including the initial one).
      const isSafe = await this.isSafeUrl(currentUrl);
      if (!isSafe) {
        throw new Error(`SSRF firewall blocked URL (redirect hop ${redirectCount}): ${currentUrl}`);
      }
      const hopConfig = { ...mergedConfig, url: currentUrl, maxRedirects: 0 };
      let response: any;
      try {
        response = await axios(hopConfig);
      } catch (err: any) {
        // axios throws on 3xx when maxRedirects=0 — extract the response
        if (err?.response && err.response.status >= 300 && err.response.status < 400) {
          response = err.response;
        } else {
          throw err;
        }
      }
      // If not a redirect, return the response
      if (!response || response.status < 300 || response.status >= 400) {
        return response;
      }
      // It's a redirect — extract Location header
      const location = response.headers?.location;
      if (!location) {
        // 3xx with no Location — return the response as-is
        return response;
      }
      // Resolve relative redirects against the current URL
      currentUrl = new URL(location, currentUrl).href;
    }
    throw new Error(`SSRF firewall: too many redirects (>${MAX_SAFE_REDIRECTS}) — possible redirect loop`);
  }

  computeCrawlPriority(input: CrawlPrioritizationInput): number {
    return computeSourceEconomicValue(input);
  }
}
