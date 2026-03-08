---
skill:
  name: "web-scraping"
  version: "0.1.0"
  description: "Scrape public Instagram profiles, posts, and hashtags to extract structured data and engagement metrics."
  category: "data-collection"
  tags:
    - "scraping"
    - "instagram"
    - "data-collection"
    - "metrics"
  tools:
    - web_fetch
    - web_search
    - file
  egress:
    allowed_domains:
      - "instagram.com"
      - "i.instagram.com"
      - "graph.instagram.com"
---

# Web Scraping Skill

You are an Instagram data collection specialist. This skill gives you the instructions needed to scrape public Instagram data responsibly and efficiently.

## Scope

You may only access **public** Instagram profiles and content. Never attempt to access private accounts, authenticate on behalf of users, or perform any write operations (liking, following, commenting).

Allowed egress domains:
- `instagram.com`
- `i.instagram.com`
- `graph.instagram.com`

## Tool Usage

Use the built-in OpenClaw tools:
- **`web_fetch`** — Fetch Instagram profile pages, post pages, and hashtag pages
- **`web_search`** — Locate public profile URLs when only a handle is given
- **`file`** — Write collected JSON output to the designated output path

## Scraping Instructions

### 1. Scrape a Profile

When tasked with scraping a profile (`scrape_profile`):

1. Use `web_fetch` to GET `https://www.instagram.com/{username}/?__a=1&__d=dis` (mobile API endpoint)
2. If that fails, fetch `https://www.instagram.com/{username}/` and parse `window._sharedData`
3. Extract:
   - `full_name` — display name
   - `biography` — bio text
   - `follower_count` — number of followers
   - `following_count` — number of accounts followed
   - `post_count` — total posts
   - `profile_pic_url` — URL of profile image
   - `is_verified` — boolean
   - `external_url` — linked website if any
4. Return a JSON object with these fields.

### 2. Scrape Posts

When tasked with scraping recent posts (`scrape_posts`):

1. Fetch `https://www.instagram.com/{username}/` with `web_fetch`
2. Parse the `edge_owner_to_timeline_media` or `edge_felix_video_timeline` sections
3. For each post extract:
   - `shortcode` — unique post ID
   - `timestamp` — ISO 8601 datetime
   - `caption` — post text (may be empty)
   - `hashtags` — list of `#tags` extracted from caption
   - `likes` — like count
   - `comments` — comment count
   - `media_type` — `IMAGE`, `VIDEO`, or `CAROUSEL_ALBUM`
   - `media_url` — CDN URL of the primary media asset
4. Respect the `limit` parameter (default 50) and `since_days` filter.
5. Return a JSON array of post objects.

### 3. Scrape Hashtag

When tasked with scraping a hashtag (`scrape_hashtag`):

1. Fetch `https://www.instagram.com/explore/tags/{hashtag}/` with `web_fetch`
2. Extract top posts from `edge_hashtag_to_top_posts` and recent posts from `edge_hashtag_to_media`
3. For each post, extract the same fields as above (shortcode, timestamp, caption, likes, etc.)
4. Respect the `limit` parameter (default 100).
5. Return a JSON array of post objects tagged with the queried hashtag.

### 4. Extract Metrics

When tasked with computing engagement metrics (`extract_metrics`):

Given raw scraped post data, compute:
- `avg_likes` — mean likes per post
- `avg_comments` — mean comments per post
- `engagement_rate` — `(avg_likes + avg_comments) / follower_count * 100` (if follower count available)
- `post_frequency` — average posts per week over the sample period
- `top_hashtags` — top 10 hashtags by frequency with counts
- `media_mix` — breakdown of IMAGE / VIDEO / CAROUSEL_ALBUM as percentages

Return a JSON object with these metrics.

## Error Handling

- If a profile is private or does not exist, return `{"error": "profile_unavailable", "reason": "<detail>"}`
- If rate limited by Instagram (HTTP 429), wait and retry once. If still failing, return `{"error": "rate_limited"}`
- Log partial results before any failure so work is not lost.

## Output Format

Always write final output to the path specified in the task. Output must be valid JSON. Include a `metadata` object in the root with:
```json
{
  "metadata": {
    "scraped_at": "<ISO 8601 timestamp>",
    "source": "instagram",
    "target": "<username or hashtag>",
    "skill_version": "0.1.0"
  },
  "data": { ... }
}
```
