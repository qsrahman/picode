#!/usr/bin/env python3
"""End-to-end live test for pcode.

Drives the real CLI against a live model (config from `pcode.json`, key from
`.env`) and asserts the CLI output/aesthetics hold together: tool status lines,
LLM streaming, and permission prompts don't clobber each other, and exit codes
track policy decisions.

The model-dependent REPL flows run under a pseudo-terminal via `script`
(macOS/Linux), because the status-line rendering, approval prompt, and banner
are gated on `process.stdout.isTTY`. A PTY spawned directly from Python hangs
Node's readline on this platform (a `tcsetattr` block), so we let `script`
own the pty and feed it over a real pipe instead.

Usage:
    python3 scripts/live-e2e.py            # all scenarios
    python3 scripts/live-e2e.py --quick    # skip model-dependent REPL flows
    python3 scripts/live-e2e.py --keep     # keep .live/ transcripts

Transcripts are written to `.live/<scenario>.txt` for eyeballing.
"""
from __future__ import annotations

import argparse
import os
import re
import select
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE_DIR = os.path.join(ROOT, ".live")

PASS = 0
FAIL = 0


def check(name: str, cond: bool, extra: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {extra}")


def banner(title: str) -> None:
    print("=" * 70)
    print(title)


def run(cmd, stdin=b"", env_extra=None):
    env = None
    if env_extra:
        env = {**os.environ, **env_extra}
    p = subprocess.run(
        cmd,
        input=stdin,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=ROOT,
        env=env,
    )
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def run_oneshot(prompt: str, *flags: str):
    """One-shot mode requires the prompt as a positional argument (stdin would
    be interpreted as REPL input and never trigger the exit-2 denial path)."""
    return run(["node", "--env-file=.env", "src/index.ts", *flags, prompt])


class Pty:
    """Drives the CLI under `script` (real PTY) over a real pipe."""

    def __init__(self, extra=None, no_color=True):
        cmd = ["script", "-q", "/dev/null", "node", "--env-file=.env", "src/index.ts"]
        if no_color:
            cmd.append("--no-color")
        if extra:
            cmd += extra
        self.p = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=ROOT,
        )
        self.fd = self.p.stdout.fileno()
        self.buf = b""

    def _drain(self):
        while True:
            r, _, _ = select.select([self.fd], [], [], 0)
            if not r:
                break
            try:
                chunk = os.read(self.fd, 65536)
            except OSError:
                break
            if not chunk:
                break
            self.buf += chunk

    def wait_for(self, s: str, t: float) -> bool:
        end = time.time() + t
        while time.time() < end:
            self._drain()
            if s.encode() in self.buf:
                return True
            time.sleep(0.1)
        return False

    def wait_n(self, s: str, n: int, t: float) -> bool:
        end = time.time() + t
        while time.time() < end:
            self._drain()
            if self.buf.count(s.encode()) >= n:
                return True
            time.sleep(0.1)
        return False

    def send(self, s: str) -> None:
        self.p.stdin.write(s.encode() + b"\n")
        self.p.stdin.flush()

    def text(self) -> str:
        self._drain()
        return self.buf.decode("utf-8", "replace")

    def close(self, t: float = 8) -> int:
        try:
            rc = self.p.wait(timeout=t)
        except subprocess.TimeoutExpired:
            self.p.kill()
            rc = self.p.wait()
        try:
            self.p.stdin.close()
        except Exception:
            pass
        return rc


def save(name: str, txt: str) -> None:
    os.makedirs(LIVE_DIR, exist_ok=True)
    with open(os.path.join(LIVE_DIR, name), "w") as f:
        f.write(repr(txt))


# ---------------------------------------------------------------------------
# Non-TTY scenarios
# ---------------------------------------------------------------------------
def non_tty() -> None:
    banner("Non-TTY: version, help, one-shot, piped REPL")

    rc, out, err = run(["node", "--env-file=.env", "src/index.ts", "--version"])
    check("version", rc == 0 and re.search(r"pcode \d+\.\d+\.\d+", out), f"rc={rc} out={out!r}")

    rc, out, err = run(["node", "--env-file=.env", "src/index.ts", "--help"])
    check(
        "help lists flags",
        rc == 0
        and "--no-stream" in out
        and "--verbose" in out
        and "--no-color" in out,
        f"rc={rc}",
    )

    # One-shot, auto, streamed tool use — exit 0, no cursor/ANSI in a pipe.
    rc, out, err = run_oneshot("Use the list_dir tool to list the current directory.", "--no-color", "--yes")
    check("one-shot auto tool use", rc == 0, f"rc={rc}")
    check("one-shot lists repo files", "pcode.json" in out, out[:200])
    check("one-shot pipe has no ANSI", "\x1b[" not in out, repr(out[:80]))
    check("one-shot pipe has no CR", "\r" not in out)

    # One-shot deny rule — exit 2.
    rc, out, err = run_oneshot("Use the read_file tool to read the file .env", "--no-color")
    check("one-shot deny exit 2", rc == 2, f"rc={rc}")
    check("one-shot deny refusal text", "denied" in out.lower() or "not" in out.lower(), out[:120])

    # Piped REPL must not print the interactive prompt.
    rc, out, err = run(
        ["node", "--env-file=.env", "src/index.ts", "--no-color"],
        stdin="Use the list_dir tool to list the current directory.\n/exit\n".encode(),
    )
    check("piped REPL exit 0", rc == 0, f"rc={rc}")
    check("piped REPL no prompt pollution", "Ask anything" not in out and not out.startswith("> "), repr(out[:60]))
    check("piped REPL no ANSI/CR", "\x1b[" not in out and "\r" not in out)

    # --no-stream one-shot — single buffered block.
    rc, out, err = run_oneshot("Use the list_dir tool to list the current directory.", "--no-color", "--yes", "--no-stream")
    check("no-stream one-shot", rc == 0 and "pcode.json" in out, f"rc={rc}")

    # Plan-mode one-shot deny — tool hidden, exit 2.
    rc, out, err = run_oneshot("Use the run_command tool to run the exact shell command: date", "--no-color", "--plan")
    check("plan-mode one-shot deny exit 2", rc == 2, f"rc={rc}")


