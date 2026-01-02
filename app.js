// app.js — UI + API wiring
import {
  upsertFood, deleteFood, getAllFoods, searchFoods,
  addLog, getLogsByDate, deleteLog, updateLog,
  exportData, importData, wipeAll
} from "./db.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function todayISO() {
  const d = new Date();
  const tzOff = d.getTimezoneOffset() * 60000;
  return new Date(Date.now() - tzOff).toISOString().slice(0,10);
}

function fmtCal(n) {
  const x = Number(n || 0) | 0;
  return `${x.toLocaleString()} cal`;
}

function safeText(s) {
  return (s ?? "").toString();
}

async function fileToDataURL(file) {
  if (!file) return null;
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderList(ul, items) {
  ul.innerHTML = "";
  if (!items || items.length === 0) {
    const li = document.createElement("li");
    li.textContent = "—";
    ul.appendChild(li);
    return;
  }
  for (const it of items) {
    const li = document.createElement("li");
    li.textContent = safeText(it);
    ul.appendChild(li);
  }
}

function renderBreakdown(ul, breakdown) {
  ul.innerHTML = "";
  if (!breakdown || breakdown.length === 0) {
    const li = document.createElement("li");
    li.textContent = "—";
    ul.appendChild(li);
    return;
  }
  for (const row of breakdown) {
    const li = document.createElement("li");
    const item = safeText(row.item || "item");
    const calories = Number(row.calories || 0) | 0;
    li.textContent = `${item} — ${calories.toLocaleString()} cal`;
    ul.appendChild(li);
  }
}

function page() {
  const p = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  return p;
}

// -------------------- LOG PAGE --------------------
async function initLogPage() {
  const dateEl = $("#date");
  const mealEl = $("#meal");
  const noteEl = $("#note");
  const photoEl = $("#photo");
  const photoMeta = $("#photoMeta");
  const previewWrap = $("#previewWrap");
  const previewImg = $("#preview");
  const removePhotoBtn = $("#removePhoto");

  const estimateBtn = $("#estimateBtn");
  const status = $("#status");

  const estimateCard = $("#estimateCard");
  const estCaloriesEl = $("#estCalories");
  const estRangeEl = $("#estRange");
  const estMatchEl = $("#estMatch");
  const breakdownEl = $("#breakdown");
  const questionsEl = $("#questions");
  const assumptionsEl = $("#assumptions");

  const saveBtn = $("#saveBtn");
  const saveFoodBtn = $("#saveFoodBtn");

  const entriesWrap = $("#entries");
  const dayTotalEl = $("#dayTotal");

  dateEl.value = todayISO();

  let previewUrl = null;
  let lastEstimate = null;
  let adjustedCalories = null;

  function clearPhoto() {
    try {
      photoEl.value = "";
      photoMeta.textContent = "";
      previewWrap.classList.add("hidden");
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
      previewImg.src = "";
    } catch {}
  }

  photoEl.addEventListener("change", () => {
    const file = photoEl.files?.[0];
    if (!file) return clearPhoto();

    photoMeta.textContent = `${file.type || "image"} • ${(file.size/1024).toFixed(0)} KB`;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    previewImg.src = previewUrl;
    previewWrap.classList.remove("hidden");
  });

  removePhotoBtn.addEventListener("click", clearPhoto);

  async function refreshEntries() {
    const date = dateEl.value || todayISO();
    const items = await getLogsByDate(date);
    entriesWrap.innerHTML = "";

    let total = 0;
    for (const e of items) total += Number(e.calories || 0);

    dayTotalEl.textContent = total.toLocaleString();

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No entries yet.";
      entriesWrap.appendChild(empty);
      return;
    }

    for (const e of items) {
      const row = document.createElement("div");
      row.className = "entry";

      const left = document.createElement("div");
      left.className = "left";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = e.label || "Food";

      const meta = document.createElement("div");
      meta.className = "meta";
      const parts = [];
      if (e.note) parts.push(e.note);
      if (e.rangeLow != null && e.rangeHigh != null) parts.push(`range ${e.rangeLow}-${e.rangeHigh}`);
      if (e.confidence) parts.push(`${e.confidence} confidence`);
      meta.textContent = parts.join(" • ");

      left.appendChild(name);
      left.appendChild(meta);

      const right = document.createElement("div");
      right.className = "actions";

      const cal = document.createElement("div");
      cal.className = "cal";
      cal.textContent = fmtCal(e.calories);

      const edit = document.createElement("button");
      edit.className = "btn ghost smallBtn";
      edit.type = "button";
      edit.textContent = "Edit";
      edit.addEventListener("click", async () => {
        const newVal = prompt("Set calories:", String(e.calories || 0));
        if (newVal == null) return;
        const n = Math.max(0, Number(newVal) | 0);
        await updateLog({ ...e, calories: n });
        await refreshEntries();
      });

      const del = document.createElement("button");
      del.className = "btn danger smallBtn";
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", async () => {
        if (!confirm("Delete this entry?")) return;
        await deleteLog(e.id);
        await refreshEntries();
      });

      right.appendChild(cal);
      right.appendChild(edit);
      right.appendChild(del);

      row.appendChild(left);
      row.appendChild(right);
      entriesWrap.appendChild(row);
    }
  }

  dateEl.addEventListener("change", refreshEntries);
  await refreshEntries();

  function setStatus(msg) { status.textContent = msg || ""; }

  function showEstimate(est) {
    lastEstimate = est;
    adjustedCalories = Number(est.estimated_calories || 0) | 0;

    estCaloriesEl.textContent = fmtCal(adjustedCalories);
    estRangeEl.textContent = (est.range_low != null && est.range_high != null)
      ? `Range: ${Number(est.range_low).toLocaleString()}–${Number(est.range_high).toLocaleString()}`
      : "Range: —";

    const matchText = (est.matched_candidate_index != null && est.matched_candidate_index >= 0)
      ? `Matched your library: #${est.matched_candidate_index + 1} (${safeText(est.matched_candidate_reason || "match")})`
      : (est.matched_candidate_reason ? safeText(est.matched_candidate_reason) : "No library match used");

    estMatchEl.textContent = `${safeText(est.confidence || "medium")} confidence • ${matchText}`;

    renderBreakdown(breakdownEl, est.breakdown);
    renderList(questionsEl, est.questions);
    renderList(assumptionsEl, est.assumptions);

    estimateCard.classList.remove("hidden");
  }

  function clearEstimateUI() {
    lastEstimate = null;
    adjustedCalories = null;
    estimateCard.classList.add("hidden");
    estCaloriesEl.textContent = "—";
    estRangeEl.textContent = "—";
    estMatchEl.textContent = "—";
    breakdownEl.innerHTML = "";
    questionsEl.innerHTML = "";
    assumptionsEl.innerHTML = "";
  }

  // Adjust chips
  $$(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      if (adjustedCalories == null) return;
      const delta = btn.getAttribute("data-delta");
      const adjust = btn.getAttribute("data-adjust");
      if (delta != null) adjustedCalories = Math.max(0, adjustedCalories + (Number(delta) | 0));
      if (adjust != null) adjustedCalories = Math.max(0, Math.round(adjustedCalories * (1 + Number(adjust))));
      estCaloriesEl.textContent = fmtCal(adjustedCalories);
    });
  });

  estimateBtn.addEventListener("click", async () => {
    clearEstimateUI();
    setStatus("");

    const date = dateEl.value || todayISO();
    const note = noteEl.value || "";
    const meal = mealEl.value || "";
    const file = photoEl.files?.[0] || null;

    if (!file && !note && !meal) {
      setStatus("Add a note, a label, or a photo first.");
      return;
    }

    estimateBtn.disabled = true;
    setStatus("Estimating…");

    try {
      // Pull local candidates so the model can match your usual foods
      const query = `${meal} ${note}`.trim();
      const candidates = (await searchFoods(query, 8)).map(f => ({
        id: f.id,
        name: f.name,
        calories: f.calories,
        portion: f.portion || "",
        tags: f.tags || [],
        notes: f.notes || ""
      }));

      const imageDataUrl = file ? await fileToDataURL(file) : null;

      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mealLabel: meal || null,
          note: note || null,
          candidates,
          imageDataUrl
        })
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`API error (${res.status}): ${t.slice(0, 400)}`);
      }

      const est = await res.json();
      showEstimate(est);

      // Immediately drop image data from memory as best we can
      // (your app never stores it; this is just extra paranoia)
      // Note: we keep the preview until you remove it / or after Save.
      // If you want it nuked immediately after estimate, uncomment next line:
      // clearPhoto();

      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus(err?.message || "Failed to estimate.");
    } finally {
      estimateBtn.disabled = false;
    }
  });

  saveBtn.addEventListener("click", async () => {
    if (!lastEstimate) return;

    const date = dateEl.value || todayISO();
    const note = noteEl.value || "";
    const meal = mealEl.value || lastEstimate.label || "Food";

    const calories = adjustedCalories ?? (Number(lastEstimate.estimated_calories || 0) | 0);

    await addLog({
      date,
      label: meal,
      calories,
      rangeLow: lastEstimate.range_low ?? null,
      rangeHigh: lastEstimate.range_high ?? null,
      note,
      breakdown: lastEstimate.breakdown || [],
      confidence: lastEstimate.confidence || "medium",
      matchedFoodId: (lastEstimate.matched_food_id ?? null)
    });

    // After saving, nuke the photo (as requested)
    clearPhoto();

    // Clear inputs (keep date)
    mealEl.value = "";
    noteEl.value = "";
    clearEstimateUI();
    await refreshEntries();
  });

  saveFoodBtn.addEventListener("click", async () => {
    if (!lastEstimate) return;

    const name = prompt("Save food name:", mealEl.value || lastEstimate.label || "Food");
    if (!name) return;

    const calories = adjustedCalories ?? (Number(lastEstimate.estimated_calories || 0) | 0);
    const portion = prompt("Portion label (optional):", "1 serving") || "";
    const tags = prompt("Tags (comma-separated, optional):", "") || "";

    await upsertFood({
      name,
      calories,
      portion,
      tags,
      notes: noteEl.value || "",
    });

    alert("Saved to Food Library.");
  });
}

