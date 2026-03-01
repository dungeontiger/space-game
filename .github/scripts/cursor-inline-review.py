#!/usr/bin/env python3
"""
Run Cursor agent to get structured PR review comments (path, line, body)
and post them as inline review comments on the GitHub PR.
Reads from env: CURSOR_API_KEY, GH_TOKEN, PR_NUMBER, HEAD_SHA, REPO.
"""
import os
import re
import json
import subprocess
import sys


def main():
    pr_number = os.environ.get("PR_NUMBER")
    head_sha = os.environ.get("HEAD_SHA")
    repo = os.environ.get("REPO")
    if not all([pr_number, head_sha, repo]):
        print("Missing env: PR_NUMBER, HEAD_SHA, REPO", file=sys.stderr)
        sys.exit(1)

    # Prompt: agent should run gh pr diff and output only a JSON array of comments
    prompt = f"""Review this pull request. Run this command to get the diff: gh pr diff {pr_number}

For each substantive issue (bug, security, clarity, style), output exactly one JSON object with:
- "path": file path relative to repo root (e.g. "src/main.ts")
- "line": line number in the NEW file where the issue is
- "body": your short comment (one or two sentences)

Output ONLY a JSON array of these objects. No markdown, no code fence, no other text. One array only.
If you find no issues, output: []
Example format: [{{"path":"src/a.ts","line":10,"body":"Prefer const."}}]"""

    env = os.environ.copy()
    env["GH_PR_NUMBER"] = str(pr_number)

    proc = subprocess.run(
        ["cursor-agent", "--print", "--trust"],
        input=prompt,
        capture_output=True,
        text=True,
        env=env,
        timeout=600,
    )
    raw = (proc.stdout or "") + (proc.stderr or "")
    if not raw.strip():
        print("No output from cursor-agent", file=sys.stderr)
        sys.exit(0)

    # Extract JSON array from output (allow ```json ... ``` or raw [...])
    comments = []
    # Prefer block inside ```json ... ```
    code = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if code:
        try:
            comments = json.loads(code.group(1).strip())
        except json.JSONDecodeError:
            pass
    if not comments and "[" in raw and "]" in raw:
        start = raw.index("[")
        end = raw.rindex("]") + 1
        if end > start:
            try:
                comments = json.loads(raw[start:end])
            except json.JSONDecodeError:
                pass
    if not isinstance(comments, list):
        comments = []

    # Normalize: each comment must have path, line, body; add side for GitHub API
    out = []
    for c in comments:
        if not isinstance(c, dict):
            continue
        path = c.get("path")
        line = c.get("line")
        body = c.get("body")
        if not path or line is None or not body:
            continue
        try:
            line = int(line)
        except (TypeError, ValueError):
            continue
        out.append({
            "path": path.strip(),
            "line": line,
            "side": "RIGHT",
            "body": str(body).strip()[:65535],
        })

    if not out:
        print("No valid comments to post")
        sys.exit(0)

    # Build review payload: commit_id, event, body (summary), comments
    payload = {
        "commit_id": head_sha,
        "event": "COMMENT",
        "body": f"Cursor AI review ({len(out)} comment(s) on the diff).",
        "comments": out,
    }
    payload_bytes = json.dumps(payload).encode("utf-8")

    url = f"/repos/{repo}/pulls/{pr_number}/reviews"
    r = subprocess.run(
        ["gh", "api", "-X", "POST", url, "--input", "-"],
        input=payload_bytes,
        capture_output=True,
        env={**os.environ, "GH_TOKEN": os.environ.get("GH_TOKEN", "")},
        timeout=30,
    )
    if r.returncode != 0:
        print("gh api failed:", r.stderr.decode(), file=sys.stderr)
        sys.exit(1)
    print(f"Posted {len(out)} review comment(s)")


if __name__ == "__main__":
    main()
