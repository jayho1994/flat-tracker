// 睇樓資料庫 · Lambda v2 (Node.js 20, Function URL)
// ─────────────────────────────────────────────────────────────
// 環境變數（必填）：NOTION_TOKEN, APP_KEY，以及 ANTHROPIC_API_KEY 或 GEMINI_API_KEY（GERMINI_ 拼法亦接受）二擇一
// 環境變數（選填）：ANTHROPIC_MODEL (預設 claude-sonnet-4-6), GEMINI_MODEL (預設 gemini-2.5-flash), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
//                   NOTION_VERSION (預設 2022-06-28)，以及六個 *_DB 覆蓋預設 ID
// 路由：
//   GET  /health
//   GET  /all
//   GET  /{kind}            kind ∈ flats rooms furniture contacts offers checks
//   POST /{kind}            建立（物件或陣列）
//   PATCH /{kind}/{id}      更新
//   DELETE /{kind}/{id}     封存
//   POST /import            {url} → 解析樓盤網頁，回傳建議欄位（不寫入）
//   POST /analyze           {flat_id} → Claude 摘要，寫入 AI摘要
//   POST /analyze-photo     {image_base64, media_type, question?, flat_id?} → Claude 視覺
//   POST /compare           {flat_ids:[...], weights?:{}} → Claude 結構化比較
// ─────────────────────────────────────────────────────────────

const NOTION = "https://api.notion.com/v1";
const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";
const USE_DS = /^2025/.test(NOTION_VERSION);   // 新版 API 用 data_source 端點
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

// 由 Claude 在 Jay 的 Notion 建立（2026-09-09）。可用環境變數覆蓋。
const IDS = {
  flats:     { db: "0539068977b6464891ab466b2abd4b66", ds: "30e3daf4-b998-4310-9364-6227b4d593e5" },
  rooms:     { db: "af744dfa1eb64d809649c46f8495d0d6", ds: "8e59036a-70f8-4492-921f-cb1506b70b25" },
  furniture: { db: "118d439667284d43b09df266c08bc86b", ds: "33c4c1b9-bf14-497e-8f9a-2316790a8521" },
  contacts:  { db: "a38fcf0db5cb452cbfcb901bee71a876", ds: "f452d17d-b6e6-4f3c-b80b-394479163ece" },
  offers:    { db: "3bc36418803b4eb39cb97f4d13c980d9", ds: "e976e586-19ec-492c-a81c-0209d1e718a6" },
  checks:    { db: "0447462320dc49bcbd91706bb387a440", ds: "5db73546-93c2-46f8-86ae-47860082eeb5" },
};
const ENV_KEY = { flats: "FLATS_DB", rooms: "ROOMS_DB", furniture: "FURN_DB", contacts: "CONTACTS_DB", offers: "OFFERS_DB", checks: "CHECKS_DB" };
const idFor = (kind) => process.env[ENV_KEY[kind]] || (USE_DS ? IDS[kind].ds : IDS[kind].db);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,x-app-key",
  "Content-Type": "application/json; charset=utf-8",
};

