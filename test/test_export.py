import importlib.machinery
import importlib.util
import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
LOADER = importlib.machinery.SourceFileLoader("agl_export", str(ROOT / "bin/agl-export"))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
EXPORT = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(EXPORT)


class ExportTests(unittest.TestCase):
    def test_tui_defaults_select_detected_sources_and_mark_profile(self):
        args = EXPORT.parse_args([])
        detected = [
            {"source": "codex", "transcript_store_found": True},
            {"source": "claude", "transcript_store_found": False},
        ]
        state = EXPORT.tui_initial_state(args, detected)
        self.assertEqual(state["selected"], {"codex"})
        self.assertEqual(state["default_selected"], {"codex"})
        self.assertEqual(state["days"], EXPORT.DEFAULT_DAYS)
        self.assertEqual(state["max_sessions_per_agent"], EXPORT.DEFAULT_MAX_SESSIONS)
        self.assertEqual(state["assistant_chars"], EXPORT.DEFAULT_ASSISTANT_CHARS)
        self.assertTrue(state["upload"])
        self.assertFalse(state["keep_local"])

    def test_tui_option_presets_cycle_both_directions(self):
        self.assertEqual(EXPORT.cycle_tui_value("days", 30, 1), 90)
        self.assertEqual(EXPORT.cycle_tui_value("days", 30, -1), 7)
        self.assertEqual(EXPORT.cycle_tui_value("days", 45, 1), 90)

    def test_redacts_secrets_identity_and_local_paths(self):
        text = "Authorization: Bearer abcdef email d@example.com path /Users/d/private/x API_KEY=supersecret id 123e4567-e89b-12d3-a456-426614174000 phone +91 98765 43210"
        redacted = EXPORT.redact_text(text)
        for private in ("abcdef", "d@example.com", "/Users/d", "supersecret", "123e4567", "98765"):
            self.assertNotIn(private, redacted)

    def test_codex_export_keeps_only_expected_fields(self):
        with tempfile.TemporaryDirectory() as raw:
            home = Path(raw)
            transcript = home / ".codex/sessions/2026/08/27/rollout-test.jsonl"
            transcript.parent.mkdir(parents=True)
            records = [
                {"type": "session_meta", "payload": {"id": "secret-id", "cwd": "/Users/d/private", "timestamp": "2026-08-27T00:00:00Z"}},
                {"type": "response_item", "payload": {"type": "message", "role": "developer", "content": [{"type": "input_text", "text": "hidden instructions"}]}},
                {"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "fix this with API_KEY=secret"}]}},
                {"type": "response_item", "payload": {"type": "reasoning", "summary": [{"text": "hidden reasoning"}]}},
                {"type": "response_item", "payload": {"type": "custom_tool_call", "name": "exec", "input": "cat ~/.env"}},
                {"type": "response_item", "payload": {"type": "custom_tool_call_output", "output": "private output"}},
                {"type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Implemented the requested change in a very long response."}]}},
            ]
            transcript.write_text("".join(json.dumps(row) + "\n" for row in records))
            sessions = EXPORT.collect_source("codex", home, 0, 10, b"salt", 1000, 12)
            self.assertEqual(len(sessions), 1)
            encoded = json.dumps(sessions[0])
            self.assertIn("[REDACTED]", encoded)
            self.assertIn('"exec": 1', encoded)
            for private in ("hidden instructions", "hidden reasoning", "cat ~/.env", "private output", "secret-id", "/Users/d/private"):
                self.assertNotIn(private, encoded)
            self.assertLessEqual(len(sessions[0]["assistant_snippets"][0]), 25)

    def test_archive_has_normalized_tree_and_mode_0600(self):
        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw) / "out.zip"
            session = EXPORT.empty_session("codex", "raw-id", "2026-08-27T00:00:00Z")
            EXPORT.add_message(session, "user", "do the work", 100, 20)
            EXPORT.add_tool(session, "exec")
            session = EXPORT.finalize_session(session, b"salt", 0)
            EXPORT.write_archive(output, [session], [], 30)
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            with zipfile.ZipFile(output) as archive:
                names = archive.namelist()
                self.assertIn("agl-recruitment-export/manifest.json", names)
                self.assertTrue(any(name.startswith("agl-recruitment-export/agents/codex/sessions/") for name in names))
                content = "".join(archive.read(name).decode() for name in names)
                self.assertNotIn("raw-id", content)

    def test_claude_and_cursor_cli_extract_text_and_tool_names_only(self):
        with tempfile.TemporaryDirectory() as raw:
            home = Path(raw)
            claude = home / ".claude/projects/project/session.jsonl"
            cursor = home / ".cursor/projects/project/agent-transcripts/session/session.jsonl"
            claude.parent.mkdir(parents=True)
            cursor.parent.mkdir(parents=True)
            claude.write_text(json.dumps({"type": "user", "message": {"content": "please fix it"}}) + "\n" + json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": "done"}, {"type": "tool_use", "name": "Read", "input": {"secret": "hidden"}}]}}) + "\n")
            cursor.write_text(json.dumps({"role": "user", "message": {"content": [{"type": "text", "text": "review this"}]}}) + "\n" + json.dumps({"role": "assistant", "message": {"content": [{"type": "tool_use", "name": "Shell", "input": {"command": "printenv"}}]}}) + "\n")
            claude_sessions = EXPORT.collect_source("claude", home, 0, 10, b"salt", 100, 20)
            cursor_sessions = EXPORT.collect_source("cursor-cli", home, 0, 10, b"salt", 100, 20)
            self.assertEqual(claude_sessions[0]["tool_calls"], {"Read": 1})
            self.assertEqual(cursor_sessions[0]["tool_calls"], {"Shell": 1})
            self.assertNotIn("hidden", json.dumps(claude_sessions))
            self.assertNotIn("printenv", json.dumps(cursor_sessions))

    def test_opencode_sqlite_extracts_parts_without_tool_state(self):
        with tempfile.TemporaryDirectory() as raw:
            home = Path(raw)
            path = home / ".local/share/opencode/opencode.db"
            path.parent.mkdir(parents=True)
            db = sqlite3.connect(path)
            db.executescript("CREATE TABLE session(id TEXT, time_created INTEGER, time_updated INTEGER); CREATE TABLE message(id TEXT, session_id TEXT, time_created INTEGER, data TEXT); CREATE TABLE part(message_id TEXT, time_created INTEGER, data TEXT);")
            now = 2_000_000_000_000
            db.execute("INSERT INTO session VALUES ('raw-session', ?, ?)", (now, now))
            db.execute("INSERT INTO message VALUES ('m1', 'raw-session', 1, ?)", (json.dumps({"role": "user"}),))
            db.execute("INSERT INTO part VALUES ('m1', 1, ?)", (json.dumps({"type": "text", "text": "build it"}),))
            db.execute("INSERT INTO part VALUES ('m1', 2, ?)", (json.dumps({"type": "tool", "tool": "bash", "state": {"input": "secret command", "output": "secret output"}}),))
            db.commit()
            db.close()
            sessions = EXPORT.collect_source("opencode", home, 0, 10, b"salt", 100, 20)
            encoded = json.dumps(sessions)
            self.assertEqual(sessions[0]["tool_calls"], {"bash": 1})
            self.assertIn("build it", encoded)
            self.assertNotIn("secret command", encoded)
            self.assertNotIn("raw-session", encoded)

    def test_noninteractive_requires_explicit_consent(self):
        with mock.patch.object(EXPORT.sys.stdin, "isatty", return_value=False):
            with self.assertRaises(SystemExit) as caught:
                EXPORT.main(["--no-upload"])
        self.assertIn("--yes", str(caught.exception))

    def test_presigned_upload_sends_zip_without_exposing_url(self):
        with tempfile.TemporaryDirectory() as raw:
            archive = Path(raw) / "export.zip"
            archive.write_bytes(b"zip bytes")
            response = mock.MagicMock()
            response.status = 200
            response.headers = {"ETag": '"abc"'}
            response.__enter__.return_value = response
            with mock.patch.object(EXPORT.urllib.request, "urlopen", return_value=response) as urlopen:
                self.assertEqual(EXPORT.upload_presigned(archive, "https://example.invalid/private?secret=yes"), "abc")
            request = urlopen.call_args.args[0]
            self.assertEqual(request.method, "PUT")
            self.assertEqual(request.data, b"zip bytes")
            self.assertEqual(request.headers["Content-type"], "application/zip")

    def test_only_accepts_signed_https_r2_upload_urls(self):
        self.assertEqual(EXPORT.validate_upload_url("https://account.r2.cloudflarestorage.com/bucket/key?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc"), "presigned")
        self.assertEqual(EXPORT.validate_upload_url(EXPORT.DEFAULT_UPLOAD_URL), "ingest")
        for url in ("http://account.r2.cloudflarestorage.com/bucket/key?X-Amz-Algorithm=x&X-Amz-Signature=y", "https://uploads.example.com/key?X-Amz-Algorithm=x&X-Amz-Signature=y", "https://account.r2.cloudflarestorage.com/bucket/key"):
            with self.assertRaises(SystemExit):
                EXPORT.validate_upload_url(url)

    def test_ingest_upload_uses_bearer_token_and_digest(self):
        with tempfile.TemporaryDirectory() as raw:
            archive = Path(raw) / "export.zip"
            archive.write_bytes(b"zip bytes")
            response = mock.MagicMock()
            response.status = 201
            response.read.return_value = json.dumps({"object": "candidates/date/id.zip"}).encode()
            response.__enter__.return_value = response
            with mock.patch.object(EXPORT.urllib.request, "urlopen", return_value=response) as urlopen:
                self.assertEqual(EXPORT.upload_ingest(archive, EXPORT.DEFAULT_UPLOAD_URL, "private-token"), "candidates/date/id.zip")
            request = urlopen.call_args.args[0]
            self.assertEqual(request.method, "POST")
            self.assertEqual(request.headers["Authorization"], "Bearer private-token")
            self.assertEqual(request.headers["User-agent"], "agl-export/1")
            self.assertEqual(request.headers["X-content-sha256"], EXPORT.hashlib.sha256(b"zip bytes").hexdigest())

    def test_archive_refuses_to_overwrite_existing_file(self):
        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw) / "out.zip"
            output.write_text("keep me")
            with self.assertRaises(FileExistsError):
                EXPORT.write_archive(output, [], [], 30)
            self.assertEqual(output.read_text(), "keep me")


if __name__ == "__main__":
    unittest.main()
