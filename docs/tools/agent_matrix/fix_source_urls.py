#!/usr/bin/env python3
"""Fix agent matrix source_url anchors by verifying headings and text on live pages."""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent

from audit_source_urls import (
    DATA_DIR,
    REPORT_PATH,
    FetchResult,
    PageParser,
    SourceRef,
    assess,
    base_fetch_url,
    fetch,
    normalize_text,
    slugify,
    source_refs,
    strip_text_fragment,
    text_fragment_parts,
    write_report,
)

USER_AGENT = "agent-launch-source-url-fix/1.0"

# SPAs / bot-sensitive hosts: always render with Playwright for reliable headings + text.
PLAYWRIGHT_FIRST_HOSTS = frozenset(
    {
        "antigravity.google",
        "x.ai",
        "docs.cursor.com",
        "cursor.com",
        "docs.factory.ai",
        "factory.ai",
        "jules.google",
        "kiro.dev",
        "opencode.ai",
        "kilo.ai",
        "cohere.com",
        "docs.devin.ai",
        "devin.ai",
        "junie.jetbrains.com",
        "jetbrains.com",
        "docs.windsurf.com",
        "github.com",
    }
)


def anchor_slug(value: str) -> str:
    """Slug for matching doc heading ids; keeps leading -- for CLI flags."""
    value = urllib.parse.unquote(value).strip().lower()
    value = re.sub(r"[^\w\s-]", "", value)
    return re.sub(r"[\s_]+", "-", value)

# Known broken URL bases -> working replacements (longest match first at apply time).
BASE_URL_REWRITES: list[tuple[str, str]] = [
    ("https://developers.openai.com/codex/agents-md", "https://developers.openai.com/codex/guides/agents-md"),
    ("https://google-gemini.github.io/gemini-cli/docs/cli/configuration.html", "https://antigravity.google/docs/cli-features"),
    ("https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html", "https://antigravity.google/docs/cli-features"),
    ("https://google-gemini.github.io/gemini-cli/docs/tools/", "https://antigravity.google/docs/cli-features"),
    ("https://google-gemini.github.io/gemini-cli/docs/cli/commands.html", "https://antigravity.google/docs/cli-features"),
    ("https://google-gemini.github.io/gemini-cli/docs/cli/", "https://antigravity.google/docs/cli-getting-started"),
    ("https://google-gemini.github.io/gemini-cli/docs/telemetry/", "https://antigravity.google/docs/cli-features"),
    ("https://google-gemini.github.io/gemini-cli/", "https://antigravity.google/docs/cli-getting-started"),
    ("https://qwenlm.github.io/qwen-code-docs/getting-started/", "https://qwenlm.github.io/qwen-code-docs/en/users/overview/"),
    ("https://qwenlm.github.io/qwen-code-docs/getting-started", "https://qwenlm.github.io/qwen-code-docs/en/users/overview/"),
    ("https://antigravity.google/docs/#", "https://antigravity.google/docs/cli-features#"),
    ("https://antigravity.google/docs/", "https://antigravity.google/docs/cli-features"),
    ("https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/settings.html", "https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/providers-and-models.html"),
    ("https://docs.github.com/en/copilot/using-github-copilot/getting-code-suggestions-in-your-ide", "https://docs.github.com/en/copilot/concepts/agents/about-copilot-coding-agent"),
    ("https://blog.replit.com/agent", "https://blog.replit.com/ai"),
]


@dataclass
class PageContent:
    ok: bool
    status: int | None
    final_url: str
    ids: set[str]
    names: set[str]
    headings: list[tuple[str, str]]
    sections: list[tuple[str, str, str]]  # anchor, heading text, section body
    text: str
    error: str = ""


def rewrite_base_url(url: str) -> str:
    out = url
    for old, new in sorted(BASE_URL_REWRITES, key=lambda x: len(x[0]), reverse=True):
        if out.startswith(old):
            return new + out[len(old) :]
    return out


def parse_report_suggestions(report_path: Path) -> dict[tuple[str, str], str]:
    """Map (file, path) -> suggested URL from audit markdown."""
    if not report_path.is_file():
        return {}
    text = report_path.read_text(encoding="utf-8")
    suggestions: dict[tuple[str, str], str] = {}
    current_file = ""
    current_path = ""
    for line in text.splitlines():
        m = re.match(r"^- `([^`]+)` `([^`]+)` \([^)]+\): ", line)
        if m:
            current_file, current_path = m.group(1), m.group(2)
            continue
        m2 = re.match(r"^\s+- Suggested URL: (.+)$", line)
        if m2 and current_file and current_path:
            suggestions[(current_file, current_path)] = m2.group(1).strip()
    return suggestions