/* ---------- Schemas（與 Notion 欄位名一致） ---------- */
export const SCHEMAS = {
  flats: {
    名稱: "title", 階段: "select", 屋苑: "rich_text", 座: "rich_text", 樓層: "rich_text", 單位: "rich_text",
    大廈: "rich_text", 地址: "rich_text", 分區: "rich_text", 售價: "number",
    地區: "select", 來源: "select", 來源連結: "url", 叫價: "number", 實用呎: "number", 建築呎: "number",
    房數: "number", 廁所數: "number", 樓齡: "number", 座向: "select", 管理費: "number", 差餉季度: "number",
    包項目: "multi_select", 租期: "rich_text", 免租期日: "number", 交樓日: "date", 刊登日期: "date", 睇樓日期: "date",
    我評分: "number", 太太評分: "number", 標籤: "multi_select", 教會車程分鐘: "number", 工作車程分鐘: "number",
    代理: "relation", 搬運估算: "number", AI摘要: "rich_text", 備註: "rich_text",
  },
  rooms: {
    名稱: "title", 單位: "relation", 類型: "select", 長: "number", 闊: "number", 高: "number", 門闊: "number", 門高: "number",
    窗台深: "number", 冷氣位: "rich_text", 電掣位: "rich_text", 其他尺寸: "rich_text", 備註: "rich_text",
  },
  furniture: { 名稱: "title", 長: "number", 闊: "number", 高: "number", 所屬: "select", 狀態: "select", 可拆件: "checkbox", 備註: "rich_text" },
  contacts: { 姓名: "title", 角色: "select", 公司: "rich_text", 電話: "phone_number", WhatsApp: "url", 佣金: "rich_text", 評價: "select", 最後聯絡: "date", 備註: "rich_text" },
  offers: { 摘要: "title", 單位: "relation", 日期: "date", 類型: "select", 金額: "number", 要求項目: "multi_select", 狀態: "select", 誰跟進: "select", 經誰: "relation", 詳情: "rich_text" },
  checks: {
    名稱: "title", 單位: "relation", 填寫人: "select", 日期: "date", 備註: "rich_text",
    ...Object.fromEntries(["滲水牆身","天花霉斑","窗框密封","水壓","熱水爐","廁所去水","廚房去水","煤氣或電磁爐","冷氣運作","電掣位足夠","光線","景觀","噪音","手機訊號","晾衫位","儲物空間","BB車出入","電梯狀況","保安管理","垃圾房位置","樓下商舖","鄰居觀感","蟲患跡象","門鎖大門","傢俬電器狀況"].map((k) => [k, "select"])),
  },
};
export const CHECK_ITEMS = Object.keys(SCHEMAS.checks).filter((k) => !["名稱","單位","填寫人","日期","備註"].includes(k));

/* ---------- Notion helpers ---------- */
const nHeaders = () => ({ Authorization: `Bearer ${process.env.NOTION_TOKEN}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" });
async function notion(method, path, body) {
  const r = await fetch(NOTION + path, { method, headers: nHeaders(), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Notion ${r.status}: ${j.message || r.statusText}`), { status: r.status, notion: j });
  return j;
}
const text = (s) => [{ type: "text", text: { content: String(s ?? "").slice(0, 2000) } }];

