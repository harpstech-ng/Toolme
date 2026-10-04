import { promises as dns } from "dns";

// ============================================================
//  TAG MAPS — one for Geoapify, one for Overpass/OSM
// ============================================================
const GEO_CAT = {
  "restaurant":"catering.restaurant","restaurants":"catering.restaurant",
  "cafe":"catering.cafe","coffee":"catering.cafe","bakery":"commercial.food_and_drink.bakery",
  "bar":"catering.bar","pub":"catering.pub","fast food":"catering.fast_food","fastfood":"catering.fast_food",
  "hotel":"accommodation.hotel","hotels":"accommodation.hotel",
  "guesthouse":"accommodation.guest_house","lodge":"accommodation",
  "hospital":"healthcare.hospital","clinic":"healthcare.clinic_or_praxis",
  "pharmacy":"healthcare.pharmacy","chemist":"healthcare.pharmacy",
  "dentist":"healthcare.dentist","doctor":"healthcare.doctors",
  "salon":"service.beauty.spa","barber":"service.beauty.hairdresser",
  "spa":"service.beauty.spa","beauty":"service.beauty",
  "gym":"sport.fitness.fitness_centre","fitness":"sport.fitness.fitness_centre",
  "supermarket":"commercial.supermarket","market":"commercial.marketplace",
  "grocery":"commercial.food_and_drink.greengrocer",
  "clothes":"commercial.clothing","fashion":"commercial.clothing",
  "electronics":"commercial.electronics","furniture":"commercial.furniture",
  "car":"commercial.vehicle.car","car dealer":"commercial.vehicle.car",
  "mechanic":"service.vehicle.repair","fuel":"service.vehicle.fuel",
  "school":"education.school","schools":"education.school",
  "university":"education.university","college":"education.college",
  "bank":"service.financial.bank","insurance":"service.financial.insurance",
  "real estate":"service.estate_agent","lawyer":"service.financial.legal_services",
  "church":"religion.place_of_worship","mosque":"religion.place_of_worship",
  "laundry":"service.laundry","courier":"service.logistics",
  "travel agency":"service.travel_agency","photographer":"service.photographer",
  "farm":"commercial.agriculture","agriculture":"commercial.agriculture",
  "poultry":"commercial.agriculture","livestock":"commercial.agriculture",
  "office":"office","company":"office","business":"commercial"
};