def fetch_result_to_page(fr: FetchResult) -> PageContent:
    headings = list(fr.headings or [])
    text = fr.text or ""
    sections = sectionize(headings, text)
    return PageContent(
        ok=fr.ok,
        status=fr.status,
        final_url=fr.final_url or fr.url,
        ids=set(fr.ids or set()),
        names=set(fr.names or set()),
        headings=headings,
        sections=sections,
        text=text,
        error=fr.error,
    )


def sectionize(headings: list[tuple[str, str]], full_text: str) -> list[tuple[str, str, str]]:
    if not headings:
        return []
    out: list[tuple[str, str, str]] = []
    lower = full_text.lower()
    positions: list[tuple[int, str, str]] = []
    for hid, htext in headings:
        if not htext:
            continue
        idx = lower.find(htext.lower())
        if idx >= 0:
            positions.append((idx, hid, htext))
    positions.sort(key=lambda x: x[0])
    for i, (start, hid, htext) in enumerate(positions):
        end = positions[i + 1][0] if i + 1 < len(positions) else len(full_text)
        anchor = hid or slugify(htext)
        out.append((anchor, htext, full_text[start:end]))
    return out


def fetch_with_playwright(url: str, timeout_ms: int = 45000) -> PageContent:
    from playwright.sync_api import sync_playwright

    final_url = url
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(user_agent=USER_AGENT)
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            page.wait_for_timeout(1500)
            final_url = page.url
            html_body = page.content()
            body_text = page.inner_text("body")
            raw_headings = page.eval_on_selector_all(
                "h1,h2,h3,h4,h5,h6",
                "els => els.map(e => ({id: e.id || '', text: (e.innerText || '').trim()}))",
            )
            browser.close()
    except Exception as exc:
        return PageContent(False, None, url, set(), set(), [], [], "", str(exc))

    parser = PageParser()
    parser.feed(html_body)
    headings = list(parser.headings)
    for item in raw_headings:
        text = normalize_text(item.get("text", ""))
        if text and (item.get("id") or text):
            hid = item.get("id") or slugify(text)
            if (hid, text) not in headings:
                headings.append((hid, text))
    text = normalize_text(body_text) or parser.text
    sections = sectionize(headings, text)
    return PageContent(True, 200, final_url, set(parser.ids), set(parser.names), headings, sections, text)


class PageCache:
    def __init__(self, timeout: int, use_playwright: bool) -> None:
        self.timeout = timeout
        self.use_playwright = use_playwright
        self._cache: dict[str, PageContent] = {}

    def get(self, url: str) -> PageContent:
        key = base_fetch_url(url)
        if key in self._cache:
            return self._cache[key]
        rewritten = rewrite_base_url(url)
        fetch_url = base_fetch_url(rewritten)
        host = urllib.parse.urlsplit(fetch_url).netloc.removeprefix("www.")
        force_pw = self.use_playwright and host in PLAYWRIGHT_FIRST_HOSTS
        if force_pw:
            page = fetch_with_playwright(fetch_url)
        else:
            fr = fetch(fetch_url, self.timeout)
            page = fetch_result_to_page(fr)
            needs_pw = self.use_playwright and (
                not page.ok
                or len(page.text) < 400
                or (not page.headings and len(page.text) < 2000)
                or "enable javascript" in page.text.lower()[:2000]
            )
            if needs_pw:
                page = fetch_with_playwright(fetch_url)
        self._cache[key] = page
        self._cache[base_fetch_url(url)] = page
        return page


def anchor_id(hid: str, htext: str) -> str:
    return hid or anchor_slug(htext)


def anchor_valid(page: PageContent, anchor: str) -> bool:
    if not anchor or anchor == "source":
        return False
    if anchor in page.ids or anchor in page.names:
        return True
    slug = slugify(anchor)
    return any(slug == slugify(hid) or slug == slugify(htext) for hid, htext in page.headings)


def primary_fragment(part: str) -> str:
    if "\n" in part:
        return part.split("\n")[0].strip()
    flag = re.match(r"^(--\S+(?:\s+[^\s-][^\s]*)?)", part)
    if flag:
        return flag.group(1).strip()
    return part[:160].strip()


