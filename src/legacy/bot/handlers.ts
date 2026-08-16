import { Telegraf } from 'telegraf';
import { config } from '../../config';
import { initDb, upsertUser, getUser, insertPromoHistory, getPromoHistory } from '../database';
import { rankPromos, filterByBudget, filterBySearchMode } from '../engine';
import { formatVerifiedNotification, formatUnverifiedNotification } from '../notifications/formatter';
import { searchPromos } from '../scrapers/registry';
import { defaultContext } from '../scrapers/base';
import { UserPreferences, Marketplace, VerificationStatus } from '../models';
import pino from 'pino';
import { ArbitragePipeline } from '../../arbitrage/pipeline/pipeline';

const logger = pino({ level: config.logLevel });

function isAllowed(userId: number): boolean {
  if (!config.allowedUserIds.length) return true;
  return config.allowedUserIds.includes(userId);
}

function getUserPrefs(user: any): UserPreferences {
  const prefs: UserPreferences = {
    userId: user.telegram_id,
    budget: user.budget ?? null,
    marketplaces: user.marketplaces ? user.marketplaces.split(',').map((m: string) => m as Marketplace) : [],
    categories: user.categories ? user.categories.split(',').filter(Boolean) : [],
    keywords: user.keywords ? user.keywords.split(',').filter(Boolean) : [],
    sellers: user.sellers ? user.sellers.split(',').filter(Boolean) : [],
    minDiscountPercent: user.min_discount_percent ?? null,
    maxPrice: user.max_price ?? null,
    notificationsEnabled: Boolean(user.notifications_enabled),
    notificationFrequency: user.notification_frequency || 'immediate',
    searchMode: user.search_mode || 'checkout',
  };
  return prefs;
}

