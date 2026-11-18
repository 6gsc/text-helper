# language: Python, module: helper, target: Windows 10/11 — 本地 WebSocket 服务 + 定时截图识题循环
"""运行： python helper.py
- ws://127.0.0.1:8765，仅本机回环；Chrome 插件 background.js 作为客户端连入。
- 定时 mss 截屏 -> solver -> match 缓存 -> 推送答案给插件（页内写剪贴板/回填）。
- 前台窗口检查为只读 GetForegroundWindow，不激活、不移动鼠标，零焦点干扰。
"""
import asyncio
import ctypes
import ctypes.wintypes as wt
import json
import sys
import time

import websockets

import capture
import match
import solver

CLIENTS = set()
PAUSED = False  # 全局暂停开关（可由快捷键置位）


def load_config() -> dict:
    with open("config.json", "r", encoding="utf-8") as f:
        return json.load(f)


# ---------- 前台进程检查（只读，不改焦点） ----------
def foreground_process_name() -> str:
    if sys.platform != "win32":
        return "debug"
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return ""
    pid = wt.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
    if not h:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(512)
        size = wt.DWORD(512)
        if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            return buf.value.rsplit("\\", 1)[-1].rsplit(".", 1)[0].lower()
    finally:
        kernel32.CloseHandle(h)
    return ""


def browser_in_foreground(cfg) -> bool:
    if not cfg.get("require_foreground"):
        return True
    name = foreground_process_name()
    return any(b in name for b in cfg.get("foreground_browsers", []))


# ---------- WebSocket 服务 ----------
async def ws_handler(ws):
    CLIENTS.add(ws)
    print(f"[helper] 插件已连接（当前 {len(CLIENTS)} 个客户端）")
    try:
        async for _ in ws:
            pass  # 插件目前不发送消息，预留：暂停/取题指令
    except websockets.ConnectionClosed:
        pass
    finally:
        CLIENTS.discard(ws)
        print(f"[helper] 插件断开（剩余 {len(CLIENTS)}）")


async def broadcast(payload: dict):
    if not CLIENTS:
        return
    msg = json.dumps(payload, ensure_ascii=False)
    results = await asyncio.gather(
        *(c.send(msg) for c in list(CLIENTS)), return_exceptions=True)
    for r in results:
        if isinstance(r, Exception):
            print(f"[helper] 发送失败: {r}")


# ---------- 主循环 ----------
async def answer_loop(cfg):
    cache = match.AnswerCache(cfg.get("cache_path", "answer_cache.json"))
    interval = max(5, int(cfg.get("interval_seconds", 20)))
    print(f"[helper] 定时识别启动，间隔 {interval}s，autofill={cfg.get('autofill')}")
    while True:
        try:
            if not PAUSED and browser_in_foreground(cfg):
                arr = capture.grab(cfg.get("monitor_index", 1), cfg.get("region"))
                result = solver.solve(arr, cfg)
                if result:
                    qhash = match.question_hash(result["question"])
                    cached = cache.get(qhash)
                    if cached:
                        answer = cached["answer"]
                        low = cached.get("low_confidence", False)
                        print(f"[helper] 缓存命中 {qhash[:8]}")
                    else:
                        answer = result["answer"]
                        low = result["low_confidence"]
                        cache.put(qhash, {
                            "questionText": result["question"],
                            "answer": answer,
                            "low_confidence": low,
                            "ts": time.time(),
                        })
                        print(f"[helper] 新题 {qhash[:8]} conf={result['confidence']:.2f} "
                              f"answer={answer[:40]}")
                    await broadcast({
                        "type": "answer",
                        "questionHash": qhash,
                        "questionText": result["question"],
                        "answer": answer,
                        "lowConfidence": low,
                        "autofill": bool(cfg.get("autofill")) and not low,
                    })
                # 无题/识别失败：静默跳过本轮（兜底：不覆盖剪贴板）
        except Exception as e:
            print(f"[helper] 本轮异常（跳过）: {e}")
        await asyncio.sleep(interval)


async def main():
    cfg = load_config()
    server = await websockets.serve(
        ws_handler, cfg.get("ws_host", "127.0.0.1"), int(cfg.get("ws_port", 8765)))
    print(f"[helper] WebSocket 监听 ws://{cfg.get('ws_host','127.0.0.1')}:{cfg.get('ws_port',8765)}")
    await asyncio.gather(server.wait_closed(), answer_loop(cfg))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[helper] 已退出")
