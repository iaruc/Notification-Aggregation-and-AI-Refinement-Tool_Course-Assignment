"""
FastAPI：静态网页 + 对话 API，使用 HuggingFace Transformers 加载 Qwen2（PyTorch）。

权重加载优先级:
  1) 环境变量 LLM_MODEL（本地路径或 Hub ID）
  2) 项目 models/ 下本地文件夹（优先 Qwen2-1.5B-Instruct，其次仍兼容 Qwen2-0.5B-Instruct）
  3) 从 Hub 在线拉取 Qwen/Qwen2-1.5B-Instruct

环境变量:
  LLM_MODEL   覆盖默认模型路径或 Hub ID（若仍指向已废弃的 minigpt.pt，将自动忽略）
  LLM_DEVICE  cpu 或 cuda
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
# 优先 1.5B；仍兼容仅下载过 0.5B 的旧目录
_LOCAL_MODEL_DIRS = [
    _PROJECT_ROOT / "models" / "Qwen2-1.5B-Instruct",
    _PROJECT_ROOT / "models" / "Qwen2-0.5B-Instruct",
]
_DEFAULT_HUB_ID = "Qwen/Qwen2-1.5B-Instruct"
_LOCAL_PRIMARY = _LOCAL_MODEL_DIRS[0]

_skipped_llm_env_reason: str | None = None


def _legacy_llm_env_should_skip(env: str) -> str | None:
    """旧版 MiniGPT 单文件 .pt 不是 HuggingFace 目录，应忽略 LLM_MODEL 并改用 models 下的 Qwen。"""
    raw = env.strip()
    if not raw:
        return None
    lower = raw.lower().replace("\\", "/")
    if lower.endswith(".pt") or lower.endswith(".pth"):
        return (
            "检测到环境变量 LLM_MODEL 指向 .pt/.pth 旧权重，已自动忽略。"
            "请在 Windows「系统属性 → 环境变量」中删除 LLM_MODEL，或改为项目内 models\\Qwen2-1.5B-Instruct。"
        )
    if "minigpt" in lower:
        return (
            "检测到环境变量 LLM_MODEL 含已废弃的 minigpt 路径，已自动忽略。"
            "请删除用户/系统中的 LLM_MODEL，或将 LLM_MODEL 设为 models\\Qwen2-1.5B-Instruct。"
        )
    return None


def get_model_path() -> str:
    """解析本次应加载的模型路径或 Hub ID。"""
    global _skipped_llm_env_reason
    _skipped_llm_env_reason = None
    env = os.environ.get("LLM_MODEL", "").strip()
    if env:
        skip_reason = _legacy_llm_env_should_skip(env)
        if skip_reason:
            _skipped_llm_env_reason = skip_reason
        else:
            return env
    for d in _LOCAL_MODEL_DIRS:
        if (d / "config.json").is_file():
            return str(d.resolve())
    return _DEFAULT_HUB_ID


DEVICE_STR = os.environ.get("LLM_DEVICE", "cpu")
DEVICE = torch.device(DEVICE_STR)

tokenizer: Any = None
model: Any = None
load_error: str | None = None
loaded_model_path: str = ""

SYSTEM_PREFIX = (
    "你是「学讯助手」，面向中国大学生，专门帮助理解和归纳校园通知、课程与教务信息。\n"
    "要求：使用简体中文；先抓住用户问题核心再作答；条理清晰，可分点；不确定时明确说明「通知里未提及」。\n"
    "避免空洞套话；回答尽量简短实用。"
)

SUMMARY_SYSTEM = (
    "你是通知摘要助手。请把给定的一条通知压缩成一句简体中文摘要：\n"
    "- 抓住「做什么 + 时间/地点 + 关键限制」三要素；\n"
    "- 不超过 30 个汉字，不要列表、不要前缀「摘要：」之类的字样；\n"
    "- 仅输出一句话本身，不要解释。"
)


def load_model() -> None:
    global tokenizer, model, load_error, loaded_model_path
    path = get_model_path()
    loaded_model_path = path
    print(f"[LLM] Loading Qwen from: {path}", flush=True)
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(path, trust_remote_code=True)
        if getattr(tokenizer, "pad_token", None) is None and getattr(tokenizer, "eos_token", None) is not None:
            tokenizer.pad_token = tokenizer.eos_token
        # 长 prompt 截断时优先丢弃左侧（system+早期历史），保留用户当前提问
        tokenizer.truncation_side = "left"
        dtype = torch.float16 if DEVICE_STR == "cuda" else torch.float32
        model = AutoModelForCausalLM.from_pretrained(
            path,
            torch_dtype=dtype,
            trust_remote_code=True,
            device_map=None,
            low_cpu_mem_usage=True,
        )
        model.to(DEVICE)
        model.eval()
        load_error = None
        print("[LLM] Qwen loaded and ready.", flush=True)
    except Exception as e:  # noqa: BLE001
        tokenizer = None
        model = None
        load_error = repr(e)
        print(f"[LLM] Load failed: {load_error}", flush=True)


app = FastAPI(title="学讯 LLM API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    # 后台加载模型，HTTP 立即就绪，避免首次下载大权重时长时间无法打开网页
    threading.Thread(target=load_model, daemon=True).start()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    digest_context: str = ""
    history: list[ChatMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    reply: str
    backend: str = "transformers"


class SummarizeItem(BaseModel):
    id: str = Field(..., min_length=1)
    source_label: str = ""
    title: str = ""
    body: str = Field(..., min_length=1)


class SummarizeRequest(BaseModel):
    items: list[SummarizeItem] = Field(..., min_length=1, max_length=20)


class SummaryEntry(BaseModel):
    id: str
    summary: str
    error: str | None = None


class SummarizeResponse(BaseModel):
    summaries: list[SummaryEntry]
    backend: str = "transformers"


@app.get("/api/health")
def health() -> dict[str, Any]:
    env_lm = os.environ.get("LLM_MODEL", "").strip() or None
    model_loaded = model is not None and tokenizer is not None
    # 后台线程加载中：load_error 仍为 None，但 model 尚未就绪，不能把 ok 当作 True
    model_loading = not model_loaded and load_error is None
    chat_ready = model_loaded and load_error is None
    return {
        "ok": chat_ready,
        "model_loaded": model_loaded,
        "model_loading": model_loading,
        "backend": "transformers",
        "model": loaded_model_path or get_model_path(),
        "local_folder": str(_LOCAL_PRIMARY),
        "local_candidates": [str(p) for p in _LOCAL_MODEL_DIRS],
        "error": load_error,
        "env_LLM_MODEL": env_lm,
        "llm_env_override_note": _skipped_llm_env_reason,
    }


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    if model is None or tokenizer is None:
        if load_error is None:
            raise HTTPException(
                status_code=503,
                detail="model still loading; retry in a few seconds",
            )
        raise HTTPException(status_code=503, detail=load_error or "model not loaded")

    system = SYSTEM_PREFIX
    dc = req.digest_context.strip()
    if dc:
        # 历史较长时给上下文让位，避免左侧截断把对话历史挤掉
        cap = 1500 if len(req.history) >= 6 else 3500
        if len(dc) > cap:
            dc = dc[:cap] + "\n…（摘要过长已截断）"
        system += "\n\n用户当前筛选下的通知摘要如下（仅供参考）：\n" + dc

    messages: list[dict[str, str]] = [{"role": "system", "content": system}]
    for h in req.history[-10:]:
        if h.role in ("user", "assistant") and h.content.strip():
            messages.append({"role": h.role, "content": h.content.strip()})
    messages.append({"role": "user", "content": req.message.strip()})

    try:
        prompt = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
    except Exception:  # noqa: BLE001
        prompt = system + "\n\n" + "\n".join(f"{m['role']}: {m['content']}" for m in messages[1:])

    # 超长时保留 prompt 末尾（含用户本轮提问），truncation_side 已在加载时设为 left
    inputs = tokenizer(
        prompt,
        return_tensors="pt",
        truncation=True,
        max_length=4096,
    )
    inputs = {k: v.to(DEVICE) for k, v in inputs.items()}

    pad_id = getattr(tokenizer, "pad_token_id", None) or getattr(tokenizer, "eos_token_id", None)
    eos_id = getattr(tokenizer, "eos_token_id", None)

    gen_kw: dict[str, Any] = {
        **inputs,
        "max_new_tokens": 512,
        "do_sample": True,
        "temperature": 0.75,
        "top_p": 0.88,
        "repetition_penalty": 1.08,
        "pad_token_id": pad_id,
    }
    if eos_id is not None:
        gen_kw["eos_token_id"] = eos_id

    with torch.no_grad():
        out = model.generate(**gen_kw)

    gen_ids = out[0][inputs["input_ids"].shape[1] :]
    reply = tokenizer.decode(gen_ids, skip_special_tokens=True).strip()
    if not reply:
        reply = "（模型未生成有效文本，请换种问法试试）"
    return ChatResponse(reply=reply, backend="transformers")


def _summarize_one(item: SummarizeItem) -> str:
    """单条通知 → 一句话中文摘要；调用方负责异常捕获。"""
    user_text = (
        f"通知来源：{item.source_label or '未知'}\n"
        f"标题：{item.title or '(无)'}\n"
        f"正文：{item.body.strip()}"
    )
    messages = [
        {"role": "system", "content": SUMMARY_SYSTEM},
        {"role": "user", "content": user_text},
    ]
    try:
        prompt = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
    except Exception:  # noqa: BLE001
        prompt = SUMMARY_SYSTEM + "\n\n" + user_text + "\n摘要："

    inputs = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=2048)
    inputs = {k: v.to(DEVICE) for k, v in inputs.items()}

    pad_id = getattr(tokenizer, "pad_token_id", None) or getattr(tokenizer, "eos_token_id", None)
    eos_id = getattr(tokenizer, "eos_token_id", None)

    gen_kw: dict[str, Any] = {
        **inputs,
        "max_new_tokens": 80,
        "do_sample": False,
        "repetition_penalty": 1.05,
        "pad_token_id": pad_id,
    }
    if eos_id is not None:
        gen_kw["eos_token_id"] = eos_id

    with torch.no_grad():
        out = model.generate(**gen_kw)
    gen_ids = out[0][inputs["input_ids"].shape[1] :]
    text = tokenizer.decode(gen_ids, skip_special_tokens=True).strip()
    # 模型偶尔会生成多行解释，仅保留首句；并去除常见前缀
    first_line = text.splitlines()[0].strip() if text else ""
    for prefix in ("摘要：", "摘要:", "总结：", "总结:"):
        if first_line.startswith(prefix):
            first_line = first_line[len(prefix) :].strip()
            break
    return first_line


@app.post("/api/summarize_batch", response_model=SummarizeResponse)
def summarize_batch(req: SummarizeRequest) -> SummarizeResponse:
    if model is None or tokenizer is None:
        if load_error is None:
            raise HTTPException(
                status_code=503,
                detail="model still loading; retry in a few seconds",
            )
        raise HTTPException(status_code=503, detail=load_error or "model not loaded")

    results: list[SummaryEntry] = []
    for item in req.items:
        try:
            summary = _summarize_one(item)
            if not summary:
                results.append(SummaryEntry(id=item.id, summary="", error="empty output"))
            else:
                results.append(SummaryEntry(id=item.id, summary=summary))
        except Exception as e:  # noqa: BLE001
            results.append(SummaryEntry(id=item.id, summary="", error=repr(e)))
    return SummarizeResponse(summaries=results, backend="transformers")


# 项目根目录：同一端口提供网页 + API
_SITE_ROOT = Path(__file__).resolve().parent.parent
app.mount("/", StaticFiles(directory=str(_SITE_ROOT), html=True), name="site")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "5055"))
    uvicorn.run("app:app", host="127.0.0.1", port=port, reload=False)
