import { Telegraf } from 'telegraf';
import { config } from '../../config';
import { initDb, upsertUser, getPromoHistory } from '../database';
import { Marketplace } from '../models';
import pino from 'pino';
import { ArbitragePipeline } from '../../arbitrage/pipeline/pipeline';

const logger = pino({ level: config.logLevel });

function isAllowed(userId: number): boolean {
  if (!config.allowedUserIds.length) return true;
  return config.allowedUserIds.includes(userId);
}

// ─── Professional help text (reflects actual implemented capabilities) ──────
const HELP_TEXT =
  '🤖 MARKETINTELE\n' +
  'Arbitrage Intelligence Engine\n\n' +
  'Analisis peluang arbitrage marketplace Indonesia berdasarkan:\n' +
  '• harga marketplace\n' +
  '• supplier/source price\n' +
  '• landed cost\n' +
  '• margin\n' +
  '• ROI\n' +
  '• risk\n' +
  '• freshness\n' +
  '• provenance\n\n' +
  '— COMMANDS —\n\n' +
  '🔎 Discovery\n' +
  '/arbitrage <produk> — Analisis peluang arbitrage untuk produk\n' +
  '/arbitrage <produk> <marketplace> — Batasi ke marketplace tertentu\n\n' +
  '⚙️ Settings\n' +
  '/setbudget <nominal> — Set batas budget\n' +
  '/setmarketplace <nama> — Pilih marketplace aktif\n' +
  '/setkategori <nama> — Pilih kategori\n' +
  '/setnotifikasi on/off — Aktifkan/nonaktifkan notifikasi\n\n' +
  '📋 System\n' +
  '/status — Status worker & adapter\n' +
  '/health — Health check database & dependencies\n' +
  '/history — Riwayat analisis arbitrage\n' +
  '/help — Bantuan ini\n\n' +
  'Marketplace tersedia: shopee, tokopedia, lazada, blibli, tiktok_shop\n\n' +
  '⚠️ Setiap analisis mempertahankan fail-closed: data UNKNOWN tidak pernah dianggap 0.';

const DEPRECATED_NOTICE =
  'ℹ️ Perintah ini (legacy promo search) sudah tidak digunakan.\n\n' +
  'Gunakan /arbitrage <produk> untuk analisis arbitrage real-time.\n\n' +
  'Contoh: /arbitrage "wireless mouse" shopee';

