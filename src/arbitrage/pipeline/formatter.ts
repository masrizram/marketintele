/**
 * Result Formatter — converts PipelineResult into a human-readable Telegram message.
 *
 * Every number shown must have provenance traceable to a data source.
 * No fabricated or hardcoded values.
 */
import { PipelineResult } from './types';
import { createRequestLogger } from './logger';
import Decimal from 'decimal.js';

export function formatPipelineResult(result: PipelineResult, _logger?: ReturnType<typeof createRequestLogger>): string {
  const lines: string[] = [];
  lines.push('📊 <b>MarketIntele Arbitrage Analysis</b>');
  lines.push('');
  lines.push(`<b>Query:</b> ${result.context.query}`);
  lines.push(`<b>Request ID:</b> <code>${result.context.requestId}</code>`);
  lines.push(`<b>Processed in:</b> ${result.elapsedMs}ms`);
  lines.push('');

  // ─── Discovery Result ─────────────────────────────────────────────────────
  if (result.discovery) {
    lines.push('🔍 <b>Discovery</b>');
    lines.push(`  Status: ${result.discovery.status}`);
    lines.push(`  Marketplace: ${result.discovery.marketplace}`);
    lines.push(`  Adapter: ${result.discovery.metadata.adapterName}`);
    lines.push(`  Elapsed: ${result.discovery.metadata.elapsedMs}ms`);
    if (result.discovery.error) {
      lines.push(`  <i>Error: ${result.discovery.error}</i>`);
    }
    lines.push('');
  }

  // ─── Product Data ─────────────────────────────────────────────────────────
  if (result.canonicalProduct) {
    const p = result.canonicalProduct;
    const provenance = p.dataProvenance || 'UNKNOWN';
    lines.push('📦 <b>PRODUCT</b>');
    lines.push('');
    lines.push(`  Nama: <b>${p.canonicalTitle}</b>`);
    if (p.brand) lines.push(`  Brand: ${p.brand}`);
    if (p.model) lines.push(`  Model: ${p.model}`);
    if (p.sku) lines.push(`  SKU: ${p.sku}`);
    lines.push('');
    lines.push('━━━ MARKETPLACE ━━━');
    lines.push(`  🛒 Sumber: ${p.sourceId || 'UNKNOWN'}`);
    lines.push(`  💰 Harga: ${formatIDR(p.priceInIdr)}`);
    if (p.originalPriceIdr != null && p.originalPriceIdr > 0 && p.priceInIdr !== p.originalPriceIdr) {
      lines.push(`  📉 Harga Asli: ${formatIDR(p.originalPriceIdr)}`);
    }
    if (p.discountPercent != null && p.discountPercent > 0) {
      lines.push(`  🏷️ Diskon: ${p.discountPercent}%`);
    }
    if (p.sellerName) lines.push(`  🏪 Seller: ${p.sellerName}`);
    if (p.rating != null) lines.push(`  ⭐ Rating: ${p.rating}`);
    if (p.reviewCount != null) lines.push(`  📝 Reviews: ${p.reviewCount.toLocaleString('id-ID')}`);
    if (p.soldCount != null && typeof p.soldCount === 'number') {
      lines.push(`  📦 Terjual: ${p.soldCount.toLocaleString('id-ID')}`);
    }
    if (p.marketplaceListingUrl) {
      lines.push(`  🔗 URL: ${p.marketplaceListingUrl}`);
    }
    lines.push(`  📅 Scraped: ${p.observedAt || 'UNKNOWN'}`);
    lines.push(`  📋 Provenance: <b>${provenance}</b>`);
    lines.push(`  🎯 Confidence: ${(p.confidence * 100).toFixed(1)}%`);
    lines.push('');

    // Show additional discovery products if available
    if (result.discovery && result.discovery.products.length > 1) {
      lines.push('━━━ LISTING LAIN ━━━');
      const others = result.discovery.products.filter(x => x.id !== p.id).slice(0, 4);
      for (const op of others) {
        const priceLine = formatIDR(op.priceInIdr);
        const urlSnippet = op.marketplaceListingUrl
          ? `<a href="${op.marketplaceListingUrl}">link</a>`
          : '';
        lines.push(`  • ${op.canonicalTitle.substring(0, 50)} — ${priceLine} ${urlSnippet}`);
      }
      lines.push('');
    }
  }

  // ─── Supplier ─────────────────────────────────────────────────────────────
  if (result.supplier) {
    const s = result.supplier;
    lines.push('🏪 <b>Supplier / Source</b>');
    lines.push(`  Name: ${s.name}`);
    lines.push(`  Type: ${s.type}`);
    lines.push(`  Source URL: ${s.sourceUrl || 'N/A'}`);
    lines.push(`  Source Price: ${formatIDR(s.sourcePriceIdr)}`);
    lines.push(`  MOQ: ${s.moq ?? 'UNKNOWN'}`);
    lines.push(`  Shipping Cost: ${formatIDR(s.shippingCostIdr)}`);
    lines.push(`  Confidence: ${s.confidence} (${s.confidenceScore})`);
    lines.push(`  Evidence: ${s.evidence || 'N/A'}`);
    lines.push('');
  }

  // ─── Economics ────────────────────────────────────────────────────────────
  if (result.economics) {
    const e = result.economics;
    lines.push('💰 <b>Economics</b>');
    lines.push(`  Selling Price: ${formatIDR(e.sellingPriceIdr)}`);
    lines.push(`  Supplier Base Cost: ${formatIDR(e.supplierBaseCost)}`);
    lines.push(`  Landed Cost: ${formatIDR(e.landedCost)}`);
    if (e.landedCostBreakdown) {
      lines.push('  Landed Cost Breakdown:');
      for (const [key, value] of Object.entries(e.landedCostBreakdown)) {
        lines.push(`    ${key}: ${formatIDR(value)}`);
      }
    }
    lines.push(`  Marketplace Fee: ${formatIDR(e.marketplaceFee)}`);
    if (e.marketplaceFeeBreakdown) {
      lines.push('  Marketplace Fee Breakdown:');
      for (const [key, value] of Object.entries(e.marketplaceFeeBreakdown)) {
        if (typeof value === 'number' && key.includes('Rate')) {
          lines.push(`    ${key}: ${(value * 100).toFixed(2)}%`);
        } else {
          lines.push(`    ${key}: ${formatIDR(value)}`);
        }
      }
    }
    if (e.feeConfigUsed) {
      lines.push(`  Fee Config Source: ${e.feeConfigUsed.evidence.source}`);
      lines.push(`  Fee Config Confidence: ${(e.feeConfigUsed.evidence.confidence * 100).toFixed(1)}%`);
    }
    lines.push('');
  }

  // ─── Profit ─────────────────────────────────────────────────────────────────
  if (result.economics?.profitCalculation) {
    const pc = result.economics.profitCalculation;
    const r = pc.primaryResult;
    lines.push('📈 <b>Profit Calculation</b>');
    lines.push(`  Net Profit/Unit: ${formatIDR(r.netProfitPerUnit.toNumber())}`);
    lines.push(`  Net Margin: ${r.netMarginPercent.toFixed(2)}%`);
    lines.push(`  ROI: ${r.roiPercent.toFixed(2)}%`);
    lines.push(`  Break-even Price: ${formatIDR(r.breakEvenPrice.toNumber())}`);
    lines.push(`  Markup: ${r.markupPercent.toFixed(2)}%`);
    lines.push(`  Double-entry Reconciled: ${pc.reconciled ? '✅' : '❌'}`);
    lines.push(`  Confidence: ${(pc.confidence * 100).toFixed(1)}%`);
    lines.push('');
  }

  if (result.economics?.profitError) {
    lines.push('⚠️ <b>Profit Calculation Error</b>');
    lines.push(`  ${result.economics.profitError}`);
    lines.push('');
  }

  // ─── Risk ───────────────────────────────────────────────────────────────────
  if (result.risk) {
    const r = result.risk;
    lines.push('⚠️ <b>Risk Assessment</b>');
    lines.push(`  Overall: ${r.overallRisk} (confidence: ${(r.confidenceScore * 100).toFixed(1)}%)`);
    lines.push(`  Supplier: ${r.supplierRisk}`);
    lines.push(`  Product: ${r.productRisk}`);
    lines.push(`  Market: ${r.marketRisk}`);
    for (const evid of r.evidence) {
      lines.push(`  • ${evid}`);
    }
    lines.push('');
  }

  // ─── Opportunity Decision ──────────────────────────────────────────────────
  if (result.opportunity) {
    const o = result.opportunity;
    const emoji = o.decision === 'RECOMMEND' ? '✅' : o.decision === 'REVIEW' ? '⚠️' : '❌';
    lines.push(`${emoji} <b>Opportunity: ${o.decision}</b> (${o.qualityTier})`);
    lines.push(`  Score: ${o.totalScore}/100`);
    for (const g of o.gates) {
      const gEmoji = g.passed ? '✅' : '❌';
      const critEmoji = g.critical ? ' (🔴)' : ' (⚪)';
      lines.push(`  ${gEmoji} ${g.name}${critEmoji}: ${g.detail}`);
    }
    lines.push(`  <i>${o.reason}</i>`);
    lines.push('');
  }

  // ─── Error ──────────────────────────────────────────────────────────────────
  if (result.error) {
    lines.push('⛔ <b>Pipeline Error</b>');
    lines.push(`  ${result.error}`);
    lines.push('');
  }

  lines.push('— MarketIntele Arbitrage Bot');

  return lines.join('\n');
}

function formatIDR(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'UNKNOWN';
  return new Decimal(value).toNumber().toLocaleString('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  });
}
