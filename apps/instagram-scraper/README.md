# Instagram.com Scraper (adapted to Scrape.do)

Originally from [scrapfly/scrapfly-scrapers](https://github.com/scrapfly/scrapfly-scrapers) (instagram-scraper), adapted for this project to fetch through [Scrape.do](https://scrape.do/) instead of ScrapFly. Only the request layer (`scrape_do_get` in `instagram.py`) was changed - the parsing logic (jmespath queries, `xig_polaris_media` HTML extraction) is untouched from the original.

Used by the mobile app's experimental "Testowa" tab (see `apps/backend/src/routes/testowa.ts`, which runs `run_scrapedo.py` as a subprocess) to scrape a given account's recent posts and their comments.

This scraper scrapes:
- Instagram.com user information
- Instagram.com user posts and their comments (first batch embedded on page load - see the note in `scrape_post_comments` in `instagram.py`, full comment pagination isn't implemented)

For output examples from the original ScrapFly version see the `./results` directory (kept for reference, not regenerated).

Note: This scraper only reads public Instagram data that doesn't require a login. Instagram's internal GraphQL `doc_id` values (`INSTAGRAM_ACCOUNT_DOCUMENT_ID`, `INSTAGRAM_DOCUMENT_ID`) rotate periodically - if scraping starts failing, these are the first thing to check/refresh.

## Setup and use

Requires Python 3.10+ (no poetry - just plain pip, since this only needs `requests` + `jmespath` now that scrapfly-sdk is gone):

```shell
pip install -r requirements.txt
```

Set the `SCRAPE_DO_KEY` environment variable (already set in `apps/backend/.env`, which is what the Node backend passes through when it spawns this script):

```shell
export SCRAPE_DO_KEY="your Scrape.do token"
```

Run standalone (same entrypoint the backend calls):

```shell
python run_scrapedo.py --username some_account --posts 10
```

Prints one JSON object to stdout: `{ "username": ..., "posts": [ { ...postFields, "comments": [...] } ] }`.

