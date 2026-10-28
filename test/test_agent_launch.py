import importlib.machinery
import importlib.util
import sys
import unittest
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
