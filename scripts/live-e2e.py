#!/usr/bin/env python3
"""End-to-end live test for picode.

Drives the real CLI against a live model (config from `picode.json`, key from
`.env`) and asserts the CLI output/aesthetics hold together: tool status lines,
LLM streaming, and permission prompts don't clobber each other, and exit codes
track policy decisions. Covers every built-in tool (fs, shell, git, web,
run_agent, todo), the permission engine (allow/ask/deny/plan/auto), and the
REPL's slash commands.

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
import json
import os
import re
import select
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE_DIR = os.path.join(ROOT, ".live")
SCRATCH_DIR = os.path.join(LIVE_DIR, "scratch")

PASS = 0
FAIL = 0
SKIP = 0


def check(name: str, cond: bool, extra: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {extra}")


def skip(name: str, reason: str) -> None:
    global SKIP
    SKIP += 1
    print(f"  SKIP  {name}  ({reason})")


def banner(title: str) -> None:
    print("=" * 70)
    print(title)


def env_value(key: str) -> str | None:
    """Read a var from .env directly (Python doesn't load it; only Node's
    --env-file does), so gated scenarios can decide whether a live key is
    configured without spawning a process."""
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            if k.strip() == key:
                return v.strip()
    return None


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

    def wait_regex(self, pattern: str, t: float) -> bool:
        rx = re.compile(pattern.encode())
        end = time.time() + t
        while time.time() < end:
            self._drain()
            if rx.search(self.buf):
                return True
            time.sleep(0.1)
        return False

    # The re-rendered prompt after a turn (`rl.prompt()`'s cursor-reset +
    # redraw). Appears once at session start (before any input) and once more
    # per completed turn, so `wait_n(PROMPT_MARK, k + 1, t)` reliably waits for
    # the k-th turn to finish — unlike a bare "Ask anything" substring wait,
    # which is already satisfied from the very first prompt and so never
    # actually blocks on a later turn.
    PROMPT_MARK = "\x1b[1G\x1b[0JAsk anything"

    def wait_turn(self, completed: int, t: float) -> bool:
        return self.wait_n(self.PROMPT_MARK, completed + 1, t)

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
    banner("Non-TTY: version, help, one-shot tool use, piped REPL")

    rc, out, err = run(["node", "--env-file=.env", "src/index.ts", "--version"])
    check("version", rc == 0 and re.search(r"picode \d+\.\d+\.\d+", out), f"rc={rc} out={out!r}")

    rc, out, err = run(["node", "--env-file=.env", "src/index.ts", "--help"])
    check(
        "help lists flags",
        rc == 0
        and "--no-stream" in out
        and "--verbose" in out
        and "--no-color" in out
        and "--auto" in out,
        f"rc={rc}",
    )

    # One-shot, auto, streamed tool use — exit 0, no cursor/ANSI in a pipe.
    rc, out, err = run_oneshot(
        "Use the list_dir tool to list the current directory.", "--no-color", "--auto"
    )
    check("one-shot auto tool use", rc == 0, f"rc={rc}")
    check("one-shot lists repo files", "picode.json" in out, out[:200])
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
    check(
        "piped REPL no prompt pollution",
        "Ask anything" not in out and not out.startswith("> "),
        repr(out[:60]),
    )
    check("piped REPL no ANSI/CR", "\x1b[" not in out and "\r" not in out)

    # --no-stream one-shot — single buffered block.
    rc, out, err = run_oneshot(
        "Use the list_dir tool to list the current directory.", "--no-color", "--auto", "--no-stream"
    )
    check("no-stream one-shot", rc == 0 and "picode.json" in out, f"rc={rc}")

    # Plan-mode one-shot deny — tool hidden, exit 2.
    rc, out, err = run_oneshot(
        "Use the run_command tool to run the exact shell command: date", "--no-color", "--plan"
    )
    check("plan-mode one-shot deny exit 2", rc == 2, f"rc={rc}")

    # stat tool — read-only, always allowed.
    rc, out, err = run_oneshot(
        "Use the stat tool to report on the file package.json, then tell me its type.", "--no-color"
    )
    check("stat tool exit 0", rc == 0, f"rc={rc}")
    check("stat reports a file", "file" in out.lower(), out[:200])

    # git tools — read-only, always allowed, never denied even without --auto.
    rc, out, err = run_oneshot(
        "Use the git_status tool and summarize the result in one short sentence.", "--no-color"
    )
    check("git_status exit 0", rc == 0, f"rc={rc}")

    # write_file + edit_file + read_file round trip, confined to the
    # gitignored .live/scratch/ dir so nothing pollutes the repo. `edit`
    # defaults to `ask` and picode.json's allow rules don't cover .live/**,
    # so this needs --auto.
    os.makedirs(SCRATCH_DIR, exist_ok=True)
    scratch = os.path.join(SCRATCH_DIR, "roundtrip.txt")
    if os.path.exists(scratch):
        os.remove(scratch)
    rc, out, err = run_oneshot(
        "Use write_file to create .live/scratch/roundtrip.txt with the exact content "
        "'placeholder line'. Then use edit_file to replace 'placeholder line' with "
        "'edited line' in that same file. Then use read_file to confirm the final "
        "content and report it back to me.",
        "--no-color",
        "--auto",
    )
    check("fs round-trip exit 0", rc == 0, f"rc={rc}\n{err[:300]}")
    on_disk = ""
    if os.path.exists(scratch):
        with open(scratch) as f:
            on_disk = f.read()
    check("write_file+edit_file landed on disk", on_disk.strip() == "edited line", repr(on_disk))
    check("read_file reported the edited content", "edited line" in out, out[:300])

    # todo tool — allowed in every mode, no --auto needed.
    rc, out, err = run_oneshot(
        "Use the todo tool to add one item: 'ship the release'. Then list the checklist "
        "and report exactly what it contains.",
        "--no-color",
    )
    check("todo one-shot exit 0", rc == 0, f"rc={rc}")
    check("todo one-shot reports the item", "ship the release" in out, out[:300])

    # run_agent — delegates to a fresh sub-agent; `agent` defaults to `ask`,
    # so this needs --auto.
    rc, out, err = run_oneshot(
        "Use run_agent (description: 'count files') with the prompt 'use list_dir to "
        "list the current directory and report how many entries it has, as a single "
        "number'. Then report back exactly what the sub-agent said.",
        "--no-color",
        "--auto",
    )
    check("run_agent one-shot exit 0", rc == 0, f"rc={rc}\n{err[:300]}")
    check("run_agent one-shot produced a report", len(out.strip()) > 0, out[:300])

    # web_search — needs a configured Brave key; skip cleanly if absent so the
    # suite stays runnable without one.
    if env_value("BRAVE_SEARCH_API_KEY"):
        rc, out, err = run_oneshot(
            "Use web_search to search for 'picode ai coding agent' and report the "
            "first result's title.",
            "--no-color",
            "--auto",
        )
        check("web_search one-shot exit 0", rc == 0, f"rc={rc}\n{err[:300]}")
    else:
        skip("web_search one-shot", "BRAVE_SEARCH_API_KEY not set in .env")

    # web_fetch — needs real network egress to a public host.
    rc, out, err = run_oneshot(
        "Use web_fetch to fetch https://example.com and tell me what the page's "
        "main heading says.",
        "--no-color",
        "--auto",
    )
    check("web_fetch one-shot exit 0", rc == 0, f"rc={rc}\n{err[:300]}")
    check("web_fetch read the page", "example" in out.lower(), out[:300])

    # --config: a custom project config with its own deny rule proves config
    # loading/merging works end-to-end, not just the default picode.json.
    with tempfile.NamedTemporaryFile("w", suffix=".json", dir=LIVE_DIR, delete=False) as f:
        json.dump(
            {
                "model": "gemma4:cloud",
                "baseURL": "http://localhost:11434/v1",
                "permission": {"read": {"deny": ["Read(README.md)"]}},
            },
            f,
        )
        config_path = f.name
    try:
        rc, out, err = run_oneshot(
            "Use the read_file tool to read README.md",
            "--no-color",
            "--config",
            config_path,
        )
        check("--config custom deny rule exit 2", rc == 2, f"rc={rc}")
    finally:
        os.remove(config_path)


# ---------------------------------------------------------------------------
# PTY (interactive) scenarios
# ---------------------------------------------------------------------------
def pty_flows() -> None:
    banner("PTY: allow / ask / deny / n / commands / color")

    # Allow path
    s = Pty()
    check("banner", s.wait_for("picode · gemma4:cloud · interactive", 8))
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

    # 'a' (always allow), then the same pattern must not prompt again. Each
    # approval prints "Run? (y/n/a)" twice (the instruction line, then the
    # actual inline question), so the invariant is "no *new* occurrences" —
    # comparing the raw count to a hardcoded 1 would be wrong.
    s = Pty()
    s.wait_for("Ask anything", 8)
    s.send("Use the run_command tool to run the exact shell command: whoami")
    check("always-allow: prompt shown", s.wait_for("Run? (y/n/a)", 120))
    s.send("a")
    check("always-allow: settled after a", s.wait_for("✓ done", 30))
    check("always-allow: turn 1 complete", s.wait_turn(1, 30))
    before = s.text()
    s.send("Use the run_command tool to run the exact shell command: whoami")
    check("always-allow: settled again, no re-prompt", s.wait_n("✓ done", 2, 60))
    check("always-allow: turn 2 complete", s.wait_turn(2, 30))
    after = s.text()
    check(
        "always-allow: no new approval prompt",
        after.count("Run? (y/n/a)") == before.count("Run? (y/n/a)"),
        after[len(before) :],
    )
    s.send("/exit")
    rc = s.close()
    check("always-allow: exit 0", rc == 0, f"rc={rc}")
    save("pty_always_allow.txt", s.text())

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
    s.send("/help")
    s.wait_for("Commands:", 5)
    help_txt = s.text()
    check(
        "/help lists every command",
        all(
            c in help_txt
            for c in ["/clear", "/exit", "/help", "/mode", "/model", "/reset", "/tools", "/version"]
        ),
        help_txt,
    )
    s.send("/version")
    # A bare "picode " wait would already be satisfied by the banner
    # ("picode · gemma4:cloud · ..."), so wait for the actual version pattern.
    check("/version prints a version", s.wait_regex(r"picode \d+\.\d+\.\d+", 5))
    s.send("/tools")
    s.wait_for("git_status", 5)
    t = s.text()
    check("/tools lists tools", "run_command" in t and "read_file" in t and "ask" in t and "allow" in t)
    check("/tools lists run_agent and todo", "run_agent" in t and "todo" in t, t)
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
    before_clear = s.text()
    s.send("/clear")
    time.sleep(0.3)
    after_clear = s.text()
    # The typed "/clear" itself is echoed by the pty before the program's
    # response, so the escape sequence follows rather than opens the segment.
    new_segment = after_clear[len(before_clear) :]
    check(
        "/clear emits the clear-screen sequence",
        "\x1b[2J\x1b[H" in new_segment,
        repr(new_segment),
    )
    s.send("/exit")
    rc = s.close()
    check("commands: exit 0", rc == 0, f"rc={rc}")
    save("pty_commands.txt", s.text())

    # todo tool: no approval prompt (allowed in every mode), status line shows
    # the live done/total count instead of a generic "done".
    s = Pty()
    s.wait_for("Ask anything", 8)
    s.send(
        "Use the todo tool to add two items: 'write code' and 'write tests'. Then "
        "mark the first one complete. Then list the checklist."
    )
    check("todo: settled status shows counts", s.wait_n("todo: ", 3, 60))
    check("todo: turn 1 complete", s.wait_turn(1, 30))
    txt = s.text()
    check("todo: no approval prompt", "Run? (y/n/a)" not in txt, txt)
    check("todo: final answer reflects the checklist", "write tests" in txt, txt)
    s.send("/reset")
    s.wait_for("conversation reset", 5)
    s.send("Use the todo tool to list the checklist and report exactly what it contains.")
    check("todo: /reset cleared the checklist", s.wait_for("todo: 0/0 done", 60))
    s.send("/exit")
    rc = s.close()
    check("todo: exit 0", rc == 0, f"rc={rc}")
    save("pty_todo.txt", s.text())

    # run_agent: one approval prompt for the whole sub-run, one settled status
    # line (no clobbering from the sub-agent's own internal tool calls), and
    # its report folded into the parent's final answer.
    s = Pty()
    s.wait_for("Ask anything", 8)
    s.send(
        "Use run_agent (description: 'count files') with the prompt 'use list_dir to "
        "list the current directory and report how many entries it has, as a single "
        "number'. Report back exactly what the sub-agent said."
    )
    check("run_agent: approval prompt shown", s.wait_for("Run? (y/n/a)", 120))
    check("run_agent: pattern preview", "approves: Agent(count files)" in s.text())
    s.send("y")
    check("run_agent: settled", s.wait_for("✓ done", 60))
    check("run_agent: turn complete", s.wait_turn(1, 30))
    txt = s.text()
    check(
        "run_agent: exactly one settled status line",
        len(re.findall(r"› agent: count files ✓ done \(\d+\.\ds\)", txt)) == 1,
        txt,
    )
    # One approval writes "Run? (y/n/a)" twice — the instruction line, then
    # the actual inline question — so "one approval for the whole sub-run"
    # (i.e. none of the sub-agent's own internal tool calls also prompted)
    # means exactly 2 total, not 1.
    check(
        "run_agent: only one approval prompt for the whole sub-run",
        txt.count("Run? (y/n/a)") == 2,
        txt,
    )
    s.send("/exit")
    rc = s.close()
    check("run_agent: exit 0", rc == 0, f"rc={rc}")
    save("pty_run_agent.txt", s.text())

    # run_agent + todo isolation: the sub-agent must get its own checklist,
    # never the parent's — regression test for a real bug this project hit.
    # (Turn boundaries are tracked with wait_turn rather than a bare "Ask
    # anything" wait, which would already be satisfied by the initial prompt.)
    s = Pty()
    s.wait_for("Ask anything", 8)
    s.send("Use the todo tool to add one item: 'parent task'.")
    # Snapshot format is "todo: <done>/<total> done" — one added, none
    # completed, so 0/1.
    check("isolation: parent add settled", s.wait_for("todo: 0/1 done", 30))
    check("isolation: turn 1 complete", s.wait_turn(1, 30))
    s.send(
        "Use run_agent (description: 'sub todo') with the prompt 'use the todo tool "
        "to add one item: sub task, then list the checklist and report exactly what "
        "it contains'."
    )
    check("isolation: approval prompt shown", s.wait_for("Run? (y/n/a)", 120))
    s.send("y")
    # The sub-agent runs headless — its own todo add/list calls don't surface
    # live status lines to this terminal, only the outer "agent: sub todo"
    # line does, settling once (todo actions render as "todo: ...", never
    # "✓ done", so this is the first "✓ done" of the whole session).
    check("isolation: sub-agent settled", s.wait_for("✓ done", 60))
    check("isolation: turn 2 complete", s.wait_turn(2, 30))
    sub_report = s.text()
    check("isolation: sub-agent sees only its own item", "sub task" in sub_report, sub_report)
    check(
        "isolation: sub-agent never sees the parent's item",
        "parent task" not in sub_report[sub_report.rfind("agent: sub todo") :],
        sub_report,
    )
    s.send("Use the todo tool to list the checklist and report exactly what it contains.")
    # Same checklist state as the first add ("0/1 done"), so this is the
    # *second* occurrence of that exact status text.
    check("isolation: parent list settled", s.wait_n("todo: 0/1 done", 2, 30))
    check("isolation: turn 3 complete", s.wait_turn(3, 30))
    parent_report = s.text()
    tail = parent_report[len(sub_report) :]
    check("isolation: parent still sees its own item", "parent task" in tail, tail)
    check("isolation: parent never sees the sub-agent's item", "sub task" not in tail, tail)
    s.send("/exit")
    rc = s.close()
    check("isolation: exit 0", rc == 0, f"rc={rc}")
    save("pty_todo_isolation.txt", s.text())

    # plan mode denies run_agent outright (it can write/run shell through its
    # own inner tool calls, so it isn't treated as non-mutating like a read).
    s = Pty(extra=["--plan"])
    s.wait_for("Ask anything", 8)
    s.send("Use run_agent (description: 'plan check') with the prompt 'say hi'.")
    check(
        "plan mode: run_agent denied",
        s.wait_for("✗ denied", 120) and "plan mode (read-only)" in s.text(),
    )
    check("plan mode: no approval prompt", "Run? (y/n/a)" not in s.text())
    s.send("/exit")
    rc = s.close()
    check("plan mode denies run_agent: exit 0", rc == 0, f"rc={rc}")
    save("pty_run_agent_plan_mode.txt", s.text())

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

    os.makedirs(LIVE_DIR, exist_ok=True)
    non_tty()
    if not args.quick:
        pty_flows()

    print()
    print(f"RESULT: {PASS} passed, {FAIL} failed, {SKIP} skipped")
    if not args.keep:
        import shutil

        shutil.rmtree(LIVE_DIR, ignore_errors=True)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
