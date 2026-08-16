-- ============================================================================
-- Migration: V0001 — Core Foundation Schema
-- Project: MarketIntele Arbitrage Intelligence Engine
-- Generated: 2026-08-15
-- ============================================================================
-- This migration creates the complete database schema as specified in
-- IDEA.xml §10 (DatabaseSchemaArchitecture).
--
-- All primary keys are ULIDs (Crockford base32, 26 chars).
-- All timestamps are TIMESTAMPTZ.
-- All financial amounts use NUMERIC(18,4) for exact decimal arithmetic.
-- All JSONB columns carry auditable structured data.
-- ============================================================================

-- ── Enable required extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- fallback for any UUID needs
-- Note: ULIDs are generated client-side (TypeScript ulid package), not by DB.

-- ── ENUM: source trust tiers ─────────────────────────────────────────────────
CREATE TYPE trust_tier AS ENUM (
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
  'UNKNOWN'
);

-- ── ENUM: source / crawl statuses ───────────────────────────────────────────
CREATE TYPE source_status AS ENUM (
  'ACTIVE',
  'INACTIVE',
  'DEGRADED',
  'UNAVAILABLE'
);

CREATE TYPE crawl_status AS ENUM (
  'SCHEDULED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'RETRY',
  'CANCELLED'
);

-- ── ENUM: supplier verification statuses ────────────────────────────────────
CREATE TYPE supplier_verification_status AS ENUM (
  'VERIFIED',
  'PARTIALLY_VERIFIED',
  'UNVERIFIED',
  'SUSPICIOUS',
  'UNKNOWN'
);

-- ── ENUM: supplier types ─────────────────────────────────────────────────────
CREATE TYPE supplier_type AS ENUM (
  'FACTORY',
  'MANUFACTURER',
  'DISTRIBUTOR',
  'IMPORTER',
  'WHOLESALER',
  'TRADING_COMPANY',
  'RESELLER',
  'UNKNOWN'
);

-- ── ENUM: match types ────────────────────────────────────────────────────────
CREATE TYPE match_type AS ENUM (
  'EXACT_SAME_PRODUCT',
  'SAME_PRODUCT_DIFFERENT_PACKAGE',
  'SAME_PRODUCT_DIFFERENT_VARIANT',
  'SAME_PRODUCT_DIFFERENT_BRAND',
  'SUBSTITUTE',
  'SIMILAR',
  'UNRELATED',
  'UNKNOWN'
);

-- ── ENUM: marketplace regions ────────────────────────────────────────────────
CREATE TYPE marketplace_region AS ENUM (
  'ID',
  'MY',
  'PH',
  'TH',
  'SG',
  'OTHER'
);

-- ── ENUM: opportunity states & quality tiers ─────────────────────────────────
CREATE TYPE opportunity_state AS ENUM (
  'ACTIVE',
  'WEAKENING',
  'DECAYING',
  'COLLAPSED',
  'EXPIRED',
  'TESTED',
  'SCALED',
  'REJECTED'
);

CREATE TYPE quality_tier AS ENUM (
  'S-TIER',
  'A-TIER',
  'B-TIER',
  'C-TIER',
  'REJECTED'
);

-- ── ENUM: test order statuses ────────────────────────────────────────────────
CREATE TYPE test_order_status AS ENUM (
  'PENDING',
  'ORDERED',
  'IN_TRANSIT',
  'RECEIVED',
  'SOLD',
  'COMPLETED',
  'CANCELLED',
  'FAILED'
);

-- ── ENUM: data tier (demand signals) ─────────────────────────────────────────
CREATE TYPE data_tier AS ENUM (
  'OBSERVED',
  'MODEL_ESTIMATE',
  'HEURISTIC',
  'INSUFFICIENT_DATA'
);

