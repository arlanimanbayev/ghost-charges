// Well-known subscription merchants. Matching a descriptor here gives a stable grouping key and a
// clean name even before any AI runs, so the core report works offline and is deterministic.
// `overlap` groups services that do the same job (two music services = paying twice for one job).

export const KNOWN = [
  // video
  { re: /NETFLIX/, name: 'Netflix', category: 'Streaming video', overlap: 'video' },
  { re: /HULU/, name: 'Hulu', category: 'Streaming video', overlap: 'video' },
  { re: /DISNEY\s*\+|DISNEYPLUS|DISNEY PLUS/, name: 'Disney+', category: 'Streaming video', overlap: 'video' },
  { re: /\bHBO\b|\bMAX\.COM\b|HBOMAX|\bMAX STREAMING\b/, name: 'Max', category: 'Streaming video', overlap: 'video' },
  { re: /PARAMOUNT/, name: 'Paramount+', category: 'Streaming video', overlap: 'video' },
  { re: /PEACOCK/, name: 'Peacock', category: 'Streaming video', overlap: 'video' },
  { re: /APPLE\s*TV/, name: 'Apple TV+', category: 'Streaming video', overlap: 'video' },
  { re: /YOUTUBE\s*(PREMIUM|PREM)|GOOGLE\s*\*?\s*YOUTUBE(?!\s*MUSIC)/, name: 'YouTube Premium', category: 'Streaming video', overlap: 'video' },
  { re: /\bSTARZ\b/, name: 'Starz', category: 'Streaming video', overlap: 'video' },
  // music & audio
  { re: /SPOTIFY/, name: 'Spotify', category: 'Music', overlap: 'music' },
  { re: /APPLE\s*MUSIC/, name: 'Apple Music', category: 'Music', overlap: 'music' },
  { re: /YOUTUBE\s*MUSIC/, name: 'YouTube Music', category: 'Music', overlap: 'music' },
  { re: /AMAZON\s*MUSIC|AMZN\s*DIGITAL\s*MUSIC/, name: 'Amazon Music', category: 'Music', overlap: 'music' },
  { re: /\bTIDAL\b/, name: 'Tidal', category: 'Music', overlap: 'music' },
  { re: /PANDORA/, name: 'Pandora', category: 'Music', overlap: 'music' },
  { re: /SIRIUS\s*XM|SIRIUSXM/, name: 'SiriusXM', category: 'Music' },
  { re: /AUDIBLE/, name: 'Audible', category: 'Audiobooks' },
  // storage & software
  { re: /APPLE\.COM\/BILL|APPLE\s*COM\s*BILL|ICLOUD/, name: 'Apple (iCloud / App Store)', category: 'Cloud storage', overlap: 'storage' },
  { re: /GOOGLE\s*\*?\s*(ONE|STORAGE)/, name: 'Google One', category: 'Cloud storage', overlap: 'storage' },
  { re: /DROPBOX/, name: 'Dropbox', category: 'Cloud storage', overlap: 'storage' },
  { re: /ADOBE/, name: 'Adobe', category: 'Software' },
  { re: /MICROSOFT\s*\*?\s*(365|OFFICE)|MSFT\s*\*/, name: 'Microsoft 365', category: 'Software' },
  { re: /OPENAI|CHATGPT/, name: 'ChatGPT', category: 'Software' },
  { re: /CANVA/, name: 'Canva', category: 'Software' },
  { re: /GRAMMARLY/, name: 'Grammarly', category: 'Software' },
  { re: /NOTION/, name: 'Notion', category: 'Software' },
  { re: /NORTON|MCAFEE|LIFELOCK/, name: 'Antivirus / identity protection', category: 'Software' },
  { re: /LINKEDIN/, name: 'LinkedIn Premium', category: 'Software' },
  // news & learning
  { re: /NYTIMES|NY\s*TIMES|NEW\s*YORK\s*TIMES/, name: 'The New York Times', category: 'News' },
  { re: /\bWSJ\b|WALL\s*STREET\s*JOURNAL|DOW\s*JONES/, name: 'The Wall Street Journal', category: 'News' },
  { re: /WASHINGTON\s*POST|WAPO/, name: 'The Washington Post', category: 'News' },
  { re: /DUOLINGO/, name: 'Duolingo', category: 'Learning' },
  { re: /MASTERCLASS/, name: 'MasterClass', category: 'Learning' },
  { re: /COURSERA/, name: 'Coursera', category: 'Learning' },
  // fitness & wellbeing
  { re: /PLANET\s*FIT/, name: 'Planet Fitness', category: 'Fitness', overlap: 'gym' },
  { re: /LA\s*FITNESS/, name: 'LA Fitness', category: 'Fitness', overlap: 'gym' },
  { re: /EQUINOX/, name: 'Equinox', category: 'Fitness', overlap: 'gym' },
  { re: /ANYTIME\s*FITNESS/, name: 'Anytime Fitness', category: 'Fitness', overlap: 'gym' },
  { re: /PELOTON/, name: 'Peloton', category: 'Fitness' },
  { re: /CLASSPASS/, name: 'ClassPass', category: 'Fitness' },
  { re: /HEADSPACE/, name: 'Headspace', category: 'Wellbeing', overlap: 'meditation' },
  { re: /\bCALM\b/, name: 'Calm', category: 'Wellbeing', overlap: 'meditation' },
  // memberships & delivery
  { re: /AMAZON\s*PRIME|AMZN\s*PRIME|PRIME\s*VIDEO|AMAZON\s*PRIME\*/, name: 'Amazon Prime', category: 'Membership' },
  { re: /WALMART\s*\+|WALMART\s*PLUS/, name: 'Walmart+', category: 'Membership' },
  { re: /DASHPASS/, name: 'DoorDash DashPass', category: 'Delivery membership', overlap: 'delivery' },
  { re: /UBER\s*\*?\s*ONE\b/, name: 'Uber One', category: 'Delivery membership', overlap: 'delivery' },
  { re: /INSTACART\s*\+|INSTACART\s*PLUS|INSTACART\s*MEMBERSHIP/, name: 'Instacart+', category: 'Delivery membership', overlap: 'delivery' },
  { re: /GRUBHUB\s*\+/, name: 'Grubhub+', category: 'Delivery membership', overlap: 'delivery' },
  // games & dating
  { re: /XBOX|GAME\s*PASS/, name: 'Xbox Game Pass', category: 'Gaming' },
  { re: /PLAYSTATION|PSN|SONY\s*INTERACTIVE/, name: 'PlayStation Plus', category: 'Gaming' },
  { re: /NINTENDO/, name: 'Nintendo Switch Online', category: 'Gaming' },
  { re: /TINDER/, name: 'Tinder', category: 'Dating', overlap: 'dating' },
  { re: /BUMBLE/, name: 'Bumble', category: 'Dating', overlap: 'dating' },
  { re: /HINGE/, name: 'Hinge', category: 'Dating', overlap: 'dating' },
  { re: /PATREON/, name: 'Patreon', category: 'Creators' },
];

