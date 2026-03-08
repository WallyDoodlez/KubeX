"""kubex-harness CLI entry point — invoked by entrypoint.sh."""

from __future__ import annotations

import asyncio
import sys

from .harness import HarnessConfig, KubexHarness


async def _run() -> None:
    config = HarnessConfig.from_env()
    harness = KubexHarness(config)
    exit_reason = await harness.run()
    sys.exit(0 if exit_reason.value == "completed" else 1)


def main() -> None:
    """Entry point for 'python -m kubex_harness.main'."""
    asyncio.run(_run())


if __name__ == "__main__":
    main()
