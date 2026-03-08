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

    proc = subprocess.run(
        ["cursor-agent", "--print", "--trust"],
        input=prompt,
        capture_output=True,
        text=True,
        env=os.environ,
        timeout=600,
    )
    if proc.returncode != 0:
        if proc.stderr:
            print(proc.stderr, file=sys.stderr)
        if proc.stdout:
            print(proc.stdout, file=sys.stderr)
        sys.exit(1)

    if proc.stderr:
        print(proc.stderr, file=sys.stderr)

    raw = proc.stdout or ""
    if not raw.strip():
        print("No output from cursor-agent", file=sys.stderr)
        sys.exit(0)

    # Extract JSON array from stdout only (allow ```json ... ``` or raw [...])
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

    # Fetch existing review comments so we don't repeat still-valid ones.
    existing_key = set()
    list_url = f"/repos/{repo}/pulls/{pr_number}/comments?per_page=100"
    r = subprocess.run(
        ["gh", "api", list_url],
        capture_output=True,
        text=True,
        env=os.environ,
        timeout=30,
    )
    if r.returncode == 0 and r.stdout.strip():
        try:
            existing_list = json.loads(r.stdout)
            if isinstance(existing_list, list):
                for ex in existing_list:
                    if isinstance(ex, dict):
                        p = ex.get("path")
                        ln = ex.get("line")
                        b = (ex.get("body") or "").strip()
                        if p is not None and ln is not None:
                            existing_key.add((str(p), int(ln), b))
        except (json.JSONDecodeError, TypeError, ValueError):
            pass

    # Post only comments that don't already exist (same path, line, body).
    url_base = f"/repos/{repo}/pulls/{pr_number}/comments"
    posted = 0
    skipped = 0
    for c in out:
        key = (c["path"], c["line"], c["body"])
        if key in existing_key:
            skipped += 1
            continue
        payload = {
            "commit_id": head_sha,
            "path": c["path"],
            "line": c["line"],
            "side": c["side"],
            "body": c["body"],
        }
        payload_bytes = json.dumps(payload).encode("utf-8")
        r = subprocess.run(
            ["gh", "api", "-X", "POST", url_base, "--input", "-"],
            input=payload_bytes,
            capture_output=True,
            env=os.environ,
            timeout=30,
        )
        if r.returncode != 0:
            print(f"gh api failed for {c['path']}:{c['line']}:", r.stderr.decode(), file=sys.stderr)
            sys.exit(1)
        posted += 1
    msg = f"Posted {posted} review comment(s)"
    if skipped:
        msg += f" ({skipped} already present, skipped)"
    print(msg)


if __name__ == "__main__":
    main()
