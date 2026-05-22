"""
端口选择助手:供「启动演示.bat」调用。

行为:
  1) 从 5055 开始,逐个尝试 bind 127.0.0.1:<port>
  2) 5055 被占用时,识别占用方:
     - 命令行含 app.py / app:app / uvicorn 且路径含 backend / 本项目 backend 目录
       -> 视为本项目残留进程,taskkill /F 后重试 5055
     - 否则视为外部进程(代理软件、其它服务等),不动它,改用下一个端口
  3) 找到第一个能 bind 成功的端口后,只把端口号(纯数字)输出到 stdout 供 bat
     用 `for /f` 读取;其它日志全部走 stderr,避免污染管道。
  4) 5055..5070 全部都拿不下,退出码 1。

只用 Python 标准库,不引入新依赖。
"""

from __future__ import annotations

import socket
import subprocess
import sys
import time
from pathlib import Path

PORT_MIN = 5055
PORT_MAX = 5070

_BACKEND_DIR = str(Path(__file__).resolve().parent).lower()


def log(msg: str) -> None:
    print(f"[pick-port] {msg}", file=sys.stderr, flush=True)


def can_bind(port: int) -> bool:
    """探测 127.0.0.1:port 是否当前可以绑定(立即关闭)。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", port))
    except OSError:
        return False
    finally:
        try:
            s.close()
        except OSError:
            pass
    return True


def pid_listening_on(port: int) -> int | None:
    """从 netstat 输出里取出在 127.0.0.1:port 上 LISTENING 的 PID。"""
    try:
        out = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True,
            text=True,
            check=False,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    needle = f"127.0.0.1:{port}"
    for line in out.splitlines():
        if needle in line and "LISTENING" in line:
            parts = line.split()
            if parts and parts[-1].isdigit():
                return int(parts[-1])
    return None


def _process_commandline(pid: int) -> str:
    """通过 PowerShell + CIM 拿到指定 PID 的命令行(小写),失败返回空串。"""
    try:
        res = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                f"(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CommandLine",
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=8,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return (res.stdout or "").strip().lower()


def is_our_old_python(pid: int) -> bool:
    """判断 pid 是否本项目自身残留的 python(uvicorn + app:app/app.py)。

    本项目启动方式固定为 ``python -m uvicorn app:app --port <5055..5070>``,
    所以同时满足 python + uvicorn + (app:app 或 app.py) 即可视为本项目残留。
    工作目录无法从 Win32_Process 可靠取到,因此不强制要求命令行包含 "backend"。
    """
    cmdline = _process_commandline(pid)
    if not cmdline:
        return False
    if "python" not in cmdline:
        return False
    if "uvicorn" not in cmdline:
        return False
    if ("app:app" not in cmdline) and ("app.py" not in cmdline):
        return False
    # 路径若已包含本项目 backend 绝对路径,更进一步确认是自家(可选信号)
    _ = _BACKEND_DIR  # 留作日志/未来扩展
    return True


def kill_pid(pid: int) -> None:
    subprocess.run(
        ["taskkill", "/PID", str(pid), "/F"],
        capture_output=True,
        check=False,
    )


def pick_port() -> int | None:
    for port in range(PORT_MIN, PORT_MAX + 1):
        if can_bind(port):
            return port

        pid = pid_listening_on(port)
        if pid is not None and is_our_old_python(pid):
            log(f"port {port} occupied by our own old python (PID {pid}); killing it")
            kill_pid(pid)
            # 端口释放需要一点时间,最多等 ~3s
            for _ in range(6):
                time.sleep(0.5)
                if can_bind(port):
                    return port
            log(f"port {port} still busy after taskkill; trying next port")
        else:
            who = f"PID {pid}" if pid else "unknown process"
            log(f"port {port} occupied by {who} (not ours); trying next port")
    return None


def main() -> int:
    port = pick_port()
    if port is None:
        log(f"no free port available in {PORT_MIN}..{PORT_MAX}")
        return 1
    print(port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
