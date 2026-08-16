import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

let db: Database.Database;

export function initDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      budget REAL,
      marketplaces TEXT,
      categories TEXT,
      keywords TEXT,
      sellers TEXT,
      min_discount_percent REAL,
      max_price REAL,
      notifications_enabled INTEGER DEFAULT 1,
      notification_frequency TEXT DEFAULT 'immediate',
      search_mode TEXT DEFAULT 'checkout',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS promos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promo_id TEXT UNIQUE NOT NULL,
      marketplace TEXT NOT NULL,
      product_id TEXT NOT NULL,
      seller_id TEXT,
      product_name TEXT NOT NULL,
      seller_name TEXT,
      product_url TEXT,
      original_price REAL NOT NULL,
      listing_price REAL NOT NULL,
      product_discount REAL DEFAULT 0,
      store_voucher REAL DEFAULT 0,
      marketplace_voucher REAL DEFAULT 0,
      payment_discount REAL DEFAULT 0,
      shipping_discount REAL DEFAULT 0,
      other_discount REAL DEFAULT 0,
      shipping_cost REAL DEFAULT 0,
      service_fee REAL DEFAULT 0,
      other_required_fee REAL DEFAULT 0,
      cashback REAL DEFAULT 0,
      cashback_type TEXT DEFAULT 'after_transaction',
      minimum_purchase REAL DEFAULT 0,
      maximum_discount REAL,
      voucher_code TEXT,
      voucher_quota INTEGER,
      promo_start TEXT,
      promo_end TEXT,
      checkout_total REAL NOT NULL,
      effective_cost REAL NOT NULL,
      verification_status TEXT DEFAULT 'unverified',
      confidence_score INTEGER DEFAULT 0,
      detected_at TEXT DEFAULT CURRENT_TIMESTAMP,
      verified_at TEXT,
      user_conditions TEXT,
      payment_conditions TEXT,
      region_conditions TEXT,
      category_conditions TEXT,
      seller_conditions TEXT,
      product_conditions TEXT,
      quantity_conditions TEXT,
      stacking_notes TEXT
    );
    CREATE TABLE IF NOT EXISTS promo_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      promo_id TEXT NOT NULL,
      marketplace TEXT NOT NULL,
      product_name TEXT NOT NULL,
      checkout_total REAL NOT NULL,
      sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
      action TEXT DEFAULT 'search'
    );
    CREATE INDEX IF NOT EXISTS idx_promos_marketplace ON promos(marketplace);
    CREATE INDEX IF NOT EXISTS idx_promo_history_user ON promo_history(user_id);
  `);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function upsertUser(
  telegramId: number,
  username: string | undefined,
  data: Partial<{
    budget: number;
    marketplaces: string;
    categories: string;
    keywords: string;
    sellers: string;
    minDiscountPercent: number;
    maxPrice: number;
    notificationsEnabled: boolean;
    notificationFrequency: string;
    searchMode: string;
  }>
): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO users (telegram_id, username, budget, marketplaces, categories, keywords, sellers, min_discount_percent, max_price, notifications_enabled, notification_frequency, search_mode, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      budget = excluded.budget,
      marketplaces = excluded.marketplaces,
      categories = excluded.categories,
      keywords = excluded.keywords,
      sellers = excluded.sellers,
      min_discount_percent = excluded.min_discount_percent,
      max_price = excluded.max_price,
      notifications_enabled = excluded.notifications_enabled,
      notification_frequency = excluded.notification_frequency,
      search_mode = excluded.search_mode,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(
    telegramId,
    username || null,
    data.budget ?? null,
    data.marketplaces ?? null,
    data.categories ?? null,
    data.keywords ?? null,
    data.sellers ?? null,
    data.minDiscountPercent ?? null,
    data.maxPrice ?? null,
    data.notificationsEnabled ? 1 : 0,
    data.notificationFrequency ?? 'immediate',
    data.searchMode ?? 'checkout'
  );
}

export function getUser(telegramId: number) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as any;
  return row;
}

export function insertPromo(promo: any): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO promos (
      promo_id, marketplace, product_id, seller_id, product_name, seller_name, product_url,
      original_price, listing_price, product_discount, store_voucher, marketplace_voucher,
      payment_discount, shipping_discount, other_discount, shipping_cost, service_fee,
      other_required_fee, cashback, cashback_type, minimum_purchase, maximum_discount,
      voucher_code, voucher_quota, promo_start, promo_end, checkout_total, effective_cost,
      verification_status, confidence_score, detected_at, verified_at,
      user_conditions, payment_conditions, region_conditions, category_conditions,
      seller_conditions, product_conditions, quantity_conditions, stacking_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    promo.promoId,
    promo.marketplace,
    promo.productId,
    promo.sellerId || null,
    promo.productName,
    promo.sellerName || null,
    promo.productUrl || null,
    promo.originalPrice,
    promo.listingPrice,
    promo.productDiscount,
    promo.storeVoucher,
    promo.marketplaceVoucher,
    promo.paymentDiscount,
    promo.shippingDiscount,
    promo.otherDiscount,
    promo.shippingCost,
    promo.serviceFee,
    promo.otherRequiredFee,
    promo.cashback,
    promo.cashbackType,
    promo.minimumPurchase,
    promo.maximumDiscount,
    promo.voucherCode,
    promo.voucherQuota,
    promo.promoStart,
    promo.promoEnd,
    promo.checkoutTotal,
    promo.effectiveCost,
    promo.verificationStatus,
    promo.confidenceScore,
    promo.detectedAt.toISOString(),
    promo.verifiedAt ? promo.verifiedAt.toISOString() : null,
    JSON.stringify(promo.userConditions || []),
    JSON.stringify(promo.paymentConditions || []),
    JSON.stringify(promo.regionConditions || []),
    JSON.stringify(promo.categoryConditions || []),
    JSON.stringify(promo.sellerConditions || []),
    JSON.stringify(promo.productConditions || []),
    JSON.stringify(promo.quantityConditions || []),
    JSON.stringify(promo.stackingNotes || [])
  );
}

export function insertPromoHistory(history: { userId: number; promoId: string; marketplace: string; productName: string; checkoutTotal: number; action: string }): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO promo_history (user_id, promo_id, marketplace, product_name, checkout_total, action)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(history.userId, history.promoId, history.marketplace, history.productName, history.checkoutTotal, history.action);
}

export function getPromoHistory(userId: number, limit = 10) {
  const db = getDb();
  return db.prepare('SELECT * FROM promo_history WHERE user_id = ? ORDER BY sent_at DESC LIMIT ?').all(userId, limit);
}

export function getAllPromos() {
  const db = getDb();
  return db.prepare('SELECT * FROM promos ORDER BY detected_at DESC').all();
}
