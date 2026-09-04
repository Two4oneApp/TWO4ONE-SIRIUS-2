# Two4One Wallet -- Security/Gap Audit & Render Deployment

Base: a 2019 fork of the ProximaX Sirius Chain wallet (Ionic 3 / Angular 5 /
Cordova, dual NIS1 + Sirius Chain support).

## Fixed in this pass

1. **PBKDF2 iteration count was 4** (`src/providers/forge/forge.ts`). This is
   the function that derives the AES key used to encrypt a wallet's private
   key from the user's password -- at 4 iterations it's essentially
   unsalted-hash-speed, so a stolen encrypted wallet backup could have its
   password brute-forced trivially. Raised to 210,000 (OWASP's current floor
   for PBKDF2-HMAC-SHA1-class KDFs).
   - **This is a breaking change for existing users' wallets.** I added
     `decryptWithMigration()` in the same file: it tries the new iteration
     count first, falls back to the legacy count of 4 on failure, and tells
     the caller to re-encrypt under the new parameters. **You still need to
     wire this into `pin.ts`'s `decryptPasswordUsingCurrentPin()`** (call
     `decryptWithMigration` instead of `decrypt`, and if `migrated` is
     `true`, re-encrypt and persist) before shipping to existing users --
     I didn't do that wiring myself since I can't test the login flow
     end-to-end in this environment and a broken login lockout is worse
     than the vulnerability for a live wallet.

2. **Private key, derived AES key, and wallet password were being
   `console.log`'d** in `wallet-backup.ts`, `auth.ts`, and
   `pages/@core/settings/private-key/private-key.ts`. On a webview or
   browser, console output can end up in crash reports, remote debugging
   sessions, or browser extensions with console access. All removed.

## Found, not fixed -- needs a decision from you

3. **`AuthProvider.ec()`** (`src/providers/auth/auth.ts`) derives the key
   protecting each wallet's `encrypted` blob by running the password through
   20 rounds of **unsalted** SHA3-256. No salt means two users with the same
   password get the same derived key, and 20 rounds of a fast hash is not a
   meaningful brute-force deterrent. This is a separate, older encryption
   path from the one in `forge.ts` (used for the multi-account
   `decryptAccountUser`/`encryptAccount` flow) -- I didn't touch it because
   fixing it has the same migration problem as #1, but I haven't traced
   every call site closely enough to write a safe migration in this
   session. Recommend applying the same PBKDF2 pattern before launch.

4. **The wallet password is cached in plaintext** in `@ionic/storage` under
   the key `plainPassword` (`pin.ts`, `auth.ts`) so the app doesn't have to
   re-prompt for it constantly. On native, `@ionic/storage` sits on
   SQLite -- not the OS keychain, even though `cordova-plugin-secure-storage`
   is already a dependency and isn't being used here. On the **web/PWA
   build you asked for, there is no OS keychain equivalent at all** --
   `@ionic/storage` falls back to IndexedDB, which is readable by anything
   that can run JS in that origin (e.g. an XSS bug, or a malicious browser
   extension). This is a real architectural gap for a wallet handling
   actual funds in a browser. I'd treat "ship the PWA build with real
   money in it" and "ship it as a UI demo / internal tool" as two different
   risk decisions -- happy to help harden this (e.g. never persist the
   decrypted password, re-derive it per-transaction, add a strict CSP) if
   real funds are in scope.

## Other gaps (not security-critical, still worth knowing)

- **Committed release keystore** (`proximax.keystore`) was in the original
  zip. I did not include it in what's delivered back to you. If this is
  your real Android signing key, rotate it and never commit it again --
  pass it into CI/Render as a secret file or env-var-decoded blob instead.
- **Stale blockchain endpoints**: `src/app/app.config.ts` points at 2019-era
  ProximaX mainnet nodes (`arcturus.xpxsirius.io` etc). ProximaX has since
  rebranded to Sirius Chain and also operates on BNB Chain -- I could not
  verify these specific node URLs are still live from this environment;
  test connectivity before relying on them.
- **Two overlapping chain SDKs** (`nem-library` for legacy NIS1 +
  `tsjs-xpx-chain-sdk` for Sirius Chain) plus a 2018-era dependency tree
  (`ionic-app-scripts`, deprecated since Ionic 4; `node-sass`, deprecated
  in favor of `sass`). None of this blocks a build, but `npm audit` will
  show a long list of CVEs in transitive deps -- not re-litigated here
  since most are in dev tooling, not runtime attack surface for a static
  deploy.

## Why the build fails on a normal Node install (and how deployment handles it)

`node-sass@4.12` ships a native binding that only supports Node up to
roughly v13. This repo's toolchain (`ionic-app-scripts`) calls it directly,
so `npm run build` fails on any current Node with:

```
Error: Node Sass does not yet support your current environment: Linux 64-bit with Unsupported runtime (127)
```

I confirmed this by actually running the install and build here. Rather
than hand you a build that silently doesn't work on Render's default Node
image, I added:

- **`Dockerfile`** -- multi-stage build. Stage 1 uses `node:10-buster`
  (old enough for `node-sass@4.12`) with `python2` + build tools for
  `node-gyp`, runs `ionic-app-scripts build --prod` to produce the static
  `www/` output. Stage 2 serves that output with `nginx`.
- **`nginx.conf`** -- SPA routing fallback (`try_files ... /index.html`),
  asset caching, and baseline security headers (`X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, a starter
  `Permissions-Policy`). You should add a real `Content-Security-Policy`
  scoped to the exact node/API origins in `app.config.ts` once you've
  confirmed which ones you're actually using.
- **`render.yaml`** -- a Render Web Service using `runtime: docker`, which
  builds from the `Dockerfile` above. This sidesteps Render's own Node
  build image entirely (which is far newer than this stack tolerates) since
  Docker gives full control over the build environment.

**I could not execute `docker build` inside this sandbox** (no Docker
daemon, and no network access to Docker Hub / Debian package mirrors from
here), so this Dockerfile is written to the standard, well-tested pattern
for this exact stack but is not proven end-to-end. First Render deploy
attempt may need one or two rounds of log-driven fixes (e.g. lockfile
version quirks under `npm install`) -- push it and share the build log if
it fails and I'll fix it from there.

### To deploy
1. Push this to a GitHub repo.
2. In Render: New -> Blueprint -> point at the repo (picks up `render.yaml`
   automatically), or New -> Web Service -> Docker runtime, pointing
   `dockerfilePath` at `./Dockerfile`.
3. Set the real production node/API URLs as Render env vars if you want
   them injected at build time rather than hardcoded in `app.config.ts`.

## Recommended before this touches real funds
1. Wire up `decryptWithMigration` in `pin.ts` (see #1) and test the
   PIN-unlock flow against an existing pre-fix wallet.
2. Decide on #3 and #4 above -- both are password/key-handling design
   questions, not one-line fixes.
3. Swap `node-sass` -> `sass` and drop `ionic-app-scripts` for a maintained
   Ionic/Angular build chain, so the Node-version pin in the Dockerfile
   stops being load-bearing.
