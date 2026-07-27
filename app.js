const STORAGE_KEY = "toolflow-nfc-v1";

const initialData = {
  workers: [
    { id: crypto.randomUUID(), name: "Иван", tag: "EMP-001" },
    { id: crypto.randomUUID(), name: "Сергей", tag: "EMP-002" }
  ],
  tools: [
    { id: crypto.randomUUID(), name: "Болгарка №1", tag: "TOOL-001", status: "free", holderId: null, issuedAt: null },
    { id: crypto.randomUUID(), name: "Дрель №1", tag: "TOOL-002", status: "free", holderId: null, issuedAt: null }
  ],
  history: []
};

let db = loadData();
let selectedWorker = null;
let sessionItems = [];
let deferredPrompt = null;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : structuredClone(initialData);
  } catch {
    return structuredClone(initialData);
  }
}
function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  renderAll();
}
function normalizeTag(value) {
  return String(value || "").trim().toUpperCase();
}
function nowIso() { return new Date().toISOString(); }
function fmtDate(iso) {
  return new Intl.DateTimeFormat("ru-RU", {dateStyle:"short", timeStyle:"short"}).format(new Date(iso));
}
function beep(type="ok") {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = type === "ok" ? 900 : type === "warn" ? 550 : 220;
    gain.gain.value = .08; osc.start();
    const duration = type === "ok" ? .12 : type === "warn" ? .22 : .45;
    osc.stop(ctx.currentTime + duration);
  } catch {}
  if (navigator.vibrate) navigator.vibrate(type === "ok" ? 80 : type === "warn" ? [100,80,100] : 350);
}
function setStatus(kind, title, text, icon) {
  const card = $("#statusCard");
  card.className = "status-card" + (kind ? " " + kind : "");
  $("#statusTitle").textContent = title;
  $("#statusText").textContent = text;
  $("#statusIcon").textContent = icon;
}
function resetFlow(delay=0) {
  setTimeout(() => {
    selectedWorker = null;
    sessionItems = [];
    $("#currentWorker").classList.add("hidden");
    $("#sessionPanel").classList.add("hidden");
    $("#cancelBtn").classList.add("hidden");
    renderSession();
    setStatus("", "Приложите карту сотрудника", "После этого сканируйте инструменты один за другим", "1");
  }, delay);
}
function chooseWorker(worker) {
  selectedWorker = worker;
  sessionItems = [];
  $("#currentWorker").textContent = `Сотрудник: ${worker.name}`;
  $("#currentWorker").classList.remove("hidden");
  $("#sessionPanel").classList.remove("hidden");
  $("#sessionWorkerName").textContent = worker.name;
  $("#cancelBtn").classList.remove("hidden");
  renderSession();
  setStatus("", `Список открыт: ${worker.name}`, "Сканируйте инструменты. Повторная метка сотрудника закроет список", "2");
  beep("ok");
}
function addSessionItem(tool, action) {
  sessionItems.unshift({
    toolId: tool.id,
    name: tool.name,
    action,
    at: nowIso()
  });
  renderSession();
}
function renderSession() {
  $("#sessionCount").textContent = sessionItems.length;
  $("#sessionList").innerHTML = sessionItems.map(item => `
    <div class="session-row">
      <strong>${escapeHtml(item.name)}</strong>
      <span class="${item.action === "issue" ? "issued" : "returned"}">
        ${item.action === "issue" ? "ВЫДАН" : "ВОЗВРАЩЁН"}
      </span>
    </div>`).join("") || `<div class="note">Пока ничего не отсканировано</div>`;
}
function closeSession() {
  const workerName = selectedWorker?.name || "";
  const count = sessionItems.length;
  showResult("success", "Список закрыт", `${workerName}: операций — ${count}`);
  setStatus("success", "Список сохранён", `${workerName}: ${count} операций`, "✓");
  beep("ok");
  resetFlow(1400);
}
function processTool(tool) {
  if (!selectedWorker) {
    const holder = db.workers.find(w => w.id === tool.holderId);
    const text = tool.status === "busy"
      ? `Сейчас у: ${holder?.name || "неизвестно"}, с ${tool.issuedAt ? fmtDate(tool.issuedAt) : "—"}`
      : tool.status === "broken" ? "Инструмент отмечен как неисправный" : "Инструмент свободен";
    showResult(tool.status === "free" ? "success" : "warn", tool.name, text);
    return;
  }

  if (tool.status === "broken") {
    showResult("error", "Выдача запрещена", `${tool.name}: неисправен`);
    beep("error");
    return;
  }

  if (tool.status === "free") {
    tool.status = "busy";
    tool.holderId = selectedWorker.id;
    tool.issuedAt = nowIso();
    db.history.unshift({ id: crypto.randomUUID(), type:"issue", toolId:tool.id, workerId:selectedWorker.id, at:tool.issuedAt });
    addSessionItem(tool, "issue");
    saveData();
    showResult("success", "Инструмент выдан", `${tool.name} → ${selectedWorker.name}`);
    setStatus("", `Список открыт: ${selectedWorker.name}`, "Сканируйте следующий инструмент или приложите свою метку для завершения", "2");
    beep("ok");
    return;
  }

  if (tool.status === "busy" && tool.holderId === selectedWorker.id) {
    const returnedAt = nowIso();
    db.history.unshift({ id: crypto.randomUUID(), type:"return", toolId:tool.id, workerId:selectedWorker.id, at:returnedAt });
    tool.status = "free";
    tool.holderId = null;
    tool.issuedAt = null;
    addSessionItem(tool, "return");
    saveData();
    showResult("success", "Инструмент возвращён", `${tool.name} ← ${selectedWorker.name}`);
    setStatus("", `Список открыт: ${selectedWorker.name}`, "Сканируйте следующий инструмент или приложите свою метку для завершения", "2");
    beep("ok");
    return;
  }

  const holder = db.workers.find(w => w.id === tool.holderId);
  showResult("warn", "Инструмент уже выдан", `${tool.name} находится у ${holder?.name || "другого сотрудника"}`);
  setStatus("warn", "Операция не выполнена", `Инструмент находится у ${holder?.name || "другого сотрудника"}`, "!");
  beep("warn");
}
function processTag(raw) {
  const tag = normalizeTag(raw);
  if (!tag) return;
  const worker = db.workers.find(w => normalizeTag(w.tag) === tag);
  const tool = db.tools.find(t => normalizeTag(t.tag) === tag);

  if (!selectedWorker && worker) return chooseWorker(worker);

  if (selectedWorker && worker) {
    if (worker.id === selectedWorker.id) return closeSession();
    showResult("error", "Чужая метка", `Сначала закройте список сотрудника ${selectedWorker.name}`);
    setStatus("error", "Список уже открыт", `Повторно приложите метку ${selectedWorker.name}`, "!");
    beep("error");
    return;
  }

  if (tool) return processTool(tool);

  showResult("error", "Метка не зарегистрирована", tag);
  setStatus("error", "Неизвестная метка", "Добавьте её в настройках", "?");
  beep("error");
  resetFlow(1800);
}
function showResult(kind, title, text) {
  const el = $("#lastResult");
  el.className = `result ${kind}`;
  el.innerHTML = `<strong>${escapeHtml(title)}</strong><div>${escapeHtml(text)}</div>`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function scanNfc() {
  if (!("NDEFReader" in window)) {
    showResult("warn", "NFC недоступен", "Используйте Chrome на Android или ручной выбор");
    return;
  }
  try {
    const reader = new NDEFReader();
    await reader.scan();
    setStatus("", "Ожидание NFC", selectedWorker ? "Приложите инструмент" : "Приложите карту сотрудника", "…");
    reader.onreadingerror = () => showResult("error", "Ошибка чтения", "Попробуйте приложить метку ещё раз");
    reader.onreading = event => {
      let value = "";
      for (const record of event.message.records) {
        if (record.recordType === "text") value = new TextDecoder(record.encoding || "utf-8").decode(record.data);
        if (record.recordType === "url") value = new TextDecoder().decode(record.data).split("/").pop();
      }
      if (!value && event.serialNumber) value = event.serialNumber;
      processTag(value);
    };
  } catch (e) {
    showResult("error", "NFC не запущен", e.message || "Проверьте разрешение NFC");
  }
}

function renderTools(filter="") {
  const q = filter.trim().toLowerCase();
  const list = db.tools.filter(t => t.name.toLowerCase().includes(q) || t.tag.toLowerCase().includes(q));
  $("#toolList").innerHTML = list.map(toolCard).join("") || `<div class="note">Ничего не найдено</div>`;
}
function toolCard(t) {
  const holder = db.workers.find(w => w.id === t.holderId);
  const statusText = t.status === "free" ? "Свободен" : t.status === "broken" ? "Неисправен" : `У ${holder?.name || "сотрудника"}`;
  return `<div class="item">
    <div class="item-main"><div class="item-title">${escapeHtml(t.name)}</div><div class="item-sub">${escapeHtml(t.tag)}${t.issuedAt ? " · с " + fmtDate(t.issuedAt) : ""}</div></div>
    <span class="badge ${t.status}">${escapeHtml(statusText)}</span>
  </div>`;
}
function renderHistory() {
  $("#historyList").innerHTML = db.history.slice(0,300).map(h => {
    const t = db.tools.find(x=>x.id===h.toolId), w = db.workers.find(x=>x.id===h.workerId);
    return `<div class="item"><div class="item-main"><div class="item-title">${h.type==="issue"?"Выдан":"Возвращён"}: ${escapeHtml(t?.name||"Удалённый инструмент")}</div><div class="item-sub">${escapeHtml(w?.name||"Удалённый сотрудник")} · ${fmtDate(h.at)}</div></div></div>`;
  }).join("") || `<div class="note">История пока пустая</div>`;
}
function renderSettings() {
  $("#workerList").innerHTML = db.workers.map(w => `<div class="item"><div><div class="item-title">${escapeHtml(w.name)}</div><div class="item-sub">${escapeHtml(w.tag)}</div></div><button class="mini" data-del-worker="${w.id}">Удалить</button></div>`).join("");
  $("#settingsToolList").innerHTML = db.tools.map(t => `<div class="item"><div><div class="item-title">${escapeHtml(t.name)}</div><div class="item-sub">${escapeHtml(t.tag)} · ${t.status}</div></div><div class="item-actions"><button class="mini" data-toggle-tool="${t.id}">${t.status==="broken"?"Исправен":"Неисправен"}</button><button class="mini" data-del-tool="${t.id}">Удалить</button></div></div>`).join("");
}
function renderAll() { renderTools($("#searchInput")?.value || ""); renderHistory(); renderSettings(); }

function openPicker(type) {
  const items = type === "worker" ? db.workers : db.tools;
  $("#pickerTitle").textContent = type === "worker" ? "Выберите сотрудника" : "Выберите инструмент";
  $("#pickerList").innerHTML = items.map(x => `<button type="button" class="item" data-pick-type="${type}" data-pick-id="${x.id}"><span class="item-title">${escapeHtml(x.name)}</span><span class="item-sub">${escapeHtml(x.tag)}</span></button>`).join("");
  $("#pickerDialog").showModal();
}

$$(".bottom-nav button").forEach(btn => btn.addEventListener("click", () => {
  $$(".bottom-nav button").forEach(b=>b.classList.toggle("active", b===btn));
  $$(".page").forEach(p=>p.classList.toggle("active", p.id===btn.dataset.page));
  if (btn.dataset.page === "search") $("#searchInput").focus();
}));

$("#scanBtn").addEventListener("click", scanNfc);
$("#cancelBtn").addEventListener("click", () => selectedWorker ? closeSession() : resetFlow());
$("[data-action='manual-worker']").addEventListener("click", ()=>openPicker("worker"));
$("[data-action='manual-tool']").addEventListener("click", ()=>openPicker("tool"));
$("#pickerList").addEventListener("click", e => {
  const btn = e.target.closest("[data-pick-id]"); if (!btn) return;
  $("#pickerDialog").close();
  if (btn.dataset.pickType === "worker") chooseWorker(db.workers.find(w=>w.id===btn.dataset.pickId));
  else processTool(db.tools.find(t=>t.id===btn.dataset.pickId));
});
$("#searchInput").addEventListener("input", e=>renderTools(e.target.value));

$("#workerForm").addEventListener("submit", e => {
  e.preventDefault();
  const name = $("#workerName").value.trim(), tag = normalizeTag($("#workerTag").value);
  if (db.workers.some(w=>normalizeTag(w.tag)===tag) || db.tools.some(t=>normalizeTag(t.tag)===tag)) return alert("Такой код уже используется");
  db.workers.push({id:crypto.randomUUID(),name,tag}); e.target.reset(); saveData();
});
$("#toolForm").addEventListener("submit", e => {
  e.preventDefault();
  const name = $("#toolName").value.trim(), tag = normalizeTag($("#toolTag").value);
  if (db.workers.some(w=>normalizeTag(w.tag)===tag) || db.tools.some(t=>normalizeTag(t.tag)===tag)) return alert("Такой код уже используется");
  db.tools.push({id:crypto.randomUUID(),name,tag,status:"free",holderId:null,issuedAt:null}); e.target.reset(); saveData();
});
$("#workerList").addEventListener("click", e => {
  const id=e.target.dataset.delWorker; if(!id) return;
  if(db.tools.some(t=>t.holderId===id)) return alert("Сначала верните инструменты этого сотрудника");
  if(confirm("Удалить сотрудника?")) { db.workers=db.workers.filter(w=>w.id!==id); saveData(); }
});
$("#settingsToolList").addEventListener("click", e => {
  const del=e.target.dataset.delTool, toggle=e.target.dataset.toggleTool;
  if(del && confirm("Удалить инструмент?")) { db.tools=db.tools.filter(t=>t.id!==del); saveData(); }
  if(toggle) {
    const t=db.tools.find(x=>x.id===toggle);
    if(t.status==="busy") return alert("Сначала верните инструмент");
    t.status=t.status==="broken"?"free":"broken"; saveData();
  }
});
$("#exportBtn").addEventListener("click", () => {
  const rows=[["Операция","Инструмент","Сотрудник","Дата"]];
  db.history.forEach(h=>rows.push([h.type==="issue"?"Выдан":"Возвращён",db.tools.find(t=>t.id===h.toolId)?.name||"",db.workers.find(w=>w.id===h.workerId)?.name||"",fmtDate(h.at)]));
  const csv="\uFEFF"+rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(";")).join("\n");
  downloadBlob(csv,"toolflow-history.csv","text/csv;charset=utf-8");
});
$("#backupBtn").addEventListener("click",()=>downloadBlob(JSON.stringify(db,null,2),"toolflow-backup.json","application/json"));
$("#restoreInput").addEventListener("change", async e => {
  try { db=JSON.parse(await e.target.files[0].text()); saveData(); alert("Резервная копия загружена"); }
  catch { alert("Неверный файл"); }
});
$("#resetBtn").addEventListener("click",()=>{ if(confirm("Удалить все данные без возможности восстановления?")){db={workers:[],tools:[],history:[]};saveData();resetFlow();}});
function downloadBlob(content,name,type){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();URL.revokeObjectURL(a.href)}

window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("#installBtn").classList.remove("hidden")});
$("#installBtn").addEventListener("click",async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("#installBtn").classList.add("hidden")}});

if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
renderAll();
