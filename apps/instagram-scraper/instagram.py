"""
Instagram scraper adapted from the scrapfly-scrapers reference implementation
(https://github.com/scrapfly/scrapfly-scrapers, instagram-scraper), with the
scrapfly-sdk fetch layer swapped for Scrape.do (https://scrape.do). Only the
request layer changed - all parsing logic (jmespath queries, the
xig_polaris_media HTML extraction) is unmodified from the original.

Set env variable $SCRAPE_DO_KEY with your Scrape.do token before running.
"""
import json
import os
import sys
import re
from typing import Dict, Optional
from urllib.parse import urlencode

import jmespath
import requests


# --- Minimal stderr logger (replaces loguru from the original - one less
# dependency for a script that only needs to run standalone). ---
class _Log:
    def _emit(self, level: str, msg: str, *args):
        try:
            print(f"[{level}] {msg.format(*args)}", file=sys.stderr)
        except Exception:
            print(f"[{level}] {msg}", file=sys.stderr)

    def info(self, msg, *a):
        self._emit("INFO", msg, *a)

    def debug(self, msg, *a):
        self._emit("DEBUG", msg, *a)

    def warning(self, msg, *a):
        self._emit("WARN", msg, *a)

    def success(self, msg, *a):
        self._emit("OK", msg, *a)


log = _Log()

INSTAGRAM_APP_ID = "936619743392459"  # this is the public app id for instagram.com
INSTAGRAM_DOCUMENT_ID = "8845758582119845"  # constant id for post documents instagram.com
INSTAGRAM_ACCOUNT_DOCUMENT_ID = "9310670392322965"

SCRAPE_DO_BASE_URL = "https://api.scrape.do/"


class ScrapeDoResult:
    """Mirrors the small part of scrapfly's ScrapeApiResponse shape (`.content`)
    that the parsing functions below actually use, so those functions didn't
    need to change."""

    def __init__(self, content: str):
        self.content = content


def scrape_do_get(url: str, headers: Optional[Dict[str, str]] = None, render: bool = False, super_proxy: bool = True) -> ScrapeDoResult:
    """Fetch `url` through the Scrape.do proxy (https://scrape.do/documentation/).

    super_proxy defaults to True - Instagram has aggressive anti-bot
    protection, so datacenter IPs get blocked quickly.
    """
    token = os.environ.get("SCRAPE_DO_KEY")
    if not token:
        raise RuntimeError("SCRAPE_DO_KEY environment variable is not set.")

    params = {"token": token, "url": url}
    if render:
        params["render"] = "true"
    if super_proxy:
        params["super"] = "true"

    request_headers: Dict[str, str] = {}
    if headers:
        params["extraHeaders"] = "true"
        for name, value in headers.items():
            request_headers[f"sd-{name}"] = value

    resp = requests.get(SCRAPE_DO_BASE_URL, params=params, headers=request_headers, timeout=90)
    if resp.status_code >= 400:
        raise RuntimeError(f"Scrape.do request failed ({resp.status_code}): {resp.text[:300]}")
    return ScrapeDoResult(content=resp.text)


def parse_user(data: Dict) -> Dict:
    """Reduce the user data to the relevant fields"""
    log.debug("parsing user data {}", data["username"])
    result = jmespath.search(
        """{
        name: full_name,
        username: username,
        id: id,
        category: category_name,
        business_category: business_category_name,
        phone: business_phone_number,
        email: business_email,
        bio: biography,
        bio_links: bio_links[].url,
        homepage: external_url,
        followers: edge_followed_by.count,
        follows: edge_follow.count,
        facebook_id: fbid,
        is_private: is_private,
        is_verified: is_verified,
        profile_image: profile_pic_url_hd,
        video_count: edge_felix_video_timeline.count,
        videos: edge_felix_video_timeline.edges[].node.{
            id: id,
            title: title,
            shortcode: shortcode,
            thumb: display_url,
            url: video_url,
            views: video_view_count,
            tagged: edge_media_to_tagged_user.edges[].node.user.username,
            captions: edge_media_to_caption.edges[].node.text,
            comments_count: edge_media_to_comment.count,
            comments_disabled: comments_disabled,
            taken_at: taken_at_timestamp,
            likes: edge_liked_by.count,
            location: location.name,
            duration: video_duration
        },
        image_count: edge_owner_to_timeline_media.count,
        images: edge_felix_video_timeline.edges[].node.{
            id: id,
            title: title,
            shortcode: shortcode,
            src: display_url,
            url: video_url,
            views: video_view_count,
            tagged: edge_media_to_tagged_user.edges[].node.user.username,
            captions: edge_media_to_caption.edges[].node.text,
            comments_count: edge_media_to_comment.count,
            comments_disabled: comments_disabled,
            taken_at: taken_at_timestamp,
            likes: edge_liked_by.count,
            location: location.name,
            accesibility_caption: accessibility_caption,
            duration: video_duration
        },
        saved_count: edge_saved_media.count,
        collections_count: edge_saved_media.count,
        related_profiles: edge_related_profiles.edges[].node.username
    }""",
        data,
    )
    return result


