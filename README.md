# Stremio Custom Links (v5.1)

A Stremio addon (works in Nuvio too) to attach your own video links to movies and series. Titles are found by **searching the name** (Cinemeta). The addon has **no catalog and no poster of its own** — every link plays directly on the original movie/series card. Every user gets a personal page and install URL, protected by their own password. Built without the Stremio addon SDK.

## How it works

- `/` : homepage, pick a username
- `/@username` : search a movie/series by name, select it, then add the link (description + video URL). You stay logged in with a 30-day cookie until you press **Logout**.
- `/@username/manifest.json` : your addon install URL — works in Stremio and Nuvio

## Streams

On any movie or series page, the addon shows a card per link:

- **name** : the original title name (from Cinemeta, stored when the link was added)
- **description** : the text you pasted when adding the link
- **url** : your direct video link

A series link shows on every episode of that series. If a title has no link, a card saying **"no link added in this title"** is always shown — there is no setting to turn it off.

## Login sessions

After the first password login the server sets an HttpOnly cookie (30 days). Page reloads and later visits never ask for the password again. **Logout** (or a missing cookie) brings the password screen back. Password attempts are still rate-limited (10 per 15 minutes).

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
- Search results are cached in Redis for 10 minutes; 30 searches per IP per minute.
