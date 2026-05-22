const MockData = window.MockData;
const { rawNotifications, summarize } = MockData;
/** 当前正在行内编辑的通知 id;为 null 表示无编辑 */
let editingId = null;
/** 刚刚通过「+ 新增」加进来、还没点过保存的草稿 id;取消时会被丢弃 */
let draftId = null;
const LLM_API_BASE = (() => {
  const raw = typeof window.LLM_API_BASE === "string" ? window.LLM_API_BASE.trim() : "";
  if (raw) return raw.replace(/\/$/, "");
  if (typeof window.location !== "undefined" && window.location.origin && window.location.protocol !== "file:")
    return window.location.origin.replace(/\/$/, "");
  return "http://127.0.0.1:5055";
})();

const panelIds = {
  wechat: "panel-wechat",
  qq: "panel-qq",
  chaoxing: "panel-chaoxing",
  email: "panel-email",
  sms: "panel-sms",
};

/** 供后端多轮对话（不含摘要短信与欢迎语） */
let llmHistory = [];

/** AI 摘要缓存：{ [noticeId]: summary }；点击「AI 智能摘要」后填充 */
const aiSummaryCache = Object.create(null);
let aiSummaryInflight = false;

function formatDisplayTime(iso) {
  const t = new Date(iso);
  return `${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}`;
}

