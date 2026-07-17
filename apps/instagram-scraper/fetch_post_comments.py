"""CLI entrypoint called by the Node backend (apps/backend/src/integrations/
instagramScraper.ts, used by jobs/inspirationScrapeJob.ts) to fetch all
comments for a single post, logged-out, via Scrape.do.

Separate from run_scrapedo.py's --include-comments (which fetches comments
inline for every post in a scrape_user_posts run) because the backend only
wants comments once per post ever - the first time it's scraped - not
re-fetched on every daily re-scrape of an already-known post. See
docs/Backlog.md and jobs/inspirationScrapeJob.ts's existing-post skip.

Usage: python fetch_post_comments.py --url https://www.instagram.com/p/<shortcode>/
"""
import argparse
import json
import sys

from instagram import scrape_post_comments


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    args = parser.parse_args()

    try:
        comments = scrape_post_comments(args.url)
    except Exception as exc:  # noqa: BLE001 - surfaced as a clean JSON error, not a Python traceback
        json.dump({"error": str(exc)}, sys.stdout)
        return 1

    json.dump({"comments": comments}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