// Overpass uses raw OSM tags. Multiple tags per niche.
const OSM_TAGS = {
  "restaurant":[["amenity","restaurant"]],
  "restaurants":[["amenity","restaurant"]],
  "cafe":[["amenity","cafe"]],
  "coffee":[["amenity","cafe"]],
  "bakery":[["shop","bakery"]],
  "bar":[["amenity","bar"]],
  "pub":[["amenity","pub"]],
  "fast food":[["amenity","fast_food"]],
  "fastfood":[["amenity","fast_food"]],
  "hotel":[["tourism","hotel"]],
  "hotels":[["tourism","hotel"]],
  "guesthouse":[["tourism","guest_house"]],
  "hostel":[["tourism","hostel"]],
  "hospital":[["amenity","hospital"]],
  "clinic":[["amenity","clinic"],["healthcare","clinic"]],
  "pharmacy":[["amenity","pharmacy"]],
  "chemist":[["amenity","pharmacy"]],
  "dentist":[["amenity","dentist"]],
  "doctor":[["amenity","doctors"]],
  "salon":[["shop","hairdresser"],["shop","beauty"]],
  "barber":[["shop","hairdresser"]],
  "spa":[["leisure","spa"],["shop","beauty"]],
  "beauty":[["shop","beauty"]],
  "gym":[["leisure","fitness_centre"],["amenity","gym"]],
  "fitness":[["leisure","fitness_centre"]],
  "supermarket":[["shop","supermarket"]],
  "market":[["amenity","marketplace"]],
  "grocery":[["shop","grocery"],["shop","greengrocer"]],
  "clothes":[["shop","clothes"]],
  "fashion":[["shop","clothes"]],
  "shoes":[["shop","shoes"]],
  "electronics":[["shop","electronics"]],
  "furniture":[["shop","furniture"]],
  "car":[["shop","car"]],
  "car dealer":[["shop","car"]],
  "mechanic":[["shop","car_repair"]],
  "fuel":[["amenity","fuel"]],
  "school":[["amenity","school"]],
  "schools":[["amenity","school"]],
  "university":[["amenity","university"]],
  "college":[["amenity","college"]],
  "bank":[["amenity","bank"]],
  "insurance":[["office","insurance"]],
  "real estate":[["office","estate_agent"]],
  "lawyer":[["office","lawyer"]],
  "church":[["amenity","place_of_worship"],["building","church"]],
  "mosque":[["amenity","place_of_worship"]],
  "laundry":[["shop","laundry"]],
  "courier":[["office","courier"],["amenity","post_office"]],
  "photographer":[["shop","photo"],["craft","photographer"]],
  "farm":[["landuse","farmyard"]],
  "poultry":[["landuse","farmyard"]],
  "livestock":[["landuse","farmyard"]],
  "office":[["office","company"]],
  "company":[["office","company"]]
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const { niche, city, country } = req.body || {};
  const KEY = process.env.GEOAPIFY_KEY;

  if (!KEY) return res.status(500).json({ error: "API key not set" });
  if (!city) return res.status(400).json({ error: "Missing city" });
  if (!niche) return res.status(400).json({ error: "Missing niche" });

  // forgiving lookup — trim, lowercase, strip punctuation
  const normalized = String(niche).toLowerCase().trim().replace(/[^\w\s]/g, "");
  const geoCategory = GEO_CAT[normalized];
  const osmTags = OSM_TAGS[normalized];

  if (!geoCategory && !osmTags) {
    return res.status(400).json({
      error: "We don't have a category for '" + niche + "' yet.",
      supported: Object.keys(GEO_CAT).slice(0, 40)
    });
  }

  try {
    // 1. Geocode the city
    const geocodeUrl = "https://api.geoapify.com/v1/geocode/search?text=" +
      encodeURIComponent(city + ", " + (country || "Nigeria")) +
      "&format=json&limit=1&apiKey=" + KEY;

    const geoRes = await fetch(geocodeUrl);
    const geoData = await geoRes.json();

    if (!geoData.results || !geoData.results.length) {
      return res.json({ results: [], total: 0, searched: city, message: "Could not find that city." });
    }

    const { lat, lon } = geoData.results[0];
    const countryCode = (country || "Nigeria").toLowerCase();

    // 2. Query both sources in parallel with progressive radius
    // Try 15km, and if too few results, 30km, then 50km.
    let allPlaces = [];
    const radii = [15000, 30000, 50000];

    for (const radius of radii) {
      const [geoapifyPlaces, osmPlaces] = await Promise.all([
        geoCategory ? fetchGeoapify(geoCategory, lat, lon, radius, KEY) : Promise.resolve([]),
        osmTags ? fetchOverpass(osmTags, lat, lon, radius) : Promise.resolve([])
      ]);
      allPlaces = mergePlaces(geoapifyPlaces, osmPlaces);
      if (allPlaces.length >= 15) break;
    }

    if (!allPlaces.length) {
      return res.json({
        results: [], total: 0, searched: niche + " in " + city,
        message: "No businesses in that category near " + city + ". Try a wider search or a different city."
      });
    }

    // 3. Enrich each with email/website scraping
    const enriched = await Promise.all(allPlaces.map(async function (p) {
      let email = "";
      let emailVerified = false;
      let waFromSite = "";

      if (p.website) {
        const found = await findContacts(p.website);
        email = found.email;
        waFromSite = found.whatsapp;
      }
      if (email) emailVerified = await checkMx(email);

      const waNumber = waFromSite || normalizePhone(p.phone || "", countryCode);
      const displayPhone = p.phone || (waNumber ? "+" + waNumber : "");

      return {
        name: p.name || "",
        address: p.address || "",
        phone: displayPhone,
        whatsappNumber: waNumber,
        email: email || "",
        emailVerified: emailVerified,
        website: p.website || "",
        lat: p.lat,
        lon: p.lon
      };
    }));

    // keep anything with at least one contact method
    const clean = enriched.filter(function (e) { return e.email || e.whatsappNumber; });

    // count summary
    const withEmail = clean.filter(function (e) { return e.email; }).length;
    const withWa = clean.filter(function (e) { return e.whatsappNumber; }).length;

    res.json({
      results: clean,
      total: clean.length,
      withEmail: withEmail,
      withWhatsApp: withWa,
      searched: niche + " in " + city
    });

  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
}

// ============================================================
//  SOURCE 1 — Geoapify
// ============================================================
async function fetchGeoapify(category, lat, lon, radius, key) {
  try {
    const url = "https://api.geoapify.com/v2/places?categories=" +
      encodeURIComponent(category) +
      "&filter=circle:" + lon + "," + lat + "," + radius +
      "&limit=50&apiKey=" + key;

    const r = await fetch(url);
    const d = await r.json();
    if (!d.features) return [];

    return d.features.map(function (f) {
      const p = f.properties || {};
      return {
        id: "geo_" + (p.place_id || p.name || Math.random()),
        name: p.name || p.address_line1 || "",
        address: p.formatted || "",
        phone: p.phone || (p.contact && p.contact.phone) || (p.datasource && p.datasource.raw && p.datasource.raw.phone) || "",
        website: p.website || "",
        lat: p.lat,
        lon: p.lon
      };
    });
  } catch (e) { return []; }
}

// ============================================================
//  SOURCE 2 — Overpass (OpenStreetMap)
// ============================================================
async function fetchOverpass(osmTags, lat, lon, radius) {
  try {
    // build Overpass query: (node[...](around:...);way[...](around:...););
    const queries = osmTags.map(function (pair) {
      const [k, v] = pair;
      const around = "(around:" + radius + "," + lat + "," + lon + ")";
      return 'node["' + k + '"="' + v + '"]' + around + ';' +
             'way["' + k + '"="' + v + '"]' + around + ';';
    }).join("");

    const q = "[out:json][timeout:20];(" + queries + ");out center tags 60;";

    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(q)
    });
    const d = await r.json();
    if (!d.elements) return [];

    return d.elements.map(function (el) {
      const t = el.tags || {};
      const lat2 = el.lat || (el.center && el.center.lat);
      const lon2 = el.lon || (el.center && el.center.lon);

      // phone fields vary — check all common ones
      const phone = t.phone || t["contact:phone"] || t["contact:mobile"] || t.mobile || "";
      const website = t.website || t["contact:website"] || t.url || "";
      const whatsapp = t["contact:whatsapp"] || "";

      const addr = [
        t["addr:housenumber"], t["addr:street"], t["addr:suburb"], t["addr:city"]
      ].filter(Boolean).join(", ");

      return {
        id: "osm_" + el.type + "_" + el.id,
        name: t.name || t["name:en"] || "",
        address: addr,
        phone: phone,
        website: website,
        whatsappRaw: whatsapp,
        lat: lat2,
        lon: lon2
      };
    }).filter(function (p) { return p.name; });
  } catch (e) { return []; }
}

