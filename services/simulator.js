// Realistic transaction data for UniwebPay / SingEat / YiDian network

const PAYMENT_METHODS = [
  "Visa", "Mastercard", "Alipay", "WeChat Pay",
  "GrabPay", "ShopeePay", "PayNow", "SGQR",
];
const PAYMENT_WEIGHTS = [0.18, 0.15, 0.18, 0.14, 0.12, 0.08, 0.10, 0.05];

const MERCHANTS = [
  // Fine Dining — SingEat partners
  { name: "Imperial Treasures Fine Chinese Cuisine", category: "fine_dining" },
  { name: "Crystal Jade Golden Palace",              category: "fine_dining" },
  { name: "Shisen Hanten by Chen Kentaro",           category: "fine_dining" },
  { name: "Waku Ghin at Marina Bay Sands",           category: "fine_dining" },
  { name: "Summer Pavilion Ritz-Carlton",            category: "fine_dining" },
  { name: "Jade Restaurant at Fullerton",            category: "fine_dining" },

  // Casual Dining — YiDian recommended
  { name: "Paradise Dynasty ION Orchard",            category: "casual_dining" },
  { name: "Din Tai Fung VivoCity",                   category: "casual_dining" },
  { name: "Hai Di Lao Hot Pot Orchard",              category: "casual_dining" },
  { name: "Tim Ho Wan Plaza Singapura",              category: "casual_dining" },
  { name: "Dian Xiao Er Clarke Quay",                category: "casual_dining" },
  { name: "Peach Garden OCBC Centre",                category: "casual_dining" },
  { name: "Birds of Paradise Gelato",                category: "casual_dining" },
  { name: "Song Fa Bak Kut Teh",                    category: "casual_dining" },

  // Food Courts
  { name: "Koufu Kopitiam Bugis+",                   category: "food_court" },
  { name: "Hawker Chan Chinatown",                   category: "food_court" },
  { name: "Maxwell Food Centre",                     category: "food_court" },
  { name: "Old Chang Kee Orchard Rd",                category: "food_court" },

  // Retail / Tourism
  { name: "Suntec City Mall Retailer",               category: "retail" },
  { name: "Chinatown Heritage Souvenir",             category: "retail" },
  { name: "BreadTalk Raffles City",                  category: "retail" },
  { name: "Resorts World Sentosa Shop",              category: "retail" },
  { name: "Gardens by the Bay Gift Shop",            category: "retail" },
  { name: "Marina Bay Sands Boutique",               category: "retail" },
];

const AMOUNT_RANGES = {
  fine_dining:   { min: 80,  max: 1500 },
  casual_dining: { min: 12,  max: 160  },
  food_court:    { min: 3,   max: 30   },
  retail:        { min: 15,  max: 800  },
};

const MERCHANT_AVERAGES = {
  fine_dining: 250,
  casual_dining: 55,
  food_court: 12,
  retail: 120,
};

const COUNTRIES = [
  { name: "Singapore", weight: 0.74 },
  { name: "China",     weight: 0.18 },
  { name: "Malaysia",  weight: 0.04 },
  { name: "Indonesia", weight: 0.02 },
  { name: "Hong Kong", weight: 0.015 },
  { name: "Taiwan",    weight: 0.005 },
];

function weightedPick(items, weights) {
  const r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += weights[i];
    if (r <= cumulative) return items[i];
  }
  return items[items.length - 1];
}

function randFloat(min, max) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateAmount(category) {
  // 4% chance of anomalous high-value transaction for risk testing
  if (Math.random() < 0.04) {
    return randFloat(3000, 8000);
  }
  const r = AMOUNT_RANGES[category];
  return randFloat(r.min, r.max);
}

function generateTxnId() {
  const ts  = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).substr(2, 5).toUpperCase();
  return `UWP-${ts}-${rnd}`;
}

function generateUserId(country) {
  const prefixes = { Singapore: "SG", China: "CN", Malaysia: "MY", Indonesia: "ID", "Hong Kong": "HK", Taiwan: "TW" };
  const prefix = prefixes[country] || "XX";
  return `${prefix}-${randInt(10000, 99999)}`;
}

function merchantId(name) {
  return `MRC-${name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32)}`;
}

function randomDigits(length) {
  return Array.from({ length }, () => randInt(0, 9)).join("");
}

exports.generateTransaction = () => {
  const merchant       = MERCHANTS[randInt(0, MERCHANTS.length - 1)];
  const country        = weightedPick(COUNTRIES.map(c => c.name), COUNTRIES.map(c => c.weight));
  const payment_method = weightedPick(PAYMENT_METHODS, PAYMENT_WEIGHTS);
  const amount         = generateAmount(merchant.category);
  const transaction_type = Math.random() < 0.35 ? "online" : "face_to_face";
  const isCard = payment_method === "Visa" || payment_method === "Mastercard";
  const cardBin = isCard ? (payment_method === "Visa" ? "411111" : "555555") : null;
  const cardLast4 = isCard ? randomDigits(4) : null;
  const userId = generateUserId(country);

  return {
    transaction_id: generateTxnId(),
    merchant_id:    merchantId(merchant.name),
    user_id:        userId,
    merchant_name:  merchant.name,
    business_category: merchant.category,
    merchant_average_amount: MERCHANT_AVERAGES[merchant.category],
    merchant_risk_score: amount > 3000 ? 75 : randInt(5, 35),
    merchant_country: "Singapore",
    has_physical_location: true,
    payment_method,
    transaction_type,
    amount,
    currency:       "SGD",
    country,
    ip_address:     transaction_type === "online" ? `103.18.${randInt(1, 254)}.${randInt(1, 254)}` : null,
    masked_wallet_ref: !isCard ? `${payment_method.toUpperCase().replace(/\s+/g, "-")}-***${userId.slice(-4)}` : null,
    masked_payment_ref: `PAY-***${randomDigits(6)}`,
    card_bin: cardBin,
    card_last4: cardLast4,
    masked_card_number: isCard ? `${cardBin}******${cardLast4}` : null,
    card_presence: isCard ? (transaction_type === "online" ? "card_not_present" : "card_present") : null,
    terminal_id: transaction_type === "face_to_face" ? `TERM-${randInt(1000, 9999)}` : null,
    receipt_id: `RCP-${Date.now()}-${randInt(100, 999)}`,
    payment_gateway_ref: `GW-${randomDigits(12)}`,
    txn_time:       new Date().toISOString().slice(0, 19).replace("T", " "),
  };
};
