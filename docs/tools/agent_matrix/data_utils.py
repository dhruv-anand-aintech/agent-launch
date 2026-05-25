#!/usr/bin/env python3
"""Utilities for the coding-agent feature matrix JSON data."""

from __future__ import annotations

import argparse
import glob
import json
from collections import OrderedDict
from pathlib import Path


def _load_json(path: str | Path) -> OrderedDict:
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=OrderedDict)


def _required_keys(schema: dict) -> list[str]:
    return list(schema.get("required", []))


FORM_FACTOR_ORDER = ["CLI", "IDE", "Extension", "SDK", "Web"]


def _sort_form_factors(values: list[str]) -> list[str]:
    rank = {v: i for i, v in enumerate(FORM_FACTOR_ORDER)}
    return sorted(values, key=lambda v: (rank.get(v, 99), v))


def _validate_feature(name: str, key: str, value: object) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"{name}: {key} must be an object")
    support = value.get("support")
    if support not in {"", "none", "partial", "full", "unknown"}:
        raise ValueError(f"{name}: {key}.support has invalid value {support!r}")
    for required in ("source_url", "comment"):
        if required not in value or not isinstance(value[required], str):
            raise ValueError(f"{name}: {key}.{required} must be a string")
    if value.get("source_url") and "#:~:text=" not in value["source_url"]:
        raise ValueError(f"{name}: {key}.source_url must include a text-fragment highlight")


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
            if isinstance(value, dict) and "source_url" in value and value["source_url"]:
                if "#:~:text=" not in value["source_url"]:
                    raise ValueError(f"{filename}: {key}.source_url must include a text-fragment highlight")


def bundle(schema_path: str, data_glob: str, output_path: str) -> None:
    schema = _load_json(schema_path)
    properties = schema.get("properties", {})
    feature_keys = [
        key
        for key, spec in properties.items()
        if spec.get("allOf", [{}])[0].get("$ref", "").endswith("featureWithSource")
    ]
    rows = [_load_json(name) for name in sorted(glob.glob(data_glob))]
    Path(output_path).write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")

    return rows, sorted(feature_keys), sorted(properties.keys())


def generate_llms_txt(bundle_path: str, output_path: str) -> None:
    schema = _load_json(Path(bundle_path).parent / "schema.json")
    properties = schema.get("properties", {})
    feature_keys = [
        key
        for key, spec in properties.items()
        if spec.get("allOf", [{}])[0].get("$ref", "").endswith("featureWithSource")
    ]
    meta_keys = {"name", "form_factor", "released_in", "latest_major_update", "pricing", "notes", "links", "hosted_agent"}
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
        "rules": "Rul", "skills": "Skl", "hooks": "Hks",
        "mcp_servers": "MCP", "custom_commands": "Cmd", "subagents": "Sub",
        "model_selection": "Mod", "approval_mode": "App", "sandbox_mode": "San",
        "resume": "Res", "continue": "Con", "non_interactive": "Hdl",
        "output_format": "Fmt", "statusline": "Sta", "telemetry": "Tel",
        "hosted_agent": "Hst", "custom_model_provider": "BYOM",
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

    args = parser.parse_args()
    if args.command == "validate":
        validate(args.schema, args.data_glob)
    elif args.command == "bundle":
        bundle(args.schema, args.data_glob, args.output)
    elif args.command == "llms-txt":
        generate_llms_txt(args.bundle, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
