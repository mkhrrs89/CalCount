// db.js — IndexedDB wrapper (local-only)
// Stores:
// - foods: reusable food library items
// - logs: daily log entries

const DB_NAME = "calory_local_db";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("foods")) {
        const foods = db.createObjectStore("foods", { keyPath: "id", autoIncrement: true });
        foods.createIndex("nameLower", "nameLower", { unique: false });
        foods.createIndex("tagsLower", "tagsLower", { unique: false });
        foods.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains("logs")) {
        const logs = db.createObjectStore("logs", { keyPath: "id", autoIncrement: true });
        logs.createIndex("date", "date", { unique: false });
        logs.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map(t => String(t).trim()).filter(Boolean);
  return String(tags).split(",").map(t => t.trim()).filter(Boolean);
}

export async function upsertFood(food) {
  const now = Date.now();
  const item = {
    ...food,
    name: String(food.name || "").trim(),
    nameLower: String(food.name || "").trim().toLowerCase(),
    calories: Math.max(0, Number(food.calories || 0) | 0),
    portion: String(food.portion || "").trim(),
    tags: normalizeTags(food.tags),
    tagsLower: normalizeTags(food.tags).join(",").toLowerCase(),
    notes: String(food.notes || "").trim(),
    updatedAt: now,
    createdAt: food.createdAt || now,
  };

  return withStore("foods", "readwrite", (store) => {
    if (item.id) store.put(item);
    else store.add(item);
  });
}

export async function deleteFood(id) {
  return withStore("foods", "readwrite", (store) => store.delete(Number(id)));
}

export async function getAllFoods() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("foods", "readonly");
    const store = tx.objectStore("foods");
    const req = store.getAll();
    req.onsuccess = () => {
      const items = req.result || [];
      items.sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function searchFoods(query, limit = 8) {
  const q = (query || "").trim().toLowerCase();
  const foods = await getAllFoods();
  if (!q) return foods.slice(0, limit);

  const tokens = q.split(/\s+/).filter(Boolean);

  const scored = foods.map(f => {
    const hay = `${f.nameLower} ${(f.tagsLower||"")} ${(String(f.notes||"").toLowerCase())}`;
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score += 2;
      if (f.nameLower.includes(t)) score += 3;
    }
    // small boost for recency
    score += Math.min(2, ((f.updatedAt || 0) / 1e13));
    return { f, score };
  }).sort((a,b) => b.score - a.score);

  return scored.filter(x => x.score > 0).slice(0, limit).map(x => x.f);
}

export async function addLog(entry) {
  const now = Date.now();
  const item = {
    date: entry.date, // YYYY-MM-DD
    label: String(entry.label || "").trim() || "Food",
    calories: Math.max(0, Number(entry.calories || 0) | 0),
    rangeLow: entry.rangeLow == null ? null : Math.max(0, Number(entry.rangeLow) | 0),
    rangeHigh: entry.rangeHigh == null ? null : Math.max(0, Number(entry.rangeHigh) | 0),
    note: String(entry.note || "").trim(),
    breakdown: entry.breakdown || [],
    confidence: entry.confidence || "medium",
    matchedFoodId: entry.matchedFoodId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  return withStore("logs", "readwrite", (store) => store.add(item));
}

export async function updateLog(entry) {
  const now = Date.now();
  const item = { ...entry, updatedAt: now };
  return withStore("logs", "readwrite", (store) => store.put(item));
}

export async function deleteLog(id) {
  return withStore("logs", "readwrite", (store) => store.delete(Number(id)));
}

export async function getLogsByDate(date) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("logs", "readonly");
    const store = tx.objectStore("logs");
    const idx = store.index("date");
    const range = IDBKeyRange.only(date);
    const req = idx.getAll(range);
    req.onsuccess = () => {
      const items = req.result || [];
      items.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getAllLogs() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("logs", "readonly");
    const store = tx.objectStore("logs");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function exportData() {
  const foods = await getAllFoods();
  const logs = await getAllLogs();
  return {
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    foods,
    logs,
  };
}

export async function importData(payload, { wipeFirst = true } = {}) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid JSON payload.");
  const foods = Array.isArray(payload.foods) ? payload.foods : [];
  const logs = Array.isArray(payload.logs) ? payload.logs : [];

  const db = await openDB();

  // wipe
  if (wipeFirst) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["foods","logs"], "readwrite");
      tx.objectStore("foods").clear();
      tx.objectStore("logs").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // insert (ids may be reused as-is; IDB will accept explicit keys)
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["foods","logs"], "readwrite");
    const foodStore = tx.objectStore("foods");
    const logStore = tx.objectStore("logs");

    for (const f of foods) foodStore.put(f);
    for (const l of logs) logStore.put(l);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function wipeAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["foods","logs"], "readwrite");
    tx.objectStore("foods").clear();
    tx.objectStore("logs").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