-- ── ENUM: audit actor types ───────────────────────────────────────────────────
CREATE TYPE actor_type AS ENUM (
  'SYSTEM',
  'HUMAN_ADMIN',
  'CRON',
  'EXTERNAL_WEBHOOK',
  'TELEMETRY'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- GROUP: Ingestion & Raw
-- ═════════════════════════════════════════════════════════════════════════════

-- ── sources ───────────────────────────────────────────────────────────────────
CREATE TABLE sources (
  id              VARCHAR(26) PRIMARY KEY,         -- ULID
  name            TEXT NOT NULL,
  adapter_name    VARCHAR(128),
  base_url        TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  trust_tier      trust_tier NOT NULL DEFAULT 'UNKNOWN',
  metadata_json   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sources_adapter_name ON sources(adapter_name);
CREATE INDEX idx_sources_is_active ON sources(is_active);

-- ── source_health ────────────────────────────────────────────────────────────
CREATE TABLE source_health (
  id              VARCHAR(26) PRIMARY KEY,         -- ULID
  source_id       VARCHAR(26) NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  status          source_status NOT NULL,
  error_rate      NUMERIC(5,4) NOT NULL DEFAULT 0,  -- 0.0000 - 1.0000
  latency_p95_ms  INTEGER NOT NULL DEFAULT 0,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id)  -- one health record per source
);

CREATE INDEX idx_source_health_status ON source_health(status);

-- ── crawl_jobs ───────────────────────────────────────────────────────────────
CREATE TABLE crawl_jobs (
  id              VARCHAR(26) PRIMARY KEY,         -- ULID
  source_id       VARCHAR(26) NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  status          crawl_status NOT NULL DEFAULT 'SCHEDULED',
  priority        INTEGER NOT NULL DEFAULT 0,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crawl_jobs_source_id ON crawl_jobs(source_id);
CREATE INDEX idx_crawl_jobs_status ON crawl_jobs(status);
CREATE INDEX idx_crawl_jobs_scheduled_at ON crawl_jobs(scheduled_at);

-- ── crawl_events ─────────────────────────────────────────────────────────────
CREATE TABLE crawl_events (
  id              VARCHAR(26) PRIMARY KEY,         -- ULID
  job_id          VARCHAR(26) NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  http_status     INTEGER NOT NULL,
  latency_ms      INTEGER NOT NULL,
  content_hash    VARCHAR(64) NOT NULL,           -- SHA-256 hex
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retry_attempt   INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_crawl_events_job_id ON crawl_events(job_id);
CREATE INDEX idx_crawl_events_url ON crawl_events(url);
CREATE INDEX idx_crawl_events_observed_at ON crawl_events(observed_at);

-- ── raw_documents ────────────────────────────────────────────────────────────
CREATE TABLE raw_documents (
  id              VARCHAR(26) PRIMARY KEY,         -- ULID
  crawl_event_id  VARCHAR(26) NOT NULL REFERENCES crawl_events(id) ON DELETE CASCADE,
  payload_blob    TEXT NOT NULL,                   -- raw HTML/JSON/XML as text
  payload_format  VARCHAR(32) NOT NULL DEFAULT 'text',  -- 'text' | 'json' | 'html' | 'xml'
  parser_version  VARCHAR(64) NOT NULL,
  checksum        VARCHAR(64) NOT NULL,           -- SHA-256 of payload_blob
  content_length  INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_raw_documents_crawl_event_id ON raw_documents(crawl_event_id);
CREATE INDEX idx_raw_documents_checksum ON raw_documents(checksum);

-- ── raw_products ─────────────────────────────────────────────────────────────
CREATE TABLE raw_products (
  id                   VARCHAR(26) PRIMARY KEY,    -- ULID
  raw_document_id      VARCHAR(26) NOT NULL REFERENCES raw_documents(id) ON DELETE CASCADE,
  extracted_json       JSONB NOT NULL,            -- the raw extracted product data
  extraction_confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
  extraction_method    VARCHAR(128) NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_raw_products_raw_document_id ON raw_products(raw_document_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- GROUP: Core Entities
-- ═════════════════════════════════════════════════════════════════════════════

-- ── suppliers ────────────────────────────────────────────────────────────────
CREATE TABLE suppliers (
  id                     VARCHAR(26) PRIMARY KEY,
  name                   TEXT NOT NULL,
  legal_name            TEXT,
  type                   supplier_type NOT NULL DEFAULT 'UNKNOWN',
  website               TEXT,
  domain                TEXT,
  phone                 TEXT,
  email                 TEXT,
  address               TEXT,
  verification_status   supplier_verification_status NOT NULL DEFAULT 'UNVERIFIED',
  confidence_score      NUMERIC(5,4) NOT NULL DEFAULT 0,  -- 0.0000 - 1.0000
  business_evidence_json JSONB,                    -- public registration / legal evidence
  reputation_signals_json JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_suppliers_type ON suppliers(type);
CREATE INDEX idx_suppliers_verification_status ON suppliers(verification_status);
CREATE INDEX idx_suppliers_domain ON suppliers(domain);
CREATE INDEX idx_suppliers_name ON suppliers(name TEXT_PATTERN_OPS);

-- ── supplier_contacts ────────────────────────────────────────────────────────
CREATE TABLE supplier_contacts (
  id              VARCHAR(26) PRIMARY KEY,
  supplier_id     VARCHAR(26) NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  channel_type   VARCHAR(32) NOT NULL,           -- 'phone' | 'email' | 'whatsapp' | 'telegram' | 'website'
  value           TEXT NOT NULL,
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_supplier_contacts_supplier_id ON supplier_contacts(supplier_id);

-- ── supplier_products ────────────────────────────────────────────────────────
CREATE TABLE supplier_products (
  id                   VARCHAR(26) PRIMARY KEY,
  supplier_id          VARCHAR(26) NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  raw_title           TEXT NOT NULL,
  normalized_title     TEXT,
  sku                  TEXT,
  barcode              TEXT,                      -- EAN / UPC
  brand                TEXT,
  model                TEXT,
  moq                  INTEGER NOT NULL DEFAULT 1,  -- minimum order quantity (pcs)
  category             TEXT,
  attributes_json      JSONB,
  package_quantity     INTEGER,                   -- how many pcs per package (NULL if per-pcs)
  package_unit         VARCHAR(32),               -- 'pcs' | 'karton' | 'dusin' | ...
  lead_time_days       INTEGER,
  stock_available      BOOLEAN NOT NULL DEFAULT TRUE,
  product_url          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_supplier_products_supplier_id ON supplier_products(supplier_id);
CREATE INDEX idx_supplier_products_sku ON supplier_products(sku);
CREATE INDEX idx_supplier_products_barcode ON supplier_products(barcode);
CREATE INDEX idx_supplier_products_normalized_title ON supplier_products(normalized_title);

-- ── supplier_prices ──────────────────────────────────────────────────────────
CREATE TABLE supplier_prices (
  id                  VARCHAR(26) PRIMARY KEY,
  supplier_product_id VARCHAR(26) NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
  tier_min            INTEGER NOT NULL DEFAULT 1,
  tier_max            INTEGER,                    -- NULL = unlimited / single price
  price               NUMERIC(18,4) NOT NULL,     -- in IDR, stored as NUMERIC
  currency            VARCHAR(8) NOT NULL DEFAULT 'IDR',
  price_per_unit      NUMERIC(18,4),              -- computed normalized unit price
  package_qty         INTEGER,                    -- package size this price applies to
  observed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_url          TEXT,
  raw_evidence_hash   VARCHAR(64),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_supplier_prices_supplier_product_id ON supplier_prices(supplier_product_id);
CREATE INDEX idx_supplier_prices_tier ON supplier_prices(tier_min, tier_max);
CREATE INDEX idx_supplier_prices_observed_at ON supplier_prices(observed_at);

-- ── products (canonical) ──────────────────────────────────────────────────────
CREATE TABLE products (
  id                      VARCHAR(26) PRIMARY KEY,
  canonical_title         TEXT NOT NULL,
  brand                   TEXT,
  model                  TEXT,
  category_id            VARCHAR(26),             -- FK to product_categories (created later if needed)
  standard_unit          VARCHAR(32) NOT NULL DEFAULT 'pcs', -- 'pcs' | 'ml' | 'gram' | 'meter'
  standard_weight_grams  INTEGER,
  standard_dimensions_cm TEXT,                    -- "10x5x3"
  images_json            JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_brand ON products(brand);
CREATE INDEX idx_products_model ON products(model);

-- ── product_variants ─────────────────────────────────────────────────────────
CREATE TABLE product_variants (
  id                  VARCHAR(26) PRIMARY KEY,
  product_id          VARCHAR(26) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_name        TEXT NOT NULL,              -- e.g. "Blue / 12GB RAM"
  sku                 TEXT,
  barcode             TEXT,
  package_quantity    INTEGER NOT NULL DEFAULT 1,
  package_unit        VARCHAR(32) NOT NULL DEFAULT 'pcs',
  attributes_json     JSONB,
  is_primary          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_variants_product_id ON product_variants(product_id);
CREATE INDEX idx_product_variants_sku ON product_variants(sku);

-- ── product_matches ──────────────────────────────────────────────────────────
CREATE TABLE product_matches (
  id                   VARCHAR(26) PRIMARY KEY,
  product_id           VARCHAR(26) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_product_id  VARCHAR(26) NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
  match_type           match_type NOT NULL,
  match_score          NUMERIC(5,4) NOT NULL,     -- 0.0000 - 1.0000
  match_signals_json   JSONB,                     -- detailed match evidence
  is_verified          BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, supplier_product_id)  -- one match record per pair
);

CREATE INDEX idx_product_matches_product_id ON product_matches(product_id);
CREATE INDEX idx_product_matches_supplier_product_id ON product_matches(supplier_product_id);
CREATE INDEX idx_product_matches_match_type ON product_matches(match_type);

-- ═════════════════════════════════════════════════════════════════════════════
-- GROUP: Marketplace & Intel
-- ═════════════════════════════════════════════════════════════════════════════

-- ── marketplaces ─────────────────────────────────────────────────────────────
CREATE TABLE marketplaces (
  id              VARCHAR(26) PRIMARY KEY,
  name            VARCHAR(64) NOT NULL UNIQUE,   -- 'shopee' | 'tokopedia' | 'lazada' | 'blibli' | 'tiktok_shop'
  region          marketplace_region NOT NULL DEFAULT 'ID',
  api_adapter     VARCHAR(128),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  metadata_json   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── marketplace_listings ─────────────────────────────────────────────────────
CREATE TABLE marketplace_listings (
  id                  VARCHAR(26) PRIMARY KEY,
  marketplace_id      VARCHAR(26) NOT NULL REFERENCES marketplaces(id) ON DELETE CASCADE,
  product_id          VARCHAR(26),                -- FK to products(id), nullable until entity-resolved
  seller_id           VARCHAR(26) NOT NULL,
  seller_name         TEXT,
  title               TEXT NOT NULL,
  url                 TEXT NOT NULL,
  rating              NUMERIC(3,2),               -- 0.00 - 5.00
  review_count        INTEGER NOT NULL DEFAULT 0,
  sold_count          INTEGER,                    -- observed sold count (nullable — don't fabricate)
  stock_status        VARCHAR(32),                -- 'in_stock' | 'low_stock' | 'out_of_stock'
  image_url           TEXT,
  category_path       TEXT,
  listing_age_days    INTEGER,                    -- days since listing creation
  observed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_evidence_hash   VARCHAR(64),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_marketplace_listings_marketplace_id ON marketplace_listings(marketplace_id);
CREATE INDEX idx_marketplace_listings_product_id ON marketplace_listings(product_id);
CREATE INDEX idx_marketplace_listings_seller_id ON marketplace_listings(seller_id);
CREATE INDEX idx_marketplace_listings_observed_at ON marketplace_listings(observed_at);

-- ── marketplace_prices ───────────────────────────────────────────────────────
CREATE TABLE marketplace_prices (
  id              VARCHAR(26) PRIMARY KEY,
  listing_id      VARCHAR(26) NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  price           NUMERIC(18,4) NOT NULL,        -- current price in IDR
  original_price  NUMERIC(18,4),                 -- original/RRP price
  discount_pct    NUMERIC(5,2),                  -- discount percentage (0-100)
  discount_label  TEXT,                           -- e.g. "Diskon 20%"
  flash_sale      BOOLEAN NOT NULL DEFAULT FALSE,
  vip_discount    NUMERIC(5,2),                  -- additional VIP discount %
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_evidence_hash VARCHAR(64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_marketplace_prices_listing_id ON marketplace_prices(listing_id);
CREATE INDEX idx_marketplace_prices_observed_at ON marketplace_prices(observed_at);

-- ── demand_signals ───────────────────────────────────────────────────────────
CREATE TABLE demand_signals (
  id                      VARCHAR(26) PRIMARY KEY,
  product_id              VARCHAR(26) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  estimated_monthly_demand INTEGER,
  monthly_sales_observed  INTEGER,                -- directly observed (e.g. sold_count delta)
  velocity                NUMERIC(5,2),           -- 0.00 - 5.00 qualitative
  confidence              NUMERIC(5,4) NOT NULL DEFAULT 0,
  data_tier               data_tier NOT NULL DEFAULT 'INSUFFICIENT_DATA',
  trend_7d                NUMERIC(5,2),           -- 7-day trend slope
  trend_30d               NUMERIC(5,2),           -- 30-day trend slope
  source_notes            TEXT,
  observed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_demand_signals_product_id ON demand_signals(product_id);
CREATE INDEX idx_demand_signals_data_tier ON demand_signals(data_tier);

-- ── competition_snapshots ────────────────────────────────────────────────────
CREATE TABLE competition_snapshots (
  id                  VARCHAR(26) PRIMARY KEY,
  product_id          VARCHAR(26) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  seller_count        INTEGER NOT NULL,
  hhi_index           NUMERIC(10,6),             -- Herfindahl-Hirschman Index (0-10000+)
  top_seller_share    NUMERIC(5,2),              -- top seller's % of listings
  price_dispersion    NUMERIC(5,2),              -- coefficient of variation
  lowest_price        NUMERIC(18,4),
  highest_price       NUMERIC(18,4),
  median_price        NUMERIC(18,4),
  price_war_risk      VARCHAR(32),               -- 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  competition_level   VARCHAR(32),               -- 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'
  market_saturation   NUMERIC(5,2),              -- 0.00 - 5.00
  observed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_competition_snapshots_product_id ON competition_snapshots(product_id);
CREATE INDEX idx_competition_snapshots_observed_at ON competition_snapshots(observed_at);

-- ═════════════════════════════════════════════════════════════════════════════
-- GROUP: Economics & Decisions
-- ═════════════════════════════════════════════════════════════════════════════

-- ── cost_models ──────────────────────────────────────────────────────────────
CREATE TABLE cost_models (
  id              VARCHAR(26) PRIMARY KEY,
  product_id      VARCHAR(26) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id     VARCHAR(26) NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_cost   NUMERIC(18,4) NOT NULL,
  landed_cost     NUMERIC(18,4) NOT NULL,        -- fully computed landed cost in IDR
  landed_cost_breakdown_json JSONB NOT NULL,     -- every component with evidence
  vendor_fee_total NUMERIC(18,4) NOT NULL,       -- total vendor/marketplace fee
  vendor_fee_breakdown_json JSONB NOT NULL,
  inbound_logistics NUMERIC(18,4) NOT NULL DEFAULT 0,
  import_duties    NUMERIC(18,4) NOT NULL DEFAULT 0,
  vat             NUMERIC(18,4) NOT NULL DEFAULT 0,
  customs         NUMERIC(18,4) NOT NULL DEFAULT 0,
  payment_fee     NUMERIC(18,4) NOT NULL DEFAULT 0,
  packaging_in    NUMERIC(18,4) NOT NULL DEFAULT 0,
  qc_cost         NUMERIC(18,4) NOT NULL DEFAULT 0,
  wastage         NUMERIC(18,4) NOT NULL DEFAULT 0,
  handling        NUMERIC(18,4) NOT NULL DEFAULT 0,
  version         VARCHAR(32) NOT NULL,
  calculation_hash VARCHAR(64) NOT NULL,         -- SHA-256 of all inputs
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cost_models_product_id ON cost_models(product_id);
CREATE INDEX idx_cost_models_supplier_id ON cost_models(supplier_id);
CREATE INDEX idx_cost_models_version ON cost_models(version);

-- ── profit_models ────────────────────────────────────────────────────────────
CREATE TABLE profit_models (
  id                  VARCHAR(26) PRIMARY KEY,
  cost_model_id       VARCHAR(26) NOT NULL REFERENCES cost_models(id) ON DELETE CASCADE,
  selling_price_conservative NUMERIC(18,4) NOT NULL,
  selling_price_base        NUMERIC(18,4) NOT NULL,
  selling_price_optimistic  NUMERIC(18,4) NOT NULL,
  market_clearing_price     NUMERIC(18,4) NOT NULL,
  net_profit_per_unit       NUMERIC(18,4) NOT NULL,
  net_margin_pct            NUMERIC(5,2) NOT NULL,
  roi_pct                   NUMERIC(5,2) NOT NULL,
  break_even_price          NUMERIC(18,4) NOT NULL,
  gross_margin_pct          NUMERIC(5,2) NOT NULL,
  markup_pct                NUMERIC(5,2) NOT NULL,
  scoring_details_json      JSONB NOT NULL,
  calculation_hash          VARCHAR(64) NOT NULL,
  validated                 BOOLEAN NOT NULL DEFAULT FALSE,   -- dual-engine check passed?
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profit_models_cost_model_id ON profit_models(cost_model_id);
CREATE INDEX idx_profit_models_validated ON profit_models(validated);

-- ── sensitivity_models ───────────────────────────────────────────────────────
CREATE TABLE sensitivity_models (
  id                  VARCHAR(26) PRIMARY KEY,
  profit_model_id     VARCHAR(26) NOT NULL REFERENCES profit_models(id) ON DELETE CASCADE,
  matrix_json         JSONB NOT NULL,            -- full 5×5 or N×N grid
  robustness_rating   VARCHAR(32) NOT NULL,      -- 'VERY_FRAGILE' | 'FRAGILE' | 'MODERATE' | 'ROBUST' | 'VERY_ROBUST'
  profitable_cells    INTEGER NOT NULL,
  total_cells         INTEGER NOT NULL,
  worst_case_profit   NUMERIC(18,4) NOT NULL,
  best_case_profit    NUMERIC(18,4) NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sensitivity_models_profit_model_id ON sensitivity_models(profit_model_id);

-- ── opportunities ────────────────────────────────────────────────────────────
CREATE TABLE opportunities (
  id                  VARCHAR(26) PRIMARY KEY,
  product_id          VARCHAR(26) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id         VARCHAR(26) NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  marketplace_id      VARCHAR(26) REFERENCES marketplaces(id) ON DELETE SET NULL,
  quality_tier        quality_tier NOT NULL DEFAULT 'REJECTED',
  state               opportunity_state NOT NULL DEFAULT 'ACTIVE',
  total_score         NUMERIC(5,2),
  score_breakdown_json JSONB,
  score_version       VARCHAR(32),
  expected_value      NUMERIC(18,4),
  half_life_days      INTEGER,
  decay_state         VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  required_validation_capital NUMERIC(18,4),
  recommended_test_qty INTEGER,
  action              VARCHAR(32),               -- 'BUY_TEST' | 'BUY_SCALE' | 'NEGOTIATE' | 'WAIT' | 'MONITOR' | 'SWITCH_SUPPLIER' | 'REJECT'
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_opportunities_product_id ON opportunities(product_id);
CREATE INDEX idx_opportunities_supplier_id ON opportunities(supplier_id);
CREATE INDEX idx_opportunities_quality_tier ON opportunities(quality_tier);
CREATE INDEX idx_opportunities_state ON opportunities(state);
CREATE INDEX idx_opportunities_action ON opportunities(action);
CREATE INDEX idx_opportunities_total_score ON opportunities(total_score DESC);

-- ── opportunity_scores ───────────────────────────────────────────────────────
CREATE TABLE opportunity_scores (
  id                  VARCHAR(26) PRIMARY KEY,
  opportunity_id      VARCHAR(26) NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  total_score         NUMERIC(5,2) NOT NULL,
  breakdown_json      JSONB NOT NULL,            -- per-factor scores: profitability, demand_strength, supplier_quality, etc.
  score_version       VARCHAR(32) NOT NULL,
  calculated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_opportunity_scores_opportunity_id ON opportunity_scores(opportunity_id);

-- ── test_orders ──────────────────────────────────────────────────────────────
CREATE TABLE test_orders (
  id                  VARCHAR(26) PRIMARY KEY,
  opportunity_id      VARCHAR(26) NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  supplier_id         VARCHAR(26) NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  status              test_order_status NOT NULL DEFAULT 'PENDING',
  test_quantity       INTEGER NOT NULL,
  test_unit_price     NUMERIC(18,4) NOT NULL,
  test_capital        NUMERIC(18,4) NOT NULL,
  expected_profit     NUMERIC(18,4),
  actual_revenue      NUMERIC(18,4),
  actual_cost         NUMERIC(18,4),
  actual_profit       NUMERIC(18,4),
  returns_count       INTEGER NOT NULL DEFAULT 0,
  defect_count        INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  ordered_at          TIMESTAMPTZ,
  received_at         TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_test_orders_opportunity_id ON test_orders(opportunity_id);
CREATE INDEX idx_test_orders_status ON test_orders(status);

-- ═════════════════════════════════════════════════════════════════════════════
-- GROUP: Learning & Audit
-- ═════════════════════════════════════════════════════════════════════════════

-- ── sales_actuals ────────────────────────────────────────────────────────────
CREATE TABLE sales_actuals (
  id                  VARCHAR(26) PRIMARY KEY,
  test_order_id       VARCHAR(26) REFERENCES test_orders(id) ON DELETE SET NULL,
  realized_revenue    NUMERIC(18,4) NOT NULL,
  realized_costs      NUMERIC(18,4) NOT NULL,
  realized_profit     NUMERIC(18,4) NOT NULL,
  units_sold          INTEGER NOT NULL,
  returns_count       INTEGER NOT NULL DEFAULT 0,
  defect_count        INTEGER NOT NULL DEFAULT 0,
  sell_through_pct    NUMERIC(5,2),              -- % of test inventory sold
  sell_period_days    INTEGER,
  observation_period_start TIMESTAMPTZ NOT NULL,
  observation_period_end   TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sales_actuals_test_order_id ON sales_actuals(test_order_id);

-- ── profit_attribution ───────────────────────────────────────────────────────
CREATE TABLE profit_attribution (
  id                  VARCHAR(26) PRIMARY KEY,
  sales_actual_id     VARCHAR(26) REFERENCES sales_actuals(id) ON DELETE SET NULL,
  predicted_profit    NUMERIC(18,4) NOT NULL,
  realized_profit     NUMERIC(18,4) NOT NULL,
  delta               NUMERIC(18,4) NOT NULL,    -- realized - predicted
  delta_pct           NUMERIC(5,2) NOT NULL,     -- delta / predicted * 100
  error_reason        VARCHAR(64),               -- 'PRICE_PREDICTION_ERROR' | 'DEMAND_VELOCITY_ERROR' | 'COST_OMISSION_ERROR' | 'RETURN_DEFECT_ERROR' | 'FEE_DISCREPANCY_ERROR' | 'OTHER'
  error_detail_json   JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profit_attribution_sales_actual_id ON profit_attribution(sales_actual_id);

-- ── model_calibrations ───────────────────────────────────────────────────────
CREATE TABLE model_calibrations (
  id                  VARCHAR(26) PRIMARY KEY,
  model_name          VARCHAR(128) NOT NULL,
  version             VARCHAR(32) NOT NULL,
  mape               NUMERIC(5,2) NOT NULL,      -- Mean Absolute Percentage Error
  bias                NUMERIC(5,2) NOT NULL,     -- systematic over/under-estimation
  calibration_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sample_size         INTEGER NOT NULL,
  adjusted_weights_json JSONB,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_model_calibrations_model_name ON model_calibrations(model_name);
CREATE INDEX idx_model_calibrations_calibration_date ON model_calibrations(calibration_date);

-- ── audit_logs ───────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id              VARCHAR(26) PRIMARY KEY,
  actor_type      actor_type NOT NULL,
  actor_id        VARCHAR(26),
  action          VARCHAR(128) NOT NULL,
  entity_name     VARCHAR(128) NOT NULL,
  entity_id       VARCHAR(26),
  before_json     JSONB,
  after_json      JSONB,
  correlation_id  VARCHAR(36),
  ip_address      INET,
  user_agent      TEXT,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_entity_name ON audit_logs(entity_name);
CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_logs_correlation_id ON audit_logs(correlation_id);

-- ── schema_migrations (tracking) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          SERIAL PRIMARY KEY,
  version     VARCHAR(255) NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum    VARCHAR(64)
);

-- ═════════════════════════════════════════════════════════════════════════════
-- Seed: Default marketplaces
-- ═════════════════════════════════════════════════════════════════════════════

INSERT INTO marketplaces (id, name, region, api_adapter, is_active, metadata_json)
VALUES
  ('01JQ0000000000000000000001', 'shopee', 'ID', 'ShopeeIndonesiaAdapter', TRUE, '{"official_domain":"shopee.co.id","region":"Indonesia"}'),
  ('01JQ0000000000000000000002', 'tokopedia', 'ID', 'TokopediaAdapter', TRUE, '{"official_domain":"tokopedia.com","region":"Indonesia"}'),
  ('01JQ0000000000000000000003', 'lazada', 'ID', 'LazadaIDAdapter', TRUE, '{"official_domain":"lazada.co.id","region":"Indonesia"}'),
  ('01JQ0000000000000000000004', 'blibli', 'ID', 'BlibliAdapter', TRUE, '{"official_domain":"blibli.com","region":"Indonesia"}'),
  ('01JQ0000000000000000000005', 'tiktok_shop', 'ID', 'TikTokShopIDAdapter', TRUE, '{"official_domain":"tiktok.com","region":"Indonesia"}')
ON CONFLICT (name) DO NOTHING;

-- ═════════════════════════════════════════════════════════════════════════════
-- Seed: Admin user for audit logging
-- ═════════════════════════════════════════════════════════════════════════════

-- No explicit seed needed — system creates audit entries as it operates.

-- ═════════════════════════════════════════════════════════════════════════════
-- Migration complete
-- ═════════════════════════════════════════════════════════════════════════════
