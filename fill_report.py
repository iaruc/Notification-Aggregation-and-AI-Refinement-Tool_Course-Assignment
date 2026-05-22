# -*- coding: utf-8 -*-
"""Fill sections in 期末实验报告 Word template."""
import os
import shutil
import sys

import win32com.client as win32

DESKTOP = r"C:\Users\13986\Desktop"
WD_COLLAPSE_END = 0

SECTIONS = [
    (
        "作品简介",
        "本作品为《学讯聚合》课程演示系统，面向大学生多渠道校园通知分散、噪音多的痛点。"
        "前端模拟微信、QQ、学习通、邮件与短信五类来源，支持按来源与时间筛选、本地增删改通知；"
        "后端以 FastAPI 加载本地 Qwen2-1.5B-Instruct，实现通知智能摘要与多轮对话。"
        "用户可预览定时推送并在模拟微信会话中查看摘要短信与 AI 问答，体现“聚合→精炼→推送”闭环。",
    ),
    (
        "作品设计",
        "系统采用前后端分离：前端单页（HTML/CSS/JS）含设置、数据源、微信&AI 三视图；"
        "mockData.js 维护通知并 localStorage 持久化；app.js 负责筛选与调用 /api/chat、/api/summarize_batch。"
        "后端 FastAPI 托管页面与 API，后台加载 Qwen2。流程：多源通知→过滤→摘要→模拟微信推送。"
        "双击启动演示.bat 即可运行。",
    ),
    (
        "实验步骤",
        "1. 双击启动演示.bat，等待依赖与模型加载。"
        "2. 打开 http://127.0.0.1:5055/ ，在设置页勾选来源，时间默认 2026/5/1 至今日。"
        "3. 在数据源页查看并编辑五类模拟通知。"
        "4. 在微信&AI 页执行 AI 智能摘要并模拟推送学讯日报。"
        "5. 与 AI 对话验证筛选与摘要上下文联动。",
    ),
    (
        "本人分工",
        "负责架构与前端（app.js、mockData.js、样式），实现筛选、摘要短信、本地存储与推送模拟；"
        "搭建 FastAPI+Qwen2 对话与批量摘要接口；编写启动脚本、演示数据与实验报告。",
    ),
    (
        "本人感悟",
        "体会到 LLM 适合在通知聚合后做精炼与问答；本地模型便于课堂演示与隐私保护；"
        "后续可接入真实消息源与微信推送。",
    ),
]


def resolve_paths():
    src = out = None
    for n in os.listdir(DESKTOP):
        if not n.endswith(".doc") or n.startswith("~$"):
            continue
        p = os.path.join(DESKTOP, n)
        if "\u7a7a\u767d" in n:
            src = p
        elif "\u5df2\u586b\u5199" in n:
            out = p
    if not src:
        raise FileNotFoundError("template not found")
    if not out:
        out = os.path.join(DESKTOP, "\u671f\u672b\u5b9e\u9a8c\u62a5\u544a(\u5df2\u586b\u5199).doc")
    return src, out


def all_paragraphs(doc):
    for i in range(1, doc.Paragraphs.Count + 1):
        yield i, doc.Paragraphs(i)
    for ti in range(1, doc.Tables.Count + 1):
        t = doc.Tables(ti)
        for ri in range(1, t.Rows.Count + 1):
            for ci in range(1, t.Columns.Count + 1):
                try:
                    cell = t.Cell(ri, ci)
                    for pi in range(1, cell.Range.Paragraphs.Count + 1):
                        yield None, cell.Range.Paragraphs(pi)
                except Exception:
                    pass


def fill_section(doc, keyword, body):
    indices = []
    for idx, p in all_paragraphs(doc):
        if keyword in (p.Range.Text or ""):
            indices.append((idx, p))
    if not indices:
        return False
    _, heading = indices[-1]
    r = heading.Range.Duplicate
    r.Collapse(WD_COLLAPSE_END)
    r.InsertAfter("\r" + body + "\r")
    r.Font.Name = "宋体"
    r.Font.Size = 12
    return True


def main():
    src, out = resolve_paths()
    shutil.copy2(src, out)
    word = win32.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    doc = word.Documents.Open(out, ReadOnly=False, AddToRecentFiles=False)
    done = 0
    try:
        for k, body in SECTIONS:
            if fill_section(doc, k, body):
                done += 1
                print("ok", k)
            else:
                print("miss", k, file=sys.stderr)
        doc.Save()
        print("saved", out, f"{done}/{len(SECTIONS)}")
    finally:
        doc.Close(False)
        word.Quit()
    return 0 if done == len(SECTIONS) else 1


if __name__ == "__main__":
    sys.exit(main())