/** Charges that are fees, with a short, generic tip on how people usually avoid them. */
export const FEES = [
  { re: /OVERDRAFT|\bOD\s*FEE|NSF|INSUFFICIENT\s*FUNDS|RETURNED\s*ITEM/, type: 'Overdraft / NSF fee', tip: 'Many banks waive one if you ask, and overdraft protection or low-balance alerts help prevent the next.' },
  { re: /MONTHLY\s*(SERVICE|MAINTENANCE|ACCOUNT)\s*FEE|MAINTENANCE\s*FEE|SERVICE\s*CHARGE/, type: 'Monthly account fee', tip: 'Often waived with direct deposit or a minimum balance; a no-fee account removes it.' },
  { re: /FOREIGN\s*(TRANSACTION|TRANS|TXN|EXCH)|INTL\s*(TRANSACTION|TXN)|INTERNATIONAL\s*(TRANSACTION|FEE)|FX\s*FEE|CURRENCY\s*CONVERSION/, type: 'Foreign transaction fee', tip: 'A card with no foreign transaction fee avoids this when you pay in another currency.' },
  { re: /ATM\s*(FEE|SURCHARGE|WITHDRAWAL\s*FEE)|NON-?NETWORK\s*ATM|OUT\s*OF\s*NETWORK/, type: 'ATM fee', tip: 'Your bank\'s own ATMs, or cash back at a store, are usually free.' },
  { re: /LATE\s*(FEE|PAYMENT\s*FEE|CHARGE)/, type: 'Late fee', tip: 'Autopay for at least the minimum payment prevents late fees; a first one is often waived on request.' },
  { re: /INTEREST\s*CHARGE|PURCHASE\s*INTEREST|FINANCE\s*CHARGE/, type: 'Interest charge', tip: 'Paying the full statement balance each month avoids purchase interest.' },
  { re: /PAPER\s*STATEMENT\s*FEE|STATEMENT\s*FEE/, type: 'Paper statement fee', tip: 'Switching to e-statements usually removes it.' },
  { re: /WIRE\s*(TRANSFER\s*)?FEE|TRANSFER\s*FEE/, type: 'Transfer fee', tip: 'Free transfer options (Zelle, ACH) often do the same job.' },
  { re: /ANNUAL\s*(CARD\s*|MEMBERSHIP\s*)?FEE|MEMBERSHIP\s*FEE/, type: 'Annual fee', tip: 'Cards and gyms often add a yearly fee on top of the monthly price; worth checking it still pays for itself.' },
];

/** Money moving between people or accounts: never a subscription, whatever its rhythm. */
export const TRANSFER = /\b(ZELLE|VENMO|CASH\s*APP|TRANSFER|XFER|PAYMENT\s*THANK\s*YOU|CREDIT\s*CARD\s*(PAYMENT|PMT)|CARD\s*PAYMENT|MOBILE\s*PMT|AUTOPAY\s*PAYMENT|ATM\s*WITHDRAWAL|CASH\s*WITHDRAWAL)\b/;
