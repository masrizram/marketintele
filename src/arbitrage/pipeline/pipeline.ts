/**
 * Arbitrage Pipeline Orchestrator
 *
 * Runs the full end-to-end pipeline:
 *   Telegram command
 *   → Discovery
 *   → Adapter (fetch + parse + normalize)
 *   → Matching
 *   → Supplier/Source
 *   → Landed Cost
 *   → Profit
 *   → Risk
 *   → Opportunity Decision
 *   → Formatted Result
 *
 * This is the core business logic that connects all pipeline stages.
 * Each stage logs with the correlation/request ID for traceability.
 */
import { ulid } from 'ulid';
import { PipelineContext, PipelineResult, PipelineStage } from './types';
import { discoveryService } from './discovery';
import { matchProduct } from './matching';
import { resolveSupplier } from './supplier';
import { computeEconomics } from './economics';
import { assessRisk, RiskInput } from './risk';
import { decideOpportunity } from './decision';
import { formatPipelineResult } from './formatter';
import { createRequestLogger } from './logger';
import { computeMarketClearingPrice, MarketListing } from '../intelligence/market-clearing';
import { assessDemand } from '../intelligence/demand';
import { assessCompetition } from '../intelligence/competition';
import { computeOpportunityDecay } from '../intelligence/opportunity-decay';
import { computeExpectedValue, buildDefaultScenarioProbabilities } from '../intelligence/expected-value';
import { assessComprehensiveRisk } from '../intelligence/risk-assessment';
import { supplierSourcingService } from '../sourcing/supplier-sourcing-service';
import { recordPipelineRun, recordOpportunityDecision, metricsRegistry } from '../observability/metrics';

export class ArbitragePipeline {
  private readonly discoveryTimeoutMs: number;

  constructor(timeoutMs: number = 30000) {
    this.discoveryTimeoutMs = timeoutMs;
  }

