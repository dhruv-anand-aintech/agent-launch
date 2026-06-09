#!/usr/bin/env python3
"""Audit source_url anchors and text fragments in agent matrix data."""

from __future__ import annotations

import argparse
import concurrent.futures
import html
import json
import re
import socket
import ssl
import sys
import urllib.parse
from collections import Counter, defaultdict
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
REPORT_PATH = ROOT / "source_url_audit_report.md"
USER_AGENT = "agent-launch-source-url-audit/1.0"


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: set[str] = set()
        self.names: set[str] = set()
        self.headings: list[tuple[str, str]] = []
        self._heading_stack: list[tuple[str, str | None, list[str]]] = []
        self.text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        if attr.get("id"):
            self.ids.add(attr["id"] or "")
        if attr.get("name"):
            self.names.add(attr["name"] or "")
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._heading_stack.append((tag, attr.get("id"), []))
        if tag in {"script", "style", "noscript"}:
            return

    def handle_endtag(self, tag: str) -> None:
        if self._heading_stack and self._heading_stack[-1][0] == tag:
            _, heading_id, parts = self._heading_stack.pop()
            text = normalize_text(" ".join(parts))
            if text:
                self.headings.append((heading_id or slugify(text), text))

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.text_parts.append(data)
            if self._heading_stack:
                self._heading_stack[-1][2].append(data)

    @property
    def text(self) -> str:
        return normalize_text(" ".join(self.text_parts))


@dataclass(frozen=True)
class SourceRef:
    file: str
    path: str
    name: str
    url: str


@dataclass
class FetchResult:
    url: str
    ok: bool
    status: int | None = None
    final_url: str | None = None
    content_type: str = ""
    body: str = ""
    error: str = ""
    ids: set[str] | None = None
    names: set[str] | None = None
    headings: list[tuple[str, str]] | None = None
    text: str = ""


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value or "")).strip()


def slugify(value: str) -> str:
    value = urllib.parse.unquote(value).lower()
    value = re.sub(r"[^\w\s-]", "", value)
    value = re.sub(r"[\s_]+", "-", value.strip())
    return re.sub(r"-+", "-", value)


def source_refs(data_dir: Path) -> list[SourceRef]:
    refs: list[SourceRef] = []
    for path in sorted(data_dir.glob("*.json")):
        row = json.loads(path.read_text(encoding="utf-8"))
        name = row.get("name", path.stem)

        def walk(node: object, parts: list[str]) -> None:
            if isinstance(node, dict):
                if isinstance(node.get("source_url"), str):
                    refs.append(SourceRef(path.name, ".".join(parts + ["source_url"]), name, node["source_url"]))
                for key, value in node.items():
                    walk(value, parts + [str(key)])
            elif isinstance(node, list):
                for idx, value in enumerate(node):
                    walk(value, parts + [str(idx)])

        walk(row, [])
    return refs


def strip_text_fragment(fragment: str) -> tuple[str, str]:
    marker = ":~:text="
    if marker not in fragment:
        return fragment, ""
    heading, text = fragment.split(marker, 1)
    return heading, text


def text_fragment_parts(raw: str) -> list[str]:
    if not raw:
        return []
    decoded = urllib.parse.unquote(raw)
    decoded = decoded.split("&", 1)[0]
    # Text fragments can contain prefix-,start,end,-suffix. Checking all
    # meaningful decoded phrases is stricter than just matching one token.
    candidates = [p for p in decoded.split(",") if p]
    cleaned: list[str] = []
    for part in candidates:
        normalized = normalize_text(part)
        stripped = normalize_text(part.strip("- "))
        if normalized:
            cleaned.append(normalized)
        if stripped and stripped != normalized:
            cleaned.append(stripped)
    return list(dict.fromkeys(cleaned))


def base_fetch_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))


