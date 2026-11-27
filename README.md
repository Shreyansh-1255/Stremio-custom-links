# Stremio Custom Links (v5.5.0)

A Stremio addon (works in Nuvio too) to attach your own video links to movies and series. Titles are found by **searching the name** (IMDb suggestions first, then Cinemeta). The addon has **no catalog and no poster of its own** — every link plays directly on the original movie/series card. Every user gets a personal page and install URL, protected by their own password. Built without the Stremio addon SDK.

## How it works

- `/` : if you are already logged in (cookie), you go straight to your page `/@username` — no username/password asked. Otherwise the login screen opens.
- `/@username` : login screen with two tabs, **Log in** and **Register**. The username field has a fixed `@` in front and shows your page URL live. You stay logged in with a 30-day cookie (renewed every visit) until you press **Logout**.
- `/@username/manifest.json` : your addon install URL — works in Stremio and Nuvio (the page has **Install in Stremio** and **Install in Nuvio** buttons)

## Streams

On any movie or series page, the addon shows a card per link:

- **name** : the original title name (from Cinemeta, stored when the link was added)
- **description** : the text you pasted when adding the link
- **url** : your direct video link

A series link shows on every episode by default; turn off **All episodes** to pick a season and episode from dropdowns filled by Cinemeta (`/api/meta`, episode names included) — the link then shows only on that episode. If a title has no link, a card is always shown: name **"No links found"**, description **"Click here to add new links"**, and `externalUrl` = your page `https://<host>/@username` (tapping it opens the page).

## Login sessions

After the first password login the server sets an HttpOnly cookie (30 days). Page reloads, the bare `/` URL and later visits never ask for the password again (`/api/me` checks the cookie). **Logout** (or a missing cookie) brings the login form back. Password attempts are still rate-limited (10 per 15 minutes).

## Subtitles (file info)

Stremio passes `videoHash`, `videoSize` and `filename` to subtitle addons (OpenSubtitles etc.) so they can find subtitles for this exact file. After a link is saved, the server reads them from the video URL with HTTP **Range** requests (about 128 KB, never the whole file) and stores them on the link:

- **size** : from `Content-Range` / `Content-Length`
- **hash** : OpenSubtitles hash (first + last 64 KB of the file)
- **filename** : the description if it looks like a file name, else the name from `Content-Disposition` / the URL

The host must answer Range requests (most do). If it does not, only the size is saved ("No hash" tag). **Check file info** on the page reads the info for links that have none (older links). Private/local addresses are never fetched.

## Deploy

1. Fork or upload this repo to GitHub.
2. Import it on [Vercel](https://vercel.com) (framework: Other).
3. In the project's **Storage** tab, create an **Upstash Redis** database and connect it.
4. Redeploy.

## Stack

Vercel serverless functions, Upstash Redis, plain HTML. No dependencies.

## Notes

- Passwords are hashed with scrypt. Lost passwords can't be reset.
- Install URLs are public: anyone with your URL can see your links, but not change them.
- Search and meta results are cached in Redis for 10 minutes. No request limits — even one typed character searches.
- Each link stores the title's poster (for the manager page list only — the addon itself adds no catalog).
