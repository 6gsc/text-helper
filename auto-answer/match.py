# language: Python, module: match, target: 题目归一化/哈希/缓存（与 content.js 中 normalizeText 算法严格一致）
import hashlib
import json
import os
import re
import threading

# CJK 与常见全角标点保留语义，仅去掉空白和装饰符号
_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[，。、；：？！“”‘’（）【】《》,.\;:?!\"'()\[\]<>【】·…—\-_~`]+")
_QNUM = re.compile(r"^[\(\（\[【]?\d{1,3}[\)）\]】\.、,，:：]\s*")


def normalize_text(text: str) -> str:
    """去空白/标点/题号，全角字母数字转半角，小写。JS 侧同款实现。"""
    if not text:
        return ""
    # 全角 -> 半角 (U+FF01..U+FF5E)
    out = []
    for ch in text:
        code = ord(ch)
        if 0xFF01 <= code <= 0xFF5E:
            code -= 0xFEE0
        out.append(chr(code))
    t = "".join(out).lower()
    t = _WS.sub("", t)
    # 反复剥题号前缀（如 "1." "（12）" "3、"）
    for _ in range(3):
        t = _QNUM.sub("", t, count=1)
    t = _PUNCT.sub("", t)
    return t


def question_hash(text: str) -> str:
    return hashlib.md5(normalize_text(text).encode("utf-8")).hexdigest()


class AnswerCache:
    """questionHash -> {questionText, answer, confidence, ts}，进程内 + 磁盘持久化。"""

    def __init__(self, path: str):
        self.path = path
        self.lock = threading.Lock()
        self.data = {}
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    self.data = json.load(f)
            except Exception:
                self.data = {}

    def get(self, qhash: str):
        with self.lock:
            return self.data.get(qhash)

    def put(self, qhash: str, entry: dict):
        with self.lock:
            self.data[qhash] = entry
            try:
                with open(self.path, "w", encoding="utf-8") as f:
                    json.dump(self.data, f, ensure_ascii=False, indent=1)
            except Exception:
                pass