def score_anchor(page: PageContent, anchor: str, htext: str, section: str, text_parts: list[str]) -> int:
    score = 0
    if anchor_valid(page, anchor):
        score += 8
    section_head = section[:800].lower()
    hlow = htext.lower()
    for part in text_parts:
        pl = part.lower()
        lead = primary_fragment(part).lower()
        if lead and lead in hlow:
            score += 120 + min(len(lead), 80)
        elif lead and len(lead) >= 6 and lead in section_head:
            score += 70 + min(len(lead) // 2, 40)
        elif pl in hlow:
            score += 40 + min(len(pl), 80)
        elif len(pl) >= 8 and pl in section_head:
            score += 25
        elif pl in page.text.lower():
            score += 2
        lead_slug = anchor_slug(lead) if lead else ""
        if lead_slug and anchor.lower() == lead_slug:
            score += 200
        first = lead.split()[0] if lead else ""
        if first.startswith("--") and anchor.lower() == anchor_slug(first):
            score += 180
        if first.startswith("--") and first in hlow:
            score += 80
    if anchor and anchor != "source":
        score += 2
    if len(htext) <= 3:
        score -= 10
    return score


def extra_anchor_candidates(text_parts: list[str], page: PageContent) -> list[str]:
    found: list[str] = []
    for part in text_parts:
        for token in re.split(r"[\s\n]+", part):
            token = token.strip("`'\"")
            if not token:
                continue
            for cand in (token, anchor_slug(token), anchor_slug(token[:120])):
                if cand and anchor_valid(page, cand):
                    found.append(cand)
            if token.startswith("--"):
                bare = token.lstrip("-").split("=")[0]
                for cand in (token.lower(), anchor_slug(token), anchor_slug(bare), bare):
                    if cand and anchor_valid(page, cand):
                        found.append(cand)
    return list(dict.fromkeys(found))


def find_best_anchor(page: PageContent, text_parts: list[str]) -> str | None:
    if not page.ok:
        return None
    candidates: list[tuple[int, str]] = []
    for hid, htext in page.headings:
        anchor = anchor_id(hid, htext)
        section = next((s for a, _, s in page.sections if a == anchor), "")
        candidates.append((score_anchor(page, anchor, htext, section, text_parts), anchor))
    for anchor in page.ids:
        if anchor and anchor != "source":
            candidates.append((score_anchor(page, anchor, anchor, "", text_parts), anchor))
    for anchor in extra_anchor_candidates(text_parts, page):
        candidates.append((score_anchor(page, anchor, anchor, "", text_parts) + 45, anchor))
    if not candidates:
        return None
    candidates.sort(key=lambda x: (-x[0], x[1]))
    best_score, best = candidates[0]
    if text_parts and best_score < 20:
        return None
    if not text_parts and best_score < 8:
        return None
    return best


def build_source_url(page_url: str, anchor: str, text_raw: str) -> str:
    parsed = urllib.parse.urlsplit(page_url)
    fragment = f"{anchor}:~:text={text_raw}" if text_raw else anchor
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, fragment))


def page_to_fetch_result(page: PageContent, url: str) -> FetchResult:
    return FetchResult(
        url=base_fetch_url(url),
        ok=page.ok,
        status=page.status,
        final_url=page.final_url,
        text=page.text,
        ids=page.ids,
        names=page.names,
        headings=page.headings,
    )


def strict_text_ok(page: PageContent, anchor: str, text_parts: list[str]) -> bool:
    if not text_parts:
        return True
    htext = next((t for hid, t in page.headings if anchor_id(hid, t) == anchor), anchor)
    section = next((s for a, _, s in page.sections if a == anchor), "")
    blob = f"{htext} {section[:1500]}".lower()
    for part in text_parts:
        lead = primary_fragment(part).lower()
        if lead and lead in blob:
            return True
        if part.lower() in blob:
            return True
    return False


def verify_candidate(ref: SourceRef, candidate: str, cache: PageCache) -> bool:
    page = cache.get(candidate)
    if not page.ok:
        return False
    parsed = urllib.parse.urlsplit(candidate)
    heading_raw, text_raw = strip_text_fragment(parsed.fragment)
    heading = urllib.parse.unquote(heading_raw)
    text_parts = text_fragment_parts(text_raw)
    if not heading or not anchor_valid(page, heading):
        return False
    if not strict_text_ok(page, heading, text_parts):
        return False
    fr = page_to_fetch_result(page, candidate)
    test_ref = SourceRef(ref.file, ref.path, ref.name, candidate)
    result = assess(test_ref, fr)
    if result["heading_ok"] and result["text_ok"]:
        return True
    return result["status"] == "ok"


