#!/usr/bin/env python3
"""Utilities for the coding-agent feature matrix JSON data."""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from datetime import datetime
from pathlib import Path


def _load_json(path: str | Path) -> OrderedDict:
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=OrderedDict)


def _required_keys(schema: dict) -> list[str]:
    return list(schema.get("required", []))


FORM_FACTOR_ORDER = ["CLI", "IDE", "Extension", "SDK", "Web", "Mac App"]
GITHUB_API = "https://api.github.com"
MONTH_MAP = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}
GITHUB_PATH_BLOCKLIST = frozenset(
    {"features", "organizations", "apps", "marketplace", "login", "settings", "topics", "collections"}
)
README_PATH = "docs/tools/agent_matrix/README.md"


def _sort_form_factors(values: list[str]) -> list[str]:
    rank = {v: i for i, v in enumerate(FORM_FACTOR_ORDER)}
    return sorted(values, key=lambda v: (rank.get(v, 99), v))


def _readme_value(row: dict, key: str) -> str:
    val = row.get(key, {})
    return val.get("value", "") if isinstance(val, dict) else ""


def _readme_support(row: dict, key: str) -> str:
    val = row.get(key, {})
    return val.get("support", "") if isinstance(val, dict) else ""


def _build_rows_markdown(rows: list[dict]) -> str:
    header = "| Name | Form factor | Released | Latest major update | Some free | No account | Other subs | Rules | Skills | Monitor | Transcripts | Hooks | MCP | Hosted agent | Arbitrary models |"
    divider = "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
    lines = [header, divider]

    for row in sorted(rows, key=lambda r: r.get("name", "")):
        values = row.get("form_factor", {})
        ff = _sort_form_factors(values.get("values", [])) if isinstance(values, dict) else []
        lines.append(
            "| "
            + " | ".join(
                [
                    row.get("name", ""),
                    ", ".join(ff),
                    _readme_value(row, "released_in"),
                    _readme_value(row, "latest_major_update"),
                    _readme_support(row, "some_free_usage"),
                    _readme_support(row, "no_account_required"),
                    _readme_support(row, "can_use_other_subscriptions"),
                    _readme_support(row, "rules"),
                    _readme_support(row, "skills"),
                    _readme_support(row, "monitor"),
                    _readme_support(row, "transcripts"),
                    _readme_support(row, "hooks"),
                    _readme_support(row, "mcp_servers"),
                    _readme_support(row, "hosted_agent"),
                    _readme_support(row, "custom_model_provider"),
                ]
            )
            + " |"
        )

    return "\n".join(lines) + "\n"


def _update_readme(rows: list[dict], path: str = README_PATH) -> None:
    readme = Path(path)
    content = readme.read_text(encoding="utf-8")
    start = content.find("## Rows")
    next_section = content.find("## Suggested Next Columns")
    if start == -1 or next_section == -1 or next_section < start:
        raise ValueError(f"{path} missing required README table markers")

    replacement = "## Rows\n\n" + _build_rows_markdown(rows) + "\n"
    readme.write_text(content[:start] + replacement + content[next_section:], encoding="utf-8")


def _validate_feature(name: str, key: str, value: object) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"{name}: {key} must be an object")
    support = value.get("support")
    if support not in {"", "none", "partial", "full", "unknown"}:
        raise ValueError(f"{name}: {key}.support has invalid value {support!r}")
    for required in ("source_url", "comment"):
        if required not in value or not isinstance(value[required], str):
            raise ValueError(f"{name}: {key}.{required} must be a string")
    _validate_source_url(name, key, value.get("source_url"))


def _validate_source_url(name: str, key: str, source_url: object) -> None:
    if not isinstance(source_url, str) or not source_url:
        raise ValueError(f"{name}: {key}.source_url must be a non-empty string")
    if "#:~:text=" in source_url:
        raise ValueError(f"{name}: {key}.source_url must include a heading anchor before the text-fragment highlight")
    if not re.search(r"#[^#?&:]+:~:text=", source_url):
        raise ValueError(f"{name}: {key}.source_url must include #heading:~:text=...")


