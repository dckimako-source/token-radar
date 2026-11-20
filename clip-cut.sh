#!/usr/bin/env bash
# clip-cut.sh — runtime runbook for the gta6-clipper-01 bounty clip.
#
# Replays the dress-rehearsal pipeline documented in CLIP-PLAN.md (the exact
# filtergraph used for clip-test.mp4): fetch source -> cut the best 20s ->
# center scale/crop to 1080x1920 -> hook + make.fun pitch drawtext ->
# h264/yuv420p + aac render -> ffprobe verification -> preview frame.
#
# Usage:   YTDLP_COOKIES_FILE=/path/to/cookies.txt [CUT_START=00:01:00] ./clip-cut.sh
# Env:     YTDLP_COOKIES_FILE  required; Netscape cookies.txt from a logged-in browser
#          CUT_START          in-point in the VOD, HH:MM:SS (or plain seconds), default 00:01:00
#          CUT_OFFSET         seconds into the fetched 60s window where the best 20s starts, default 0
# Outputs: source.mp4 (60s fetch), clip.mp4 (20s final), preview.jpg (hook frame)
#
# This script is the committed runbook; run it in-session so the cut/render
# commands stay in the transcripts (AGENT.md step 4).

set -euo pipefail

# Always work in the repository directory so every artifact lands here.
cd "$(dirname "$0")"

# --- Fixed creative parameters (from CLIP-PLAN.md) ---------------------------
VOD_ID="xMXp80Cntxw"          # TGG "GTA 6 LAUNCH STREAM!" — launch-day first reaction
CUT_START="${CUT_START:-00:01:00}"  # default in-point: the opening reaction
FETCH_LEN=60                  # fetch a 60s window around the in-point
CLIP_LEN=20                   # final clip is the best 20s of that window
CUT_OFFSET="${CUT_OFFSET:-0}" # offset of the 20s cut inside the fetched window
PITCH_START=$((CLIP_LEN - 6)) # pitch block = final 6s (14–20s), per the text plan
SOURCE="source.mp4"
OUT="clip.mp4"
PREVIEW="preview.jpg"

# --- Step 1: cookies gate -----------------------------------------------------
# This machine's IP is bot-blocked by YouTube: yt-dlp downloads fail without
# cookies from a logged-in browser. Refuse to run (and burn retries) without them.
if [[ -z "${YTDLP_COOKIES_FILE:-}" ]]; then
  echo "ERROR: YTDLP_COOKIES_FILE is not set." >&2
  echo "YouTube downloads from this machine are IP-blocked without cookies." >&2
  echo "Export YTDLP_COOKIES_FILE pointing at a Netscape-format cookies.txt" >&2
  echo "from a logged-in browser, then re-run this script." >&2
  exit 1
fi
# The cookie file must actually exist and be readable, or yt-dlp would fail anyway.
if [[ ! -r "$YTDLP_COOKIES_FILE" ]]; then
  echo "ERROR: YTDLP_COOKIES_FILE='$YTDLP_COOKIES_FILE' is not a readable file." >&2
  exit 1
fi

# Sanity-check the tools the pipeline needs before touching the network.
for tool in yt-dlp ffmpeg ffprobe; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: $tool not found in PATH." >&2; exit 1; }
done

