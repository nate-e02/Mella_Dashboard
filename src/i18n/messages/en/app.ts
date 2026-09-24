/** Keys are prefixed "app.". Add the Amharic text for every key in ../am/app.ts (enforced by the type there). */
export const app = {
  // Landing page
  "app.landing.metaTitle": "MellaFx | Prop trading in Ethiopian birr",
  "app.landing.metaDescription":
    "Pay in birr with telebirr, CBE Birr, M-Pesa or card, pass a simulated trading challenge on live market prices, and get your profit share paid to telebirr or your bank.",
  "app.landing.login": "Log in",
  "app.landing.getStarted": "Get started",
  "app.landing.badge": "Ethiopia's prop trading firm · pay in birr",
  "app.landing.heroTitle": "Trade our capital. Keep most of the profit.",
  "app.landing.heroBody":
    "Prove your skill on a simulated account priced from live global markets — forex, gold, silver and crypto. Pass the challenge, get a funded account, and receive your profit share in birr to telebirr, CBE Birr or your bank.",
  "app.landing.ctaStart": "Start a challenge",
  "app.landing.ctaLogin": "I already have an account",
  "app.landing.ctaRules": "Read the rules",
  "app.landing.featuresTitle": "Built for traders in Ethiopia",
  "app.landing.feature.pay.title": "Pay in birr",
  "app.landing.feature.pay.body": "Pay the challenge fee in ETB through Chapa with telebirr, CBE Birr, M-Pesa or a bank card. No dollars needed.",
  "app.landing.feature.payout.title": "Payouts to telebirr or bank",
  "app.landing.feature.payout.body":
    "After {days} days on a funded account, request your profit share to telebirr, CBE Birr or a bank account. Two separate staff members check every payout before it is sent.",
  "app.landing.feature.split.title": "Up to {split}% profit split",
  "app.landing.feature.split.body": "Keep the larger share of the profit you make on your funded account. The split is shown on every challenge before you buy.",
  "app.landing.feature.terminal.title": "Live trading terminal",
  "app.landing.feature.terminal.body": "Trade in your browser — on phone or computer — with live market prices, Stop Loss and Take Profit. Nothing to install.",
  "app.landing.feature.rules.title": "Clear rules, fixed at purchase",
  "app.landing.feature.rules.body": "Your targets and loss limits are frozen when you buy and tracked live on your dashboard. No surprise rule changes.",
  "app.landing.feature.local.title": "Amharic and phone sign-up",
  "app.landing.feature.local.body": "Use MellaFx in Amharic or English, sign up with your phone number, and verify your identity with your Fayda ID.",
  "app.landing.stepsTitle": "How it works",
  "app.landing.step1.title": "Choose and pay",
  "app.landing.step1.body": "Pick an account size and pay the one-time fee in birr.",
  "app.landing.step2.title": "Pass the challenge",
  "app.landing.step2.body": "Reach the profit target without breaking the daily or maximum loss limit.",
  "app.landing.step3.title": "Get funded and paid",
  "app.landing.step3.body": "Trade your funded account and withdraw your profit share in birr.",
  "app.landing.pricingTitle": "Choose your challenge",
  "app.landing.pricingSubtitle": "Prices are in birr and include everything. Account sizes are in simulated birr.",
  "app.landing.noChallenges": "No challenges are currently available. Check back soon.",
  "app.landing.card.target": "Profit target: {value}%",
  "app.landing.card.noTarget": "Profit target: none",
  "app.landing.card.daily": "Daily loss limit: {value}%",
  "app.landing.card.maxStatic": "Max loss: {value}% (static)",
  "app.landing.card.maxTrailing": "Max loss: {value}% (trailing)",
  "app.landing.card.minDays": "Minimum trading days: {value}",
  "app.landing.card.split": "Profit split: {value}%",
  "app.landing.card.fee": "One-time fee",
  "app.landing.footer.disclaimer":
    "MellaFx challenge and funded accounts are simulated trading accounts that use real market prices; payouts are real and paid in birr. Trading involves risk, and a challenge fee is not an investment.",
  "app.landing.footer.copyright": "© {year} MellaFx.",
  "app.landing.footer.links": "Site links",

  // Public pages shared bits
  "app.public.lastUpdatedNote": "The exact numbers for your account are frozen when you buy and shown on your dashboard.",
  "app.public.ctaTitle": "Ready to start?",
  "app.public.ctaBody": "Create your account with your phone number and pick a challenge.",

  // Trading rules page
  "app.rules.metaTitle": "Trading rules · MellaFx",
  "app.rules.metaDescription": "How MellaFx challenge rules work, with examples in birr: daily loss, maximum loss, profit target, trading days, news and weekend rules, and payouts.",
  "app.rules.title": "Trading rules",
  "app.rules.intro":
    "Every MellaFx challenge follows the same few rules. This page explains them in plain words with examples in birr. The examples use a {size} account.",
  "app.rules.toc": "On this page",
  "app.rules.example": "Example",

  "app.rules.terms.title": "Key terms",
  "app.rules.terms.balance.term": "Balance",
  "app.rules.terms.balance.def": "The money in your account from closed trades.",
  "app.rules.terms.equity.term": "Equity",
  "app.rules.terms.equity.def": "Your balance plus the profit or loss of trades that are still open. The loss limits watch your equity live, every second.",
  "app.rules.terms.day.term": "Trading day",
  "app.rules.terms.day.def":
    "A day runs from one daily reset to the next — midnight in Addis Ababa (00:00 EAT) unless your program says otherwise. A day counts as a trading day when you close at least one trade on it.",

  "app.rules.daily.title": "Daily loss limit",
  "app.rules.daily.body":
    "At your account's daily reset we record your equity, including any open trades. If your equity then falls by the daily limit from that figure, the account fails — even if the losing trades are still open.",
  "app.rules.daily.example":
    "{size} account with a {pct}% daily limit. At midnight your equity is {anchor}, because you were up yesterday. Today's limit is {pct}% of {anchor} = {limit}, so your equity must stay above {floor} until the next midnight, when it is recalculated.",

  "app.rules.max.title": "Maximum loss: static or trailing",
  "app.rules.max.body":
    "The maximum loss limit protects the whole account. It is a percentage of your initial balance and comes in two types; each program shows which one it uses.",
  "app.rules.max.static.title": "Static",
  "app.rules.max.static.body": "The floor never moves: your initial balance minus the limit, for the whole life of the account.",
  "app.rules.max.static.example":
    "{size} account with a {pct}% static limit ({limit}). Your equity must always stay above {floor} — even after you have made a profit.",
  "app.rules.max.trailing.title": "Trailing",
  "app.rules.max.trailing.body":
    "The floor follows your highest equity upwards, always the same distance below it, until it reaches your initial balance. From then on it stays at your initial balance.",
  "app.rules.max.trailing.example":
    "{size} account with a {pct}% trailing limit ({limit}). You start with a floor of {floor0}. Your equity peaks at {peak1}, so the floor rises to {floor1}. Your equity then peaks at {peak2}: the floor reaches {size} and locks there. Higher peaks never move it again.",

  "app.rules.target.title": "Profit target and minimum trading days",
  "app.rules.target.body":
    "You pass a phase when your profit from closed trades reaches the target and you have traded on at least the minimum number of days. Open trades count only once they are closed. Passing is automatic: your next-phase or funded account is created straight away.",
  "app.rules.target.example":
    "{size} account with an {pct}% target and {days} minimum trading days: you need {amount} of closed profit, and trades closed on at least {days} different days. Reaching the target on the first day is not enough on its own — keep within the limits and trade on more days.",
  "app.rules.target.phases": "Two-step programs have a second phase with its own target. Funded accounts have no profit target.",

  "app.rules.time.title": "Time limit",
  "app.rules.time.body":
    "Some programs give you a fixed number of days to reach the target. If the time runs out first, the challenge ends as failed. Funded accounts have no time limit. The table below shows the limit for each program.",

  "app.rules.holding.title": "Weekend, overnight and news rules",
  "app.rules.holding.body": "Each program says whether these are allowed. When a rule is off for your program:",
  "app.rules.holding.weekend": "Weekend holding: your open positions are closed automatically before the forex market closes on Friday.",
  "app.rules.holding.overnight": "Overnight holding: your open positions are closed automatically at the end of the trading day.",
  "app.rules.holding.news":
    "News trading: you cannot open new orders on the affected pairs from 2 minutes before until 2 minutes after a high-impact economic news event.",

  "app.rules.consistency.title": "Consistency rule",
  "app.rules.consistency.body":
    "Some programs require steady results: your best single day may be at most a set percentage of your total profit before you can pass or withdraw.",
  "app.rules.consistency.example":
    "With a {pct}% rule and {total} of total profit, your best day may be at most {max}. If your best day was {best}, keep trading until your total profit reaches {needed}.",

  "app.rules.breach.title": "If you break a limit",
  "app.rules.breach.body":
    "The moment your equity touches a loss limit, all open positions are closed and the account is marked Failed. You get a notification, and your trade history stays available. You can start again with a new challenge.",

  "app.rules.payouts.title": "Payouts",
  "app.rules.payouts.body": "You can request a payout from a funded account when:",
  "app.rules.payouts.funded": "the account has been funded for at least {days} days;",
  "app.rules.payouts.kyc": "your identity (KYC) has been approved with your Fayda ID;",
  "app.rules.payouts.min": "the amount is at least {min}.",
  "app.rules.payouts.available":
    "You can withdraw your share of the profit (profit × your profit split) minus any payouts still being processed. Money is sent to telebirr, CBE Birr or your bank account.",
  "app.rules.payouts.review": "Every payout is checked by two different MellaFx staff members: one approves the request and another sends the money.",
  "app.rules.payouts.example":
    "Funded {size} account with an {split}% split and a balance of {balance}: your profit is {profit} and your share is {share}. When it is paid, {profit} of profit is used ({share} to you, {firm} to MellaFx) and your loss limits move down by the same amount, so a payout never counts as a loss.",

  "app.rules.programs.title": "Current programs",
  "app.rules.programs.subtitle": "Rules for the first phase of each program on sale today.",
  "app.rules.programs.empty": "No programs are on sale right now.",
  "app.rules.programs.program": "Program",
  "app.rules.programs.sizes": "Account sizes",
  "app.rules.programs.target": "Profit target",
  "app.rules.programs.daily": "Daily loss",
  "app.rules.programs.max": "Max loss",
  "app.rules.programs.minDays": "Min. days",
  "app.rules.programs.time": "Time limit",
  "app.rules.programs.weekend": "Weekend holding",
  "app.rules.programs.news": "News trading",
  "app.rules.programs.split": "Profit split",
  "app.rules.programs.static": "static",
  "app.rules.programs.trailing": "trailing",
  "app.rules.programs.days": "{n} days",
  "app.rules.programs.noLimit": "None",
  "app.rules.programs.allowed": "Allowed",
  "app.rules.programs.notAllowed": "Not allowed",

  // FAQ page
  "app.faq.metaTitle": "Frequently asked questions · MellaFx",
  "app.faq.metaDescription": "Answers for traders in Ethiopia: paying in birr, simulated accounts and real payouts, Fayda KYC, phone sign-up, refunds and support.",
  "app.faq.title": "Frequently asked questions",
  "app.faq.intro": "Short answers to the questions traders ask us most. Can't find yours? Log in and open a support ticket.",
  "app.faq.q.what": "What is MellaFx?",
  "app.faq.a.what":
    "MellaFx is an Ethiopian prop trading firm. You pay a one-time fee in birr, trade a simulated account, and if you pass the challenge you get a funded account and a share of the profit you make.",
  "app.faq.q.real": "Is it real money?",
  "app.faq.a.real":
    "Challenge and funded accounts are simulated: the account balance is not real money, but prices come from the live market. The fee you pay and the payouts you receive are real, and both are in birr.",
  "app.faq.q.pay": "How do I pay?",
  "app.faq.a.pay": "At checkout we use Chapa. You can pay with telebirr, CBE Birr, M-Pesa or a bank card, all in birr. Your challenge starts as soon as the payment is confirmed.",
  "app.faq.q.price": "How much does a challenge cost?",
  "app.faq.a.price": "Challenges currently start at {price}. Every price is shown in birr on the home page and includes everything — there are no monthly fees.",
  "app.faq.a.priceNone": "Prices are shown in birr on the home page and include everything — there are no monthly fees.",
  "app.faq.q.phone": "Can I sign up with my phone number?",
  "app.faq.a.phone": "Yes. Enter your Ethiopian phone number and the code we send you by SMS. Adding an email address is optional.",
  "app.faq.q.trade": "What can I trade, and do I need MT5?",
  "app.faq.a.trade":
    "You trade major forex pairs such as EURUSD, gold, silver and crypto such as Bitcoin in the MellaFx terminal in your browser. It works on a phone, and there is nothing to install.",
  "app.faq.q.rules": "What are the main rules?",
  "app.faq.a.rules": "Stay within the daily and maximum loss limits, reach the profit target, and trade on the minimum number of days. See the trading rules page for examples in birr.",
  "app.faq.q.reset": "When does the trading day reset?",
  "app.faq.a.reset": "At midnight in Addis Ababa (00:00 EAT) unless your program says otherwise. The daily loss limit starts again from your equity at that moment.",
  "app.faq.q.fail": "What happens if I break a rule?",
  "app.faq.a.fail":
    "Your open positions are closed, the account is marked Failed and you get a notification. Your trade history stays available so you can learn from it, and you can start again with a new challenge.",
  "app.faq.q.kyc": "What do I need for identity verification (KYC)?",
  "app.faq.a.kyc":
    "Your Fayda ID and a phone with a camera. You verify from the Account page; it takes a few minutes. KYC must be approved before your first payout.",
  "app.faq.q.payout": "When and how do I get paid?",
  "app.faq.a.payout":
    "After {days} days on a funded account, request a payout of at least {min} from the Account page. Two MellaFx staff members check it, and the money is sent to telebirr, CBE Birr or your bank account.",
  "app.faq.q.refund": "Can I get a refund?",
  "app.faq.a.refund": "Refunds follow our refund policy and are reviewed case by case. Please contact support through a support ticket.",
  "app.faq.q.language": "How do I switch between Amharic and English?",
  "app.faq.a.language": "Use the EN / አማ button at the top of the page. When you are logged in, your choice is saved to your profile.",
  "app.faq.q.support": "How do I contact support?",
  "app.faq.a.support": "Log in, go to Account and open a support ticket. You will see our reply there and get a notification.",

  // Trader area
  "app.challenges.metaTitle": "Challenges · MellaFx",
  "app.challenges.title": "Challenges",
  "app.challenges.subtitle": "Choose a challenge, pay in birr, and start trading. Prices include everything, with no hidden fees.",

  "app.history.metaTitle": "Trade history · MellaFx",
  "app.history.title": "History",
  "app.history.subtitle": "Select an account and timeframe to review your trade history.",
  "app.history.account": "Account",
  "app.history.timeframe": "Timeframe",
  "app.history.from": "From",
  "app.history.to": "To",
  "app.history.tf.this_month": "This month",
  "app.history.tf.last_month": "Last month",
  "app.history.tf.3_months": "3 months",
  "app.history.tf.6_months": "6 months",
  "app.history.tf.this_year": "This year",
  "app.history.tf.all_time": "All time",
  "app.history.tf.custom": "Custom range",
  "app.history.col.symbol": "Symbol",
  "app.history.col.side": "Direction",
  "app.history.col.entry": "Entry",
  "app.history.col.exit": "Exit",
  "app.history.col.volume": "Volume",
  "app.history.col.pnl": "Profit/Loss",
  "app.history.col.status": "Status",
  "app.history.col.date": "Date",
  "app.history.noAccounts": "No accounts yet.",
  "app.history.noAccountsHint": "Purchase a challenge to start building trade history.",
  "app.history.emptyTitle": "No trades for this account",
  "app.history.emptyDescription": "No trades were recorded in the selected timeframe.",
  "app.history.loadFailed": "Failed to load trade history",

  "app.kyc.title": "KYC verification",
  "app.kyc.approved": "Your identity has been verified.",
  "app.kyc.pendingSubmitted": "Your verification has been submitted and is being confirmed. This page will update automatically.",
  "app.kyc.pendingInProgress": "A verification session is in progress. If you closed it before finishing, you can start a new one below.",
  "app.kyc.submittedAt": "Submitted {date}",
  "app.kyc.starting": "Starting...",
  "app.kyc.resume": "Resume verification",
  "app.kyc.start": "Start verification",
  "app.kyc.retryHint": "You can start a new verification below.",
  "app.kyc.intro": "Verify your identity with your Fayda ID to complete your account setup. It is required before your first payout.",
  "app.kyc.fail.generic": "Verification could not be completed.",
  "app.kyc.fail.abandoned": "The verification session was closed before it finished.",
  "app.kyc.fail.steps": "One or more verification steps could not be confirmed.",
  "app.kyc.toast.submitted": "Verification submitted — confirming your result...",
  "app.kyc.toast.couldNotStart": "Verification could not be started. Please try again.",
  "app.kyc.error.start": "Failed to start verification",
  "app.kyc.error.widget": "The verification window failed to load. Check your connection and try again.",

  "app.notifications.title": "Notifications",
  "app.notifications.label": "Notifications",
  "app.notifications.labelUnread": "Notifications, {n} unread",
  "app.notifications.empty": "No notifications yet.",
  "app.notifications.open": "Open →",

  // Error, 404 and loading states
  "app.notFound.title": "Page not found",
  "app.notFound.body": "The page you are looking for does not exist or you do not have access to it.",
  "app.notFound.back": "Back to home",
  "app.error.title": "Something went wrong",
  "app.error.body": "The page could not be loaded. Our team has been notified.",
  "app.error.reference": "Reference: {ref}",
  "app.globalError.title": "MellaFx is temporarily unavailable",
  "app.globalError.body": "Please try again in a moment.",
  "app.globalError.reload": "Reload",
  "app.loading.page": "Loading page",
  "app.loading.dashboard": "Loading your dashboard",
  "app.loading.trade": "Loading the trading terminal",
} as const;