def scrape_user(username: str) -> Dict:
    """Scrape instagram user's data"""
    log.info("scraping instagram user {}", username)
    result = scrape_do_get(
        f"https://i.instagram.com/api/v1/users/web_profile_info/?username={username}",
        headers={"x-ig-app-id": INSTAGRAM_APP_ID},
    )
    data = json.loads(result.content)
    return parse_user(data["data"]["user"])


def parse_comments(data: Dict) -> Dict:
    """Parse the comments data from the post dataset"""
    if "edge_media_to_comment" in data:
        return jmespath.search(
            """{
                comments_count: edge_media_to_comment.count,
                comments_disabled: comments_disabled,
                comments_next_page: edge_media_to_comment.page_info.end_cursor,
                comments: edge_media_to_comment.edges[].node.{
                    id: id,
                    text: text,
                    created_at: created_at,
                    owner_id: owner.id,
                    owner: owner.username,
                    owner_verified: owner.is_verified,
                    viewer_has_liked: viewer_has_liked
                }
            }""",
            data,
        )
    else:
        return jmespath.search(
            """{
                comments_count: edge_media_to_parent_comment.count,
                comments_disabled: comments_disabled,
                comments_next_page: edge_media_to_parent_comment.page_info.end_cursor,
                comments: edge_media_to_parent_comment.edges[].node.{
                    id: id,
                    text: text,
                    created_at: created_at,
                    owner: owner.username,
                    owner_verified: owner.is_verified,
                    viewer_has_liked: viewer_has_liked,
                    likes: edge_liked_by.count
                }
            }""",
            data,
        )


def _extract_xig_polaris_media(html: str) -> Optional[Dict]:
    scripts = re.findall(
        r'<script[^>]*data-sjs[^>]*>(.*?)</script>', html, re.DOTALL
    )
    for script in scripts:
        if "xig_polaris_media" not in script:
            continue
        try:
            payload = json.loads(script)
            modules = payload["require"][0][3][0]["__bbox"]["require"]
        except (KeyError, IndexError, TypeError, json.JSONDecodeError):
            continue
        for module in modules:
            if not isinstance(module, list) or len(module) <= 3:
                continue
            for entry in module[3]:
                if not isinstance(entry, dict):
                    continue
                media = (
                    entry.get("__bbox", {})
                    .get("result", {})
                    .get("data", {})
                    .get("xig_polaris_media")
                )
                if media:
                    return media
    return None


def parse_post(data: Dict) -> Dict:
    """Parse post data from the xig_polaris_media HTML-embedded structure"""
    post = data.get("if_not_gated_logged_out") or data
    caption_text = (post.get("caption") or {}).get("text")

    comments = []
    for edge in (data.get("comments_connection") or {}).get("edges") or []:
        node = edge.get("node")
        if not node:
            continue
        user = node.get("user") or {}
        comments.append({
            "id": str(node.get("pk", "")),
            "text": node.get("text", ""),
            "created_at": node.get("created_at"),
            "owner": user.get("username", ""),
            "owner_id": str(user.get("pk", "")),
            "owner_verified": user.get("is_verified", False),
            "likes": node.get("comment_like_count", 0),
        })

    return {
        "id": str(post.get("pk", "")),
        "shortcode": post.get("code", ""),
        "src": post.get("display_uri", ""),
        "src_attached": [
            m["display_uri"]
            for m in post.get("carousel_media") or []
            if m.get("display_uri")
        ],
        "likes": post.get("like_count"),
        "taken_at": post.get("taken_at"),
        "location": (post.get("location") or {}).get("name"),
        "captions": [caption_text] if caption_text else [],
        "comments_count": post.get("comment_count"),
        "comments": comments,
    }


def scrape_post(url_or_shortcode: str) -> Dict:
    """Scrape single Instagram post data by parsing the HTML page"""
    if "http" not in url_or_shortcode:
        url = f"https://www.instagram.com/p/{url_or_shortcode}/"
    else:
        url = url_or_shortcode

    log.info("scraping instagram post: {}", url)
    result = scrape_do_get(url)
    media = _extract_xig_polaris_media(result.content)
    if not media:
        raise ValueError(f"Could not find post data in page: {url}")
    return parse_post(media)