def propose_fix(ref: SourceRef, cache: PageCache, hint: str | None) -> str | None:
    parsed = urllib.parse.urlsplit(ref.url)
    _, text_raw = strip_text_fragment(parsed.fragment)
    text_parts = text_fragment_parts(text_raw)

    candidates: list[str] = []
    if hint:
        candidates.append(hint)
    rewritten = rewrite_base_url(ref.url)
    if rewritten != ref.url:
        candidates.append(rewritten)

    for base_url in (ref.url, rewritten):
        page = cache.get(base_url)
        anchor = find_best_anchor(page, text_parts)
        if anchor:
            page_url = page.final_url or base_fetch_url(base_url)
            candidates.append(build_source_url(page_url, anchor, text_raw))

    seen: set[str] = set()
    for candidate in candidates:
        if not candidate or candidate == ref.url or candidate in seen:
            continue
        seen.add(candidate)
        if verify_candidate(ref, candidate, cache):
            return candidate
    return None


def apply_url_to_data(data_dir: Path, ref: SourceRef, new_url: str) -> bool:
    path = data_dir / ref.file
    row = json.loads(path.read_text(encoding="utf-8"))
    parts = ref.path.split(".")
    node = row
    for part in parts[:-1]:
        node = node[int(part)] if part.isdigit() else node[part]
    key = parts[-1]
    if node.get(key) != new_url:
        node[key] = new_url
        path.write_text(json.dumps(row, indent=2) + "\n", encoding="utf-8")
        return True
    return False


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--report", type=Path, default=REPORT_PATH)
    parser.add_argument("--fix-report", type=Path, default=ROOT / "source_url_fix_report.md")
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--no-playwright", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args(argv)

    hints = parse_report_suggestions(args.report)
    refs = source_refs(args.data_dir)
    cache = PageCache(args.timeout, use_playwright=not args.no_playwright)

    fixes: list[dict] = []
    skipped_ok = 0
    failed: list[dict] = []

    work = refs
    if args.limit:
        work = work[: args.limit]

    for ref in work:
        page = cache.get(ref.url)
        test_fr = FetchResult(
            url=base_fetch_url(ref.url),
            ok=page.ok,
            status=page.status,
            final_url=page.final_url,
            text=page.text,
            ids=page.ids,
            names=page.names,
            headings=page.headings,
        )
        before = assess(ref, test_fr)
        if before["status"] == "ok":
            skipped_ok += 1
            continue

        hint = hints.get((ref.file, ref.path))
        new_url = propose_fix(ref, cache, hint)
        if new_url:
            fixes.append(
                {
                    "file": ref.file,
                    "path": ref.path,
                    "name": ref.name,
                    "old_url": ref.url,
                    "new_url": new_url,
                    "before": before["status"],
                    "hint": bool(hint),
                }
            )
            if not args.dry_run:
                apply_url_to_data(args.data_dir, ref, new_url)
        else:
            failed.append({"file": ref.file, "path": ref.path, "name": ref.name, "url": ref.url, "before": before["status"]})

    lines = [
        "# Source URL Fix Report",
        "",
        f"- Applied fixes: {len(fixes)}",
        f"- Already OK: {skipped_ok}",
        f"- Unresolved: {len(failed)}",
        f"- Dry run: {args.dry_run}",
        "",
    ]
    if fixes:
        lines.append("## Applied")
        for item in fixes:
            lines.append(f"- `{item['file']}` `{item['path']}` ({item['name']})")
            lines.append(f"  - {item['before']} -> verified ok")
            lines.append(f"  - Old: {item['old_url']}")
            lines.append(f"  - New: {item['new_url']}")
    if failed:
        lines.append("")
        lines.append("## Unresolved")
        for item in failed[:200]:
            lines.append(f"- `{item['file']}` `{item['path']}` ({item['name']}): {item['before']}")
            lines.append(f"  - {item['url']}")

    args.fix_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Fixes: {len(fixes)}, ok skipped: {skipped_ok}, unresolved: {len(failed)}")
    print(f"Wrote {args.fix_report}")

    if not args.dry_run and fixes:
        refs2 = source_refs(args.data_dir)
        fetch_urls = sorted({base_fetch_url(ref.url) for ref in refs2})
        fetched = {u: fetch(u, args.timeout) for u in fetch_urls}
        results = [assess(ref, fetched[base_fetch_url(ref.url)]) for ref in refs2]
        write_report(refs2, results, args.report)
        print(f"Re-audited -> {args.report}")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