  /**
   * Execute the full arbitrage pipeline for a single product query.
   *
   * Returns a PipelineResult with all stages executed and evidence collected.
   */
  async execute(
    userId: number,
    query: string,
    marketplace: string | null = null,
    stages: PipelineStage = 'full',
  ): Promise<PipelineResult> {
    const requestId = `req_${ulid()}`;
    const correlationId = `corr_${ulid()}`;
    const reqLogger = createRequestLogger(requestId);

    const context: PipelineContext = {
      requestId,
      correlationId,
      userId,
      query,
      requestedAt: new Date().toISOString(),
    };

    reqLogger.info('Pipeline started', {
      userId,
      query,
      marketplace,
      stages,
      correlationId,
    });

    const startTime = Date.now();
    const result: PipelineResult = {
      context,
      discovery: null,
      canonicalProduct: null,
      supplier: null,
      economics: null,
      risk: null,
      marketClearingPrice: null,
      demand: null,
      competition: null,
      decay: null,
      expectedValue: null,
      comprehensiveRisk: null,
      opportunity: null,
      formattedResult: '',
      error: null,
      elapsedMs: 0,
    };

    try {
      // ─── Stage 1: Discovery ────────────────────────────────────────────────
      reqLogger.info('Stage: Discovery');
      const discoveryResult = await discoveryService.discover(context, query, marketplace, this.discoveryTimeoutMs);
      result.discovery = discoveryResult;

      if (discoveryResult.status !== 'SUCCESS' || discoveryResult.products.length === 0) {
        reqLogger.info('Discovery did not yield products', { status: discoveryResult.status });
        result.error = `Discovery ${discoveryResult.status}: ${discoveryResult.error || 'No products found'}`;
        result.formattedResult = formatPipelineResult(result, reqLogger);
        result.elapsedMs = Date.now() - startTime;
        return result;
      }

      // Use the best product from discovery (highest confidence)
      const bestProduct = discoveryResult.products.reduce((best, current) =>
        (current.confidence > best.confidence ? current : best),
      );

      reqLogger.info('Selected best product from discovery', {
        productId: bestProduct.id,
        title: bestProduct.canonicalTitle,
        confidence: bestProduct.confidence,
        priceInIdr: bestProduct.priceInIdr,
      });

      result.canonicalProduct = bestProduct;

      // ─── Stage 1b: Market Clearing Price (IDEA §16) ──────────────────────
      // Aggregate ALL discovery results into a market clearing price — never
      // use a single listing price as the selling price.
      reqLogger.info('Stage: Market Clearing Price');
      try {
        const listings: MarketListing[] = discoveryResult.products.map((p) => ({
          listingId: p.id,
          sellerId: p.sellerId || 'unknown',
          sellerName: p.sellerName,
          price: p.priceInIdr ?? 0,
          originalPrice: null,
          rating: null,
          reviewCount: null,
          soldCount: null,
          stock: null,
          title: p.canonicalTitle,
          observedAt: p.observedAt,
          sourceUrl: p.marketplaceListingUrl,
        }));
        result.marketClearingPrice = computeMarketClearingPrice(listings);
        reqLogger.info('Market clearing price computed', {
          clearingPrice: result.marketClearingPrice.marketClearingPrice,
          confidence: result.marketClearingPrice.priceConfidence,
          effectiveSample: result.marketClearingPrice.effectiveSampleSize,
        });
      } catch (err) {
        reqLogger.warn('Market clearing price computation failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // ─── Stage 2: Matching ─────────────────────────────────────────────────
      reqLogger.info('Stage: Matching');
      // Since we don't have a supplier product database yet, we match the
      // marketplace product to itself (identity match) with confidence from the adapter
      const matchInput = {
        marketplaceProduct: bestProduct,
        canonicalProduct: bestProduct,  // Self-match in absence of supplier product DB
      };
      const matchResult = matchProduct(matchInput.marketplaceProduct, [matchInput.canonicalProduct], 0.3);
      // In production, candidates would come from the supplier product database.
      // For now, the marketplace product IS our canonical product.
      const matchedProduct = matchResult.canonicalProduct || bestProduct;

      reqLogger.info('Matching completed', {
        matchType: matchResult.match.matchType,
        matchScore: matchResult.match.matchScore,
        isVerified: matchResult.match.isVerified,
      });

      // ─── Stage 3: Supplier Resolution ──────────────────────────────────────
      // IDEA §9: Use the supplier sourcing service (real B2B adapters) when
      // available.  Fall back to marketplace-seller derivation when no
      // adapter is registered (supplier cost stays null — fail-closed).
      reqLogger.info('Stage: Supplier Resolution');
      let supplierResult;
      let supplierSourcingProvenance: string = 'NONE';

      if (supplierSourcingService['adapters'].length > 0) {
        reqLogger.info('Using supplier sourcing service (B2B adapter)');
        const sourcingResult = await supplierSourcingService.searchSuppliers(query, matchedProduct);
        supplierSourcingProvenance = sourcingResult.dataProvenance;
        if (sourcingResult.supplier) {
          supplierResult = {
            supplier: sourcingResult.supplier,
            reason: sourcingResult.reason,
          };
          reqLogger.info('Supplier sourced via adapter', {
            supplierId: sourcingResult.supplier.id,
            supplierName: sourcingResult.supplier.name,
            dataProvenance: sourcingResult.dataProvenance,
            sourcePriceIdr: sourcingResult.supplier.sourcePriceIdr,
          });
        } else {
          // Adapter found no offers — fall back to marketplace-seller derivation
          reqLogger.info('Supplier adapter returned no offers — falling back to marketplace-seller derivation');
          supplierResult = await resolveSupplier({
            canonicalProduct: matchedProduct,
            marketplace: discoveryResult.marketplace,
            sellerId: matchedProduct.sellerId || (bestProduct as any).sellerId || null,
            sellerName: matchedProduct.sellerName || (bestProduct as any).sellerName || null,
            productUrl: matchedProduct.marketplaceListingUrl || null,
          });
        }
      } else {
        // No adapter registered — use marketplace-seller derivation (fail-closed)
        supplierResult = await resolveSupplier({
          canonicalProduct: matchedProduct,
          marketplace: discoveryResult.marketplace,
          sellerId: matchedProduct.sellerId || (bestProduct as any).sellerId || null,
          sellerName: matchedProduct.sellerName || (bestProduct as any).sellerName || null,
          productUrl: matchedProduct.marketplaceListingUrl || null,
        });
      }

      result.supplier = supplierResult.supplier;
      reqLogger.info('Supplier resolved', {
        supplierId: supplierResult.supplier?.id,
        supplierName: supplierResult.supplier?.name,
        confidence: supplierResult.supplier?.confidence,
        sourcePriceIdr: supplierResult.supplier?.sourcePriceIdr,
        shippingCostIdr: supplierResult.supplier?.shippingCostIdr,
        sourcingProvenance: supplierSourcingProvenance,
      });

      if (!supplierResult.supplier) {
        result.error = `Supplier not resolved: ${supplierResult.reason}`;
        result.formattedResult = formatPipelineResult(result, reqLogger);
        result.elapsedMs = Date.now() - startTime;
        return result;
      }

      // ─── Stage 4: Economics (Landed Cost + Profit) ─────────────────────────
      reqLogger.info('Stage: Economics');
      // Use the conservative market clearing price (P25) when available —
      // IDEA §16: never use a single listing price as the selling price.
      const clearingPrice = result.marketClearingPrice?.marketClearingPrice;
      const sellingPriceIdr = clearingPrice !== null && clearingPrice !== undefined && clearingPrice > 0
        ? clearingPrice
        : bestProduct.priceInIdr || 0;
      const supplierPriceIdr = supplierResult.supplier.sourcePriceIdr;
      const supplierMoq = supplierResult.supplier.moq;
      const shippingCostIdr = supplierResult.supplier.shippingCostIdr;

      const economicsResult = computeEconomics(
        bestProduct,
        discoveryResult.marketplace,
        sellingPriceIdr,
        supplierPriceIdr,
        supplierMoq,
        shippingCostIdr,
        requestId,
      );

      result.economics = economicsResult;

      reqLogger.info('Economics computed', {
        sellingPriceIdr,
        clearingPriceUsed: clearingPrice !== null && clearingPrice !== undefined,
        landedCost: economicsResult.landedCost,
        marketplaceFee: economicsResult.marketplaceFee,
        hasProfit: economicsResult.profitCalculation !== null,
        reconciled: economicsResult.profitCalculation?.reconciled,
        independentValidation: economicsResult.profitCalculation?.independentValidation,
        profitError: economicsResult.profitError,
      });

      // ─── Stage 4b: Demand Intelligence (IDEA §18) ──────────────────────────
      reqLogger.info('Stage: Demand Intelligence');
      try {
        result.demand = assessDemand({
          soldCount: null, // not exposed by current adapters
          reviewCount: null,
          reviewVelocity: null,
          ranking: null,
          listingGrowth: null,
          sellerCount: result.marketClearingPrice?.sellerCount ?? null,
          historicalPriceObservations: [],
          observedAt: bestProduct.observedAt,
        });
        reqLogger.info('Demand assessed', {
          demandScore: result.demand.demandScore,
          demandClass: result.demand.demandClass,
        });
      } catch (err) {
        reqLogger.warn('Demand assessment failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // ─── Stage 4c: Competition Intelligence (IDEA §19) ─────────────────────
      reqLogger.info('Stage: Competition Intelligence');
      try {
        const compListings = discoveryResult.products.map((p) => ({
          listingId: p.id,
          sellerId: p.sellerId || 'unknown',
          sellerName: p.sellerName,
          price: p.priceInIdr ?? 0,
          originalPrice: null,
          rating: null,
          reviewCount: null,
          soldCount: null,
          stock: null,
          title: p.canonicalTitle,
          observedAt: p.observedAt,
          sourceUrl: p.marketplaceListingUrl,
        }));
        result.competition = assessCompetition({
          listings: compListings,
          priceChangeFrequency: null,
          recentUndercutCount: null,
          observedAt: new Date().toISOString(),
        });
        reqLogger.info('Competition assessed', {
          competitionLevel: result.competition.competitionLevel,
          priceWarRisk: result.competition.priceWarRisk,
        });
      } catch (err) {
        reqLogger.warn('Competition assessment failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // ─── Stage 5: Risk Assessment ──────────────────────────────────────────
      reqLogger.info('Stage: Risk Assessment');
      const riskInput: RiskInput = {
        product: matchedProduct,
        supplier: supplierResult.supplier,
        economics: economicsResult,
        marketplace: discoveryResult.marketplace,
        listingAgeHours: null,  // Not available from current adapter
        requestId,
      };
      const riskResult = assessRisk(riskInput);
      result.risk = riskResult;

      // ─── Stage 5b: Comprehensive Risk (11 dimensions, IDEA §27) ────────────
      reqLogger.info('Stage: Comprehensive Risk');
      try {
        result.comprehensiveRisk = assessComprehensiveRisk({
          product: matchedProduct,
          supplier: supplierResult.supplier,
          economics: economicsResult,
          demand: result.demand,
          competition: result.competition,
          decay: result.decay,
          marketplace: discoveryResult.marketplace,
          requestId,
        });
        reqLogger.info('Comprehensive risk assessed', {
          overallRisk: result.comprehensiveRisk.overallRisk,
          dimensions: result.comprehensiveRisk.dimensions.length,
        });
      } catch (err) {
        reqLogger.warn('Comprehensive risk assessment failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // ─── Stage 5c: Opportunity Decay (IDEA §31) ───────────────────────────
      reqLogger.info('Stage: Opportunity Decay');
      try {
        result.decay = computeOpportunityDecay({
          discoveredAt: context.requestedAt,
          lastPriceObservedAt: bestProduct.observedAt,
          lastSupplierVerifiedAt: supplierResult.supplier.observedAt,
          now: null,
          halfLifeHours: 24,
          priceChangeVelocity: null,
          supplierPriceChangeVelocity: null,
          competitionChangeVelocity: null,
          marketPriceTtlHours: 4,
          supplierPriceTtlHours: 72,
        });
        reqLogger.info('Decay computed', {
          freshness: result.decay.freshness,
          staleCriticalData: result.decay.staleCriticalData,
        });
      } catch (err) {
        reqLogger.warn('Decay computation failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // ─── Stage 5d: Expected Value (IDEA §26) ──────────────────────────────
      reqLogger.info('Stage: Expected Value');
      try {
        if (economicsResult.profitCalculation && economicsResult.profitCalculation.primaryResult.netProfitPerUnit.gt(0)) {
          const netProfit = economicsResult.profitCalculation.primaryResult.netProfitPerUnit.toNumber();
          const capitalLoss = economicsResult.landedCost ?? 0;
          // Base success probability derived from confidence + risk (HEURISTIC)
          const confidenceFactor = riskResult.confidenceScore;
          const baseSuccessProb = Math.max(0.05, Math.min(0.9, confidenceFactor * 0.7));
          const scenarioProbs = buildDefaultScenarioProbabilities(baseSuccessProb);
          result.expectedValue = computeExpectedValue({
            successProfit: netProfit,
            failureCapitalLoss: capitalLoss,
            successProbability: scenarioProbs[1], // BASE
            scenarios: {
              probabilities: scenarioProbs,
              payoffs: [
                { scenario: 'BEAR', netProfit: Math.round(netProfit * 0.3), capitalLoss },
                { scenario: 'BASE', netProfit, capitalLoss: 0 },
                { scenario: 'BULL', netProfit: Math.round(netProfit * 1.5), capitalLoss: 0 },
              ],
            },
          });
          reqLogger.info('EV computed', {
            expectedValue: result.expectedValue.expectedValue,
            evConfidence: result.expectedValue.evConfidence,
          });
        }
      } catch (err) {
        reqLogger.warn('EV computation failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      reqLogger.info('Risk assessed', {
        overallRisk: riskResult.overallRisk,
        confidenceScore: riskResult.confidenceScore,
      });

      // ─── Stage 6: Opportunity Decision ─────────────────────────────────────
      reqLogger.info('Stage: Opportunity Decision');
      const opportunityResult = decideOpportunity({
        product: matchedProduct,
        marketplace: discoveryResult.marketplace,
        economics: economicsResult,
        risk: result.comprehensiveRisk
          ? { ...riskResult, overallRisk: result.comprehensiveRisk.overallRisk, confidenceScore: result.comprehensiveRisk.confidenceScore }
          : riskResult,
        requestId,
        marketClearingPrice: result.marketClearingPrice,
        demand: result.demand,
        competition: result.competition,
        decay: result.decay,
        expectedValue: result.expectedValue,
      });
      result.opportunity = opportunityResult;

      reqLogger.info('Opportunity decided', {
        decision: opportunityResult.decision,
        qualityTier: opportunityResult.qualityTier,
        totalScore: opportunityResult.totalScore,
      });

    } catch (err) {
      reqLogger.error('Pipeline failed with error', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      result.error = err instanceof Error ? err.message : String(err);
    }

    result.elapsedMs = Date.now() - startTime;
    result.formattedResult = formatPipelineResult(result, reqLogger);

    // Record metrics (IDEA §49 / AUDIT §50)
    const success = result.error === null && result.opportunity !== null;
    recordPipelineRun(success, result.elapsedMs / 1000);
    metricsRegistry.inc('opportunities_discovered_total');
    if (result.opportunity) {
      recordOpportunityDecision(result.opportunity.decision);
    }
    metricsRegistry.inc('supplier_resolution_total');

    reqLogger.info('Pipeline completed', {
      elapsedMs: result.elapsedMs,
      error: result.error,
      hasOpportunity: result.opportunity !== null,
    });

    return result;
  }
}

export const arbitragePipeline = new ArbitragePipeline();