def parse_user_posts(data: Dict) -> Dict:
    """Reduce users posts' dataset to the most important fields"""
    result = jmespath.search(
        """{
        id: id,
        pk: pk,
        shortcode: code,
        caption: caption,
        taken_at: taken_at,
        video_versions: video_versions,
        image_versions2: image_versions2,
        original_height: original_height,
        original_width: original_width,
        link: link,
        title: title,
        comment_count: comment_count,
        top_likers: top_likers,
        like_count: like_count,
        usertags: usertags,
        clips_metadata: clips_metadata,
        comments: comments,
        carousel_media_count: carousel_media_count,
        carousel_media: carousel_media[].{
            media_type: media_type,
            image_url: image_versions2.candidates[0].url,
            video_url: video_versions[0].url
        }
    }""",
        data,
    )

    return result


def scrape_user_posts(username: str, page_size=12, max_pages: Optional[int] = None):
    """Scrape all posts of an instagram user of given the username"""
    base_url = "https://www.instagram.com/graphql/query/"
    variables = {
        "after": None,
        "before": None,
        "data": {
            "count": page_size,
            "include_reel_media_seen_timestamp": True,
            "include_relationship_info": True,
            "latest_besties_reel_media": True,
            "latest_reel_media": True
        },
        "first": page_size,
        "last": None,
        "username": f"{username}",
        "__relay_internal__pv__PolarisIsLoggedInrelayprovider": True,
        "__relay_internal__pv__PolarisShareSheetV3relayprovider": True
    }

    prev_cursor = None
    _page_number = 1

    while True:
        params = {
            "doc_id": INSTAGRAM_ACCOUNT_DOCUMENT_ID,  # e.g., "7950326061742207"
            "variables": json.dumps(variables, separators=(",", ":"))
        }

        # Build the final URL by appending the query string to the base URL
        final_url = f"{base_url}?{urlencode(params)}"
        result = scrape_do_get(final_url, headers={"content-type": "application/x-www-form-urlencoded"})

        data = json.loads(result.content)

        posts = data["data"]["xdt_api__v1__feed__user_timeline_graphql_connection"]
        for post in posts["edges"]:
            yield parse_user_posts(post["node"])

        page_info = posts["page_info"]
        if not page_info["has_next_page"]:
            log.info("scraping posts page {}", _page_number)
            break

        if page_info["end_cursor"] == prev_cursor:
            log.warning("found no new posts, breaking")
            break

        prev_cursor = page_info["end_cursor"]
        variables["after"] = page_info["end_cursor"]
        _page_number += 1

        if max_pages and _page_number > max_pages:
            break


def parse_post_comment(data: Dict) -> Dict:
    """refine the comment dataset"""
    return jmespath.search(
        """{
        id: pk,
        text: text,
        created_at: created_at,
        owner: user.username,
        owner_id: user.id,
        owner_verified: user.is_verified,
        owner_profile_pic: user.profile_pic_url,
        likes: comment_like_count
    }""",
        data,
    )


# Anonymous (logged-out) full comment pagination via Instagram's own web
# client GraphQL endpoint - discovered 2026-07 by inspecting DevTools network
# traffic on a real logged-out browser session (the `xig_polaris_media`
# HTML-embed technique the rest of this file uses only ever exposes 1-2
# "preview" comments, and the private mobile API needs a real login).
#
# THIS WILL GO STALE: `doc_id` values rotate roughly every 2-4 weeks as an
# anti-scraping measure. When this starts failing, refresh it: open any
# public Instagram post in a normal (logged-out/incognito) browser, open
# DevTools > Network, filter "graphql", scroll the comments panel to load
# more, find the request to `api/graphql` whose `x-fb-friendly-name` is
# "PolarisLoggedOutDesktopWWWPostCommentsPaginationQuery", right-click it >
# Copy > Copy as cURL, and read the new `doc_id` out of the pasted command's
# --data-raw body.
INSTAGRAM_COMMENTS_DOC_ID = "27261273046856309"
INSTAGRAM_COMMENTS_FRIENDLY_NAME = "PolarisLoggedOutDesktopWWWPostCommentsPaginationQuery"
MAX_COMMENT_PAGES = 20  # safety cap (~300 comments at 15/page) against runaway pagination on mega-viral posts


def _comet_jazoest(lsd_token: str) -> str:
    """Facebook/Instagram's Comet framework derives this simple checksum from
    the `lsd` token and expects it alongside every request - verified against
    a real captured request (same lsd -> same jazoest)."""
    return "2" + str(sum(ord(c) for c in lsd_token))


