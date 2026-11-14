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

## Sync and sharing (optional, about 3 minutes)

The same worker can keep your notes in step between your iPad, iPhone and
Mac, and publish a note or deck as a read-only page you can send to a
classmate. Both need a free D1 database:

1. In Cloudflare open **Storage & Databases → D1 → Create** and name it
   `scrabbler-sync`.
2. In your worker open **Bindings → Add binding → D1 database**: variable
   name `SYNC`, database `scrabbler-sync`. (The worker creates its tables on
   first use.)
3. Paste in the latest server code again (step 3 above), unless the worker
   deploys from GitHub.
4. Open your worker's address: it should now say *"D1 database bound as
   SYNC: yes"*.
5. In Scrabbler open **Settings → Sync between devices**, choose a
   passphrase, and tap **Turn on sync**. Do the same on each device, with the
   same server address, password and passphrase.

Sync is end-to-end encrypted: each device encrypts everything with a key made
from your passphrase (AES-256-GCM, PBKDF2) before sending it, so the
database only ever holds ciphertext. The passphrase never leaves your
devices; if you lose it, the synced copy can't be read (each device keeps its
own notes, and backups still work). When two devices change the same note
before syncing, the later change wins and the other is kept in that note's
version history.

Shared pages are the exception: they are published so that anyone with the
link can read them, served with every script and outside request blocked.
Take one down from the note's or deck's Share menu.

Free plan limits: D1 gives 5 GB and 100,000 row writes a day, far more than
one person's notes need. Large files (lecture recordings) are stored in
1.5 MB parts.

## Deploy from GitHub (optional)

Instead of pasting the code after each change, GitHub can deploy the worker
whenever `push-server/` changes on the main branch
(`.github/workflows/push-server.yml`). Do steps 1–8 first, then:

1. **Make a token.** In Cloudflare open **My Profile → API Tokens → Create
   Token**, pick the **Edit Cloudflare Workers** template, limit it to your
   account, and create it. Copy the token: Cloudflare shows it once.
2. **Find your account ID.** It is on the right of the **Workers & Pages**
   overview (it is also the long code in your dashboard's address bar).
3. **Give both to GitHub.** In the repository open **Settings → Secrets and
   variables → Actions → New repository secret** and add
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. **Pin the KV namespace (recommended).** In Cloudflare open **Storage &
   Databases → KV**, copy the ID of the namespace bound to the worker as
   `SCRABBLER`, and add it in the same GitHub page under the **Variables** tab
   as `SCRABBLER_KV_ID`. If you set up sync, do the same for the D1 database
   bound as `SYNC` (**Storage & Databases → D1**, its ID) as
   `SCRABBLER_SYNC_ID`.
5. **Turn off Cloudflare's own builds**, if you connected them before: in the
   worker open **Settings → Build** and disconnect the repository, so pushes
   aren't built twice.
6. **Deploy once by hand** to check it: in the repository open **Actions →
   Deploy push server → Run workflow**.

Deploys keep the KV namespace bound as `SCRABBLER`, so registered devices and
the push keys survive: without `SCRABBLER_KV_ID`, Wrangler reuses the
namespace the worker already has (`wrangler.toml` deliberately has no id);
with it, the deploy is pinned to that namespace. They also keep the
`PASSWORD` secret and the cron trigger.

## From a computer instead

```bash
cd push-server
npm install
npx wrangler secret put PASSWORD
npx wrangler deploy   # the first deploy creates the KV namespace and binds it
```

## Notes

- **Free plan limits.** Each minute the worker reads its device list and each
  device (about 1,440 × (devices + 1) reads a day), and writes only when
  Scrabbler syncs a change: well inside Cloudflare's free allowance for a few
  devices.
- **Timing.** Cron runs once a minute, so an alert can land up to a minute late.
- **Term dates.** Class alerts follow the term dates in Scrabbler's calendar.
  Fix them there and the worker picks up the change on the next sync.
- **Updating.** If Scrabbler's server code changes, repeat step 3, unless the
  worker deploys from GitHub (above).
- **Building.** `worker.js` is built from `src/` with `npm run build:push`.
