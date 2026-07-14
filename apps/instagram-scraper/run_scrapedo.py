"""CLI entrypoint called by the Node backend (apps/backend/src/integrations/
instagramScraper.ts, used by jobs/inspirationScrapeJob.ts): scrapes an
Instagram account's most recent posts, optionally with each post's comments,
via Scrape.do, and prints the result as one JSON object on stdout. Diagnostic
logging goes to stderr so it never corrupts the stdout JSON.

Usage: python run_scrapedo.py --username <name> --posts 10 [--include-comments]

Comments are opt-in (--include-comments) because full comment pagination is
several extra Scrape.do requests per post - the production Instagram job
currently only needs post data, not comments (see docs/Backlog.md), but the
flag exists so that can be turned on later without any other code changes.
"""
import argparse
import json
import sys

from instagram import scrape_user_posts, scrape_post_comments


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--posts", type=int, default=10)
    parser.add_argument("--include-comments", action="store_true")
    args = parser.parse_args()

    posts = []
    try:
        for post in scrape_user_posts(args.username, page_size=args.posts, max_pages=1):
            if args.include_comments:
                shortcode = post.get("shortcode")
                comments = []
                comments_error = None
                if shortcode:
                    try:
                        comments = scrape_post_comments(f"https://www.instagram.com/p/{shortcode}/")
                    except Exception as exc:  # noqa: BLE001 - a single post's comments failing shouldn't kill the whole run
                        comments_error = str(exc)
                post["comments"] = comments
                if comments_error:
                    post["comments_error"] = comments_error
            else:
                post["comments"] = []
            posts.append(post)
            if len(posts) >= args.posts:
                break
    except Exception as exc:  # noqa: BLE001 - surfaced as a clean JSON error, not a Python traceback
        json.dump({"error": str(exc)}, sys.stdout)
        return 1

    json.dump({"username": args.username, "posts": posts}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