def validate(schema_path: str, data_glob: str) -> None:
    schema = _load_json(schema_path)
    properties = schema.get("properties", {})
    required = _required_keys(schema)
    feature_keys = [
        key
        for key, spec in properties.items()
        if spec.get("allOf", [{}])[0].get("$ref", "").endswith("featureWithSource")
    ]

    for filename in sorted(glob.glob(data_glob)):
        data = _load_json(filename)
        missing = [key for key in required if key not in data]
        if missing:
            raise ValueError(f"{filename}: missing required keys: {', '.join(missing)}")
        if not isinstance(data.get("name"), str) or not data["name"]:
            raise ValueError(f"{filename}: name must be a non-empty string")
        links = data.get("links")
        if not isinstance(links, dict) or not links.get("slug"):
            raise ValueError(f"{filename}: links.slug is required")
        for key in feature_keys:
            if key in data:
                _validate_feature(filename, key, data[key])
        for key, value in data.items():
            if isinstance(value, dict) and "source_url" in value:
                _validate_source_url(filename, key, value["source_url"])


def parse_display_date(value: str) -> str | None:
    """Parse display strings like Jun '23 or 2023 into YYYY-MM-DD."""
    v = (value or "").strip()
    if not v:
        return None
    m = re.match(r"^([A-Za-z]{3})\s*['\u2019](\d{2})$", v)
    if m:
        month = MONTH_MAP.get(m.group(1).title())
        if not month:
            return None
        year = 2000 + int(m.group(2))
        return f"{year:04d}-{month:02d}-01"
    if re.fullmatch(r"\d{4}", v):
        return f"{v}-01-01"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        return v
    return None


def format_short_date(iso_date: str) -> str:
    dt = datetime.strptime(iso_date[:10], "%Y-%m-%d")
    return dt.strftime("%b '%y")


def parse_github_repo(url: str) -> tuple[str, str] | None:
    if not url or "github.com" not in url:
        return None
    parts = [p for p in url.split("github.com/", 1)[-1].split("?")[0].split("#")[0].strip("/").split("/") if p]
    if len(parts) < 2:
        return None
    owner, repo = parts[0], parts[1]
    if owner in GITHUB_PATH_BLOCKLIST:
        return None
    return owner, repo


def _github_headers(token: str | None) -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "agent-launch-matrix",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def github_json(path: str, token: str | None = None) -> object:
    req = urllib.request.Request(f"{GITHUB_API}{path}", headers=_github_headers(token))
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 403:
            raise RuntimeError("GitHub API rate limit; set GITHUB_TOKEN for bundle") from exc
        raise


def fetch_repo_created_at(owner: str, repo: str, token: str | None) -> str | None:
    data = github_json(f"/repos/{owner}/{repo}", token)
    if isinstance(data, dict) and data.get("created_at"):
        return data["created_at"][:10]
    return None


def fetch_oldest_release_date(owner: str, repo: str, token: str | None) -> str | None:
    oldest: str | None = None
    page = 1
    while page <= 10:
        batch = github_json(f"/repos/{owner}/{repo}/releases?per_page=100&page={page}", token)
        if not isinstance(batch, list) or not batch:
            break
        for release in batch:
            pub = release.get("published_at") or release.get("created_at")
            if not pub:
                continue
            day = pub[:10]
            if oldest is None or day < oldest:
                oldest = day
        if len(batch) < 100:
            break
        page += 1
        time.sleep(0.2)
    return oldest


def fetch_latest_commit_date(owner: str, repo: str, token: str | None) -> str | None:
    batch = github_json(f"/repos/{owner}/{repo}/commits?per_page=1", token)
    if not isinstance(batch, list) or not batch:
        return None
    commit = batch[0].get("commit") or {}
    for key in ("committer", "author"):
        meta = commit.get(key) or {}
        if meta.get("date"):
            return meta["date"][:10]
    return None


def _set_sort_date(field: dict, iso_date: str | None) -> None:
    if iso_date:
        field["sort_date"] = iso_date


def _ensure_sort_date_from_value(row: dict, key: str) -> None:
    field = row.get(key)
    if not isinstance(field, dict) or field.get("sort_date"):
        return
    parsed = parse_display_date(field.get("value", ""))
    if parsed:
        field["sort_date"] = parsed


def _rows_by_slug(rows: list[dict]) -> dict[str, dict]:
    result = {}
    for row in rows:
        slug = (row.get("links") or {}).get("slug")
        if slug:
            result[slug] = row
    return result


def _restore_previous_date_fields(row: dict, previous_row: dict | None) -> None:
    if not previous_row:
        return
    for key in ("released_in", "latest_major_update"):
        previous_field = previous_row.get(key)
        if isinstance(previous_field, dict) and isinstance(row.get(key), dict):
            row[key] = previous_field.copy()