function initDatetimeDefaults() {
  const now = new Date();
  const start = new Date(2026, 4, 1, 0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  document.getElementById("filter-from").value = toLocalDatetimeValue(start);
  document.getElementById("filter-to").value = toLocalDatetimeValue(end);
}

function toLocalDatetimeValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getFilterState() {
  const sources = [...document.querySelectorAll('input[name="source"]:checked')].map((el) => el.value);
  const fromVal = document.getElementById("filter-from").value;
  const toVal = document.getElementById("filter-to").value;
  return { sources, fromVal, toVal };
}

function getPreferredPushSlots() {
  return [...document.querySelectorAll('input[name="slot"]:checked')].map((el) => el.value);
}

const slotLabels = { morning: "早间 7:00–9:00", noon: "午间 11:30–13:00", evening: "晚间 20:00–22:00" };

function passesTimeFilter(n, fromVal, toVal) {
  const t = new Date(n.sentAt).getTime();
  if (fromVal) {
    const f = new Date(fromVal).getTime();
    if (t < f) return false;
  }
  if (toVal) {
    const end = new Date(toVal).getTime();
    if (t > end) return false;
  }
  return true;
}

function getFilteredNotifications() {
  const { sources, fromVal, toVal } = getFilterState();
  return rawNotifications.filter((n) => {
    if (!sources.includes(n.source)) return false;
    if (!passesTimeFilter(n, fromVal, toVal)) return false;
    return true;
  });
}

function getDigestItems() {
  return getFilteredNotifications()
    .map((n) => {
      const summary = aiSummaryCache[n.id] || summarize(n);
      if (!summary) return null;
      return { notice: n, summary };
    })
    .filter(Boolean);
}

function buildDigestContext() {
  return getDigestItems()
    .map(({ notice, summary }) => `- [${notice.sourceLabel}] ${notice.title}: ${summary}`)
    .join("\n");
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function actionsHtml(id) {
  return `<div class="msg-actions">
    <button type="button" class="msg-action-btn btn-edit-msg" data-id="${id}" title="编辑" aria-label="编辑">✎</button>
    <button type="button" class="msg-action-btn btn-delete-msg" data-id="${id}" title="删除" aria-label="删除">✕</button>
  </div>`;
}

function editFormHtml(n) {
  const dt = (n.sentAt || "").slice(0, 16);
  return `<form class="msg-edit-form" data-id="${escapeAttr(n.id)}">
    <div class="ef-row">
      <label class="ef-label ef-label-grow">发送方
        <input type="text" name="from" value="${escapeAttr(n.from)}" maxlength="60" />
      </label>
      <label class="ef-label">时间
        <input type="datetime-local" name="sentAt" value="${escapeAttr(dt)}" />
      </label>
    </div>
    <label class="ef-label">标题
      <input type="text" name="title" value="${escapeAttr(n.title)}" maxlength="200" placeholder="(可留空)" />
    </label>
    <label class="ef-label">正文
      <textarea name="body" rows="3" maxlength="2000" placeholder="通知正文">${escapeHtml(n.body || "")}</textarea>
    </label>
    <div class="ef-bottom">
      <label class="ef-check">
        <input type="checkbox" name="isNoise" ${n.isNoise ? "checked" : ""} /> 标记为可过滤(噪声)
      </label>
      <div class="ef-buttons">
        <button type="button" class="btn ef-cancel" data-id="${escapeAttr(n.id)}">取消</button>
        <button type="submit" class="btn primary">保存</button>
      </div>
    </div>
  </form>`;
}

/** 在模拟微信会话内渲染「今日摘要」短信（替换 #wx-digest-root） */
function renderDigestSmsInChat() {
  const root = document.getElementById("wx-digest-root");
  if (!root) return;
  const items = getDigestItems();
  const count = items.length;
  if (items.length === 0) {
    root.innerHTML = `<div class="wx-digest-banner">今日摘要 · 共 0 条</div>
      <div class="wx-sms-empty-hint">当前筛选下暂无摘要短信，请在「设置」中放宽来源或时间。</div>`;
    return;
  }
  const blocks = items
    .map(({ notice, summary }) => {
      return `<div class="wx-sms-item">
        <div class="digest-sms-sender">学讯助手 · 摘要短信</div>
        <div class="digest-sms-bubble">
          <div class="digest-sms-title">${escapeHtml(notice.title)}</div>
          <p class="digest-sms-text">${escapeHtml(summary)}</p>
          <div class="digest-sms-meta">${escapeHtml(notice.sourceLabel)} · ${formatDisplayTime(notice.sentAt)} · ${escapeHtml(notice.from)}</div>
          <button type="button" class="digest-sms-link btn-trace-sms" data-id="${notice.id}">查看原文 ›</button>
        </div>
      </div>`;
    })
    .join("");
  root.innerHTML = `<div class="wx-digest-banner">今日摘要 · 共 ${count} 条（短信形式）</div>${blocks}`;
  root.querySelectorAll(".btn-trace-sms").forEach((btn) => {
    btn.addEventListener("click", () => traceToOriginal(btn.dataset.id));
  });
}

function renderPreviewPush() {
  const ul = document.getElementById("preview-push");
  const slots = getPreferredPushSlots();
  const slotText =
    slots.length > 0 ? slots.map((s) => slotLabels[s] || s).join("、") : "（未选择推送时段）";
  const items = getDigestItems();
  const head = `<li style="margin-bottom:0.65rem;color:#b8c4dc">计划在以下窗口推送：${escapeHtml(slotText)}</li>`;
  const body = items.length
    ? items.map(({ summary }) => `<li>${escapeHtml(summary)}</li>`).join("")
    : `<li>（无）当前筛选下没有可推送条目</li>`;
  ul.innerHTML = head + body;
}

function refreshDigestAndPreview() {
  renderDigestSmsInChat();
  renderPreviewPush();
}

function formatDailyReport(items) {
  if (items.length === 0) return "";
  const blocks = items.map(({ notice, summary }, i) => {
    const num = String(i + 1).padStart(2, "0");
    return `〔${num}〕 ${notice.title}\n    ${summary}`;
  });
  return [
    "【学讯日报】",
    "",
    "汇总如下（共 " + items.length + " 条）：",
    "",
    ...blocks,
    "",
    "──────────────────",
    "",
    "提示：摘要短信在会话上方；点击「查看原文」可溯源；也可继续向 AI 提问。",
  ].join("\n");
}

function traceToOriginal(id) {
  const notice = rawNotifications.find((n) => n.id === id);
  if (!notice) return;
  switchView("sources");
  const panel = document.getElementById(panelIds[notice.source]);
  if (panel) {
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
    panel.classList.add("highlight");
    setTimeout(() => panel.classList.remove("highlight"), 2000);
  }
  const el = document.querySelector(`.msg-item[data-id="${id}"]`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1200);
  }
}

function emptyHint(source) {
  const tip = source === "wechat" || source === "qq" ? "暂无消息" : "暂无内容";
  return `<div class="msg-empty-hint">${tip} · 点击右上角「+ 新增」添加一条</div>`;
}

function renderItem(n) {
  if (editingId === n.id) {
    return `<div class="msg-item msg-item-editing" data-id="${escapeAttr(n.id)}" data-source="${escapeAttr(n.source)}">
      ${editFormHtml(n)}
    </div>`;
  }
  switch (n.source) {
    case "wechat":
      return `<div class="bubble-row msg-item" data-id="${escapeAttr(n.id)}">
        ${actionsHtml(n.id)}
        <div class="name">${escapeHtml(n.from)} ${formatDisplayTime(n.sentAt)}</div>
        ${n.title ? `<div class="bubble-title">${escapeHtml(n.title)}</div>` : ""}
        <div class="bubble other">${escapeHtml(n.body)}</div>
      </div>`;
    case "qq":
      return `<div class="bubble-row msg-item" data-id="${escapeAttr(n.id)}">
        ${actionsHtml(n.id)}
        <div class="name">${escapeHtml(n.from)}</div>
        ${n.title ? `<div class="bubble-title">${escapeHtml(n.title)}</div>` : ""}
        <div class="bubble qq-other">${escapeHtml(n.body)}</div>
      </div>`;
    case "chaoxing":
      return `<div class="list-item msg-item" data-id="${escapeAttr(n.id)}">
        ${actionsHtml(n.id)}
        <div class="li-title">${escapeHtml(n.title)}</div>
        <div class="li-sub">${escapeHtml(n.from)} · ${formatDisplayTime(n.sentAt)}</div>
        <div class="li-sub" style="margin-top:0.35rem;color:#b8c0d4">${escapeHtml(n.body)}</div>
      </div>`;
    case "email":
      return `<div class="list-item msg-item" data-id="${escapeAttr(n.id)}">
        ${actionsHtml(n.id)}
        <div class="li-title">${escapeHtml(n.title)}</div>
        <div class="li-sub">发件人 ${escapeHtml(n.from)} · ${formatDisplayTime(n.sentAt)}</div>
        <div class="li-sub" style="margin-top:0.35rem">${escapeHtml(n.body)}</div>
      </div>`;
    case "sms":
      return `<div class="sms-bubble msg-item" data-id="${escapeAttr(n.id)}">
        ${actionsHtml(n.id)}
        ${n.title ? `<div class="sms-title">${escapeHtml(n.title)}</div>` : ""}
        ${escapeHtml(n.body)}
        <div class="sms-meta">${escapeHtml(n.from)} · ${formatDisplayTime(n.sentAt)}</div>
      </div>`;
    default:
      return "";
  }
}

const _SOURCE_TO_LIST_ID = {
  wechat: "mock-wechat-list",
  qq: "mock-qq-list",
  chaoxing: "mock-chaoxing-list",
  email: "mock-email-list",
  sms: "mock-sms-list",
};

function renderMockPanels() {
  const bySource = (s) => rawNotifications.filter((n) => n.source === s);
  for (const [src, listId] of Object.entries(_SOURCE_TO_LIST_ID)) {
    const list = document.getElementById(listId);
    if (!list) continue;
    const items = bySource(src);
    list.innerHTML = items.length
      ? items.map(renderItem).join("")
      : emptyHint(src);
  }
}

function refreshAllAfterMutation() {
  renderMockPanels();
  refreshDigestAndPreview();
}

function discardDraftIfAny() {
  if (draftId != null && rawNotifications.some((n) => n.id === draftId)) {
    MockData.deleteNotification(draftId);
    delete aiSummaryCache[draftId];
  }
  draftId = null;
}

function focusEditCard(id) {
  const card = document.querySelector(`.msg-item-editing[data-id="${cssEscape(id)}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  const titleInput = card.querySelector('input[name="title"]');
  titleInput?.focus();
  titleInput?.select?.();
}

function enterEditMode(id) {
  discardDraftIfAny();
  editingId = id;
  refreshAllAfterMutation();
  focusEditCard(id);
}

function cancelEdit() {
  discardDraftIfAny();
  editingId = null;
  refreshAllAfterMutation();
}

function saveEditFromForm(form) {
  const id = form.dataset.id;
  const fd = new FormData(form);
  const patch = {
    from: String(fd.get("from") || "").trim(),
    sentAt: normalizeSentAt(String(fd.get("sentAt") || "")),
    title: String(fd.get("title") || "").trim(),
    body: String(fd.get("body") || "").trim(),
    isNoise: fd.get("isNoise") === "on",
  };
  if (!patch.body) {
    alert("正文不能为空。");
    return;
  }
  MockData.updateNotification(id, patch);
  // 编辑后清空对应条目的 AI 摘要缓存,让下次摘要重新生成
  delete aiSummaryCache[id];
  editingId = null;
  if (draftId === id) draftId = null;
  refreshAllAfterMutation();
}

function normalizeSentAt(v) {
  if (!v) return new Date().toISOString().slice(0, 19);
  // datetime-local 是 yyyy-MM-ddTHH:mm,补足秒位
  return v.length === 16 ? `${v}:00` : v;
}

function addNewItem(source) {
  discardDraftIfAny();
  const item = MockData.addNotification(source);
  if (!item) return;
  draftId = item.id;
  editingId = item.id;
  refreshAllAfterMutation();
  focusEditCard(item.id);
}

function deleteItem(id) {
  if (!window.confirm("确定删除这条通知?(本地修改可在顶部「恢复默认数据」一键复原)")) {
    return;
  }
  MockData.deleteNotification(id);
  delete aiSummaryCache[id];
  if (editingId === id) editingId = null;
  if (draftId === id) draftId = null;
  refreshAllAfterMutation();
}

function resetSourcesToDefaults() {
  if (!window.confirm("将清空所有本地修改,并恢复演示默认数据。继续?")) return;
  MockData.resetToDefaults();
  for (const k of Object.keys(aiSummaryCache)) delete aiSummaryCache[k];
  editingId = null;
  draftId = null;
  refreshAllAfterMutation();
}

function cssEscape(s) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(s);
  return String(s).replace(/(["\\])/g, "\\$1");
}

function bindSourcesEditing() {
  // 顶部「恢复默认数据」
  const resetBtn = document.getElementById("btn-reset-sources");
  resetBtn?.addEventListener("click", resetSourcesToDefaults);

  // 每个面板顶部「+ 新增」
  document.querySelectorAll(".mock-add-btn[data-add-source]").forEach((btn) => {
    btn.addEventListener("click", () => addNewItem(btn.dataset.addSource));
  });

  // 用事件委托处理动态生成的编辑/删除按钮、编辑表单的提交/取消
  const sourcesView = document.getElementById("view-sources");
  if (!sourcesView) return;

  sourcesView.addEventListener("click", (e) => {
    const editBtn = e.target.closest(".btn-edit-msg");
    if (editBtn) {
      e.preventDefault();
      enterEditMode(editBtn.dataset.id);
      return;
    }
    const delBtn = e.target.closest(".btn-delete-msg");
    if (delBtn) {
      e.preventDefault();
      deleteItem(delBtn.dataset.id);
      return;
    }
    const cancelBtn = e.target.closest(".ef-cancel");
    if (cancelBtn) {
      e.preventDefault();
      cancelEdit();
      return;
    }
  });

  sourcesView.addEventListener("submit", (e) => {
    const form = e.target.closest(".msg-edit-form");
    if (!form) return;
    e.preventDefault();
    saveEditFromForm(form);
  });
}

function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-visible"));
  document.getElementById(`view-${name}`)?.classList.add("is-visible");
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.view === name);
  });
}

function bindNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
}

function bindSettings() {
  document
    .querySelectorAll('input[name="slot"], input[name="source"], #filter-from, #filter-to')
    .forEach((el) => el.addEventListener("change", refreshDigestAndPreview));
  document.getElementById("btn-reset-time").addEventListener("click", () => {
    initDatetimeDefaults();
    refreshDigestAndPreview();
  });
}

function appendWxTime() {
  const chat = document.getElementById("wx-chat");
  const pill = document.createElement("div");
  pill.className = "wx-time-pill";
  const now = new Date();
  pill.textContent = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  chat.appendChild(pill);
}

function appendWxMessage(role, text, options = {}) {
  const chat = document.getElementById("wx-chat");
  const row = document.createElement("div");
  row.className = `wx-msg ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "wx-avatar";
  avatar.textContent = role === "ai" ? "AI" : "我";
  const bubble = document.createElement("div");
  bubble.className = "wx-bubble";
  if (options.preLine) bubble.classList.add("wx-bubble-pre");
  bubble.textContent = text;
  row.appendChild(avatar);
  row.appendChild(bubble);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function appendWxLoading(hint) {
  const chat = document.getElementById("wx-chat");
  const row = document.createElement("div");
  row.className = "wx-msg ai wx-loading-msg";
  row.id = "wx-loading-row";
  const avatar = document.createElement("div");
  avatar.className = "wx-avatar";
  avatar.textContent = "AI";
  const bubble = document.createElement("div");
  bubble.className = "wx-bubble";
  bubble.textContent = hint || "正在请求模型生成回复…";
  row.appendChild(avatar);
  row.appendChild(bubble);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function removeWxLoading() {
  document.getElementById("wx-loading-row")?.remove();
}

function detailFromErrorPayload(data) {
  const detail = data.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg || d).join("；");
  return JSON.stringify(data);
}

function isModelStillLoadingDetail(msg) {
  return /still loading|model not loaded|尚未就绪|加载中/i.test(String(msg || ""));
}

async function fetchLlmReply(userText) {
  if (!LLM_API_BASE) {
    return null;
  }
  const maxAttempts = 12;
  const delayMs = 1500;
  let lastFail = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(`${LLM_API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          digest_context: buildDigestContext(),
          history: llmHistory,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) {
        const msg = detailFromErrorPayload(data);
        lastFail = msg;
        if (isModelStillLoadingDetail(msg) && attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        return `【后端错误 503】${msg}\n\n请确认已用「启动演示.bat」启动；若 models 已放好仍失败，请看命令行窗口里的 [LLM] 报错。`;
      }
      if (!res.ok) {
        const msg = detailFromErrorPayload(data);
        return `【后端错误 ${res.status}】${msg}\n\n请确认已用「启动演示.bat」启动服务；若已下载本地 models 权重，请看终端里的 Python 报错。`;
      }
      return typeof data.reply === "string" ? data.reply : null;
    } catch (e) {
      const hint =
        e instanceof TypeError && String(e.message || "").includes("fetch")
          ? "浏览器无法连接本地接口（请用启动脚本打开 http://127.0.0.1:5055 ，勿单独双击 html）。"
          : String(e && e.message ? e.message : e);
      return `【无法连接 LLM 服务】${hint}\n目标地址：${LLM_API_BASE}\n请先运行「启动演示.bat」。`;
    }
  }
  return `【后端错误 503】${lastFail || "timeout"}\n\n模型长时间未就绪，请查看命令行是否卡在下载权重或内存不足。`;
}

function buildAiReply(userText) {
  const t = userText.trim();
  const items = getDigestItems();
  if (/你好|在吗|hi\b|hello/i.test(t)) {
    return `你好！我是学讯助手。连接后端 Qwen 后可正常对话；当前为离线规则。筛选下共有 ${items.length} 条有效摘要。`;
  }
  if (/作业|实验|报告|deadline|ddl/i.test(t)) {
    const hits = items.filter(({ notice }) => /作业|实验|测验|报告|章节/i.test(notice.title + notice.body));
    if (hits.length === 0) return "当前筛选下没有明显的作业类通知，可到「设置」里放宽来源或时间范围试试。";
    return hits.map(({ summary }) => `· ${summary}`).join("\n");
  }
  if (/选课|教务|选修/i.test(t)) {
    const e = items.find(({ notice }) => notice.source === "email" && /选课|教务/i.test(notice.title));
    return e ? e.summary : "当前摘要里没有教务邮件，可能被来源或时间筛掉了。";
  }
  if (/快递|取件|驿站/i.test(t)) {
    const s = items.find(({ notice }) => notice.source === "sms" && /快递|驿站/i.test(notice.body));
    return s ? s.summary : "暂无快递类短信摘要。";
  }
  if (/推送|摘要|汇总|几条/i.test(t)) {
    if (items.length === 0) return "现在没有符合条件的摘要，请检查左侧勾选的来源与时间范围。";
    return `为你汇总了 ${items.length} 条：\n` + items.map(({ summary }) => `· ${summary}`).join("\n");
  }
  return `（离线 fallback）未匹配关键词：「${t.slice(0, 80)}」。请启动 backend 连接 PyTorch LLM，或尝试问「作业」「摘要」等。`;
}

function initWxChatShell() {
  const chat = document.getElementById("wx-chat");
  chat.innerHTML = "";
  appendWxTime();
  const root = document.createElement("div");
  root.id = "wx-digest-root";
  root.className = "wx-digest-root";
  chat.appendChild(root);
  renderDigestSmsInChat();
  const items = getDigestItems();
  appendWxMessage(
    "ai",
    items.length
      ? `已就绪：会话上方为「今日摘要」短信，每条可点「查看原文」。\n\n请通过「启动演示.bat」打开本页，对话由本机 Qwen2 模型生成。`
      : "你好！当前筛选较严，暂无摘要短信。\n\n可在「设置」中勾选来源或放宽时间。",
    { preLine: true }
  );
  llmHistory = [];
}

function bindWechatChat() {
  const input = document.getElementById("wx-input");
  const send = document.getElementById("wx-send");
  const sendHandler = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    send.disabled = true;
    appendWxTime();
    appendWxMessage("user", text);
    input.value = "";
    appendWxLoading("正在请求 Qwen 模型生成回复…");
    const reply = await fetchLlmReply(text);
    removeWxLoading();
    const isDiagnostic =
      typeof reply === "string" &&
      (reply.startsWith("【后端错误") || reply.startsWith("【无法连接 LLM"));
    if (reply !== null && reply.length > 0 && !isDiagnostic) {
      appendWxMessage("ai", reply, { preLine: true });
      llmHistory.push({ role: "user", content: text });
      llmHistory.push({ role: "assistant", content: reply });
      if (llmHistory.length > 10) llmHistory = llmHistory.slice(-10);
    } else if (isDiagnostic) {
      appendWxMessage("ai", reply, { preLine: true });
    } else {
      appendWxMessage("ai", buildAiReply(text), { preLine: true });
    }
    input.disabled = false;
    send.disabled = false;
    input.focus();
  };
  send.addEventListener("click", sendHandler);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendHandler();
  });
}

function bindSimulatePush() {
  document.getElementById("btn-simulate-push").addEventListener("click", () => {
    switchView("wechat");
    const items = getDigestItems();
    appendWxTime();
    if (items.length === 0) {
      appendWxMessage("ai", "当前没有可推送的摘要，请回到「设置」调整筛选条件。");
      return;
    }
    appendWxMessage("ai", formatDailyReport(items), { preLine: true });
  });
}

function setAiSummaryStatus(text, kind) {
  const el = document.getElementById("ai-summary-status");
  if (!el) return;
  el.textContent = text || "";
  el.dataset.kind = kind || "";
}

async function runAiSummarize() {
  if (aiSummaryInflight) return;
  const btn = document.getElementById("btn-ai-summarize");
  // 仅对非噪声、当前筛选下的通知做 AI 重写
  const candidates = getFilteredNotifications().filter((n) => !n.isNoise);
  if (candidates.length === 0) {
    setAiSummaryStatus("当前筛选下没有可摘要的通知。", "warn");
    return;
  }
  const items = candidates.slice(0, 20).map((n) => ({
    id: n.id,
    source_label: n.sourceLabel || "",
    title: n.title || "",
    body: n.body || "",
  }));

  aiSummaryInflight = true;
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = "Qwen 生成中…";
  setAiSummaryStatus(`正在让 Qwen 重写 ${items.length} 条摘要…`, "info");

  try {
    const res = await fetch(`${LLM_API_BASE}/api/summarize_batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = detailFromErrorPayload(data);
      const hint = res.status === 503 ? "（模型尚未加载完成，请稍候再试）" : "";
      setAiSummaryStatus(`生成失败：${msg}${hint}`, "error");
      return;
    }
    const list = Array.isArray(data.summaries) ? data.summaries : [];
    let okCount = 0;
    let failCount = 0;
    list.forEach((entry) => {
      if (entry && entry.summary) {
        aiSummaryCache[entry.id] = entry.summary;
        okCount++;
      } else {
        failCount++;
      }
    });
    refreshDigestAndPreview();
    if (okCount === 0) {
      setAiSummaryStatus("Qwen 未生成有效摘要，已保留原文案。", "warn");
    } else if (failCount === 0) {
      setAiSummaryStatus(`已用 Qwen 重写 ${okCount} 条摘要。`, "ok");
    } else {
      setAiSummaryStatus(`成功 ${okCount} 条，失败 ${failCount} 条；失败项保留原文案。`, "warn");
    }
  } catch (e) {
    const msg = e instanceof TypeError && String(e.message || "").includes("fetch")
      ? "无法连接本地接口，请确认「启动演示.bat」黑窗口仍在运行。"
      : String(e && e.message ? e.message : e);
    setAiSummaryStatus(`生成失败：${msg}`, "error");
  } finally {
    aiSummaryInflight = false;
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function bindAiSummarize() {
  const btn = document.getElementById("btn-ai-summarize");
  if (!btn) return;
  btn.addEventListener("click", runAiSummarize);
}

function appendBackendModelStatus() {
  if (!LLM_API_BASE) return;

  let loadingHintShown = false;

  const showReady = (h) => {
    appendWxTime();
    const isLocal = /[\\/]models[\\/]Qwen2-(?:0\.5|1\.5)B-Instruct/i.test(String(h.model || ""));
    const envNote =
      typeof h.llm_env_override_note === "string" && h.llm_env_override_note
        ? `\n\n【说明】${h.llm_env_override_note}`
        : "";
    const badEnv =
      h.env_LLM_MODEL && /minigpt|\.pt$/i.test(String(h.env_LLM_MODEL))
        ? `\n\n（系统里仍设置 LLM_MODEL=${h.env_LLM_MODEL}，已按上面说明处理）`
        : "";
    appendWxMessage(
      "ai",
      `Qwen 已接入。\n当前模型路径：\n${h.model}\n${isLocal ? "（本地 models 文件夹）" : ""}${envNote}${badEnv}\n\n对话将由此模型生成。请用「启动演示.bat」保持黑色窗口运行，勿单独双击 html。`,
      { preLine: true }
    );
  };

  const showFailed = (h) => {
    appendWxTime();
    const detail =
      typeof h.error === "string" && h.error.trim()
        ? h.error
        : "未返回具体错误。常见原因：重复双击了「启动演示.bat」，5055 端口已被旧的黑色窗口占用，新窗口绑定失败；请先关掉多余的命令行窗口，只保留一个服务。";
    appendWxMessage(
      "ai",
      `【Qwen 未加载成功】${detail}\n\n请查看启动窗口是否有 WinError 10048（端口占用）或 [LLM] Load failed；确认仅运行一个演示窗口；models\\Qwen2-1.5B-Instruct 完整；必要时检查网络以下载权重。`,
      { preLine: true }
    );
  };

  const poll = (attempt) => {
    fetch(`${LLM_API_BASE}/api/health`)
      .then((r) => r.json())
      .then((h) => {
        const foreign =
          h &&
          typeof h.backend === "string" &&
          h.backend !== "transformers" &&
          !Object.prototype.hasOwnProperty.call(h, "model_loading");
        if (foreign) {
          appendWxTime();
          appendWxMessage(
            "ai",
            `【当前不是 Qwen 后端】接口返回 backend="${h.backend}"，与本项目所需的 HuggingFace Qwen2 不一致。\n\n5055 端口很可能被其它程序占用（例如旧的 MiniGPT 演示）。请先关闭占用该端口的 python 黑色窗口，或在任务管理器中结束对应进程，再双击项目里的「启动演示.bat」启动正确服务。`,
            { preLine: true }
          );
          return;
        }
        if (h.model_loading && attempt < 120) {
          if (!loadingHintShown) {
            loadingHintShown = true;
            appendWxTime();
            appendWxMessage(
              "ai",
              "正在后台加载 Qwen 模型，加载完成后即可使用 AI 对话（请勿关闭启动脚本的黑窗口；首次下载约 3GB 需较长时间）。",
              { preLine: true }
            );
          }
          setTimeout(() => poll(attempt + 1), 2000);
          return;
        }
        if (h.ok && h.model_loaded) {
          showReady(h);
          return;
        }
        showFailed(h);
      })
      .catch(() => {
        appendWxTime();
        appendWxMessage(
          "ai",
          "【无法连接后端】请先双击「启动演示.bat」，在浏览器打开 http://127.0.0.1:5055/ （勿用 file:// 打开本地 html）。",
          { preLine: true }
        );
      });
  };

  poll(0);
}

function init() {
  initDatetimeDefaults();
  renderMockPanels();
  bindNav();
  bindSettings();
  bindSourcesEditing();
  initWxChatShell();
  appendBackendModelStatus();
  bindWechatChat();
  bindSimulatePush();
  bindAiSummarize();
  renderPreviewPush();
}

init();