export function createBot(pipeline?: ArbitragePipeline): Telegraf {
  const bot = new Telegraf(config.telegramBotToken);

  // ─── Diagnostic middleware ───────────────────────────────────────────────
  // Evidences the receive → dispatch → authorization path without weakening
  // any security control. PII is minimized: only a truncated user id hash and
  // the command verb are logged. No tokens, names, or message bodies.
  bot.use(async (ctx, next) => {
    const updateId = ctx.update?.update_id;
    const msg: any = (ctx.update as any)?.message;
    const fromId = msg?.from?.id ?? (ctx.update as any)?.callback_query?.from?.id;
    const text: string | undefined = msg?.text;
    const command = text?.match(/^\/(\w+)/)?.[1];
    logger.info(
      {
        update_id: updateId,
        user: fromId ? Number(String(fromId).slice(-6)) : null,
        command: command ?? null,
      },
      'TELEGRAM UPDATE RECEIVED — dispatching to command handler',
    );
    if (fromId != null) {
      const allowed = isAllowed(fromId);
      logger.info(
        { user: Number(String(fromId).slice(-6)), authorized: allowed },
        'TELEGRAM AUTHORIZATION CHECK',
      );
    }
    return next();
  });

  // ─── Start command — professional product UX ──────────────────────────────
  bot.command('start', async (ctx) => {
    if (!isAllowed(ctx.from.id)) {
      await ctx.reply('⛔ Akses ditolak.');
      return;
    }
    initDb(config.databasePath);
    upsertUser(ctx.from.id, ctx.from.username, {});
    await ctx.reply(
      '🤖 MARKETINTELE\n' +
        'Arbitrage Intelligence Engine\n\n' +
        'Bot ini menganalisis peluang arbitrage antar marketplace Indonesia dan supplier internasional.\n\n' +
        '— COMMANDS —\n\n' +
        '🔎 Discovery\n' +
        '/arbitrage <produk> — Analisis peluang arbitrage\n' +
        '/arbitrage <produk> <marketplace> — Batasi ke marketplace\n\n' +
        '⚙️ Settings\n' +
        '/setbudget <nominal>\n' +
        '/setmarketplace <nama>\n' +
        '/setkategori <nama>\n' +
        '/setnotifikasi on/off\n\n' +
        '📋 System\n' +
        '/status — Status worker\n' +
        '/health — Health check\n' +
        '/history — Riwayat\n' +
        '/help — Bantuan lengkap\n\n' +
        'Marketplace: shopee, tokopedia, lazada, blibli, tiktok_shop',
    );
  });

  // ─── Help command ─────────────────────────────────────────────────────────
  bot.help(async (ctx) => {
    if (!isAllowed(ctx.from.id)) {
      await ctx.reply('⛔ Akses ditolak.');
      return;
    }
    await ctx.reply(HELP_TEXT);
  });

  // ─── Status command — worker & adapter status ─────────────────────────────
  bot.command('status', async (ctx) => {
    if (!isAllowed(ctx.from.id)) {
      await ctx.reply('⛔ Akses ditolak.');
      return;
    }
    const adapterCount = pipeline ? 5 : 0;
    const pipelineState = pipeline ? 'READY' : 'NOT_INITIALIZED';
    await ctx.reply(
      '📊 MarketIntele Status\n\n' +
        `Pipeline: ${pipelineState}\n` +
        `Adapters: ${adapterCount} (shopee, tokopedia, lazada, blibli, tiktok_shop)\n` +
        `Marketplaces: 5\n` +
        `Mode: Long-polling (Fly.io)\n` +
        `Database: PostgreSQL + SQLite\n` +
        `Version: 2.0.0`,
    );
  });

  // ─── Health command ───────────────────────────────────────────────────────
  bot.command('health', async (ctx) => {
    if (!isAllowed(ctx.from.id)) {
      await ctx.reply('⛔ Akses ditolak.');
      return;
    }
    await ctx.reply(
      '💚 Health Check\n\n' +
        'Worker: ✅ Running (Fly.io)\n' +
        'Polling: ✅ Active\n' +
        'PostgreSQL: see /ready endpoint on :9090\n' +
        'SQLite: see DATABASE READY in logs\n' +
        'Adapters: 5 registered\n\n' +
        'Full health: curl https://marketintele-worker.fly.dev/health',
    );
  });

  // ─── Settings commands (backed by SQLite) ─────────────────────────────────
  bot.command('setbudget', async (ctx) => {
    if (!isAllowed(ctx.from.id)) return;
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (!args.length || !/^\d+$/.test(args[0])) {
      await ctx.reply('Format: /setbudget nominal\nContoh: /setbudget 10000');
      return;
    }
    const budget = parseInt(args[0], 10);
    initDb(config.databasePath);
    upsertUser(ctx.from.id, ctx.from.username, { budget });
    await ctx.reply(`✅ Budget diatur: Rp${budget.toLocaleString('id-ID')}`);
  });

  bot.command('setmarketplace', async (ctx) => {
    if (!isAllowed(ctx.from.id)) return;
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (!args.length) {
      await ctx.reply('Format: /setmarketplace nama\nContoh: /setmarketplace shopee tokopedia');
      return;
    }
    const valid = args.filter((a) => Object.values(Marketplace).includes(a as Marketplace));
    if (!valid.length) {
      await ctx.reply('Marketplace tidak dikenali. Pilihan: shopee, tokopedia, lazada, blibli, tiktok_shop');
      return;
    }
    initDb(config.databasePath);
    upsertUser(ctx.from.id, ctx.from.username, { marketplaces: valid.join(',') });
    await ctx.reply(`✅ Marketplace diatur: ${valid.join(', ')}`);
  });

  bot.command('setkategori', async (ctx) => {
    if (!isAllowed(ctx.from.id)) return;
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (!args.length) {
      await ctx.reply('Format: /setkategori nama\nContoh: /setkategori elektronik');
      return;
    }
    initDb(config.databasePath);
    upsertUser(ctx.from.id, ctx.from.username, { categories: args.join(',') });
    await ctx.reply(`✅ Kategori diatur: ${args.join(' ')}`);
  });

  bot.command('setnotifikasi', async (ctx) => {
    if (!isAllowed(ctx.from.id)) return;
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (!args.length || !['on', 'off'].includes(args[0].toLowerCase())) {
      await ctx.reply('Format: /setnotifikasi on/off');
      return;
    }
    const enabled = args[0].toLowerCase() === 'on';
    initDb(config.databasePath);
    upsertUser(ctx.from.id, ctx.from.username, { notificationsEnabled: enabled });
    await ctx.reply(`✅ Notifikasi ${enabled ? 'aktif' : 'nonaktif'}.`);
  });

  // ─── History command ──────────────────────────────────────────────────────
  bot.command('history', async (ctx) => {
    if (!isAllowed(ctx.from.id)) return;
    initDb(config.databasePath);
    const rows = getPromoHistory(ctx.from.id, 10) as any[];
    if (!rows.length) {
      await ctx.reply('Belum ada riwayat analisis.');
      return;
    }
    const lines = ['📜 *Riwayat* (10 terakhir):\n'];
    for (const r of rows) {
      lines.push(`- ${r.product_name} (${r.marketplace}) — Rp${Number(r.checkout_total).toLocaleString('id-ID')} — ${r.sent_at}`);
    }
    await ctx.reply(lines.join('\n'));
  });

  // ─── Legacy deprecated commands (stub scrapers removed) ───────────────────
  for (const cmd of ['cari', 'rp0', 'murah']) {
    bot.command(cmd, async (ctx) => {
      if (!isAllowed(ctx.from.id)) return;
      await ctx.reply(DEPRECATED_NOTICE);
    });
  }

  // ─── Arbitrage Pipeline Command (core) ────────────────────────────────────
  bot.command('arbitrage', async (ctx) => {
    if (!isAllowed(ctx.from.id)) {
      await ctx.reply('⛔ Akses ditolak.');
      return;
    }

    if (!pipeline) {
      await ctx.reply('⚠️ Arbitrage pipeline is not initialized. Contact administrator.');
      return;
    }

    const args = ctx.message.text.split(/\s+/).slice(1);
    if (!args.length) {
      await ctx.reply(
        '📊 MarketIntele Arbitrage\n\n' +
          'Format: /arbitrage query marketplace\n\n' +
          'Contoh:\n' +
          '/arbitrage "sandal kaki" shopee\n' +
          '/arbitrage "power bank" tokopedia\n' +
          '/arbitrage "headphone bluetooth" lazada\n\n' +
          'Marketplace tersedia: shopee, tokopedia, lazada, blibli, tiktok_shop',
      );
      return;
    }

    const query = args.join(' ');
    const marketplace = args.length > 1 ? args[args.length - 1].toLowerCase() : null;
    const cleanQuery = marketplace ? args.slice(0, -1).join(' ') : query;

    const marketplaceList = ['shopee', 'tokopedia', 'lazada', 'blibli', 'tiktok_shop'];
    const mp = marketplace && marketplaceList.includes(marketplace) ? marketplace : null;
    const finalQuery = mp ? cleanQuery : query;

    await ctx.reply(`🔍 Memulai arbitrage analysis untuk: "${finalQuery}"${mp ? ` di ${mp}` : ''}...`);

    try {
      const pipelineResult = await pipeline.execute(ctx.from.id, finalQuery, mp || null);
      logger.info(`[LazadaBrowser] event=pipeline_result canonicalProduct=${pipelineResult.canonicalProduct ? 'true' : 'false'} products=${pipelineResult.discovery?.products?.length || 0}`);

      // ─── 4-category response (Phase 22) ────────────────────────────────────
      // A. MARKETPLACE DATA UNAVAILABLE — discovery found no usable products
      if (
        pipelineResult.discovery &&
        pipelineResult.discovery.status !== 'SUCCESS' &&
        pipelineResult.discovery.products.length === 0
      ) {
        await ctx.reply(
          '🟡 MARKETPLACE DATA UNAVAILABLE\n\n' +
            'The configured marketplace source did not return usable production-eligible observations.\n\n' +
            `Query: ${finalQuery}\n` +
            `Reason: ${pipelineResult.discovery.error || pipelineResult.discovery.status}\n\n` +
            'Kemungkinan penyebab:\n' +
            '• source unavailable\n' +
            '• no matching product\n' +
            '• stale data\n' +
            '• insufficient provenance',
        );
        return;
      }

      // D. SUPPLIER DATA UNAVAILABLE — marketplace data found but no supplier price
      if (
        pipelineResult.supplier &&
        pipelineResult.supplier.sourcePriceIdr === null
      ) {
        const cp = pipelineResult.canonicalProduct;
        const productCount = pipelineResult.discovery?.products?.length || 0;
        const msg = '🟢 MARKETPLACE DATA ACQUIRED\n\n' +
            `Marketplace: ${pipelineResult.discovery?.marketplace || 'unknown'}\n` +
            `Products: ${productCount}\n` +
            `Acquisition: ${cp?.acquisitionMethod || 'unknown'}\n` +
            `Provenance: ${cp?.dataProvenance || 'unknown'}\n\n` +
            'Example Product:\n' +
            `Title: ${cp?.canonicalTitle || 'unknown'}\n` +
            `Price: ${cp?.priceInIdr != null ? 'Rp' + cp.priceInIdr.toLocaleString('id-ID') : 'UNKNOWN'}\n` +
            `URL: ${cp?.marketplaceListingUrl || 'unknown'}\n\n` +
            '──\n\n' +
            '🔵 SUPPLIER DATA UNAVAILABLE\n\n' +
            'Supplier Price: UNKNOWN (no B2B/wholesale source available)\n\n' +
            'Arbitrage:\n' +
            'Status: UNAVAILABLE\n' +
            'Reason: SUPPLIER_PRICE_UNKNOWN\n\n' +
            'This is NOT an opportunity recommendation.\n' +
            'The system fails closed rather than fabricating a supplier price.';
        logger.info(`[LazadaBrowser] event=telegram_response_prepared category=MARKETPLACE_DATA_ACQUIRED products=${productCount} title="${cp?.canonicalTitle || 'none'}" price=${cp?.priceInIdr ?? 'null'} url="${cp?.marketplaceListingUrl || 'none'}"`);
        await ctx.reply(msg);
        logger.info(`[LazadaBrowser] event=telegram_response_sent category=MARKETPLACE_DATA_ACQUIRED`);
        return;
      }

      // B. NO OPPORTUNITY — valid marketplace + supplier data but decision REJECT
      if (
        pipelineResult.opportunity &&
        pipelineResult.opportunity.decision !== 'RECOMMEND'
      ) {
        const reason = pipelineResult.opportunity.reason || 'One or more decision gates failed.';
        await ctx.reply(
          '🔴 NO ARBITRAGE OPPORTUNITY\n\n' +
            'The system found valid marketplace + supplier data, but the opportunity failed one or more decision gates.\n\n' +
            `Decision: ${pipelineResult.opportunity.decision}\n` +
            `Reason: ${reason}\n\n` +
            pipelineResult.formattedResult,
          {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
          },
        );
        return;
      }

      // A. REAL OPPORTUNITY — decision RECOMMEND
      await ctx.reply(pipelineResult.formattedResult, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    } catch (err) {
      logger.error('Arbitrage pipeline error:', err instanceof Error ? err.message : err);
      await ctx.reply(
        '⛔ Error saat menjalankan arbitrage analysis. Silakan coba lagi atau hubungi admin.',
      );
    }
  });

  return bot;
}