def enrich_github_dates(rows: list[dict], previous_rows: list[dict] | None = None) -> None:
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    previous_by_slug = _rows_by_slug(previous_rows or [])
    for row in rows:
        name = row.get("name", "?")
        for key in ("released_in", "latest_major_update"):
            _ensure_sort_date_from_value(row, key)

        if row.get("deprecated"):
            continue

        links = row.get("links") or {}
        repo = parse_github_repo(links.get("github", ""))
        if not repo:
            continue

        owner, repo_name = repo
        try:
            released = row.get("released_in")
            needs_released_sort = not (isinstance(released, dict) and released.get("sort_date"))
            oldest_release = fetch_oldest_release_date(owner, repo_name, token) if needs_released_sort else None
            latest_commit = fetch_latest_commit_date(owner, repo_name, token)
            if needs_released_sort and not oldest_release:
                oldest_release = fetch_repo_created_at(owner, repo_name, token)
        except Exception as exc:
            _restore_previous_date_fields(row, previous_by_slug.get(links.get("slug", "")))
            print(f"  warn: {name}: GitHub dates skipped ({exc})", file=sys.stderr)
            continue

        if isinstance(released, dict) and oldest_release:
            _set_sort_date(released, oldest_release)

        updated = row.get("latest_major_update")
        if isinstance(updated, dict) and latest_commit:
            _set_sort_date(updated, latest_commit)
            updated["value"] = format_short_date(latest_commit)

        time.sleep(0.15)


def bundle(schema_path: str, data_glob: str, output_path: str) -> None:
    schema = _load_json(schema_path)
    properties = schema.get("properties", {})
    feature_keys = [
        key
        for key, spec in properties.items()
        if spec.get("allOf", [{}])[0].get("$ref", "").endswith("featureWithSource")
    ]
    output = Path(output_path)
    previous_bundle = output.read_text(encoding="utf-8") if output.exists() else None
    previous_rows = json.loads(previous_bundle, object_pairs_hook=OrderedDict) if previous_bundle else []
    rows = [_load_json(name) for name in sorted(glob.glob(data_glob))]
    enrich_github_dates(rows, previous_rows)
    next_bundle = json.dumps(rows, indent=2) + "\n"
    output.write_text(next_bundle, encoding="utf-8")
    metadata_path = Path(output_path).with_name("updated.json")
    if previous_bundle == next_bundle and metadata_path.exists():
        metadata = _load_json(metadata_path)
    else:
        metadata = {"updated_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z"}
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    _update_readme(rows)

    return rows, sorted(feature_keys), sorted(properties.keys())


