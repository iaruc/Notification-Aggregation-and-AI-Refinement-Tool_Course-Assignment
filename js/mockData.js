/**
 * 模拟多源通知数据(全部虚构,用于界面演示)。
 * source: wechat | qq | chaoxing | email | sms
 * isNoise: 被 AI 标记为可过滤
 *
 * 这里的列表对外是「可变」的:用户在「数据源」面板可增删改,
 * 改动通过 localStorage 持久化(刷新页面不丢);也提供「重置为默认」。
 */
(function () {
  const STORAGE_KEY = "xx-data-sources-v1";

  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");

  function at(h, min) {
    return `${y}-${m}-${d}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
  }

  const SEED = [
    {
      id: "n1",
      source: "wechat",
      sourceLabel: "微信群",
      sentAt: at(8, 5),
      title: "《操作系统》第 8 周作业",
      body: "请大家本周五 18:00 前在平台提交实验三报告,迟交按规则扣分。",
      from: "助教-小张",
      isNoise: false,
    },
    {
      id: "n2",
      source: "wechat",
      sourceLabel: "微信群",
      sentAt: at(9, 40),
      title: "拼单奶茶",
      body: "下午有人一起点喜茶吗?满减差一人~",
      from: "同学A",
      isNoise: true,
    },
    {
      id: "n3",
      source: "qq",
      sourceLabel: "QQ 群",
      sentAt: at(10, 12),
      title: "综测材料收集",
      body: "团委:请各位团支书周三前收齐社会实践登记表电子版发到邮箱 shetuan@univ.edu.cn",
      from: "组织部",
      isNoise: false,
    },
    {
      id: "n4",
      source: "qq",
      sourceLabel: "QQ 群",
      sentAt: at(11, 20),
      title: "游戏开黑",
      body: "晚上无畏契约有人来吗 缺两个",
      from: "室友",
      isNoise: true,
    },
    {
      id: "n5",
      source: "chaoxing",
      sourceLabel: "学习通",
      sentAt: at(13, 30),
      title: "《数据结构》直播即将开始",
      body: "今日 14:00 章节测验开放,时长 45 分钟,请准时参加。",
      from: "王老师",
      isNoise: false,
    },
    {
      id: "n6",
      source: "chaoxing",
      sourceLabel: "学习通",
      sentAt: at(14, 5),
      title: "课程资料更新",
      body: "第五章课件已上传,请预习红黑树部分。",
      from: "王老师",
      isNoise: false,
    },
    {
      id: "n7",
      source: "email",
      sourceLabel: "邮件",
      sentAt: at(15, 0),
      title: "[教务] 选课结果公示",
      body: "同学你好:你本学期选修《信息安全导论》已成功,请于开学两周内登录教务系统确认。",
      from: "教务处",
      isNoise: false,
    },
    {
      id: "n8",
      source: "email",
      sourceLabel: "邮件",
      sentAt: at(16, 22),
      title: "校园招聘宣讲会",
      body: "某某科技 下周三 19:00 图书馆报告厅,现场接收简历。感兴趣的同学欢迎参加。(此为推广邮件可忽略)",
      from: "就业中心",
      isNoise: true,
    },
    {
      id: "n9",
      source: "sms",
      sourceLabel: "短信",
      sentAt: at(17, 8),
      title: "快递到达",
      body: "【菜鸟驿站】您有一个包裹已到南门驿站,取件码 8-2-3014。",
      from: "1069xxxx",
      isNoise: false,
    },
    {
      id: "n10",
      source: "sms",
      sourceLabel: "短信",
      sentAt: at(18, 45),
      title: "话费账单",
      body: "您本月账单已出,回复 TD 退订营销短信。",
      from: "10086",
      isNoise: true,
    },
  ];

  const SOURCE_LABELS = {
    wechat: "微信群",
    qq: "QQ 群",
    chaoxing: "学习通",
    email: "邮件",
    sms: "短信",
  };

  const VALID_KEYS = new Set([
    "id",
    "source",
    "sourceLabel",
    "sentAt",
    "title",
    "body",
    "from",
    "isNoise",
  ]);

  function clone(arr) {
    return arr.map((n) => ({ ...n }));
  }

  function sanitize(n) {
    const out = {};
    for (const k of Object.keys(n)) {
      if (VALID_KEYS.has(k)) out[k] = n[k];
    }
    if (!out.id || typeof out.id !== "string") return null;
    if (!SOURCE_LABELS[out.source]) return null;
    out.sourceLabel = SOURCE_LABELS[out.source];
    out.title = String(out.title || "").slice(0, 200);
    out.body = String(out.body || "").slice(0, 2000);
    out.from = String(out.from || "").slice(0, 60);
    out.sentAt = String(out.sentAt || "");
    out.isNoise = !!out.isNoise;
    return out;
  }

  function loadFromStorage() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const cleaned = parsed.map(sanitize).filter(Boolean);
      return cleaned;
    } catch (_e) {
      return null;
    }
  }

  function saveToStorage(arr) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch (_e) {
      /* 配额或私密模式失败时静默忽略 */
    }
  }

  // 用户自定义优先,否则用种子数据。注意:rawNotifications 是同一个数组引用,
  // 后续只在原地 splice/push,保证 app.js 通过解构得到的引用始终最新。
  const initial = loadFromStorage();
  const rawNotifications = initial && initial.length ? initial : clone(SEED);

  function persist() {
    saveToStorage(rawNotifications);
  }

  function findIndex(id) {
    return rawNotifications.findIndex((n) => n.id === id);
  }

  function nextId() {
    return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  function addNotification(source) {
    if (!SOURCE_LABELS[source]) return null;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const sentAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
    const item = sanitize({
      id: nextId(),
      source,
      sourceLabel: SOURCE_LABELS[source],
      sentAt,
      title: "新通知标题",
      body: "在这里输入通知正文……",
      from: "新发送方",
      isNoise: false,
    });
    rawNotifications.push(item);
    persist();
    return item;
  }

  function updateNotification(id, patch) {
    const i = findIndex(id);
    if (i < 0) return null;
    const merged = sanitize({ ...rawNotifications[i], ...patch, id });
    if (!merged) return null;
    rawNotifications[i] = merged;
    persist();
    return merged;
  }

  function deleteNotification(id) {
    const i = findIndex(id);
    if (i < 0) return false;
    rawNotifications.splice(i, 1);
    persist();
    return true;
  }

  function resetToDefaults() {
    rawNotifications.splice(0, rawNotifications.length, ...clone(SEED));
    persist();
  }

  /** AI 风格的一句话摘要(演示用,非真实模型) */
  function summarize(n) {
    if (n.isNoise) return null;
    const snippets = {
      n1: "操作系统实验三报告周五 18:00 前提交。",
      n3: "社会实践登记表周三前发至团委邮箱。",
      n5: "数据结构今日 14:00 章节测验,限时 45 分钟。",
      n6: "数据结构第五章课件已上传,需预习红黑树。",
      n7: "选修《信息安全导论》已选中,两周内教务确认。",
      n9: "快递已到南门驿站,取件码 8-2-3014。",
    };
    return snippets[n.id] || `${n.title}:${n.body.slice(0, 42)}…`;
  }

  window.MockData = {
    rawNotifications,
    summarize,
    addNotification,
    updateNotification,
    deleteNotification,
    resetToDefaults,
    SOURCE_LABELS,
  };
})();
