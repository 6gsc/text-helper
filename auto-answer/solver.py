# language: Python, module: solver, target: 截图 -> OCR/视觉LLM -> 题目文本+答案+置信度
"""两条路径：
1. 本地 PaddleOCR 提取题目文本 -> 文本 LLM 作答（ocr.use_local=true 时）
2. 直接把截图发视觉 LLM，让模型同时返回题目文本与答案（默认路径）
返回 dict: {question, answer, confidence, source}；失败返回 None。
"""
import base64
import json
import re

import requests

SYSTEM_PROMPT = (
    "你是答题助手。识别截图中的题目并作答。只输出 JSON："
    '{"question": "题目原文（含选项）", "answer": "最终答案（选择题只给选项字母，填空/简答给完整答案）", '
    '"confidence": 0到1的小数, "is_question": true/false}。'
    "若截图中没有题目，is_question 为 false，answer 为空。不要输出其他内容。"
)

JSON_RE = re.compile(r"\{.*\}", re.S)
LOW_CONF = 0.75


def _b64_png(arr) -> str:
    from PIL import Image
    import io
    img = Image.fromarray(arr)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _ask_llm(cfg, messages) -> dict | None:
    body = {
        "model": cfg["model"],
        "messages": messages,
        "temperature": cfg.get("temperature", 0),
    }
    try:
        r = requests.post(
            cfg["base_url"],
            headers={"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"},
            json=body, timeout=cfg.get("timeout_seconds", 30))
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
        m = JSON_RE.search(content)
        if not m:
            return None
        return json.loads(m.group(0))
    except Exception as e:
        print(f"[solver] LLM 调用失败: {e}")
        return None


def solve_vision(arr, llm_cfg) -> dict | None:
    """截图直接给视觉模型。"""
    b64 = _b64_png(arr)
    data = _ask_llm(llm_cfg, [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": [
            {"type": "text", "text": "识别并解答这张截图中的题目。"},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
        ]},
    ])
    if not data or not data.get("is_question") or not data.get("answer"):
        return None
    try:
        conf = float(data.get("confidence", 0))
    except (TypeError, ValueError):
        conf = 0.0
    return {"question": data["question"], "answer": str(data["answer"]).strip(),
            "confidence": conf, "source": "vision-llm"}


def solve_local_ocr(arr, llm_cfg) -> dict | None:
    """PaddleOCR 提取文本 -> 文本 LLM 作答。paddleocr 未安装返回 None。"""
    try:
        from paddleocr import PaddleOCR
    except ImportError:
        return None
    global _ocr
    try:
        _ocr
    except NameError:
        _ocr = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
    result = _ocr.ocr(arr, cls=True)
    lines = []
    scores = []
    for page in result or []:
        for box, (txt, score) in page:
            lines.append(txt)
            scores.append(score)
    text = "\n".join(lines)
    if len(text.strip()) < 4:
        return None
    ocr_conf = sum(scores) / len(scores) if scores else 0.0
    data = _ask_llm(llm_cfg, [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"解答以下题目：\n{text}"},
    ])
    if not data or not data.get("is_question") or not data.get("answer"):
        return None
    try:
        conf = min(ocr_conf, float(data.get("confidence", 0)))
    except (TypeError, ValueError):
        conf = ocr_conf
    return {"question": data["question"] or text, "answer": str(data["answer"]).strip(),
            "confidence": conf, "source": "local-ocr"}


def solve(arr, cfg) -> dict | None:
    """主入口：按配置选择路径，失败自动落到另一条。"""
    if cfg.get("ocr", {}).get("use_local"):
        r = solve_local_ocr(arr, cfg["llm"]) or solve_vision(arr, cfg["llm"])
    else:
        r = solve_vision(arr, cfg["llm"]) or solve_local_ocr(arr, cfg["llm"])
    if r:
        r["low_confidence"] = r["confidence"] < LOW_CONF
    return r
