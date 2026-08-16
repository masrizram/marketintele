/**
 * Supplier Credential Validation & Integration Harness (Phase 2)
 *
 * Validates that supplier adapter credentials are available in the
 * environment. If credentials are NOT available, real supplier runtime
 * is classified as NOT_TESTED — no fabrication.
 *
 * This harness provides:
 *   - validateSupplierCredentials(): checks env for supplier API keys
 *   - SupplierIntegrationHarness: orchestrates real adapter calls
 *   - Recorded response test infrastructure for deterministic testing
 */
import { SupplierAdapter, SupplierOffer } from './supplier-adapter';
import { CanonicalProduct } from '../types';

export interface SupplierCredentialConfig {
  /** Environment variable name for the API key/token. */
  envVar: string;
  /** Whether the credential is required for production. */
  required: boolean;
  /** Human-readable description. */
  description: string;
}

export const REQUIRED_SUPPLIER_CREDENTIALS: SupplierCredentialConfig[] = [
  { envVar: 'ALIBABA_API_KEY', required: false, description: 'Alibaba.com B2B API key' },
  { envVar: 'MADE_IN_CHINA_API_KEY', required: false, description: 'Made-in-China.com API key' },
  { envVar: 'GLOBAL_SOURCES_API_KEY', required: false, description: 'GlobalSources.com API key' },
  { envVar: 'SUPPLIER_API_URL', required: false, description: 'Custom supplier API endpoint' },
  { envVar: 'SUPPLIER_API_TOKEN', required: false, description: 'Custom supplier API auth token' },
];

export interface CredentialValidationResult {
  hasAnyCredentials: boolean;
  availableCredentials: string[];
  missingCredentials: string[];
  realSupplierRuntimePossible: boolean;
  status: 'CREDENTIALS_AVAILABLE' | 'NO_CREDENTIALS';
  detail: string;
}

/**
 * Validate supplier credentials from the environment.
 *
 * If no credentials are available, real supplier runtime is NOT_TESTED.
 * This function MUST NOT fabricate credentials or pretend credentials exist.
 */
export function validateSupplierCredentials(): CredentialValidationResult {
  const available: string[] = [];
  const missing: string[] = [];

  for (const cred of REQUIRED_SUPPLIER_CREDENTIALS) {
    const value = process.env[cred.envVar];
    if (value && value.trim().length > 0 && !value.includes('YOUR_') && !value.includes('CHANGE_ME')) {
      available.push(cred.envVar);
    } else {
      missing.push(cred.envVar);
    }
  }

  const hasAny = available.length > 0;

  return {
    hasAnyCredentials: hasAny,
    availableCredentials: available,
    missingCredentials: missing,
    realSupplierRuntimePossible: hasAny,
    status: hasAny ? 'CREDENTIALS_AVAILABLE' : 'NO_CREDENTIALS',
    detail: hasAny
      ? `${available.length} credential(s) available: ${available.join(', ')}`
      : `No supplier API credentials found in environment. Real supplier runtime = NOT_TESTED. Available credentials: none. Missing: ${missing.join(', ')}`,
  };
}

/**
 * Supplier Integration Harness
 *
 * Provides a structured way to test real supplier adapters when
 * credentials are available. When credentials are NOT available,
 * tests are skipped (NOT_TESTED).
 */
export class SupplierIntegrationHarness {
  constructor(private adapter: SupplierAdapter) {}

  /**
   * Run a real supplier search. Throws if credentials are not available.
   */
  async searchSuppliers(query: string, product: CanonicalProduct): Promise<SupplierOffer[]> {
    const credResult = validateSupplierCredentials();
    if (!credResult.realSupplierRuntimePossible) {
      throw new Error(`Cannot run real supplier search: ${credResult.detail}`);
    }
    return this.adapter.searchSuppliers(query, product);
  }

  /**
   * Verify a real supplier. Throws if credentials are not available.
   */
  async verifySupplier(supplier: any): Promise<any> {
    const credResult = validateSupplierCredentials();
    if (!credResult.realSupplierRuntimePossible) {
      throw new Error(`Cannot run real supplier verification: ${credResult.detail}`);
    }
    return this.adapter.verifySupplier(supplier);
  }
}

/**
 * Recorded response — a deterministic supplier response captured from
 * a real API call. Used for recorded-response testing when live API
 * access is not available in the test environment.
 */
export interface RecordedSupplierResponse {
  query: string;
  response: SupplierOffer[];
  recordedAt: string;
  sourceAdapter: string;
  /** Whether this was captured from a real API or is a fixture. */
  isRealCapture: boolean;
}