def generate_llms_txt(bundle_path: str, output_path: str) -> None:
    schema = _load_json(Path(bundle_path).parent / "schema.json")
    properties = schema.get("properties", {})
    feature_keys = [
        key
        for key, spec in properties.items()
        if spec.get("allOf", [{}])[0].get("$ref", "").endswith("featureWithSource")
    ]
    meta_keys = {
        "name",
        "form_factor",
        "released_in",
        "latest_major_update",
        "pricing",
        "notes",
        "links",
        "hosted_agent",
    }
    meta_keys.add("hosted_agent")
    meta_cols = [k for k in properties if k in meta_keys and k != "links"]

    rows = _load_json(bundle_path)

    lines: list[str] = []
    lines.append("# Coding Agent Feature Matrix")
    lines.append(f"> Compare {len(rows)} coding agents, CLIs, and IDEs across features.")
    lines.append(f"> https://compare.ainorthstar.tech | Updated {__import__('datetime').date.today()}")
    lines.append("")

    col_width = max(len(r["name"]) for r in rows)
    feature_short = {
        "rules": "Rul", "skills": "Skl", "monitor": "Mon", "hooks": "Hks",
        "mcp_servers": "MCP", "custom_commands": "Cmd", "goal_command": "Gol", "subagents": "Sub",
        "git_worktrees": "Wkt", "done_notifications": "Ntf", "transcripts": "Trn", "chat_forking": "Frk",
        "model_selection": "Mod", "approval_mode": "App", "sandbox_mode": "San",
        "resume": "Res", "continue": "Con", "non_interactive": "Hdl",
        "output_format": "Fmt", "statusline": "Sta", "telemetry": "Tel",
        "some_free_usage": "Fre", "no_account_required": "NoA", "can_use_other_subscriptions": "Oth",
        "hosted_agent": "Hst", "custom_model_provider": "BYOM", "byok_prompt_caching": "Cch",
    }
    fkeys = [k for k in feature_keys if k in feature_short]
    glyph = {"full": "Y", "partial": "~", "none": "N", "unknown": "?", "": " "}

    hdr = f"{'Agent':<{col_width}}  Rel    FF{'':4s}" + "  ".join(f"{feature_short[k]:>4}" for k in fkeys)
    lines.append(hdr)
    lines.append("-" * len(hdr))

    for row in rows:
        ff_raw = row.get("form_factor", {}).get("values", [row.get("form_factor", {}).get("value", "")])
        ff = _sort_form_factors([v for v in ff_raw if v])
        ff_str = "/".join(ff)[:7] if ff else ""
        rel = row.get("released_in", {}).get("value", "")[:6]
        vals = "  ".join(
            f"{glyph.get(row.get(k, {}).get('support', ''), '?'):>4}"
            for k in fkeys
        )
        lines.append(f"{row['name']:<{col_width}}  {rel:<5} {ff_str:<8}{vals}")

    lines.append("")
    lines.append("## Feature legend")
    lines.append(f"{'Code':>4} = {' | '.join(f'{v}: {k}' for k,v in glyph.items())}")
    lines.append("FF = Form factor (CLI/IDE/Ext/SDK/Web)")
    lines.append("")

    lines.append("## Agent details")
    for row in rows:
        lines.append("")
        links = row.get("links", {})
        lines.append(f"### {row['name']}")
        if links.get("docs"):
            lines.append(f"- Docs: {links['docs']}")
        if links.get("github"):
            lines.append(f"- GitHub: {links['github']}")
        if links.get("website"):
            lines.append(f"- Website: {links['website']}")
        ff = row.get("form_factor", {})
        if ff.get("values") or ff.get("value"):
            vals = _sort_form_factors(ff.get("values") or [ff["value"]])
            lines.append(f"- Form factor: {', '.join(vals)}")
        if row.get("deprecated"):
            lines.append("- Status: Deprecated")
        if row.get("released_in", {}).get("value"):
            lines.append(f"- Released: {row['released_in']['value']}")
        if row.get("latest_major_update", {}).get("value"):
            lines.append(f"- Latest update: {row['latest_major_update']['value']}")
        for key in fkeys:
            val = row.get(key, {})
            support = val.get("support", "")
            c = val.get("comment", "")
            label = key.replace("_", " ").title()
            line = f"- {label}: {support if support else 'blank'}"
            if c:
                line += f" — {c}"
            lines.append(line)
        if row.get("pricing", {}).get("value"):
            lines.append(f"- Pricing: {row['pricing']['value']}")
        if row.get("notes"):
            lines.append(f"- Notes: {row['notes']}")

    Path(output_path).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"  ✓ llms.txt written ({output_path})")


def main() -> int:
    import datetime
    parser = argparse.ArgumentParser(description="Manage coding-agent matrix JSON data.")
    sub = parser.add_subparsers(dest="command", required=True)

    validate_cmd = sub.add_parser("validate")
    validate_cmd.add_argument("--schema", default="docs/tools/agent_matrix/schema.json")
    validate_cmd.add_argument("--data-glob", default="docs/tools/agent_matrix/data/*.json")

    bundle_cmd = sub.add_parser("bundle")
    bundle_cmd.add_argument("--schema", default="docs/tools/agent_matrix/schema.json")
    bundle_cmd.add_argument("--data-glob", default="docs/tools/agent_matrix/data/*.json")
    bundle_cmd.add_argument("--output", default="docs/tools/agent_matrix/bundle.json")

    llms_cmd = sub.add_parser("llms-txt")
    llms_cmd.add_argument("--bundle", default="docs/tools/agent_matrix/bundle.json")
    llms_cmd.add_argument("--output", default="docs/tools/agent_matrix/llms.txt")

    readme_cmd = sub.add_parser("readme")
    readme_cmd.add_argument("--data-glob", default="docs/tools/agent_matrix/data/*.json")
    readme_cmd.add_argument("--bundle", default="docs/tools/agent_matrix/bundle.json")
    readme_cmd.add_argument("--readme", default=README_PATH)

    args = parser.parse_args()
    if args.command == "validate":
        validate(args.schema, args.data_glob)
    elif args.command == "bundle":
        bundle(args.schema, args.data_glob, args.output)
    elif args.command == "llms-txt":
        generate_llms_txt(args.bundle, args.output)
    elif args.command == "readme":
        rows = _load_json(args.bundle) if Path(args.bundle).exists() else [_load_json(name) for name in sorted(glob.glob(args.data_glob))]
        _update_readme(rows, args.readme)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