export function toProps(schema, data) {
  const p = {};
  for (const [k, t] of Object.entries(schema)) {
    if (!(k in data)) continue;
    const v = data[k];
    switch (t) {
      case "title": p[k] = { title: text(v) }; break;
      case "rich_text": p[k] = { rich_text: text(v) }; break;
      case "number": p[k] = { number: v === "" || v == null || isNaN(Number(v)) ? null : Number(v) }; break;
      case "select": p[k] = { select: v ? { name: String(v) } : null }; break;
      case "multi_select": p[k] = { multi_select: (Array.isArray(v) ? v : String(v || "").split(/[,，]/)).map((s) => String(s).trim()).filter(Boolean).map((name) => ({ name })) }; break;
      case "date": p[k] = { date: v ? { start: String(v) } : null }; break;
      case "url": p[k] = { url: v ? String(v) : null }; break;
      case "phone_number": p[k] = { phone_number: v ? String(v) : null }; break;
      case "checkbox": p[k] = { checkbox: !!v && v !== "__NO__" }; break;
      case "relation": p[k] = { relation: (Array.isArray(v) ? v : [v]).filter(Boolean).map((id) => ({ id })) }; break;
    }
  }
  return p;
}
export function fromPage(page) {
  const o = { id: page.id, url: page.url, edited: page.last_edited_time, created: page.created_time };
  for (const [k, p] of Object.entries(page.properties || {})) {
    switch (p.type) {
      case "title": o[k] = p.title.map((t) => t.plain_text).join(""); break;
      case "rich_text": o[k] = p.rich_text.map((t) => t.plain_text).join(""); break;
      case "number": o[k] = p.number; break;
      case "select": o[k] = p.select ? p.select.name : null; break;
      case "multi_select": o[k] = p.multi_select.map((s) => s.name); break;
      case "date": o[k] = p.date ? p.date.start : null; break;
      case "url": o[k] = p.url; break;
      case "phone_number": o[k] = p.phone_number; break;
      case "checkbox": o[k] = p.checkbox; break;
      case "relation": o[k] = p.relation.map((r) => r.id); break;
      case "formula": o[k] = p.formula[p.formula.type]; break;
      case "files": o[k] = p.files.map((f) => (f.file ? f.file.url : f.external ? f.external.url : null)).filter(Boolean); break;
      default: break;
    }
  }
  return o;
}
async function queryAll(kind, filter) {
  const id = idFor(kind);
  const path = USE_DS ? `/data_sources/${id}/query` : `/databases/${id}/query`;
  const out = []; let cursor;
  do {
    const body = { page_size: 100, sorts: [{ timestamp: "last_edited_time", direction: "descending" }] };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    const j = await notion("POST", path, body);
    out.push(...j.results.map(fromPage));
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}
const parentFor = (kind) => (USE_DS ? { data_source_id: idFor(kind) } : { database_id: idFor(kind) });
async function createOne(kind, data) { return fromPage(await notion("POST", "/pages", { parent: parentFor(kind), properties: toProps(SCHEMAS[kind], data) })); }
async function updateOne(kind, id, data) { return fromPage(await notion("PATCH", `/pages/${id}`, { properties: toProps(SCHEMAS[kind], data) })); }
async function archiveOne(id) { await notion("PATCH", `/pages/${id}`, { archived: true }); return { id, archived: true }; }
async function getPage(id) { return fromPage(await notion("GET", `/pages/${id}`)); }

/* ---------- 樓盤網頁解析（28Hse / 中原 / 美聯 / 通用） ---------- */
const DISTRICTS = {
  港島: ["太古","鰂魚涌","北角","炮台山","天后","銅鑼灣","灣仔","金鐘","中環","上環","西環","堅尼地城","西營盤","石塘咀","半山","山頂","跑馬地","大坑","筲箕灣","西灣河","杏花邨","柴灣","小西灣","香港仔","鴨脷洲","黃竹坑","薄扶林","數碼港","赤柱","淺水灣","深水灣"],
  九龍: ["尖沙咀","尖東","佐敦","油麻地","旺角","太子","大角咀","深水埗","長沙灣","荔枝角","美孚","石硤尾","九龍塘","何文田","土瓜灣","紅磡","黃埔","九龍城","啟德","新蒲崗","鑽石山","黃大仙","樂富","慈雲山","彩虹","九龍灣","牛頭角","觀塘","藍田","油塘"],
  新界: ["荃灣","葵涌","葵芳","青衣","深井","沙田","火炭","大圍","馬鞍山","大埔","太和","粉嶺","上水","元朗","天水圍","錦田","屯門","將軍澳","坑口","調景嶺","寶琳","日出康城","西貢","清水灣"],
  離島: ["東涌","愉景灣","長洲","南丫島","坪洲","梅窩","馬灣"],
};
const JUNK_ESTATE = /^(一手|新盤|樓盤|搵樓|買樓|租樓|租屋|物業|屋苑|首頁|香港|網上|全部|地產|中原|美聯|28Hse)/i;
const toNum = (x) => Number(String(x).replace(/[^\d.]/g, ""));
// SPA 網站（中原／美聯）的資料多藏在頁內 JSON（__NEXT_DATA__ / __NUXT__ / window.__INITIAL_STATE__）；按常見 key 抽取
const JSON_KEYS = {
  rent: ["rent", "rental", "rentPrice", "rent_price", "monthlyRent", "rentalPrice", "price_rent", "leasePrice"],
  sale: ["salePrice", "sale_price", "sellPrice", "price_sale", "askingPrice"],
  estate: ["estateName", "estate_name", "estateNameZh", "estateNameTc", "estName", "estateNameChi"],
  building: ["buildingName", "building_name", "bldgName", "buildingNameZh", "buildingNameTc", "phaseName", "phaseNameZh"],
  block: ["blockName", "block_name", "blockNameZh", "towerName"],
  floor: ["floorZone", "floor_zone", "floorLevel", "floorZoneZh", "floorLevelZh"],
  district: ["districtName", "district_name", "districtNameZh", "areaName", "subDistrictName", "regionName"],
  address: ["streetAddress", "addressZh", "fullAddress", "address_zh", "addressTc", "address"],
  saleable: ["saleableArea", "saleable_area", "netArea", "net_area", "usableArea", "saleableAreaSqft"],
  gross: ["grossArea", "gross_area", "grossFloorArea", "grossAreaSqft"],
  rooms: ["bedroom", "bedrooms", "numBedroom", "bedroomCount", "roomCount"],
  baths: ["bathroom", "bathrooms", "numBathroom", "bathroomCount"],
  age: ["buildingAge", "building_age", "propertyAge"],
};
function sniffJSON(html) {
  const out = {};
  const unesc = (v) => { try { return JSON.parse('"' + v + '"'); } catch { return v; } };
  for (const [field, keys] of Object.entries(JSON_KEYS)) {
    for (const k of keys) {
      const m = html.match(new RegExp('[\'"]?\\b' + k + '[\'"]?\\s*:\\s*(?:"([^"]{1,80})"|\'([^\']{1,80})\'|(-?[\\d.]+))', "i"));
      if (m) { const v = m[1] != null ? unesc(m[1]).trim() : m[2] != null ? m[2].trim() : Number(m[3]); if (v !== "" && v !== 0 && v !== "0" && v !== "null" && !Number.isNaN(v)) { out[field] = v; break; } }
    }
  }
  return out;
}
export function parseListing(html, url) {
  const src = /28hse/i.test(url) ? "28Hse" : /centanet|中原/i.test(url) ? "中原" : /midland/i.test(url) ? "美聯" : /squarefoot/i.test(url) ? "Squarefoot" : /spacious/i.test(url) ? "Spacious" : "其他";
  const out = { 來源連結: url, 來源: src, raw: {} };
  const ld = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { ld.push(JSON.parse(m[1].trim())); } catch { /* ignore */ } }
  out.raw.ldCount = ld.length;
  const flat = (x) => (Array.isArray(x) ? x : x && x["@graph"] ? x["@graph"] : [x]).filter(Boolean);
  let ldPrice = null; const ldPrices = [];
  for (const node of ld.flatMap(flat)) {
    if (node.name && !out.標題) out.標題 = String(node.name).trim();
    if (node.description && !out.描述) out.描述 = String(node.description).trim().slice(0, 1500);
    const offer = node.offers || (node["@type"] === "Offer" ? node : null);
    for (const of of (Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : (node["@type"] === "Offer" ? [node] : []))) { if (of && of.price) { const v = toNum(of.price); ldPrices.push(v); if (ldPrice == null) ldPrice = v; } }
    if (node.floorSize && node.floorSize.value && !out.實用呎) out.實用呎 = toNum(node.floorSize.value);
    if (node.numberOfRooms && !out.房數) out.房數 = toNum(node.numberOfRooms);
    if (node.numberOfBathroomsTotal && !out.廁所數) out.廁所數 = toNum(node.numberOfBathroomsTotal);
    if (node.datePosted && !out.刊登日期) out.刊登日期 = String(node.datePosted).slice(0, 10);
    if (node.address) { const a = typeof node.address === "string" ? node.address : node.address.streetAddress; if (a && !out.地址) out.地址 = String(a).trim(); }
  }
  // 標題：<title> 優先（最穩定），去除網站尾巴
  const sj = sniffJSON(html); out.raw.json = sj;
  const tt = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const og = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)/i);
  const h1m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1 = h1m ? h1m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
  out.raw.title = tt ? tt[1].replace(/\s+/g, " ").trim() : null; out.raw.h1 = h1 || null;
  let title = (tt ? tt[1] : og ? og[1] : out.標題 || "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  { const segs = title.split(/\s*[|｜]\s*|\s+-\s+/).map((x) => x.replace(/\s*(買樓|租樓|租屋|出租|放售|出售|樓盤|物業|放盤|詳細資料)\s*/g, " ").trim()).filter((x) => x && !/中原|美聯|28Hse|香港屋網|Squarefoot|Spacious|Centaline|Midland/i.test(x));
    title = segs.sort((a, b) => b.length - a.length)[0] || ""; }
  if (title) out.標題 = title;
  // 屋苑／大廈／座：由標題拆解，重複詞去重（中原：「太古城 太古城 安盛台 建安閣 (31座)」）
  if (title) {
    const toks = title.split(/\s+/).filter((x, i, a) => x && a.indexOf(x) === i);
    const blk = title.match(/(\d{1,3})\s*座/); if (blk) out.座 = blk[1] + "座";
    const rest = toks.filter((x) => !/座\)?$/.test(x) && !/^\(/.test(x) && !JUNK_ESTATE.test(x) && !/^(高|中|低)層$|^\d+(房|廁|浴|衛|呎)|呎$|^[\d,$#]+$|^#|^(開揚|海景|山景|靚裝|連車位|全新|罕有|租盤|售盤|放盤|詳細資料|物業資料|樓盤資料|出租|出售)/.test(x));
    if (rest.length) { out.屋苑 = rest[0].replace(/[()（）]/g, ""); if (rest.length > 1) out.大廈 = rest.slice(1).join(" ").replace(/[()（）]/g, "").trim(); }
  }
  // 頁內 JSON 優先覆蓋（較標題可靠）；h1 作屋苑後備
  if (sj.estate) { out.屋苑 = String(sj.estate); }
  else if (h1 && !JUNK_ESTATE.test(h1) && (!out.屋苑 || out.屋苑.length < 2)) out.屋苑 = h1.split(/\s+/)[0];
  if (sj.building) out.大廈 = String(sj.building).replace(/\s*\(\d+座\)/, "").trim();
  if (sj.block) { const b = String(sj.block).match(/(\d{1,3})/); if (b) out.座 = b[1] + "座"; }
  if (sj.floor) { const f = String(sj.floor).match(/(高|中|低)/); if (f) out.樓層 = f[1] + "層"; }
  if (sj.district) out.分區JSON = String(sj.district);
  if (sj.address) out.地址 = String(sj.address).replace(/\s+/g, "");
  if (sj.saleable) out.實用呎 = Number(sj.saleable); if (sj.gross) out.建築呎 = Number(sj.gross);
  if (sj.rooms) out.房數 = Number(sj.rooms); if (sj.baths) out.廁所數 = Number(sj.baths); if (sj.age) out.樓齡 = Number(sj.age);
  const t = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  // 價錢：租 與 售 分開；租金合理範圍 3,000–500,000；「萬」一律視為售價
  const rents = [...t.matchAll(/(?:租金|月租|租)\s*[:：]?\s*(?:HK)?\$?\s*([\d,]{4,7})(?!\s*萬)/g)].map((m) => toNum(m[1])).filter((v) => v >= 3000 && v <= 500000);
  if (rents.length) out.叫價 = rents[0];
  const sale = t.match(/售\s*[:：]?\s*(?:HK)?\$?\s*([\d,.]+)\s*萬/); if (sale) out.售價 = Math.round(toNum(sale[1]) * 10000);
  if (!out.叫價 && sj.rent && Number(sj.rent) >= 3000 && Number(sj.rent) <= 500000) out.叫價 = Number(sj.rent);
  if (!out.叫價) { const inRange = ldPrices.filter((v) => v >= 3000 && v <= 500000); if (inRange.length) out.叫價 = inRange[0]; }
  // 後備：原始 HTML 內「租」／rent 附近 3,000–500,000 的數字，取出現次數最多者
  { const freq = new Map(); const ctx = [];
    for (const m of html.matchAll(/(?:rent(?:al)?(?:Price|_price)?|租金|月租|租)[^\d\n]{0,30}?(\d{1,3}(?:,\d{3})+|\d{4,6})(?!\d|,\d|\s*萬)/gi)) {
      const v = toNum(m[1]); if (v >= 3000 && v <= 500000) { freq.set(v, (freq.get(v) || 0) + 1); if (ctx.length < 6) ctx.push(html.slice(Math.max(0, m.index - 25), m.index + m[0].length + 5).replace(/\s+/g, " ")); }
    }
    out.raw.rentCtx = ctx; out.raw.rentCandidates = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!out.叫價 && freq.size) out.叫價 = out.raw.rentCandidates[0][0]; }
  if (!out.售價 && sj.sale && Number(sj.sale) > 1000000) out.售價 = Number(sj.sale);
  if (ldPrice != null) { if (!out.叫價 && ldPrice >= 3000 && ldPrice <= 500000) out.叫價 = ldPrice; else if (!out.售價 && ldPrice > 1000000) out.售價 = ldPrice; }
  if (!out.實用呎) { const m = t.match(/實用[^\d]{0,10}([\d,]{2,5})\s*(?:呎|平方呎|sq)/i); if (m) out.實用呎 = toNum(m[1]); }
  { const m = t.match(/建築[^\d]{0,10}([\d,]{2,5})\s*(?:呎|平方呎|sq)/i); if (m) out.建築呎 = toNum(m[1]); }
  if (!out.房數) { const m = t.match(/(\d)\s*房(?!價|屋)/); if (m) out.房數 = toNum(m[1]); }
  if (!out.廁所數) { const m = t.match(/(\d)\s*(?:廁|浴|衛)/); if (m) out.廁所數 = toNum(m[1]); }
  { const m = t.match(/樓齡[^\d]{0,6}(\d{1,2})/); if (m) out.樓齡 = toNum(m[1]); }
  { const m = t.match(/座向[^\u4e00-\u9fa5]{0,4}(東南|西南|東北|西北|東|南|西|北)/); if (m) out.座向 = m[1]; }
  { const m = t.match(/管理費[^\d]{0,10}\$?\s*([\d,]{3,6})/); if (m) out.管理費 = toNum(m[1]); }
  if (/業主(自讓|放盤|直讓)/.test(t)) out.業主自讓 = true;
  if (!out.座) { const m = t.match(/(\d{1,3})\s*座/); if (m) out.座 = m[1] + "座"; }
  { const m = t.match(/(高|中|低)層/); if (m) out.樓層 = m[1] + "層"; }
  if (!out.地址) { const m = t.match(/([\u4e00-\u9fa5]{1,10}(?:道|路|街|里|徑|巷|坊|圍|灣)\s*\d{1,4}\s*號?(?:[A-Z]|-\d+號?)?)/); if (m) out.地址 = m[1].replace(/\s+/g, "").replace(/^(位於|地址|座落|坐落)/, ""); }
  if (out.地址) { for (const names of Object.values(DISTRICTS)) for (const nme of names) if (out.地址.startsWith(nme) && out.地址.length > nme.length + 3) { out.地址 = out.地址.slice(nme.length); } }
  // 分區：優先在標題／地址附近出現者，否則全文最早出現者
  const head = [out.標題 || "", out.地址 || "", out.屋苑 || ""].join(" ");
  let best = null;
  for (const [region, names] of Object.entries(DISTRICTS)) for (const nme of names) {
    let pos = head.indexOf(nme); let w = 0;
    if (pos < 0) { pos = t.indexOf(nme); w = 100000; }
    if (pos >= 0 && (!best || pos + w < best.score)) best = { nme, region, score: pos + w };
  }
  if (out.分區JSON) { for (const [region, names] of Object.entries(DISTRICTS)) { const hit = names.find((n) => out.分區JSON.includes(n)); if (hit) { best = { nme: hit, region, score: -1 }; break; } } if (!best || best.score !== -1) out.分區 = out.分區JSON; }
  if (best) { out.分區 = best.nme; out.地區 = best.region; }
  delete out.分區JSON;
  return out;
}
async function importListing(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "Accept-Language": "zh-HK,zh;q=0.9" }, redirect: "follow" });
  const html = await r.text();
  const parsed = parseListing(html, url);
  parsed.raw.httpStatus = r.status; parsed.raw.bytes = html.length;
  if (r.status >= 400 || html.length < 2000) parsed.warning = `網頁回應 ${r.status}（${html.length} bytes），可能被攔截或需登入；請人手填寫`;
  return parsed;
}

