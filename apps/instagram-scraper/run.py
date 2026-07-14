"""
Example run script for the Instagram scraper in ./instagram.py (now fetching
through Scrape.do - see the module docstring in instagram.py). Set
$SCRAPE_DO_KEY before running.

For the actual entrypoint the Node backend calls, see run_scrapedo.py.
"""
import json
import sys
from pathlib import Path

import instagram

output = Path(__file__).parent / "results"
output.mkdir(exist_ok=True)


def run():
    print("running Instagram scrape and saving results to ./results directory", file=sys.stderr)

    user = instagram.scrape_user("google")
    output.joinpath("user.json").write_text(json.dumps(user, indent=2, ensure_ascii=False), encoding="utf-8")

    post_video = instagram.scrape_post("https://www.instagram.com/p/Cs9iEotsiGY/")
    output.joinpath("video-post.json").write_text(json.dumps(post_video, indent=2, ensure_ascii=False), encoding="utf-8")

    post_multi_image = instagram.scrape_post("https://www.instagram.com/p/Csthn7EO99u/")
    output.joinpath("multi-image-post.json").write_text(json.dumps(post_multi_image, indent=2, ensure_ascii=False), encoding="utf-8")

    posts_all = list(instagram.scrape_user_posts("google", max_pages=3))
    print(f"scraped {len(posts_all)} posts", file=sys.stderr)
    output.joinpath("all-user-posts.json").write_text(json.dumps(posts_all, indent=2, ensure_ascii=False), encoding="utf-8")

    comments = instagram.scrape_post_comments("https://www.instagram.com/p/Csthn7EO99u/")
    output.joinpath("post-comments.json").write_text(json.dumps(comments, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    run()