def fetch(url: str, timeout: int) -> FetchResult:
    try:
        resp = requests.get(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,text/plain,*/*;q=0.8",
            },
            timeout=timeout,
            allow_redirects=True,
        )
        body = resp.content[:3_000_000].decode(resp.encoding or "utf-8", errors="replace")
        content_type = resp.headers.get("content-type", "")
        parser = PageParser()
        if "html" in content_type or body.lstrip().startswith("<"):
            parser.feed(body)
            text = parser.text
        else:
            text = normalize_text(body)
        return FetchResult(
            url=url,
            ok=resp.status_code < 400,
            status=resp.status_code,
            final_url=resp.url,
            content_type=content_type,
            body=body,
            ids=parser.ids,
            names=parser.names,
            headings=parser.headings,
            text=text,
            error="" if resp.status_code < 400 else resp.reason,
        )
    except (requests.RequestException, socket.timeout, ssl.SSLError) as exc:
        return FetchResult(url=url, ok=False, error=str(exc))


def classify_page(fetch_result: FetchResult) -> str:
    if not fetch_result.ok:
        return "fetch_failed"
    body = fetch_result.body[:5000].lower()
    text = fetch_result.text.lower()
    if fetch_result.status and fetch_result.status >= 400:
        return "fetch_failed"
    if any(token in body for token in ("enable javascript", "__next_data__", "gatsby", "vite")) and len(text) < 500:
        return "manual_followup"
    if any(token in text for token in ("access denied", "just a moment", "checking your browser", "captcha")):
        return "manual_followup"
    return "checked"


def assess(ref: SourceRef, fetched: FetchResult) -> dict:
    parsed = urllib.parse.urlsplit(ref.url)
    heading_raw, text_raw = strip_text_fragment(parsed.fragment)
    heading = urllib.parse.unquote(heading_raw)
    text_parts = text_fragment_parts(text_raw)
    page_class = classify_page(fetched)
    ids = fetched.ids or set()
    names = fetched.names or set()
    headings = fetched.headings or []
    heading_slug = slugify(heading)
    heading_ok = bool(heading and (heading in ids or heading in names or heading_slug in ids or heading_slug in names))
    if not heading_ok and heading:
        heading_ok = any(heading_slug == slugify(hid) or heading_slug == slugify(htext) for hid, htext in headings)
    text_ok = bool(text_parts) and any(part.lower() in fetched.text.lower() for part in text_parts)
    if page_class == "manual_followup":
        status = "manual_followup"
    elif not fetched.ok:
        status = "fetch_failed"
    elif heading_ok and text_ok:
        status = "ok"
    elif not heading_ok and not text_ok:
        status = "heading_and_text_failed"
    elif not heading_ok:
        status = "heading_failed"
    else:
        status = "text_failed"

    suggestion = ""
    if fetched.ok and not heading_ok and heading:
        target = next((hid for hid, htext in headings if text_parts and any(part.lower() in htext.lower() for part in text_parts)), "")
        if target:
            new_fragment = f"{target}:~:text={text_raw}" if text_raw else target
            suggestion = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, new_fragment))

    return {
        "file": ref.file,
        "path": ref.path,
        "name": ref.name,
        "url": ref.url,
        "status": status,
        "http_status": fetched.status,
        "page_class": page_class,
        "heading": heading,
        "heading_ok": heading_ok,
        "text_parts": text_parts,
        "text_ok": text_ok,
        "error": fetched.error,
        "suggestion": suggestion,
    }


def write_report(refs: list[SourceRef], results: list[dict], output: Path) -> None:
    counts = Counter(item["status"] for item in results)
    by_host = Counter(urllib.parse.urlsplit(item["url"]).netloc for item in results if item["status"] != "ok")
    grouped: dict[str, list[dict]] = defaultdict(list)
    for item in results:
        if item["status"] != "ok":
            grouped[item["status"]].append(item)

    lines = [
        "# Source URL Audit Report",
        "",
        "Generated by `docs/tools/agent_matrix/audit_source_urls.py`.",
        "",
        "## Counts",
        "",
        f"- Source URL objects inspected: {len(refs)}",
        f"- Distinct fetch URLs: {len({base_fetch_url(ref.url) for ref in refs})}",
    ]
    for key, value in sorted(counts.items()):
        lines.append(f"- {key}: {value}")
    lines.extend(["", "## Top Failing Hosts", ""])
    if by_host:
        for host, count in by_host.most_common(12):
            lines.append(f"- {host}: {count}")
    else:
        lines.append("- None")

    for status in ("fetch_failed", "manual_followup", "heading_and_text_failed", "heading_failed", "text_failed"):
        items = grouped.get(status, [])
        lines.extend(["", f"## {status.replace('_', ' ').title()} ({len(items)})", ""])
        if not items:
            lines.append("- None")
            continue
        for item in items:
            lines.append(f"- `{item['file']}` `{item['path']}` ({item['name']}): {item['url']}")
            bits = []
            if item["http_status"]:
                bits.append(f"HTTP {item['http_status']}")
            if item["error"]:
                bits.append(item["error"])
            bits.append(f"heading_ok={item['heading_ok']}")
            bits.append(f"text_ok={item['text_ok']}")
            if item["text_parts"]:
                bits.append("text=" + " | ".join(f"`{part}`" for part in item["text_parts"]))
            lines.append(f"  - Evidence: {'; '.join(bits)}")
            if item["suggestion"]:
                lines.append(f"  - Suggested URL: {item['suggestion']}")

    output.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--output", type=Path, default=REPORT_PATH)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--workers", type=int, default=12)
    args = parser.parse_args(argv)

    refs = source_refs(args.data_dir)
    fetch_urls = sorted({base_fetch_url(ref.url) for ref in refs})
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        fetched_list = list(pool.map(lambda url: fetch(url, args.timeout), fetch_urls))
    fetched = dict(zip(fetch_urls, fetched_list))
    results = [assess(ref, fetched[base_fetch_url(ref.url)]) for ref in refs]
    write_report(refs, results, args.output)
    print(f"Wrote {args.output} with {len(results)} audited source URLs")
    return 1 if any(item["status"] not in {"ok", "manual_followup"} for item in results) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
