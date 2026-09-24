import type { common as en } from "../en/common";

/*
 * MellaFx Amharic glossary — every namespace follows these choices.
 *
 * Tone
 *   - Buttons and menu items: short imperative (አስቀምጥ, ቀጥል, ውጣ, ግባ).
 *   - Sentences addressed to the trader: polite form (እርስዎ/የእርስዎ, ይሞክሩ, ይክፈሉ).
 *   - Prose uses "ብር" for the currency; "ETB" stays next to formatted amounts
 *     (formatCurrency renders "ETB 1,234.00").
 *   - Midnight EAT is "እኩለ ሌሊት (00:00 EAT)" — never "ከሌሊቱ 12", which readers
 *     may map to the Ethiopian 12-hour clock (where midnight is "ከሌሊቱ 6 ሰዓት").
 *
 * Kept in Latin script (brand, product and trading jargon traders already use)
 *   MellaFx, telebirr, CBE Birr, M-Pesa, Chapa, Fayda, KYC, ETB, EURUSD, XAUUSD,
 *   Stop Loss / SL, Take Profit / TP, lot, pip, MT5, Standard 2-Step, Rapid 1-Step.
 *   Avoid gluing prefixes onto Latin names ("በtelebirr"); rephrase instead:
 *   "telebirr ተጠቅመው ይክፈሉ", "ወደ telebirr ይላካል", "Chapa በኩል". The genitive
 *   "የMellaFx" is fine. SMS in prose: "ኤስኤምኤስ".
 *
 * Terms
 *   challenge ............... ቻሌንጅ (pl. ቻሌንጆች)
 *   evaluation .............. ግምገማ
 *   phase ................... ምዕራፍ (Phase 1 = ምዕራፍ 1)
 *   trading account ......... አካውንት (the simulated account; "የትሬዲንግ አካውንት" when ambiguous)
 *   user account / profile .. መለያ (the nav item "Account")
 *   funded account .......... ፈንድድ አካውንት (status FUNDED = ፈንድድ)
 *   simulated (demo) ........ የማስመሰያ (simulated account = የማስመሰያ አካውንት)
 *   trader .................. ትሬደር
 *   trade (n.) / trading .... ግብይት (trade history = የግብይት ታሪክ)
 *   position / open position  ፖዚሽን / ክፍት ፖዚሽን
 *   order ................... ትዕዛዝ
 *   buy / sell .............. ግዢ / ሽያጭ (buttons: ግዛ / ሽጥ)
 *   balance ................. ቀሪ ሂሳብ
 *   equity .................. ኢክዊቲ (= ቀሪ ሂሳብ + የክፍት ፖዚሽኖች ትርፍ/ኪሳራ)
 *   floating P&L ............ ያልተዘጋ ትርፍ/ኪሳራ
 *   profit / loss / P&L ..... ትርፍ / ኪሳራ / ትርፍና ኪሳራ
 *   drawdown ................ ድሮውዳውን (prefer the limit names below in prose)
 *   daily loss limit ........ የዕለት ኪሳራ ገደብ
 *   max loss / max drawdown . ከፍተኛ የኪሳራ ገደብ
 *   static / trailing ....... ቋሚ / ተከታይ (Trailing)
 *   equity peak ............. የኢክዊቲ ከፍተኛ ደረጃ
 *   profit target ........... የትርፍ ግብ
 *   profit split ............ የትርፍ ድርሻ
 *   minimum trading days .... ዝቅተኛ የግብይት ቀናት
 *   trading day ............. የግብይት ቀን
 *   time limit .............. የጊዜ ገደብ
 *   daily reset ............. የዕለት ዳግም ማስጀመሪያ
 *   consistency rule ........ የወጥነት ህግ
 *   news trading ............ በዜና ሰዓት ግብይት
 *   weekend / overnight holding  በሳምንት መጨረሻ / በአዳር ፖዚሽን መያዝ
 *   rule / rules ............ ህግ / ህጎች (trading rules = የግብይት ህጎች)
 *   breach .................. ጥሰት (to breach a limit = ገደቡን መጣስ)
 *   payout .................. የትርፍ ክፍያ (a trader's withdrawal of profit)
 *   payment / to pay ........ ክፍያ / መክፈል (the trader paying MellaFx)
 *   price / challenge fee ... ዋጋ / የቻሌንጅ ክፍያ
 *   refund .................. ተመላሽ ገንዘብ
 *   KYC / identity check .... የማንነት ማረጋገጫ (KYC)
 *   Fayda ID ................ የፋይዳ መታወቂያ
 *   leaderboard ............. የደረጃ ሰንጠረዥ
 *   referral ................ ሪፈራል (inviting friends = ጓደኞችን መጋበዝ)
 *   certificate ............. ሰርተፊኬት
 *   dashboard ............... ዳሽቦርድ
 *   notification ............ ማሳወቂያ
 *   support ticket .......... የድጋፍ ጥያቄ
 *   sign up / log in / out .. መመዝገብ / መግባት / መውጣት
 *   leverage ................ ሌቨሬጅ
 */