# ---------------------------------------------------------------------------
# PTY (interactive) scenarios
# ---------------------------------------------------------------------------
def pty_flows() -> None:
    banner("PTY: allow / ask / deny / n / commands / color")

    # Allow path
    s = Pty()
    check("banner", s.wait_for("pcode · gemma4:cloud · interactive", 8))
    check("prompt", s.wait_for("Ask anything, /help for commands", 8))
    s.send("Use the list_dir tool to list the current directory.")
    check("running status", s.wait_for("› list_dir: . 0.0s", 120))
    check("settled status", s.wait_for("✓ done", 30))
    check("turn completes (next prompt)", s.wait_n("\x1b[1G\x1b[0JAsk anything", 2, 60))
    s.send("/exit")
    rc = s.close()
    txt = s.text()
    check("allow: exit 0", rc == 0, f"rc={rc}")
    check(
        "allow: exactly one settled status line",
        len(re.findall(r"› list_dir: \. ✓ done \(\d+\.\ds\)", txt)) == 1,
        txt,
    )
    check("allow: blank line before model text", bool(re.search(r"✓ done \(\d+\.\ds\)\r\n\r\n", txt)), txt)
    save("pty_allow.txt", txt)

    # Ask path (answer y)
    s = Pty()
    s.wait_for("Ask anything", 8)
    s.send("Use the run_command tool to run the exact shell command: date")
    check("ask: prompt shown", s.wait_for("Run? (y/n/a)", 120))
    check("ask: pattern preview", "approves: Bash(date)" in s.text())
    s.send("y")
    check("ask: settled after y", s.wait_for("✓ done", 30))
    s.wait_n("2026", 1, 30)
    s.send("/exit")
    rc = s.close()
    txt = s.text()
    check("ask: exit 0", rc == 0, f"rc={rc}")
    check(
        "ask: exactly one settled shell status",
        len(re.findall(r"› shell: date ✓ done \(\d+\.\ds\)", txt)) == 1,
        txt,
    )
    check("ask: 4-line erase", txt.count("\x1b[1A\r\x1b[2K") == 4, txt)
    save("pty_ask.txt", txt)

    # Deny rule
    s = Pty()
    s.wait_for("Ask anything", 8)
    s.send("Use the read_file tool to read the file .env")
    check("deny: denied line", s.wait_for("✗ denied (rule Read(.env))", 120))
    s.wait_for("not", 30)
    s.send("/exit")
    rc = s.close()
    txt = s.text()
    check("deny: exit 0", rc == 0, f"rc={rc}")
    check("deny: model continues", bool(re.search(r"✗ denied[^\n]*\n.{20,}", txt)), txt)
    save("pty_deny.txt", txt)

    # n answer
    s = Pty()
    s.wait_for("Ask anything", 8)
    s.send("Use the run_command tool to run the exact shell command: uname -s")
    check("n: prompt shown", s.wait_for("Run? (y/n/a)", 120))
    s.send("n")
    check("n: denied status", s.wait_for("✗ denied", 15))
    s.send("/exit")
    rc = s.close()
    txt = s.text()
    check("n: exit 0", rc == 0, f"rc={rc}")
    save("pty_no.txt", txt)

    # Slash commands + mode indicator
    s = Pty()
    s.wait_for("Ask anything", 8)
    s.send("/tools")
    s.wait_for("git_status", 5)
    t = s.text()
    check("/tools lists tools", "run_command" in t and "read_file" in t and "ask" in t and "allow" in t)
    s.send("/model")
    s.wait_for("model:", 5)
    check("/model", "model: gemma4:cloud" in s.text())
    s.send("/mode plan")
    s.wait_for("mode: plan", 5)
    check("plan mode set", "mode: plan" in s.text())
    s.send("/tools")
    s.wait_for("git_status", 5)
    check("prompt shows [plan]", "[plan]" in s.text())
    s.send("/mode interactive")
    s.wait_for("mode: interactive", 5)
    s.send("/exit")
    rc = s.close()
    check("commands: exit 0", rc == 0, f"rc={rc}")
    save("pty_commands.txt", s.text())

    # Color run
    s = Pty(no_color=False)
    s.wait_for("Ask anything", 8)
    s.send("/exit")
    rc = s.close()
    txt = s.text()
    check("color: ANSI present", "\x1b[" in txt, txt[:80])
    check("color: green prompt", "\x1b[32m" in txt, txt[:80])
    check("color: banner colored", "\x1b[34m" in txt, txt[:80])
    check("color: exit 0", rc == 0, f"rc={rc}")
    save("pty_color.txt", txt)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="skip model-dependent PTY flows")
    ap.add_argument("--keep", action="store_true", help="keep .live/ transcripts")
    args = ap.parse_args()

    non_tty()
    if not args.quick:
        pty_flows()

    print()
    print(f"RESULT: {PASS} passed, {FAIL} failed")
    if not args.keep:
        import shutil

        shutil.rmtree(LIVE_DIR, ignore_errors=True)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