def _bootstrap_anonymous_tokens(post_url: str) -> Dict[str, str]:
    """Visits the post page as a logged-out browser would, to harvest the
    per-visit `csrftoken`/`datr` cookies and `lsd` token Instagram hands out
    to anonymous visitors (no login involved - these are issued to every
    visitor, the same way a real browser gets them on first page load)."""
    result = scrape_do_get(post_url, render=False)

    lsd_match = re.search(r'\["LSD",\[\],\{"token":"([^"]+)"', result.content)
    if not lsd_match:
        raise ValueError("Could not find anonymous LSD token in page - Instagram's page structure may have changed.")

    # cookies are set via scrape_do_get's underlying request; re-fetch them
    # explicitly with pureCookies so we get the raw Set-Cookie header back.
    token = os.environ.get("SCRAPE_DO_KEY")
    resp = requests.get(
        SCRAPE_DO_BASE_URL,
        params={"token": token, "url": post_url, "super": "true", "pureCookies": "true"},
        timeout=90,
    )
    set_cookie = resp.headers.get("set-cookie", "")
    csrftoken_match = re.search(r"csrftoken=([^;]+)", set_cookie)
    datr_match = re.search(r"datr=([^;]+)", set_cookie)
    if not csrftoken_match or not datr_match:
        raise ValueError("Could not extract anonymous csrftoken/datr cookies.")

    return {
        "csrftoken": csrftoken_match.group(1),
        "datr": datr_match.group(1),
        "lsd": lsd_match.group(1),
    }


def _fetch_comments_page(media_id: str, after: Optional[str], tokens: Dict[str, str]) -> Dict:
    """One page of the anonymous comments-pagination GraphQL query. See the
    module-level comment above INSTAGRAM_COMMENTS_DOC_ID for how to refresh
    doc_id if this starts failing."""
    variables = {"after": after, "first": 20, "media_id": media_id}
    body = {
        "av": "0",
        "__d": "www",
        "__user": "0",
        "__a": "1",
        "__req": "1",
        "dpr": "1",
        "__ccg": "GOOD",
        "__comet_req": "7",
        "lsd": tokens["lsd"],
        "jazoest": _comet_jazoest(tokens["lsd"]),
        "__crn": "comet.igweb.PolarisLoggedOutDesktopWWWPostRoute",
        "fb_api_caller_class": "RelayModern",
        "fb_api_req_friendly_name": INSTAGRAM_COMMENTS_FRIENDLY_NAME,
        "server_timestamps": "true",
        "variables": json.dumps(variables, separators=(",", ":")),
        "doc_id": INSTAGRAM_COMMENTS_DOC_ID,
    }

    token = os.environ.get("SCRAPE_DO_KEY")
    if not token:
        raise RuntimeError("SCRAPE_DO_KEY environment variable is not set.")

    params = {"token": token, "url": "https://www.instagram.com/api/graphql", "super": "true", "extraHeaders": "true"}
    headers = {
        "sd-content-type": "application/x-www-form-urlencoded",
        "sd-x-csrftoken": tokens["csrftoken"],
        "sd-x-ig-app-id": INSTAGRAM_APP_ID,
        "sd-x-fb-friendly-name": INSTAGRAM_COMMENTS_FRIENDLY_NAME,
        "sd-x-fb-lsd": tokens["lsd"],
        "sd-cookie": f"csrftoken={tokens['csrftoken']}; datr={tokens['datr']}",
    }
    resp = requests.post(SCRAPE_DO_BASE_URL, params=params, headers=headers, data=body, timeout=90)
    if resp.status_code >= 400:
        raise RuntimeError(f"Scrape.do comments request failed ({resp.status_code}): {resp.text[:300]}")
    return json.loads(resp.text)


def scrape_post_comments(url: str, media_id: Optional[str] = None):
    """Scrape ALL comments from an Instagram post (paginated), logged-out.

    `media_id` (the numeric part of a post's `id` field, e.g. from
    scrape_user_posts/scrape_post's "id" - strip the "_<owner_id>" suffix if
    present) avoids one extra request if the caller already has it; if not
    given, this resolves it by scraping the post page first.
    """
    if not media_id:
        post = scrape_post(url)
        media_id = str(post.get("id", "")).split("_")[0]
        if not media_id:
            raise ValueError(f"Could not resolve media_id for post: {url}")

    tokens = _bootstrap_anonymous_tokens(url)

    comments = []
    after = None
    for page_number in range(1, MAX_COMMENT_PAGES + 1):
        data = _fetch_comments_page(media_id, after, tokens)
        media = data.get("data", {}).get("xig_polaris_media") or {}
        connection = media.get("comments_connection") or {}
        edges = connection.get("edges") or []
        for edge in edges:
            node = edge.get("node")
            if node:
                comments.append(parse_post_comment(node))

        page_info = connection.get("page_info") or {}
        if not page_info.get("has_next_page") or not edges:
            log.info("scraped {} comment pages, {} comments total", page_number, len(comments))
            break
        after = page_info.get("end_cursor")
    else:
        log.warning("hit MAX_COMMENT_PAGES ({}) cap, comments may be incomplete", MAX_COMMENT_PAGES)

    return comments
