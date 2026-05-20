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


def bundle(data_glob: str, output_path: str) -> None:
    rows = [_load_json(name) for name in sorted(glob.glob(data_glob))]
    Path(output_path).write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage coding-agent matrix JSON data.")
    sub = parser.add_subparsers(dest="command", required=True)

    validate_cmd = sub.add_parser("validate")
    validate_cmd.add_argument("--schema", default="docs/tools/agent_matrix/schema.json")
    validate_cmd.add_argument("--data-glob", default="docs/tools/agent_matrix/data/*.json")

    bundle_cmd = sub.add_parser("bundle")
    bundle_cmd.add_argument("--data-glob", default="docs/tools/agent_matrix/data/*.json")
    bundle_cmd.add_argument("--output", default="docs/tools/agent_matrix/bundle.json")

    args = parser.parse_args()
    if args.command == "validate":
        validate(args.schema, args.data_glob)
    elif args.command == "bundle":
        bundle(args.data_glob, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