export const common: Record<keyof typeof en, string> = {
  "common.appName": "MellaFx",
  "common.meta.title": "MellaFx | የኢትዮጵያ ፕሮፕ ትሬዲንግ",
  "common.meta.description": "በማስመሰያ የብር አካውንት ይገበያዩ፣ ቻሌንጁን ያልፉ፣ ትርፍዎን ወደ telebirr ወይም ባንክዎ ይቀበሉ። በብር ይክፈሉ፣ በአማርኛ ወይም በእንግሊዝኛ ይገበያዩ።",
  "common.language": "ቋንቋ",
  "common.language.en": "English",
  "common.language.am": "አማርኛ",
  "common.logout": "ውጣ",
  "common.loggingOut": "በመውጣት ላይ...",
  "common.openMenu": "ምናሌ ክፈት",
  "common.closeMenu": "ምናሌ ዝጋ",
  "common.loading": "በመጫን ላይ…",
  "common.save": "አስቀምጥ",
  "common.saving": "በማስቀመጥ ላይ...",
  "common.cancel": "ሰርዝ",
  "common.close": "ዝጋ",
  "common.confirm": "አረጋግጥ",
  "common.pleaseWait": "እባክዎ ይጠብቁ...",
  "common.back": "ተመለስ",
  "common.continue": "ቀጥል",
  "common.submit": "ላክ",
  "common.copy": "ቅዳ",
  "common.copied": "ተቀድቷል",
  "common.share": "አጋራ",
  "common.print": "አትም",
  "common.retry": "እንደገና ሞክር",
  "common.none": "የለም",
  "common.yes": "አዎ",
  "common.no": "አይ",
  "common.status": "ሁኔታ",
  "common.date": "ቀን",
  "common.amount": "መጠን",
  "common.total": "ጠቅላላ",
  "common.search": "ፈልግ...",
  "common.backHome": "← ወደ መነሻ ገጽ ተመለስ",
  "common.unexpectedError": "ያልተጠበቀ ስህተት ተፈጥሯል። እባክዎ እንደገና ይሞክሩ።",

  "common.nav.primary": "ዋና ማውጫ",
  "common.nav.dashboard": "ዳሽቦርድ",
  "common.nav.trade": "ግብይት",
  "common.nav.challenges": "ቻሌንጆች",
  "common.nav.purchases": "ግዢዎቼ",
  "common.nav.history": "ታሪክ",
  "common.nav.leaderboard": "የደረጃ ሰንጠረዥ",
  "common.nav.referrals": "ሪፈራል",
  "common.nav.certificates": "ሰርተፊኬቶች",
  "common.nav.account": "መለያ",
  "common.nav.more": "ተጨማሪ",
  "common.nav.rules": "የግብይት ህጎች",
  "common.nav.faq": "ተደጋጋሚ ጥያቄዎች",

  "common.status.ACTIVE": "ንቁ",
  "common.status.PASSED": "አልፏል",
  "common.status.FAILED": "አልተሳካም",
  "common.status.SUSPENDED": "ታግዷል",
  "common.status.FROZEN": "ተቆልፏል",
  "common.status.FUNDED": "ፈንድድ",
  "common.status.DRAFT": "ረቂቅ",
  "common.status.INACTIVE": "ቦዝኗል",
  "common.status.ARCHIVED": "በማህደር",
  "common.status.PENDING": "በመጠባበቅ ላይ",
  "common.status.APPROVED": "ጸድቋል",
  "common.status.REJECTED": "ውድቅ ተደርጓል",
  "common.status.PAID": "ተከፍሏል",
  "common.status.REFUNDED": "ተመላሽ ተደርጓል",
  "common.status.CANCELLED": "ተሰርዟል",
  "common.status.NEW": "አዲስ",
  "common.status.QUALIFIED": "ብቁ",
  "common.status.NEGOTIATION": "በድርድር ላይ",
  "common.status.CONVERTED": "ደንበኛ ሆኗል",
  "common.status.LOST": "ቀርቷል",
  "common.status.DISABLED": "ተሰናክሏል",
  "common.status.OPEN": "ክፍት",
  "common.status.CLOSED": "ተዘግቷል",
  "common.status.RESOLVED": "ተፈቷል",
  "common.status.FILLED": "ተፈጽሟል",
  "common.status.VOID": "ዋጋ የለውም",
  "common.status.ADMIN": "አስተዳዳሪ",
  "common.status.TRADER": "ትሬደር",

  "common.side.BUY": "ግዢ",
  "common.side.SELL": "ሽያጭ",

  "common.time.justNow": "አሁን",
  "common.time.minutesAgo": "ከ{n} ደቂቃ በፊት",
  "common.time.hoursAgo": "ከ{n} ሰዓት በፊት",
  "common.time.daysAgo": "ከ{n} ቀን በፊት",

  "common.pagination.label": "ገጾች",
  "common.pagination.pageOf": "ገጽ {page} ከ{total}",
  "common.pagination.previous": "ቀዳሚ",
  "common.pagination.next": "ቀጣይ",

  "common.table.emptyTitle": "ምንም መረጃ አልተገኘም",
  "common.table.emptyDescription": "ፍለጋዎን ወይም ማጣሪያዎችን ቀይረው ይሞክሩ።",

  "common.dialog.close": "መስኮቱን ዝጋ",

  "common.comingSoon": "በቅርቡ ይመጣል",
  "common.comingSoon.description": "ይህ ክፍል በቅርቡ ይጀመራል።",

  "common.chart.revenue": "ገቢ",
  "common.chart.equity": "ኢክዊቲ",
};
