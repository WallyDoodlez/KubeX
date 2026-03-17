"""kubex-harness unified entry point — invoked by entrypoint.sh (BASE-04).

Routes to either the standalone agent loop or the OpenClaw harness based on
the ``harness_mode`` field in config.yaml.

Modes:
    standalone (default): Polls Broker, calls LLM via Gateway proxy, posts results.
        Uses StandaloneAgent from standalone.py.
        For agents with tool definitions in their skill manifest, the agent loop
        automatically uses a multi-turn function-calling loop.

    openclaw: Spawns the OpenClaw CLI agent loop via KubexHarness.
        Uses KubexHarness from harness.py.

Boot sequence:
    1. Load config via load_agent_config() — fails fast if /app/config.yaml missing
    2. Log structured boot summary
    3. Route to the appropriate harness based on harness_mode
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import sys

logger = logging.getLogger("kubex_harness.main")


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
        stream=sys.stdout,
    )


async def _run() -> None:
    from kubex_harness.config_loader import load_agent_config

    config = load_agent_config()

    # Log structured boot summary
    logger.info(
        "kubex-harness booting: agent_id=%s model=%s harness_mode=%s skills=%s capabilities=%s",
        config.agent_id,
        config.model,
        config.harness_mode,
        config.skills,
        config.capabilities,
    )

    if config.harness_mode == "openclaw":
        # Route to OpenClaw harness
        try:
            from kubex_harness.harness import HarnessConfig, KubexHarness  # noqa: F401
        except ImportError:
            logger.error("OpenClaw harness not available — falling back to standalone")
            config.harness_mode = "standalone"

    if config.harness_mode == "standalone":
        from kubex_harness.standalone import StandaloneAgent

        agent = StandaloneAgent(config)

        # Graceful shutdown on SIGTERM/SIGINT
        import signal

        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            with contextlib.suppress(NotImplementedError):  # Windows: no add_signal_handler
                loop.add_signal_handler(sig, agent.stop)

        await agent.run()

    elif config.harness_mode == "openclaw":
        from kubex_harness.harness import HarnessConfig, KubexHarness

        harness_config = HarnessConfig.from_env()
        harness = KubexHarness(harness_config)
        exit_reason = await harness.run()
        sys.exit(0 if exit_reason.value == "completed" else 1)

    else:
        logger.error("Unknown harness_mode: %r — expected 'standalone' or 'openclaw'", config.harness_mode)
        sys.exit(1)


def main() -> None:
    """Entry point for 'python -m kubex_harness.main'."""
    _setup_logging()
    asyncio.run(_run())


if __name__ == "__main__":
    main()
