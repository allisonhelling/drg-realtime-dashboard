# DRG IMS — Microsoft Teams app package

Sideloads the dashboard as both a personal app and a configurable channel tab.
The channel-tab variant lets users pick which view (Dashboard, Records,
Calendar, Documents, Submit) the tab opens to.

## Build the package

```bash
./build.sh drg-ims.vercel.app    # or whatever the live host is
```

This produces `drg-ims-teams.zip` in this directory. The app ID is generated
once and stored in `.app-id` so re-builds are treated as updates of the same
app rather than new apps.

Use the bare host name only, without `https://` or a trailing slash. The build
script injects it into `contentUrl`, `websiteUrl`, `configurationUrl`, developer
URLs, and `validDomains`.

Before uploading a production package, confirm the generated manifest points to
the same host as the deployed app:

```bash
unzip -p drg-ims-teams.zip manifest.json | grep -E "contentUrl|configurationUrl|validDomains"
```

The current checked-in package was verified to point to `drg-ims.vercel.app`.

## Install

### Option A: client admin uploads to the org catalog (recommended for demo)

1. **Teams admin center** → `Teams apps` → `Manage apps` → `Upload new app`.
2. Select `drg-ims-teams.zip`. The app appears in the org's app catalog.
3. End users find it under `Apps` → `Built for your org`.

### Option B: sideload via Teams desktop client (per-user, fastest test)

1. Teams → `Apps` → `Manage your apps` → `Upload an app` →
   `Upload a custom app`.
2. Select `drg-ims-teams.zip`.
3. Click `Add` for personal scope, or `Add to a team` to install it as a
   channel tab. The configurable-tab flow asks which view to open to.

Sideloading must be enabled in the org's app permission policies. If it's
disabled, fall back to Option A.

## What the manifest declares

- **Static tabs** (personal scope): Dashboard, Records, Calendar.
- **Configurable tab** (team / groupChat / meeting scopes): loads
  `https://<host>/teams/configure`, lets the installer pick a view, and
  embeds the chosen page in the channel tab.
- **valid domain**: just the deploy host. No third-party iframes.
- **permissions**: `identity` (read who's signed in) + `messageTeamMembers`
  (future use — none of the prototype features exercise this yet).

## Auth and tenant checklist

The Teams app host, Auth.js URL, app URL, and Entra redirect URL must all
describe the same deployed app:

- `AUTH_URL=https://<deployed-host>`
- `APP_URL=https://<deployed-host>`
- Teams package built with `./build.sh <deployed-host>`
- Entra sign-in app registration redirect URI:
  `https://<deployed-host>/api/auth/callback/microsoft-entra-id`

If the app is moved from Vercel to Azure App Service or to a custom domain,
rebuild and re-upload the Teams zip, update `AUTH_URL` and `APP_URL`, and update
the Entra redirect URI before testing sign-in inside Teams.

## Iframe headers

`next.config.ts` sets `Content-Security-Policy: frame-ancestors …` to allow
embedding from `teams.microsoft.com`, `*.office.com`, `*.sharepoint.com`,
and `*.cloud.microsoft`. If the embed shows a blank tab, the most likely
cause is a deploy that hasn't picked up `next.config.ts` yet — redeploy and
hard-refresh.

## Troubleshooting

- **Tab is blank** → check the browser devtools console inside Teams (right-
  click the tab → `Inspect`). If you see CSP / X-Frame-Options errors, the
  headers in `next.config.ts` aren't reaching the response. Verify with:
  ```
  curl -I https://<host>/  | grep -i frame
  ```
- **"App not valid"** when uploading the zip → run the manifest through
  https://dev.teams.microsoft.com/validation, then rebuild.
- **`microsoftTeams.app.initialize()` rejects in dev** → expected, the SDK
  only initializes when actually loaded inside Teams. The configure page
  still renders so you can preview it in a normal browser.