// ============================================================
//  MERGE — dedupe by name similarity
// ============================================================
function mergePlaces(a, b) {
  const seen = new Set();
  const out = [];
  function push(p) {
    const key = (p.name || "").toLowerCase().replace(/[^\w]/g, "").slice(0, 20);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(p);
  }
  a.forEach(push);
  b.forEach(push);
  return out;
}

// ============================================================
//  NORMALIZE PHONE for WhatsApp (digits only, international)
// ============================================================
function normalizePhone(raw, country) {
  if (!raw) return "";
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return "";

  // handle multiple numbers separated by ; / ,
  if (/[;,/]/.test(String(raw))) {
    digits = String(raw).split(/[;,/]/)[0].replace(/\D/g, "");
  }

  // already international?
  if (digits.length >= 11) {
    if (digits.indexOf("234") === 0 || digits.indexOf("233") === 0 ||
        digits.indexOf("254") === 0 || digits.indexOf("27") === 0 ||
        digits.indexOf("44") === 0 || digits.indexOf("91") === 0 ||
        digits.indexOf("971") === 0 || digits.indexOf("1") === 0) {
      return digits;
    }
  }

  if (/nigeria/i.test(country)) {
    if (digits.charAt(0) === "0") digits = digits.slice(1);
    return "234" + digits;
  }
  if (/ghana/i.test(country)) {
    if (digits.charAt(0) === "0") digits = digits.slice(1);
    return "233" + digits;
  }
  if (/kenya/i.test(country)) {
    if (digits.charAt(0) === "0") digits = digits.slice(1);
    return "254" + digits;
  }
  if (/south africa/i.test(country)) {
    if (digits.charAt(0) === "0") digits = digits.slice(1);
    return "27" + digits;
  }
  if (/united kingdom|uk|britain/i.test(country)) {
    if (digits.charAt(0) === "0") digits = digits.slice(1);
    return "44" + digits;
  }
  if (/united states|usa|canada/i.test(country)) {
    return digits.length === 10 ? "1" + digits : digits;
  }
  if (/india/i.test(country)) {
    return digits.length === 10 ? "91" + digits : digits;
  }
  return digits;
}

// ============================================================
//  SCRAPE CONTACTS FROM WEBSITE
// ============================================================
async function findContacts(url) {
  try {
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 3500);
    const r = await fetch(url, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    const html = await r.text();
    const text = html.slice(0, 200000);

    const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = text.match(emailRe) || [];
    const bad = /(\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp|noreply|no-reply|example\.|sentry|wixpress|schema\.org|@2x|@3x)/i;
    const good = matches.filter(function (e) { return !bad.test(e); });
    const email = good[0] ? good[0].toLowerCase() : "";

    const waRe = /(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\+?\d{7,15})/g;
    let m; let wa = "";
    while ((m = waRe.exec(text)) !== null) { wa = m[1].replace(/\D/g, ""); break; }

    return { email: email, whatsapp: wa };
  } catch (e) {
    return { email: "", whatsapp: "" };
  }
}

async function checkMx(email) {
  try {
    const domain = email.split("@")[1];
    const records = await dns.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch (e) { return false; }
}
