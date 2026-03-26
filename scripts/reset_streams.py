#!/usr/bin/env python3
"""reset_streams.py — One-time script to trim boundary:default stream and reset consumer group cursors.

Usage:
    python scripts/reset_streams.py
    python scripts/reset_streams.py --redis-url redis://localhost:6379/0
    python scripts/reset_streams.py --dry-run

What it does:
    1. Trims the boundary:default stream to the last 100 messages (removes old backlog).
    2. Resets all consumer group cursors to "$" so agents only see future messages.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

STREAM_NAME = "boundary:default"
KEEP_LAST = 100


async def run(redis_url: str, dry_run: bool) -> None:
    try:
        import redis.asyncio as aioredis
    except ImportError:
        print("ERROR: redis package not found. Install with: pip install redis", file=sys.stderr)
        sys.exit(1)

    client = aioredis.from_url(redis_url, decode_responses=True)

    try:
        # Check if stream exists
        stream_len = await client.xlen(STREAM_NAME)
        print(f"Stream '{STREAM_NAME}': {stream_len} messages")

        if stream_len == 0:
            print("Stream is empty — nothing to trim.")
        elif dry_run:
            print(f"[dry-run] Would trim stream to last {KEEP_LAST} messages.")
        else:
            # XTRIM with MAXLEN ~ keeps approximately the last N entries
            trimmed = await client.xtrim(STREAM_NAME, maxlen=KEEP_LAST, approximate=False)
            new_len = await client.xlen(STREAM_NAME)
            print(f"Trimmed {trimmed} messages. Stream now has {new_len} messages.")

        # Get all consumer groups
        groups = await client.xinfo_groups(STREAM_NAME)
        if not groups:
            print("No consumer groups found on stream.")
        else:
            print(f"Found {len(groups)} consumer group(s):")
            for group in groups:
                group_name = group["name"]
                pending = group.get("pending", 0)
                last_id = group.get("last-delivered-id", "unknown")
                print(f"  - {group_name}: last-delivered={last_id}, pending={pending}")

                if dry_run:
                    print(f"    [dry-run] Would reset cursor to '$' and clear PEL")
                else:
                    # Reset the group cursor to "$" (only future messages)
                    await client.xgroup_setid(STREAM_NAME, group_name, "$")
                    print(f"    Reset cursor to '$'")

            if not dry_run:
                print("All consumer group cursors reset to '$'.")

        print("Done.")

    finally:
        await client.aclose()


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset boundary:default stream and consumer groups.")
    parser.add_argument(
        "--redis-url",
        default="redis://localhost:6379/0",
        help="Redis URL (default: redis://localhost:6379/0)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without making changes.",
    )
    args = parser.parse_args()

    print(f"Redis: {args.redis_url}")
    if args.dry_run:
        print("Mode: DRY RUN (no changes will be made)")
    else:
        print("Mode: LIVE (changes will be applied)")
    print()

    asyncio.run(run(args.redis_url, args.dry_run))


if __name__ == "__main__":
    main()
