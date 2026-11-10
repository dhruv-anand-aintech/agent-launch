import importlib.machinery
import importlib.util
import os
import sys
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOADER = importlib.machinery.SourceFileLoader("agl_main", str(ROOT / "bin/agent-launch"))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
AGL = importlib.util.module_from_spec(SPEC)
sys.modules[LOADER.name] = AGL
LOADER.exec_module(AGL)


class PreferredAgentOrderTests(unittest.TestCase):
    def test_preferred_agents_lead_the_failover_order(self):
        order = AGL.preferred_agent_order(("codex",))
        self.assertEqual(order[0], "codex")
        expected = set(AGL.DEFAULT_AGENT_ORDER) - AGL.UNATTENDED_LOGIN_AGENTS
        self.assertEqual(set(order), expected)

    def test_unattended_order_skips_browser_login_agents(self):
        order = AGL.preferred_agent_order(("codex",))
        self.assertNotIn("aider", order)
        self.assertNotIn("antigravity", order)

    def test_browser_login_agents_remain_usable_when_named(self):
        order = AGL.preferred_agent_order(("aider", "codex"))
        self.assertEqual(order[:2], ("aider", "codex"))
        self.assertNotIn("antigravity", order)

    def test_no_preference_returns_none(self):
        self.assertIsNone(AGL.preferred_agent_order(()))


if __name__ == "__main__":
    unittest.main()


class CodexDaemonTests(unittest.TestCase):
    def test_default_model_is_gpt_6_1_terra(self):
        args = AGL.parse_args(["-a", "codex"])
        self.assertEqual(AGL.resolve_model("codex", args), "gpt-6.1-terra")

    def test_interactive_launch_and_resume_preserve_daemon_runtime(self):
        for extra in ([], ["--resume"], ["--continue"]):
            with self.subTest(extra=extra):
                args = AGL.parse_args(["-a", "codex", "--dry-run", *extra])
                command = AGL.build_command(args)
                self.assertNotIn("--no-daemon", command)
                self.assertNotIn("-c", command)

    def test_interactive_launch_disables_cmux_hook_overrides(self):
        args = AGL.parse_args(["-a", "codex"])
        command = AGL.build_command(args)
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(AGL.os, "execvp", side_effect=OSError("stop")):
            with self.assertRaisesRegex(OSError, "stop"):
                AGL.run_command(args, command)
            self.assertEqual(os.environ.get("CMUX_CODEX_HOOKS_DISABLED"), "1")


class ClaudeModelDefaultsTests(unittest.TestCase):
    def test_pro_default_is_opus_and_fast_is_haiku(self):
        self.assertEqual(AGL.resolve_model("claude", AGL.parse_args(["-a", "claude"])), "opus")
        self.assertEqual(AGL.AGENTS["claude"].fast_model, "haiku")