// -------------------- LIBRARY PAGE --------------------
async function initLibraryPage() {
  const form = $("#foodForm");
  const idEl = $("#foodId");
  const nameEl = $("#foodName");
  const calEl = $("#foodCalories");
  const portionEl = $("#foodPortion");
  const tagsEl = $("#foodTags");
  const notesEl = $("#foodNotes");
  const resetBtn = $("#resetFood");
  const foodsWrap = $("#foods");
  const searchEl = $("#foodSearch");

  const exportBtn = $("#exportBtn");
  const importFile = $("#importFile");
  const wipeBtn = $("#wipeBtn");
  const backupStatus = $("#backupStatus");

  let allFoods = [];

  function resetForm() {
    idEl.value = "";
    nameEl.value = "";
    calEl.value = "";
    portionEl.value = "";
    tagsEl.value = "";
    notesEl.value = "";
    nameEl.focus();
  }

  function renderFoods(list) {
    foodsWrap.innerHTML = "";
    if (!list || list.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No foods yet. Add your first one above.";
      foodsWrap.appendChild(empty);
      return;
    }

    list.forEach((f) => {
      const row = document.createElement("div");
      row.className = "entry";

      const left = document.createElement("div");
      left.className = "left";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = f.name;

      const meta = document.createElement("div");
      meta.className = "meta";
      const t = (f.tags || []).join(", ");
      meta.textContent = `${fmtCal(f.calories)}${f.portion ? ` • ${f.portion}` : ""}${t ? ` • ${t}` : ""}`;

      left.appendChild(name);
      left.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "actions";

      const edit = document.createElement("button");
      edit.className = "btn ghost smallBtn";
      edit.type = "button";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        idEl.value = f.id;
        nameEl.value = f.name || "";
        calEl.value = f.calories ?? "";
        portionEl.value = f.portion || "";
        tagsEl.value = (f.tags || []).join(", ");
        notesEl.value = f.notes || "";
        nameEl.focus();
      });

      const logBtn = document.createElement("button");
      logBtn.className = "btn good smallBtn";
      logBtn.type = "button";
      logBtn.textContent = "Log";
      logBtn.addEventListener("click", async () => {
        const multStr = prompt("Portion multiplier (e.g., 1, 0.5, 1.5):", "1");
        if (multStr == null) return;
        const mult = Math.max(0, Number(multStr) || 1);
        const calories = Math.round((Number(f.calories || 0) | 0) * mult);
        await addLog({
          date: todayISO(),
          label: f.name,
          calories,
          note: f.portion ? `${mult}× ${f.portion}` : `${mult}× portion`,
          matchedFoodId: f.id,
          confidence: "high",
          breakdown: [{ item: f.name, calories }]
        });
        alert("Logged to today.");
      });

      const del = document.createElement("button");
      del.className = "btn danger smallBtn";
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", async () => {
        if (!confirm(`Delete "${f.name}"?`)) return;
        await deleteFood(f.id);
        await refresh();
      });

      actions.appendChild(logBtn);
      actions.appendChild(edit);
      actions.appendChild(del);

      row.appendChild(left);
      row.appendChild(actions);
      foodsWrap.appendChild(row);
    });
  }

  function applySearch() {
    const q = (searchEl.value || "").trim().toLowerCase();
    if (!q) return renderFoods(allFoods);
    const tokens = q.split(/\s+/).filter(Boolean);
    const filtered = allFoods.filter(f => {
      const hay = `${(f.name||"").toLowerCase()} ${(f.tags||[]).join(",").toLowerCase()} ${(f.notes||"").toLowerCase()}`;
      return tokens.every(t => hay.includes(t));
    });
    renderFoods(filtered);
  }

  async function refresh() {
    allFoods = await getAllFoods();
    applySearch();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = idEl.value ? Number(idEl.value) : null;

    await upsertFood({
      id,
      name: nameEl.value,
      calories: calEl.value,
      portion: portionEl.value,
      tags: tagsEl.value,
      notes: notesEl.value
    });

    resetForm();
    await refresh();
  });

  resetBtn.addEventListener("click", resetForm);
  searchEl.addEventListener("input", applySearch);

  exportBtn.addEventListener("click", async () => {
    const data = await exportData();
    const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    downloadJSON(`calory-local-backup-${stamp}.json`, data);
    backupStatus.textContent = "Exported.";
    setTimeout(() => (backupStatus.textContent = ""), 2500);
  });

  importFile.addEventListener("change", async () => {
    const f = importFile.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const data = JSON.parse(text);
      await importData(data, { wipeFirst: true });
      backupStatus.textContent = "Imported (replaced local data).";
      await refresh();
    } catch (err) {
      console.error(err);
      backupStatus.textContent = "Import failed: " + (err?.message || "invalid JSON");
    } finally {
      importFile.value = "";
      setTimeout(() => (backupStatus.textContent = ""), 4000);
    }
  });

  wipeBtn.addEventListener("click", async () => {
    if (!confirm("Wipe ALL local foods + logs? This cannot be undone.")) return;
    await wipeAll();
    backupStatus.textContent = "Wiped.";
    await refresh();
    setTimeout(() => (backupStatus.textContent = ""), 2500);
  });

  await refresh();
}

(async function boot() {
  const p = page();
  if (p === "library.html") await initLibraryPage();
  else await initLogPage();
})();
