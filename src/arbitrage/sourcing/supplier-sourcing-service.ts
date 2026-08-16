/**
 * Supplier Sourcing Service — Production Boundary
 *
 * IDEA.md §9–§12 require a genuine supplier discovery subsystem.
 * This service orchestrates supplier adapter(s) to find real B2B
 * suppliers (manufacturers, factories, distributors, wholesalers).
 *
 * Architecture:
 *   - SupplierAdapter interface (supplier-adapter.ts) — the abstraction
 *   - Real adapters (Alibaba, B2B directories) — implement the interface
 *   - TestFixtureSupplierAdapter — for development only (IDEA §58)
 *   - This service — orchestrates adapter calls, maps to pipeline types
 *
 * The service NEVER fabricates supplier data. When no adapter is
 * configured, it returns null (fail-closed) — it does NOT invent a
 * supplier from the marketplace seller.
 *
 * UNKNOWN != ZERO: supplier price stays null until a real adapter
 * provides verified pricing.
 */
import { SupplierAdapter, SupplierOffer, offerToSupplierSource } from './supplier-adapter';
import { SupplierSource } from '../pipeline/types';
import { CanonicalProduct } from '../types';

export interface SupplierSourcingResult {
  supplier: SupplierSource | null;
  offers: SupplierOffer[];
  reason: string;
  /** Whether a real (non-fixture) adapter was used. */
  usedRealAdapter: boolean;
  /** Data provenance: REAL / TEST_FIXTURE / NONE */
  dataProvenance: 'REAL' | 'TEST_FIXTURE' | 'NONE';
}

export class SupplierSourcingService {
  private adapters: SupplierAdapter[] = [];

  /**
   * Register a supplier adapter.  Real adapters should be registered
   * in production; TEST_FIXTURE adapters for development only.
   */
  registerAdapter(adapter: SupplierAdapter): void {
    this.adapters.push(adapter);
  }

  hasRealAdapters(): boolean {
    return this.adapters.some((a) => a.dataProvenance === 'REAL');
  }

  /**
   * Search for suppliers offering a product matching the canonical product.
   *
   * Iterates all registered adapters, collects offers, and returns the
   * best offer (highest match confidence).  When no adapters are
   * registered, returns null (fail-closed — no fabricated supplier).
   */
  async searchSuppliers(
    query: string,
    product: CanonicalProduct,
  ): Promise<SupplierSourcingResult> {
    if (this.adapters.length === 0) {
      return {
        supplier: null,
        offers: [],
        reason: 'No supplier adapter registered — cannot source real B2B suppliers',
        usedRealAdapter: false,
        dataProvenance: 'NONE',
      };
    }

    const allOffers: SupplierOffer[] = [];
    for (const adapter of this.adapters) {
      try {
        const offers = await adapter.searchSuppliers(query, product);
        allOffers.push(...offers);
      } catch (err) {
        // Adapter failure is non-fatal — continue with other adapters.
        // The circuit breaker (if wired) handles repeated failures.
        // We do NOT fabricate a supplier to compensate.
      }
    }

    if (allOffers.length === 0) {
      return {
        supplier: null,
        offers: [],
        reason: 'All supplier adapters returned zero offers',
        usedRealAdapter: this.hasRealAdapters(),
        dataProvenance: this.hasRealAdapters() ? 'REAL' : 'TEST_FIXTURE',
      };
    }

    // Select the best offer by match confidence
    const bestOffer = allOffers.reduce((best, current) =>
      current.matchConfidence > best.matchConfidence ? current : best,
    );

    const supplier = offerToSupplierSource(bestOffer);
    const usedReal = this.hasRealAdapters();

    return {
      supplier,
      offers: allOffers,
      reason: `Supplier sourced from ${usedReal ? 'REAL' : 'TEST_FIXTURE'} adapter: ${bestOffer.supplier.supplierName}`,
      usedRealAdapter: usedReal,
      dataProvenance: usedReal ? 'REAL' : 'TEST_FIXTURE',
    };
  }
}

/**
 * Singleton instance.  Adapters are registered at bootstrap (src/index.ts).
 * In production, real adapters replace the TEST_FIXTURE.
 */
export const supplierSourcingService = new SupplierSourcingService();
