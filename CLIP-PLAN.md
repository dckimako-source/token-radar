# CLIP-PLAN — gta6-clipper-01

## The moment (picked from live YouTube search metadata, 2026-11-20)

- **Video id: `xMXp80Cntxw`** — https://www.youtube.com/watch?v=xMXp80Cntxw
- Title: "GTA 6 LAUNCH STREAM! Playing GTA 6 for the First Time"
- Channel: TGG (@TGG_) · ~9.2M views · streamed 1 day ago (launch day, 2026-11-19)
- Moment: the streamer's raw first-time reaction loading into Vice City / Leonida on
  launch day — the "it's actually real" beat at the top of the VOD. Exact in-point is
  confirmed when the source is fetched at runtime (`clip-cut.sh` START arg); default
  is the opening reaction.
- Found via `curl -s 'https://www.youtube.com/results?search_query=GTA+6+launch+gameplay'`
  (titles/ids only; downloads are IP-blocked on this machine, so no yt-dlp retries).
  Runners-up from the same search: `1GtrjKhSwzM` (TGG, 1 Hour of GTA 6 Free-Roam, 2M),
  `3PiR0G3rVw8` (IGN, 15 Minutes of The First Mission, 1.9M).

## Why it holds a viewer

- 9.2M views in ~24h is the strongest demand signal in the search results: people are
  actively hunting launch-day first reactions right now.
- A genuine first-time reaction is emotionally contagious — the viewer stays to see
  what he sees. Opening on the reaction itself (not a menu, not an intro) pays off the
  hook instantly.
- "GTA 6 IS OUT" is news, not hype: the game launched yesterday (2026-11-19), so the
  text is a factual scroll-stopper for anyone who missed it.

## Hook (first 3 seconds)

- Open on the reaction moment itself, full-bleed vertical.
- On-screen text, 0–3s: **GTA 6 IS OUT** — white bold, black box, centered, upper third
  (y≈260), fontsize 96. Clear of YouTube's bottom/right UI.

## On-screen text plan (20s clip, 1080x1920)

| Time     | Text                                                        | Style / position                  |
|----------|-------------------------------------------------------------|-----------------------------------|
| 0–3s     | `GTA 6 IS OUT`                                              | white bold 96px, black box, y=260, centered |
| 3–14s    | none — let the moment play                                  | —                                 |
| 14–20s   | `Make clips like this with AI`                              | white bold 44px, black box, y=1140, centered |
| 14–20s   | `and earn money on make.fun`                                | white bold 44px, black box, y=1245, centered |
| 14–20s   | `make.fun/bounty/gta6-clipper-01`                           | white bold 44px, black box, y=1350, centered |

Pitch block ends ≈y1440, leaving ~480px clear above the bottom for Shorts buttons.
Each pitch line is on screen 6s (≥2–3s per line, readable).

## make.fun pitch lines (verbatim, in the final 6s)

    Make clips like this with AI and earn money on make.fun
    make.fun/bounty/gta6-clipper-01

(Rendered as three centered lines so nothing overflows the 1080px frame.)

## Title, tags, description

- Title: `GTA 6 IS OUT — first time in Vice City #GTA6 #Shorts`
- Tags: #GTA6 #Shorts #ViceCity #Leonida #GTA6Launch
- Description must contain, word for word (AGENT.md step 5):

      Made by my AI agent for a $500 bounty on make.fun, where you can earn money making clips with AI: https://make.fun/bounty/gta6-clipper-01

- Plus the account's play code (`makefun-…`, from
  `GET /api/competitions/gta6-clipper-01/play-code`) in the description or channel
  description, left there until the check runs.

## Pipeline

1. Dress rehearsal (done this session): `testsrc.mp4` (1280x720, 10s, no audio) →
   looped 2×, center scale/crop to 1080x1920, 20s, same hook + pitch drawtext →
   `clip-test.mp4` (NOT committed; gitignored). Verified with ffprobe + 2 frames in /tmp.
2. Real run: `clip-cut.sh [source.mp4] [START] [DURATION] [OUT]` — fetches the source at
   runtime with yt-dlp using `YTDLP_COOKIES_FILE` (Netscape cookies.txt from a logged-in
   browser; this machine's IP is bot-blocked without cookies), then performs the exact
   same cut/crop/text/render → `clip.mp4` (gitignored).
3. Upload public, fill `VIDEO.json`, run `main.ts` as the grader does, check + submit.
