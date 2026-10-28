# Stremio Custom Links

A Stremio addon to add your own custom HTTP links. Every user gets a personal page and install URL, protected by their own password. Built without the Stremio addon SDK.

## How it works

- `/` : homepage, pick a username
- `/@username` : add, edit and delete your links (password asked every time)
- `/@username/manifest.json` : your addon install URL

In Stremio, open the **Custom Links** poster in the catalog and press play to see all your links.

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
- 