/* ---------- LLM（Claude 或 Gemini，自動選） ---------- */
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GERMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || process.env.GERMINI_MODEL || "gemini-2.5-flash";
const PROVIDER = process.env.ANTHROPIC_API_KEY ? "claude" : GEMINI_KEY ? "gemini" : "none";

// messages: [{role:"user", content: string | [{type:"text",text}|{type:"image",source:{media_type,data}}]}]
async function llm(messages, system, maxTokens = 1200) {
  if (PROVIDER === "claude") return claude(messages, system, maxTokens);
  if (PROVIDER === "gemini") return gemini(messages, system, maxTokens);
  throw Object.assign(new Error("未設定 ANTHROPIC_API_KEY 或 GEMINI_API_KEY"), { status: 500 });
}
async function claude(messages, system, maxTokens) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 55000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
    });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(`Claude ${r.status}: ${j.error?.message || ""}`), { status: 502 });
    return { text: (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n"), truncated: j.stop_reason === "max_tokens", usage: j.usage };
  } finally { clearTimeout(timer); }
}
// Gemini：HearthStack 教訓——推理模型會把 maxOutputTokens 花在 thinking 上而回空白，故先關 thinking，失敗再退回。
async function gemini(messages, system, maxTokens) {
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: (Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]).map((c) =>
      c.type === "image" ? { inline_data: { mime_type: c.source.media_type, data: c.source.data } } : { text: c.text }),
  }));
  const call = async (withThinking) => {
    const body = { system_instruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: maxTokens * 2, temperature: 0.4 } };
    if (!withThinking) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 55000);
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`, { method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      return { ok: r.ok, status: r.status, j };
    } finally { clearTimeout(timer); }
  };
  let res = await call(false);
  if (!res.ok && res.status === 400) res = await call(true);          // 模型不支援 thinkingConfig → 退回
  if (!res.ok) throw Object.assign(new Error(`Gemini ${res.status}: ${res.j.error?.message || ""}`), { status: 502 });
  const cand = (res.j.candidates || [])[0] || {};
  const text = (cand.content?.parts || []).map((p) => p.text || "").join("\n").trim();
  if (!text) throw Object.assign(new Error(`Gemini 回傳空白（finishReason=${cand.finishReason || "?"}；可能 thinking 耗盡 token 或安全過濾）`), { status: 502 });
  return { text, truncated: cand.finishReason === "MAX_TOKENS", usage: res.j.usageMetadata };
}
const SYS = "你是協助一對香港夫婦（有初生嬰兒）租屋的分析員。只根據提供的資料作判斷；資料沒有的不要編造，推算必須標明「推算」。以書面語（繁體中文）回答，簡潔、分點。";

async function bundleFlat(flatId) {
  const [flat, rooms, offers, checks, furniture] = await Promise.all([
    getPage(flatId),
    queryAll("rooms", { property: "單位", relation: { contains: flatId } }),
    queryAll("offers", { property: "單位", relation: { contains: flatId } }),
    queryAll("checks", { property: "單位", relation: { contains: flatId } }),
    queryAll("furniture"),
  ]);
  return { flat, rooms, offers, checks, furniture };
}
export function fitFloor(f, r) { if (!r.長 || !r.闊 || !f.長 || !f.闊) return null; return (f.長 <= r.長 && f.闊 <= r.闊) || (f.闊 <= r.長 && f.長 <= r.闊); }
export function fitDoor(f, r) { if (!r.門闊) return null; const dh = r.門高 || 200; const d = [f.長, f.闊, f.高].filter((x) => x > 0).sort((a, b) => a - b); if (d.length < 2) return null; return d[0] <= dh && Math.min(d[0], d[1]) <= r.門闊; }
function fitSummary(b) {
  return b.rooms.map((r) => {
    const bad = b.furniture.filter((f) => f.狀態 !== "不搬").filter((f) => fitFloor(f, r) === false || fitDoor(f, r) === false).map((f) => f.名稱);
    return `${r.名稱}(${r.長 || "?"}×${r.闊 || "?"}, 門${r.門闊 || "?"}): ${bad.length ? "放不入/過不到門：" + bad.join("、") : "全部傢俬可放"}`;
  }).join("\n");
}
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length) && !["id", "url", "edited", "created", "AI摘要"].includes(k)));
async function analyzeFlat(flatId) {
  const b = await bundleFlat(flatId);
  const prompt = `單位資料：${JSON.stringify(strip(b.flat))}\n\n房間：${JSON.stringify(b.rooms.map(strip))}\n\n傢俬配對（程式計算）：\n${fitSummary(b)}\n\n出價／要求記錄：${JSON.stringify(b.offers.map(strip))}\n\n檢查表：${JSON.stringify(b.checks.map(strip))}\n\n請輸出：\n1. 一句總評\n2. 優點（最多5點）\n3. 風險／缺點（最多5點，含檢查表 ✗ 項目）\n4. 傢俬安置建議（哪件放哪房；放不入的替代方案）\n5. 談判籌碼與建議出價區間（若有刊登日期、樓齡、檢查表問題則引用；標明推算）\n6. 下一步（一項）`;
  const res = await llm([{ role: "user", content: prompt }], SYS, 1400);
  const summary = res.text + (res.truncated ? "\n（輸出被截斷）" : "");
  await updateOne("flats", flatId, { AI摘要: summary.slice(0, 2000) });
  return { summary, usage: res.usage };
}
async function analyzePhoto(body) {
  const q = body.question || "請檢查這張睇樓相片：1) 可見的狀況問題（滲水、霉斑、裂縫、窗框、電線、地板）；2) 若相中有門或標準物件，估算相中主要空間尺寸並標明「推算」及參照物；3) 值得追問代理的三個問題。";
  let ctx = "";
  if (body.flat_id) { try { const f = await getPage(body.flat_id); ctx = `\n\n單位：${f.名稱}，實用${f.實用呎 || "?"}呎，${f.房數 || "?"}房。`; } catch { /* ignore */ } }
  const res = await llm([{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: body.media_type || "image/jpeg", data: body.image_base64 } }, { type: "text", text: q + ctx }] }], SYS, 900);
  return { analysis: res.text, usage: res.usage };
}
async function compareFlats(body) {
  const ids = (body.flat_ids || []).slice(0, 4);
  if (ids.length < 2) throw Object.assign(new Error("至少兩個 flat_ids"), { status: 400 });
  const bundles = await Promise.all(ids.map(bundleFlat));
  const weights = body.weights || { 價錢: 30, 空間與傢俬: 25, 位置通勤: 20, 狀況: 15, 條款: 10 };
  const prompt = `比較以下 ${ids.length} 個單位。權重（總100）：${JSON.stringify(weights)}。\n\n` + bundles.map((b, i) => `【單位${i + 1}】${JSON.stringify(strip(b.flat))}\n房間：${JSON.stringify(b.rooms.map(strip))}\n配對：${fitSummary(b)}\n檢查表問題數：${b.checks.map((c) => c.問題數 ?? "?").join("/") || "無"}\n出價記錄：${b.offers.length} 項`).join("\n\n") + `\n\n請輸出：\n1. 每個單位按各權重項目評分（0–10）及加權總分，用表格\n2. 每個單位一句「適合／不適合我們的原因」\n3. 最終建議及理由；若資料不足以判斷，明確指出欠什麼資料`;
  const res = await llm([{ role: "user", content: prompt }], SYS, 1600);
  return { comparison: res.text, truncated: res.truncated, usage: res.usage };
}

/* ---------- Telegram（錯誤通知，選填） ---------- */
async function tg(msg) {
  const { TELEGRAM_BOT_TOKEN: t, TELEGRAM_CHAT_ID: c } = process.env; if (!t || !c) return;
  try { await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: c, text: msg.slice(0, 3800) }) }); } catch { /* ignore */ }
}

/* ---------- handler ---------- */
const reply = (status, body) => ({ statusCode: status, headers: CORS, body: JSON.stringify(body) });

export async function handler(event) {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const key = event.headers?.["x-app-key"] || event.headers?.["X-App-Key"] || "";
  if (!process.env.APP_KEY || key !== process.env.APP_KEY) return reply(401, { error: "unauthorized" });

  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body); }
    catch { return reply(400, { error: "bad json" }); }
  }
  const path = (event.rawPath || event.path || "/").replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
  const [kind, id] = path.split("/").filter(Boolean);
  const q = event.queryStringParameters || {};

  try {
    if (path === "/health") return reply(200, { ok: true, notion_version: NOTION_VERSION, llm: PROVIDER, model: PROVIDER === "gemini" ? GEMINI_MODEL : PROVIDER === "claude" ? MODEL : null, telegram: !!process.env.TELEGRAM_BOT_TOKEN, dbs: Object.fromEntries(Object.keys(IDS).map((k) => [k, idFor(k)])) });
    if (path === "/all" && method === "GET") {
      const kinds = Object.keys(IDS);
      const res = await Promise.all(kinds.map((k) => queryAll(k)));
      return reply(200, { ...Object.fromEntries(kinds.map((k, i) => [k, res[i]])), fetched: new Date().toISOString() });
    }
    if (path === "/import" && method === "POST") { if (!body.url) return reply(400, { error: "url required" }); return reply(200, await importListing(body.url)); }
    if (path === "/analyze" && method === "POST") { if (!body.flat_id) return reply(400, { error: "flat_id required" }); return reply(200, await analyzeFlat(body.flat_id)); }
    if (path === "/analyze-photo" && method === "POST") { if (!body.image_base64) return reply(400, { error: "image_base64 required" }); return reply(200, await analyzePhoto(body)); }
    if (path === "/compare" && method === "POST") return reply(200, await compareFlats(body));

    if (!IDS[kind]) return reply(404, { error: "not found", path });
    if (method === "GET") {
      const filter = q.flat && SCHEMAS[kind].單位 ? { property: "單位", relation: { contains: q.flat } } : undefined;
      return reply(200, await queryAll(kind, filter));
    }
    if (method === "POST" && !id) {
      if (Array.isArray(body)) { const out = []; for (const d of body) out.push(await createOne(kind, d)); return reply(200, out); }
      return reply(200, await createOne(kind, body));
    }
    if (method === "PATCH" && id) return reply(200, await updateOne(kind, id, body));
    if (method === "DELETE" && id) return reply(200, await archiveOne(id));
    return reply(405, { error: "method not allowed" });
  } catch (e) {
    console.error(e);
    if (!e.status || e.status >= 500) await tg(`⚠️ 睇樓 Lambda 錯誤\n${method} ${path}\n${e.message}`);
    return reply(e.status || 500, { error: e.message, notion: e.notion || null });
  }
}
