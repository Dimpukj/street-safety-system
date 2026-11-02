# Street Safety System Deployment Guide

This guide covers the complete path from a fresh checkout to a deployed Street
Safety System website. The application is a Node.js/Express server that serves
the static frontend from `frontend/` and exposes the API from the same origin.
MongoDB is optional for local exploration, but a managed MongoDB database is
recommended for a public deployment.

> **Important:** This is a prototype using synthetic demonstration hazard data.
> It is not an emergency service or an official public-safety system.

## 1. Deployment architecture

The deployed application has these components:

```text
Browser
  |
  | HTTPS
  v
Node.js/Express application
  |-- serves frontend/*.html, *.css, and *.js
  |-- serves /api/* endpoints
  |-- reads/writes backend/data/users.json in fallback mode
  |-- connects to MongoDB when MONGODB_URI is available
  |
  |-- OSRM for route geometry
  |-- OpenStreetMap tiles and Nominatim geocoding
```

The simplest production setup is one Node.js web service plus MongoDB Atlas.
Because the frontend and API are served by the same Express process, no
separate frontend deployment is required.

## 2. Prerequisites

Install or create the following before deploying:

1. A GitHub repository containing this project.
2. Node.js 18 or newer.
3. npm.
4. A MongoDB Atlas account and database.
5. A hosting provider that can run a Node.js web service, such as Vercel,
   Render, Railway, Fly.io, or a VPS.
6. A production domain if the site will be public.

Check the local tools:

```powershell
node --version
npm --version
git --version
```

## 3. Prepare the project locally

Open PowerShell in the repository root:

```powershell
cd C:\Users\dimpu\OneDrive\Desktop\street-safety-system-updated-main
npm install
```

Create a local `.env` file from the example:

```powershell
Copy-Item .env.example .env
```

Do not commit `.env`. It is already excluded by `.gitignore`.

Generate a strong JWT secret. For example, with Node.js:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Put the generated value in `.env`:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/streetSafetyDB
JWT_SECRET=replace-with-a-long-random-production-secret
```

The current server listens on port `3000`. The `PORT` value in
`.env.example` is currently documentation only; the existing
`backend/server.js` uses a fixed port. See [Section 9](#9-required-cloud-hosting-port-update)
before deploying to a platform that requires its own `PORT` variable.

## 4. Run and verify locally

Start the application:

```powershell
npm start
```

Open these URLs:

- `http://localhost:3000/`
- `http://localhost:3000/map.html`
- `http://localhost:3000/api/crimes`

The expected result for each page/API request is HTTP 200.

If MongoDB is not running, the server logs a connection warning and continues
in fallback mode. In that mode, bundled hazards are loaded from
`backend/data/crimes.json`, while users are persisted in
`backend/data/users.json`.

Stop the server with `Ctrl+C`.

## 5. Create a MongoDB Atlas database