export function createBot(pipeline?: ArbitragePipeline): Telegraf {
  const bot = new Telegraf(config.telegramBotToken);

  bot.start(async (ctx) => {
    if (!isAllowed(ctx.from.id)) {
      await ctx.reply('⛔ Akses ditolak.');
      return;
    }
    initDb(config.databasePath);
    upsertUser(ctx.from.id, ctx.from.username, {});
    await ctx.reply(
      '🤖 *Belibot — AI Promo Optimization Agent*\n\n' +
        'Saya mencari promo legal, voucher, cashback, dan kombinasi diskon di marketplace Indonesia untuk mendapatkan *Total Checkout terendah*.\n\n' +
        'Perintah:\n' +
        '/cari — Cari promo terbaru\n' +
        '/rp0 — Cari promo potensial Rp0 checkout\n' +
        '/murah — Produk dengan total checkout paling rendah\n' +
        '/setbudget <nominal> — Set batas total checkout\n' +
        '/setmarketplace <nama> — Pilih marketplace\n' +
        '/setkategori <nama> — Pilih kategori\n' +
        '/setnotifikasi on/off — Aktifkan/nonaktifkan notifikasi\n' +
        '/history — Riwayat promo\n' +
        '/help — Bantuan\n\n' +
        '⚠️ Saya hanya merekomendasikan promo legal dan terverifikasi.',
      { parse_mode: 'Markdown' }
    );
  });

  bot.help(async (ctx) => {
    if (!isAllowed(ctx.from.id)) {
      await ctx.reply('⛔ Akses ditolak.');
      return;
    }
    await ctx.reply(
      '📖 *Bantuan Belibot*\n\n' +
        '/start — Memulai bot\n' +
        '/cari — Cari promo terbaru\n' +
        '/rp0 — Cari promo potensial Rp0 checkout\n' +
        '/murah — Produk dengan total checkout paling rendah\n' +
        '/setbudget <nominal> — Set batas total checkout\n' +
        '/setmarketplace <nama> — Pilih marketplace\n' +
        '/setkategori <nama> — Pilih kategori\n' +
        '/setnotifikasi on/off — Aktifkan/nonaktifkan notifikasi\n' +
        '/history — Riwayat promo\n' +
        '/help — Bantuan ini\n\n' +
        'ℹ️ Total checkout = harga + diskon - voucher - ongkir + biaya wajib.',
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('setbudget', async (ctx) => {
    if (!isAllowed(ctx.from.id)) return;
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (!args.length || !/^\d+$/.test(args[0])) {
      await ctx.reply('Format: /setbudget <nominal>\nContoh: /setbudget 10000');
      return;
    }
    const budget = parseInt(args[0], 10);
    upsertUser(ctx.from.id, ctx.from.username, { budget });
    await ctx.reply(`✅ Budget diatur: Total Checkout <= Rp${budget.toLocaleString('id-ID')}`);
  });

  bot.command('setmarketplace', async (ctx) => {
    if (!isAllowed(ctx.from.id)) return;
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (!args.length) {
      await ctx.reply('Format: /setmarketplace <nama>\nContoh: /setmarketplace shopee tokopedia');
      return;
    }
    const valid = args.filter((a) => Object.values(Marketplace).includes(a as Marketplace));
    if (!valid.length) {
      await ctx.reply('Marketplace tidak dikenali. Pilihan: shopee, tokopedia, lazada, blibli, tiktok_shop');
      return;
    }
    upsertUser(ctx.from.id, ctx.from.username, { marketplaces: valid.join(',') });
    await ctx.reply(`✅ Marketplace diatur: ${valid.join(', ')}`);
  });

  bot.command('setkategori', async (ctx) => {
    if (!isAllowed(ctx.from.id)) return;
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (!args.length) {
      await ctx.reply('Format: /setkategori <nama>\nContoh: /setkategori elektronik');
      return;
    }
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
    upsertUser(ctx.from.id, ctx.from.username, { notificationsEnabled: enabled });
    await ctx.reply(`✅ Notifikasi ${enabled ? 'aktif' : 'nonaktif'}.`);
  });

  bot.command('history', async (ctx) => {
    if (!isAllowed(ctx.from.id)) return;
    initDb(config.databasePath);
    const rows = getPromoHistory(ctx.from.id, 10) as any[];
    if (!rows.length) {
      await ctx.reply('Belum ada riwayat promo.');
      return;
    }
    const lines = ['📜 *Riwayat Promo* (10 terakhir):\n'];
    for (const r of rows) {
      lines.push(`- ${r.product_name} (${r.marketplace}) — Total Checkout: Rp${Number(r.checkout_total).toLocaleString('id-ID')} — ${r.sent_at}`);
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  });

  async function sendSearchResults(ctx: any, rp0Mode = false) {
    initDb(config.databasePath);
    const userRow = getUser(ctx.from.id);
    if (!userRow) {
      await ctx.reply('Ketik /start terlebih dahulu.');
      return;
    }
    const prefs = getUserPrefs(userRow);
    await ctx.reply(rp0Mode ? '🔍 Mencari kandidat promo Rp0 checkout...' : '🔍 Mencari promo terbaru...');

    let results = await searchPromos(prefs, defaultContext, rp0Mode);
    results = rankPromos(results, prefs);
    results = filterByBudget(results, prefs.budget);
    results = filterBySearchMode(results, rp0Mode ? 'rp0' : prefs.searchMode);

    if (!results.length) {
      await ctx.reply(
        rp0Mode
          ? 'Belum menemukan promo Rp0 yang terverifikasi saat ini. Saya akan memprioritaskan promo dengan total checkout paling rendah.'
          : 'Belum menemukan promo yang cocok saat ini.'
      );
      return;
    }

    if (rp0Mode) {
      const verified = results.filter((p) => p.verificationStatus === VerificationStatus.VERIFIED);
      const unverified = results.filter((p) => p.verificationStatus !== VerificationStatus.VERIFIED);

      if (verified.length) {
        await ctx.reply('🟢 *RP0 CHECKOUT TERDETEKSI*', { parse_mode: 'Markdown' });
        for (const promo of verified.slice(0, 5)) {
          await ctx.reply(formatVerifiedNotification(promo), { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } });
        }
      }
      if (unverified.length) {
        await ctx.reply('🔴 *Kandidat belum terverifikasi*', { parse_mode: 'Markdown' });
        for (const promo of unverified.slice(0, 3)) {
          await ctx.reply(formatUnverifiedNotification(promo), { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } });
        }
      }
    } else {
      const top = results.slice(0, config.maxSearchResults);
      for (const promo of top) {
        const text =
          (promo.verificationStatus as VerificationStatus) === VerificationStatus.VERIFIED
            ? formatVerifiedNotification(promo)
            : formatUnverifiedNotification(promo);
        await ctx.reply(text, { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } });
      }
    }

    for (const promo of results.slice(0, config.maxSearchResults)) {
      insertPromoHistory({
        userId: ctx.from.id,
        promoId: promo.promoId,
        marketplace: promo.marketplace,
        productName: promo.productName,
        checkoutTotal: promo.checkoutTotal,
        action: rp0Mode ? 'rp0' : 'search',
      });
    }
  }

  bot.command('cari', async (ctx) => {
    if (!isAllowed(ctx.from.id)) return;
    await sendSearchResults(ctx, false);
  });

  bot.command('rp0', async (ctx) => {
    if (!isAllowed(ctx.from.id)) return;
    await sendSearchResults(ctx, true);
  });

  bot.command('murah', async (ctx) => {
    if (!isAllowed(ctx.from.id)) return;
    initDb(config.databasePath);
    const userRow = getUser(ctx.from.id);
    if (!userRow) {
      await ctx.reply('Ketik /start terlebih dahulu.');
      return;
    }
    const prefs = getUserPrefs(userRow);
    await ctx.reply('🔍 Mencari produk dengan total checkout terendah...');

    let results = await searchPromos(prefs, defaultContext, false);
    results = rankPromos(results, prefs);
    results = filterByBudget(results, prefs.budget);

    if (!results.length) {
      await ctx.reply('Belum menemukan promo yang cocok saat ini.');
      return;
    }

    for (const promo of results.slice(0, config.maxSearchResults)) {
      const text =
        (promo.verificationStatus as VerificationStatus) === VerificationStatus.VERIFIED
          ? formatVerifiedNotification(promo)
          : formatUnverifiedNotification(promo);
      await ctx.reply(text, { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } });
    }
  });

  // ─── Arbitrage Pipeline Command ───────────────────────────────────────────
  bot.command('arbitrage', async (ctx) => {
    if (!isAllowed(ctx.from.id)) {
      await ctx.reply('⛔ Akses ditolak.');
      return;
    }

    if (!pipeline) {
      await ctx.reply('⚠️ Arbitrage pipeline is not initialized. Contact administrator.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const args = ctx.message.text.split(/\s+/).slice(1);
    if (!args.length) {
      await ctx.reply(
        '📊 *MarketIntele Arbitrage*\\n\\n' +
          'Format: `/arbitrage <query> [marketplace]`\\n\\n' +
          'Contoh:\\n' +
          `/arbitrage "sandal kaki" shopee\\n` +
          `/arbitrage "power bank" tokopedia\\n` +
          '/arbitrage "headphone bluetooth" lazada\\n\\n' +
          'Marketplace tersedia: shopee, tokopedia, lazada, blibli, tiktok_shop',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const query = args.join(' ');
    const marketplace = args.length > 1 ? args[args.length - 1].toLowerCase() : null;
    const cleanQuery = marketplace ? args.slice(0, -1).join(' ') : query;

    const marketplaceList = ['shopee', 'tokopedia', 'lazada', 'blibli', 'tiktok_shop'];
    const mp = marketplace && marketplaceList.includes(marketplace) ? marketplace : null;
    const finalQuery = mp ? cleanQuery : query;

    await ctx.reply(`🔍 Memulai arbitrage analysis untuk: "${finalQuery}"${mp ? ` di ${mp}` : ''}...`, {
      parse_mode: 'Markdown',
    });

    try {
      const pipelineResult = await pipeline.execute(ctx.from.id, finalQuery, mp || null);
      await ctx.reply(pipelineResult.formattedResult, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    } catch (err) {
      logger.error('Arbitrage pipeline error:', err instanceof Error ? err.message : err);
      await ctx.reply(
        '⛔ Error saat menjalankan arbitrage analysis. Silakan coba lagi atau hubungi admin.',
        { parse_mode: 'Markdown' },
      );
    }
  });

  // ─── Start command update ─────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    if (!isAllowed(ctx.from.id)) {
      await ctx.reply('⛔ Akses ditolak.');
      return;
    }
    initDb(config.databasePath);
    upsertUser(ctx.from.id, ctx.from.username, {});
    await ctx.reply(
      '🤖 *MarketIntele — Arbitrage Intelligence Engine*\\n\\n' +
        'Bot ini menganalisis peluang arbitrage antar marketplace Indonesia dan supplier internasional.\\n\\n' +
        'Perintah:\\n' +
        '/arbitrage <query> [marketplace] — Analisis arbitrage untuk produk\\n' +
        '/cari — Cari promo terbaru (legacy)\\n' +
        '/rp0 — Cari promo potensial Rp0 checkout (legacy)\\n' +
        '/murah — Produk dengan total checkout paling rendah (legacy)\\n' +
        '/setbudget <nominal> — Set batas total checkout\\n' +
        '/setmarketplace <nama> — Pilih marketplace\\n' +
        '/setkategori <nama> — Pilih kategori\\n' +
        '/setnotifikasi on/off — Aktifkan/nonaktifkan notifikasi\\n' +
        '/history — Riwayat promo\\n' +
        '/help — Bantuan\\n\\n' +
        '⚠️ Untuk arbitrage: gunakan perintah /arbitrage dengan query produk.',
      { parse_mode: 'Markdown' },
    );
  });

  return bot;
}