# --- Step 2: fetch the 60s source window with yt-dlp --------------------------
# Convert CUT_START (HH:MM:SS, or plain seconds) to a seconds offset so we can
# give --download-sections an exact start-end range.
if [[ "$CUT_START" == *:* ]]; then
  IFS=: read -r hh mm ss <<< "$CUT_START"
  start_sec=$(( 10#${hh:-0} * 3600 + 10#${mm:-0} * 60 + 10#${ss:-0} ))
else
  start_sec=$(( 10#$CUT_START ))
fi
end_sec=$(( start_sec + FETCH_LEN ))

# Best video at height<=1080 plus best audio, merged into mp4. Only the chosen
# 60s section is downloaded; --force-keyframes-at-cuts makes the section edges
# frame-accurate instead of snapping to the nearest keyframe.
yt-dlp \
  --cookies "$YTDLP_COOKIES_FILE" \
  --no-playlist \
  -f 'bestvideo[height<=1080]+bestaudio/best[height<=1080]' \
  --merge-output-format mp4 \
  --download-sections "*${start_sec}-${end_sec}" \
  --force-keyframes-at-cuts \
  --force-overwrites \
  -o "$SOURCE" \
  "https://www.youtube.com/watch?v=${VOD_ID}"

# --- Step 3: pick a bold font for drawtext ------------------------------------
# The rehearsal text is white BOLD with a black box; drawtext needs a real bold
# TTF. Probe the usual system font locations and take the first readable one.
FONT=""
for f in \
  /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf \
  /usr/share/fonts/dejavu/DejaVuSans-Bold.ttf \
  /usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf \
  /usr/share/fonts/liberation-sans/LiberationSans-Bold.ttf \
  /usr/share/fonts/truetype/freefont/FreeSansBold.ttf
do
  if [[ -r "$f" ]]; then FONT="$f"; break; fi
done
if [[ -z "$FONT" ]]; then
  echo "ERROR: no bold TTF font found for drawtext (looked in /usr/share/fonts)." >&2
  exit 1
fi

# --- Step 4: cut, crop to vertical, overlay text, render ----------------------
# Same filtergraph as the clip-test.mp4 dress rehearsal:
#   scale to COVER 1080x1920 (keep aspect, upscale enough to fill both axes),
#   then CENTER-crop the overflow -> full-bleed 9:16 with nothing stretched,
#   square pixels + constant 30fps for a clean Shorts encode.
VF="[0:v]scale=1080:1920:force_original_aspect_ratio=increase"
VF+=",crop=1080:1920:(iw-1080)/2:(ih-1920)/2,setsar=1,fps=30"

# Hook, 0–3s: "GTA 6 IS OUT" — white bold 96px, black box, centered, y=260
# (upper third, clear of YouTube's bottom/right UI).
VF+=",drawtext=fontfile=${FONT}:text='GTA 6 IS OUT'"
VF+=":fontsize=96:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=20"
VF+=":x=(w-text_w)/2:y=260:enable='between(t,0,3)'"

# Pitch block, final 6s (14–20s): three centered white-bold 44px lines with
# black boxes at y=1140 / 1245 / 1350 — ends ~y1440, leaving ~480px clear
# above the Shorts buttons. Each line is on screen 6s (readable).
VF+=",drawtext=fontfile=${FONT}:text='Make clips like this with AI'"
VF+=":fontsize=44:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=12"
VF+=":x=(w-text_w)/2:y=1140:enable='between(t,${PITCH_START},${CLIP_LEN})'"
VF+=",drawtext=fontfile=${FONT}:text='and earn money on make.fun'"
VF+=":fontsize=44:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=12"
VF+=":x=(w-text_w)/2:y=1245:enable='between(t,${PITCH_START},${CLIP_LEN})'"
VF+=",drawtext=fontfile=${FONT}:text='make.fun/bounty/gta6-clipper-01'"
VF+=":fontsize=44:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=12"
VF+=":x=(w-text_w)/2:y=1350:enable='between(t,${PITCH_START},${CLIP_LEN})'"

# Cut the best CLIP_LEN seconds starting CUT_OFFSET into the fetched window.
# -ss before -i seeks fast; re-encoding makes the cut frame-accurate. Audio is
# mapped optionally ('?') so a silent source still renders. h264 yuv420p + aac
# is the YouTube/Shorts-safe combination; +faststart puts the moov atom first.
ffmpeg -y \
  -ss "$CUT_OFFSET" -t "$CLIP_LEN" -i "$SOURCE" \
  -map 0:v:0 -map '0:a:0?' \
  -vf "$VF" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -profile:v high \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  "$OUT"

# --- Step 5: verify the render with ffprobe -----------------------------------
# Must be exactly 1080x1920 (vertical Short) and under 60s (Shorts limit).
dims="$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height -of csv=s=x:p=0 "$OUT")"
if [[ "$dims" != "1080x1920" ]]; then
  echo "ERROR: $OUT is ${dims}, expected 1080x1920." >&2
  exit 1
fi
dur="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$OUT")"
if ! awk -v d="$dur" 'BEGIN { exit !(d > 0 && d < 60) }'; then
  echo "ERROR: $OUT duration ${dur}s is not under 60s." >&2
  exit 1
fi
echo "OK: $OUT is ${dims}, ${dur}s (< 60s)."

# --- Step 6: extract a preview frame ------------------------------------------
# Grab a frame at t=1s so the hook text ("GTA 6 IS OUT") is visible for a
# quick eyeball check of crop, text placement and safe areas.
ffmpeg -y -ss 1 -i "$OUT" -frames:v 1 -q:v 2 "$PREVIEW"

# Done: report the artifacts the upload step (AGENT.md step 5) needs.
echo "Rendered: $OUT ($(du -h "$OUT" | cut -f1)), preview: $PREVIEW, source: $SOURCE"