1. Sign in to [MongoDB Atlas](https://www.mongodb.com/atlas).
2. Create a free or paid cluster.
3. Create a database user with a long, unique password.
4. Under **Network Access**, add the IP addresses that your hosting provider
   uses. For an initial test, `0.0.0.0/0` works but is less restrictive and
   should be replaced with provider-specific egress IPs where possible.
5. Choose **Connect > Drivers**.
6. Copy the Node.js connection string.
7. Replace the password and database name in the connection string.

Example:

```dotenv
MONGODB_URI=mongodb+srv://app_user:<password>@cluster0.example.mongodb.net/streetSafetyDB?retryWrites=true&w=majority
```

Do not put the connection string in source code, a screenshot, or a committed
file. URL-encode special characters in the database password.

## 6. Push the project to GitHub

Review the files before pushing:

```powershell
git status
git add .
git diff --cached --stat
git commit -m "Prepare deployment documentation"
git push origin main
```

If the branch is not named `main`, push the actual branch name. Confirm that
`.env`, database credentials, and private keys are not included:

```powershell
git ls-files .env
```

This command should return no output.

## 7. Complete Vercel deployment

This repository now includes the Vercel entry point
[`api/index.js`](./api/index.js) and routing configuration
[`vercel.json`](./vercel.json). The entry point exports the existing Express
application as a Vercel serverless function. The frontend remains in
`frontend/`, while Vercel rewrites `/` and static files to that directory and
rewrites `/api/*` to the Express function.

### 7.1 Install and authenticate the Vercel CLI

Install the CLI globally:

```powershell
npm install --global vercel
vercel login
```

Complete the browser authentication flow. Confirm the CLI is available:

```powershell
vercel --version
```

### 7.2 Confirm the Vercel files are committed

From the repository root, verify these files exist:

```powershell
Get-Item .\api\index.js
Get-Item .\vercel.json
```

Commit and push them:

```powershell
git add api/index.js vercel.json backend/server.js DEPLOYMENT.md
git commit -m "Add Vercel deployment support"
git push origin main
```

### 7.3 Create the Vercel project

Run this command from the repository root:

```powershell
vercel
```

Answer the prompts as follows:

| Prompt | Recommended answer |
|---|---|
| Set up and deploy? | `Y` |
| Which scope? | Your personal account or team |
| Link to existing project? | `N` for the first deployment |
| Project name | `street-safety-system` or your preferred name |
| Directory | `.` |
| Modify settings? | `N` |

Vercel detects `api/index.js` as the Node.js function. The `vercel.json`
rewrites make the landing page available at `/`, the map at `/map.html`, and
the API under `/api/*`.

### 7.4 Add Vercel environment variables

Add production variables through the Vercel dashboard:

1. Open the project in the Vercel dashboard.
2. Select **Settings > Environment Variables**.
3. Add `MONGODB_URI` with the MongoDB Atlas connection string.
4. Add `JWT_SECRET` with a new random value.
5. Select **Production**. Add **Preview** too if preview deployments need
   database access.
6. Save the variables.

You can also configure them from PowerShell:

```powershell
vercel env add MONGODB_URI production
vercel env add JWT_SECRET production
```

When prompted, paste the values without surrounding quotes. Never place these
values in `vercel.json`, source code, or a committed `.env` file.

### 7.5 Deploy to Vercel production

Deploy from the repository root:

```powershell
vercel --prod
```

The command prints the production URL. Open it and verify:

```powershell
$base = "https://your-project.vercel.app"
Invoke-WebRequest "$base/" -UseBasicParsing
Invoke-WebRequest "$base/map.html" -UseBasicParsing
Invoke-WebRequest "$base/api/crimes" -UseBasicParsing
```

All three requests should return HTTP 200. If environment variables were added
after a deployment, redeploy with `vercel --prod`; existing deployments do not
automatically receive newly added variables.

### 7.6 Connect GitHub for automatic deployments

For continuous deployment:

1. Open the Vercel project dashboard.
2. Select **Settings > Git**.
3. Connect the GitHub repository
   `Dimpukj/street-safety-system`.
4. Set the production branch, normally `main`.
5. Keep preview deployments enabled for pull requests.

Every push to the production branch will then trigger a new deployment.

### 7.7 Add a custom domain

1. Open **Settings > Domains** in Vercel.
2. Add your domain.
3. Add the DNS records Vercel displays at your domain registrar.
4. Wait for verification and certificate provisioning.
5. Test the HTTPS domain, including login and registration.

Vercel provides HTTPS automatically. This is required because the application
sets the authentication cookie with `Secure: true`.

### 7.8 Vercel-specific limitations

- Vercel functions are stateless and may be restarted at any time.
- Files written to `backend/data/users.json` are not durable on Vercel.
- MongoDB Atlas must be configured for persistent users and reports.
- The first request after an idle period may be slower due to cold start.
- Public OSRM, Nominatim, and OpenStreetMap services have usage policies and
  rate limits.
- Do not use the JSON fallback as a production data store.

Use the MongoDB Atlas connection pool settings recommended for serverless
applications and monitor Atlas connections if traffic increases.

## 8. Alternative deployment: Render

The following steps use Render as an example. Other Node.js platforms use the
same general values.

### 7.1 Create the web service

1. Sign in to [Render](https://render.com).
2. Select **New > Web Service**.
3. Connect the GitHub repository.
4. Select the repository and the production branch.
5. Use these settings:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm install` |
| Start command | `node backend/server.js` |
| Environment | Production |
| Health check path | `/api/crimes` |

Select the smallest suitable instance for testing. A paid instance is
recommended for a public service that must not sleep.

### 7.2 Add production environment variables

In the service's **Environment** settings, add:

```text
MONGODB_URI=mongodb+srv://...
JWT_SECRET=<unique-random-production-secret>
NODE_ENV=production
```

Do not use the development JWT secret from `.env.example`.

### 7.3 Deploy

1. Save the environment variables.
2. Start the first deploy.
3. Open the deploy logs.
4. Wait for a successful build and a message that the server is listening.
5. Open the generated Render URL.
6. Test `/`, `/map.html`, and `/api/crimes`.

If the service reports that it cannot bind to the assigned port, apply the
port configuration in the next section and redeploy.

## 9. Required cloud hosting port update

Many cloud platforms assign a port through the `PORT` environment variable.
The current application has `const PORT = 3000`, so update
`backend/server.js` before deploying to a provider that requires dynamic port
binding:

```js
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
```

The server already calls `app.listen(PORT, '0.0.0.0', ...)`, so no other
server-side port change is required.

The project includes the `dotenv` dependency, but the current server does not
load `.env` automatically. For local `.env` support, add this as the first
line of `backend/server.js`:

```js
require('dotenv').config();
```

Alternatively, configure environment variables directly in the hosting
provider, which is the preferred production approach.

After making the port update, verify locally:

```powershell
$env:PORT = "3000"
npm start
```

Then open `http://localhost:3000/`.

## 10. Configure a custom domain and HTTPS

1. Add the custom domain in the hosting provider.
2. Add the DNS records requested by the provider.
3. Wait for DNS propagation and certificate issuance.
4. Confirm the site opens at `https://your-domain.example`.
5. Redirect or disable plain HTTP if the provider supports it.

HTTPS is required for the authentication cookie because the application sets
the cookie with `Secure: true` and `SameSite: 'none'`. Do not disable this
security setting for a public deployment.

## 11. Post-deployment verification checklist

Run these checks against the deployed URL:

```powershell
$base = "https://your-domain.example"
Invoke-WebRequest "$base/" -UseBasicParsing
Invoke-WebRequest "$base/map.html" -UseBasicParsing
Invoke-WebRequest "$base/api/crimes" -UseBasicParsing
```

Then verify in a browser:

- The landing page loads without console errors.
- The map displays OpenStreetMap tiles.
- Hazard markers load.
- Search/geocoding works.
- A new account can register.
- A registered user can log in.
- The authentication cookie is present and marked Secure/HttpOnly.
- An authenticated user can submit a report.
- Upvote/downvote behavior works.
- Route planning returns results.
- Refreshing the page does not lose the session.

Test registration with a disposable test account. Do not use real personal
information during deployment checks.

## 12. External services and operational limits

The browser and backend use public third-party services:

- OpenStreetMap tiles
- Nominatim geocoding
- OSRM routing
- MongoDB Atlas, if configured

Review each service's acceptable-use policy, attribution requirements,
rate limits, and production-use guidance before launching publicly. Add a
provider-specific API service or caching strategy if traffic becomes
significant. Do not send sensitive user data to geocoding or routing services.

## 13. Data and backup plan

For production, MongoDB should be the source of truth:

1. Keep MongoDB connectivity enabled with `MONGODB_URI`.
2. Configure Atlas backups according to the selected plan.
3. Restrict database network access.
4. Use a separate database user for the application.
5. Test restoring a backup before relying on it.
6. Monitor storage, connections, and failed authentication attempts.

Do not rely on `backend/data/users.json` as a production database. The fallback
mode is intended for local/demo operation and does not provide the durability,
concurrency, backup, or access controls expected in production.

## 14. Troubleshooting

### Build fails with missing packages

Run `npm install` locally and check that `package.json` and `bun.lock` are
committed. Do not commit `node_modules/`.

### The service starts but the platform says the port is unavailable

Apply the dynamic port change in [Section 9](#9-required-cloud-hosting-port-update)
and redeploy.

### MongoDB connection fails

Check all of the following:

- `MONGODB_URI` is set in the hosting provider.
- The database password is correct and URL-encoded.
- The hosting provider's outbound IP is allowed in Atlas.
- The database user has access to `streetSafetyDB`.
- The Atlas cluster is running.

The application may still start in fallback mode, but production data will not
be durable until MongoDB connectivity is restored.

### Registration appears successful but the session is lost

Verify that the site is loaded over HTTPS and that the browser accepts the
Secure cookie. Check the browser's Network and Application/Storage panels.
Also confirm that the frontend and API are served from the same deployed
origin.

### Map tiles or route planning do not load

Check browser console errors, external-service availability, request rate
limits, and whether the deployed server has outbound internet access.

### Users cannot write to the JSON fallback file

This indicates that the deployment is relying on fallback mode. Configure
MongoDB instead of changing filesystem permissions on an ephemeral hosting
filesystem.

## 15. Production security checklist

- [ ] Use a unique random `JWT_SECRET`.
- [ ] Store all secrets in the hosting provider's secret manager.
- [ ] Deploy only over HTTPS.
- [ ] Restrict MongoDB network access.
- [ ] Use a least-privilege MongoDB user.
- [ ] Enable MongoDB backups.
- [ ] Keep Node.js and dependencies updated.
- [ ] Review authentication, validation, abuse prevention, and rate limiting
      before accepting public reports.
- [ ] Do not expose database credentials in logs.
- [ ] Do not treat synthetic hazard records as official safety information.
- [ ] Add monitoring and alerting for application errors and database failures.

## 16. Updating the deployed application

After a change is reviewed locally:

```powershell
git status
git add <changed-files>
git commit -m "Describe the change"
git push origin main
```

The hosting provider should deploy the new commit automatically if continuous
deployment is enabled. After each deploy, repeat the checks in
[Section 11](#11-post-deployment-verification-checklist).

For a rollback, use the hosting provider's previous-deploy option or redeploy
a known-good commit. Do not delete production data while troubleshooting.
