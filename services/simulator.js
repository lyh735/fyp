// Realistic transaction data for UniwebPay / SingEat / YiDian network

const PAYMENT_METHODS = ["AliPay", "WechatPay", "UnionQR Pay", "GrabPay"];
const PAYMENT_WEIGHTS  = [0.35, 0.30, 0.20, 0.15];

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

exports.generateTransaction = () => {
  const merchant       = MERCHANTS[randInt(0, MERCHANTS.length - 1)];
  const country        = weightedPick(COUNTRIES.map(c => c.name), COUNTRIES.map(c => c.weight));
  const payment_method = weightedPick(PAYMENT_METHODS, PAYMENT_WEIGHTS);
  const amount         = generateAmount(merchant.category);

  return {
    transaction_id: generateTxnId(),
    user_id:        generateUserId(country),
    merchant_name:  merchant.name,
    payment_method,
    amount,
    country,
    txn_time:       new Date().toISOString().slice(0, 19).replace("T", " "),
  };
};
