# language: Python, module: capture, target: Windows 10/11 (mss/GDI, 无焦点操作)
"""定时截屏：mss 走 GDI BitBlt，不激活窗口、不动鼠标。"""
import mss
import numpy as np


def grab(monitor_index: int = 1, region=None) -> np.ndarray:
    """返回 BGR? 不，mss 给 BGRA，转 RGB ndarray。region=(left, top, width, height)。"""
    with mss.mss() as sct:
        if region:
            left, top, width, height = region
            mon = {"left": left, "top": top, "width": width, "height": height}
        else:
            mon = sct.monitors[monitor_index]  # monitors[0] 是全桌面
        shot = sct.grab(mon)
        # BGRA -> RGB
        arr = np.asarray(shot)[:, :, :3][:, :, ::-1]
        return np.ascontiguousarray(arr)
