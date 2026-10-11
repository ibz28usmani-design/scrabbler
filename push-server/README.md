# Scrabbler push server

An iPad can only show notifications from a web app when a server sends them.
This is that server: a free [Cloudflare Worker](https://workers.cloudflare.com)
that you own. Scrabbler sends it your timetable, term dates and reminder times;
every minute it checks what is due and pushes:

- **"First class in 1 hour: Law"** before the first class of each day, and
- **"Law in 10 min"** before each class (only on teaching days — never at
  weekends, in half term or in the holidays), and
- your **reminders** at their due time (09:00 for all-day ones), plus any early
  alert you set.

It runs on Cloudflare's free plan. Nothing else sees your data: the worker
stores it in your own Cloudflare account, behind a password you choose.

## Set it up from an iPad (about 10 minutes, once)

Cloudflare renames its menus now and then; if a name below doesn't match,
look for the nearest equivalent.

1. **Make a free account** at <https://dash.cloudflare.com/sign-up>.
2. **Create the worker.** In the dashboard open **Workers & Pages → Create →
   Worker**, keep the "Hello World" starter, name it `scrabbler-push`, and tap
   **Deploy**.
3. **Paste in Scrabbler's code.** In Scrabbler, open **Settings →
   Notifications** and tap **Copy server code**. Back in Cloudflare, open the
   worker, tap **Edit code**, select everything in `worker.js`, paste over it,
   and tap **Deploy**.
   (The same code is in this folder as [`worker.js`](worker.js).)
4. **Give it somewhere to keep data.** Go to **Storage & Databases → KV →
   Create** and name it `scrabbler-push`. Then in your worker open
   **Bindings → Add binding → KV namespace**: variable name `SCRABBLER`,
   namespace `scrabbler-push`.
5. **Choose a password.** In the worker's **Settings → Variables and Secrets →
   Add**, choose type **Secret**, name `PASSWORD`, and type any password you
   like. You'll type the same one into Scrabbler.
6. **Make it check every minute.** In the worker's **Settings → Trigger
   events** (or **Triggers**) add a **Cron Trigger** with the schedule
   `* * * * *`.
7. **Check it.** Open your worker's address
   (`https://scrabbler-push.<your-name>.workers.dev`). It should say
   *"Scrabbler push server is ready."* If something is missing, it says what.
8. **Connect Scrabbler.** Scrabbler must be installed on your Home Screen
   (Share → Add to Home Screen) — iPadOS only lets installed web apps receive
   notifications. In Scrabbler open **Settings → Notifications**, paste the
   worker address and your password, tap **Turn on notifications**, allow
   them, then tap **Send a test**.

Do the last step on each device you want notified (iPad and iPhone).

## Deploy from GitHub (optional)

Instead of pasting the code after each change, Cloudflare can deploy the worker
from this repository on every push. Do steps 1–8 first, then:

1. In the worker open **Settings → Build** and connect the GitHub repository.
2. Set **Path** (the root directory) to `push-server`. Leave the build command
   empty; the deploy command is `npx wrangler deploy` and the non-production
   branch command `npx wrangler versions upload` (Cloudflare's defaults).
3. Set the production branch to the repository's main branch.

Deploys keep the KV namespace already bound as `SCRABBLER`, so registered
devices and the push keys survive; `wrangler.toml` deliberately has no
namespace id. They also keep the `PASSWORD` secret and the cron trigger.

## From a computer instead

```bash
cd push-server
npm install
npx wrangler secret put PASSWORD
npx wrangler deploy   # the first deploy creates the KV namespace and binds it
```

## Notes

- **Free plan limits.** The worker reads its storage once a minute and writes
  only when Scrabbler syncs a change, well inside Cloudflare's free allowance.
- **Timing.** Cron runs once a minute, so an alert can land up to a minute late.
- **Term dates.** Class alerts follow the term dates in Scrabbler's calendar.
  Fix them there and the worker picks up the change on the next sync.
- **Updating.** If Scrabbler's server code changes, repeat step 3, unless the
  worker deploys from GitHub (above).
- **Building.** `worker.js` is built from `src/` with `npm run build:push`.
