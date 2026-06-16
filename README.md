# Auto VPS Deploy CLI 🚀

🌐 *Language: **English** | [Tiếng Việt](README.vi.md)*

A comprehensive automation tool for VPS configuration, SSL setup, and Github Actions Workflow generation. With special support for complex project structures like **Monorepo**, automatic **Database Migration**, SPA web apps (React, Vite, Vue), and full Git automation!

## New — Automatic Project Detection 🔍
The tool scans your repo **before asking questions** to pre-fill the project structure and the type of each part — just press Enter to confirm (or change it if it's wrong):

- **Single / Monorepo structure**: Detected from `package.json` `workspaces`, `pnpm-workspace.yaml`, `turbo.json`, or common subfolders (`frontend`, `backend`, `apps/*`, `packages/*`...). For a Monorepo it **lists every part** with its name + directory.
- **Project type (backend/frontend)**: Distinguishes **Node.js (PM2)** vs **React/Vite/Vue (SPA)** from the `package.json` dependencies (`express`/`next`/`nest` → PM2 server; `vite`/`react`/`vue` with no server → static SPA); also detects **Laravel** (`artisan` + `laravel/framework`), **plain PHP** (`composer.json`/`.php` files), and **Static** (`index.html` only).
- **Extra details**: Also guesses `buildDir` (reads `outDir` from `vite.config`), `start:prod` for NestJS, whether **Prisma** is used, and the **PHP version** (from `composer.json` `require.php`).
- **Database engine 🆕**: Auto-detected in priority order: `prisma/schema.prisma` (`provider`) → driver in `package.json` (`pg`/`mysql2`/`mongoose`/`@supabase/supabase-js`...) → `DATABASE_URL`/`DB_CONNECTION` in `.env`. If found, the "does this part need a Database?" question **defaults to Yes** and **pre-selects the right engine** (MySQL/PostgreSQL/MongoDB/Supabase).
- **Node version 🆕**: Reads `engines.node` (`package.json`) or `.nvmrc` to use the right Node version on both the runner and the VPS, instead of hardcoding Node 22 (with a Node 20 LTS floor on the VPS).
- **Stable port on re-deploy 🆕**: Re-running for the same domain reuses the port already assigned in the old Nginx config, instead of drifting to a new port and orphaning the old PM2 process.

> Everything is only a **pre-filled suggestion** — you always keep full control to change it at every step. A wrong guess is harmless.

## New in Version 6 — Database & Environment Variables 🆕
This release closes the gaps that previously broke apps with a database (e.g. a cafe ordering app with login + DB):

- **Automatic `.env` provisioning**: The tool reads your local `.env`, stores it in a Github Secret, and recreates it during the workflow run — at *build time* (so Vite `VITE_*` / CRA `REACT_APP_*` variables work) and on the *VPS* (so `DATABASE_URL`, secrets and API keys exist). No more "missing `.env`" 500 errors.
- **Automatic Database server setup**: The tool can install **MySQL / PostgreSQL / MongoDB**, create the database + user, generate a strong password, and inject the connection string into the `.env` secret automatically. `prisma db push` and `artisan migrate` now have a real database to talk to.
- **Supabase (PostgreSQL Cloud) support 🆕**: For a cloud DB, pick **Supabase** and paste the Connection String — the tool **installs nothing on the VPS**, it just injects `DATABASE_URL` (plus `DB_*` for Laravel) into the `.env` secret. The app on the VPS connects straight to Supabase.
- **One domain per part 🆕**: In a Monorepo, the tool **blocks reusing the same domain** across parts — preventing frontend and backend from clobbering each other at the `/var/www/<domain>` webroot, the Nginx config, and the **PM2 app name** (`app-<domain>`).
- **Vite / SPA build-time env**: For SPA projects, the `.env` is written **before** `npm run build`, so the bundle points at the correct API endpoint.
- **Any package manager — npm / pnpm / yarn (auto-detected)**: The tool detects the package manager from the lockfile (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`) and lets you confirm or override it. It then generates the correct install/build/runtime commands and enables **Corepack** for pnpm/yarn. **Turbo** monorepos work too (build runs at the repo root).
- **Workspaces (monorepo) support**: If your sub-package has no own lockfile (lockfile only at the repo root), pick the *workspaces* option — install + build then run at the root and only the right package is deployed.
- **Custom start script**: For Node apps you can choose the production start script (default `start`, e.g. `start:prod` for NestJS) — no more assuming `npm start`.
- **Auto Node.js + PM2 + Corepack on the VPS**: For Node projects the tool now **auto-detects and installs** Node.js (≥20 LTS), PM2 and (for pnpm/yarn) Corepack on the VPS. It's **idempotent** — already installed is skipped, nothing is chosen by hand.
- **Laravel fixes**: A valid `APP_KEY` is generated automatically (no more 500 on boot), `php artisan key:generate` runs as a safety net, **PHP-FPM is installed at the version you choose**, and the Nginx `fastcgi_pass` socket is **auto-detected** (the hard-coded `php8.1-fpm.sock` is gone).

> 🔐 The generated database password is shown **once** at the end of the run and saved inside the `.env` Github Secret — copy it somewhere safe.

## Features in Version 5.1
- **Smart Auto Port Assignment**: The tool SSHs into your VPS, scans all occupied ports in the 3000-3999 range, and automatically assigns the next available port. You don't even need to know what a "port" is to deploy!
- **Monorepo Support in a Single Run**: Just select `Monorepo`, enter the number of parts (e.g., 2 for frontend + backend), and the tool will ask for each part's configuration and generate independent workflow files.
- **Auto Git Repository Detection**: Starting the tool in a brand new folder? It will ask for your Github link and run `git init`, `git remote add origin` for you!
- **100% Auto Push Code**: After setup is complete, the tool automatically runs `git add`, `commit`, and `push` all code to the `main` branch.
- **Auto Web Server & SSL Configuration**: Automatically connects via SSH, installs Nginx, sets up proxy/root configuration, and provisions free HTTPS certificates (Let's Encrypt/Certbot).
- **Supports 5 Different Project Ecosystems**:
  1. `Node.js (PM2)`: For Next.js, Express, NestJS...
  2. `React/Vite/Vue (SPA)`: Automatically runs NPM Build to a static directory, fully handles 404 errors on page reload (F5) with specialized `try_files` config.
  3. `PHP (Laravel)`: Auto-runs Composer Install and Artisan migrate on VPS.
  4. `PHP (Vanilla)`: The most basic PHP environment without extra configuration.
  5. `Static`: Pure HTML, CSS.
- **Prisma Database Migration**: If you choose the Node.js platform, the tool automatically injects `npx prisma generate` and `npx prisma db push` commands into the deploy script.

## System Requirements
- **Node.js** (version 18 or higher)
- **Github CLI (`gh`)**: The tool will automatically check for it. If not installed, it will prompt and use Windows' `winget` installer to install it for you.

## Installation (Global)
On any computer, just open Terminal (Command Prompt / PowerShell) and run:
```bash
# Using npm
npm install -g git+https://github.com/nguyenquanghiep3404/auto-vps-deploy-CLI.git

# Using pnpm
pnpm add -g git+https://github.com/nguyenquanghiep3404/auto-vps-deploy-CLI.git
```
In just about 30 seconds, your computer will have a "DevOps expert" named `deploy-vps`.

## Usage Guide
**Step 1**: Navigate to your code directory (it can already be a git repo or not — doesn't matter).

**Step 2**: Run the tool:
```bash
deploy-vps
```

**Step 3**: Answer the prompts.
- *If the folder is not linked to Github*, the tool will ask for your Repository URL.
- **VPS Credentials**: Enter IP, Username, Password (Password is NOT stored anywhere — it's only used once for the initial SSH setup).
- **Project Structure**: Choose `Single` for a single project, or `Monorepo` for multi-part projects (frontend + backend + admin...).
- **Domain**: Enter the exact domain name (e.g., `myapp.example.com`).
  *⚠️ NOTE: Never enter `http://`, `https://`, or a trailing `/` in the domain name, otherwise the SSL Certbot certificate process will fail.*
- **Project Type**: Choose 1 of the 5 project types listed above (by typing 1, 2, 3, 4, or 5 and pressing Enter).
- **Port**: You **don't need to enter anything**! The tool automatically SSHs into the VPS, scans for occupied ports, and assigns the next available one.

**Step 4**: Enjoy the results!
After answering the prompts, go grab a cup of coffee. The tool will automatically connect to the VPS, install Nginx, set up SSH Keys for Github Actions, create the `.github/workflows/deploy.yml` file, and then... it **automatically Commits and Pushes all code to Github** for you!

Just open the Actions tab on Github.com and watch your code smoothly fly to the VPS!

## Single Project
If your project has only one type (e.g., only Frontend or only Backend), choose `Single` at the structure selection step. The tool will ask you for:
- Domain name
- Project type (Node.js / PHP / SPA / Static)
- Output directory (if SPA)
- Prisma ORM (if Node.js)

The port is automatically assigned by the tool — no worries. Then the tool generates a single `deploy.yml` file.

## How to Deploy an SPA Project (React / Vite)
1. Run the `deploy-vps` command.
2. Choose the `Single` structure.
3. Choose the `React/Vite/Vue (SPA)` project type.
4. The tool will ask for the output directory name. For most Vite projects it's `dist`, for Create React App it's `build`. Just enter the correct one.
5. The tool handles everything: from running `npm run build` on the Github server to rsyncing to the VPS. The VPS config file is pre-configured with rules to handle F5 Client-side Routing errors. Amazing!

## Monorepo Setup Guide (Example: Next.js + Express.js)
Since Version 5, you only need to **run the tool once** for the entire Monorepo project!

For a Monorepo structure, you need to prepare 2 different domains so the parts don't conflict. For example: Frontend uses `domain.com` and Backend uses `api.domain.com`. Ports are auto-assigned by the tool — no worries!

**Steps:**
1. Run `deploy-vps`.
2. Enter VPS credentials (IP, Username, Password) — **enter only once**.
3. The tool automatically scans ports in use on the VPS.
4. Choose structure: `Monorepo`.
5. Enter number of parts: `2` (or 3, 4... depending on your project).
6. **Configure PART 1/2 (Frontend):**
   - Part name: `frontend`
   - Domain: `domain.com`
   - Project type: `Node.js (PM2...)`
   - Directory: `./frontend`
   - ✅ Tool auto-assigns port: 3000
7. **Configure PART 2/2 (Backend):**
   - Part name: `backend`
   - Domain: `api.domain.com`
   - Project type: `Node.js (PM2...)`
   - Directory: `./backend`
   - ✅ Tool auto-assigns port: 3001
8. The tool displays a summary table and begins full automation:
   - Configures Nginx + SSL for **all** domains at once.
   - Creates SSH Key **only once**.
   - Generates **2 separate workflow files**: `deploy-frontend.yml` and `deploy-backend.yml`.
   - Auto-pushes code to Github.

When you push code to Github, Github Actions will trigger both yml files independently. Code in each directory will be built and deployed to its respective folder, with absolutely no interference between parts!

## Database & Environment Variables Guide (apps with a DB, e.g. a cafe app)
When you pick `Node.js`, `PHP (Laravel)` or `PHP (Vanilla)`, the tool asks a few extra questions:

1. **PHP version** (for PHP projects): e.g. `8.1`, `8.2`, `8.3`. The tool installs that exact PHP-FPM on the VPS and points Nginx at the detected socket.
2. **"Does this part need a Database?"** — If yes, choose the engine (`MySQL` / `PostgreSQL` / `MongoDB` / `Supabase`).
   - For **MySQL / PostgreSQL / MongoDB** (self-hosted on the VPS) — enter the DB name + user, and the tool will:
     - Install the database server on the VPS (idempotent).
     - Create the database and a dedicated user with an auto-generated strong password.
     - Build the connection string and add it to the `.env` secret:
       - Node.js → `DATABASE_URL="..."` (ready for Prisma).
       - Laravel / Vanilla PHP → `DB_CONNECTION`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`.
   - For **Supabase (PostgreSQL Cloud)** — the DB lives in the cloud, so the tool **installs nothing on the VPS**. Just **paste the Connection String** (Supabase → *Project Settings → Database → Connection string → URI*). The tool injects it into the `.env` secret:
     - Node.js → `DATABASE_URL="..."` (kept verbatim).
     - Laravel / Vanilla PHP → split into `DB_*` (best-effort) **plus** the original `DATABASE_URL`.
   - 💡 *Frontend note*: if a part is Next.js (classified as `Node.js`), the tool still asks this because Next.js can query a DB directly (API routes / server components). If your **frontend only calls the backend API**, just answer **No** — declare the DB on the backend part only.
3. **".env file path"** — Point it at your local `.env` (default `.env`, or `<part-dir>/.env` for monorepo). Its contents are stored as a Github Secret named `ENV_FILE` (single) or `ENV_FILE_<PARTNAME>` (monorepo) and re-created automatically by the workflow. Leave blank to skip.

How the `.env` is used per project type:
- **Node.js**: written to the app directory before build *and* shipped to the VPS, so both the build and `prisma db push` / runtime have it.
- **SPA (React/Vite/Vue)**: written **before** `npm run build` so `VITE_*` / `REACT_APP_*` are baked into the bundle.
- **Laravel / Vanilla PHP**: written before rsync so it lands on the VPS. For Laravel, a valid `APP_KEY` is injected automatically if your file doesn't already have one.

> ⚠️ **MongoDB note**: A local MongoDB has no auth by default. If you use Prisma + MongoDB you must additionally configure a **replica set** (Prisma requires it). MySQL and PostgreSQL work out of the box.

### CORS for Monorepo (avoid 403 when frontend calls backend) 🆕
When the frontend (e.g. `https://demo.test8.io.vn`) calls the backend API on a different origin, the **browser** enforces CORS — the backend must **whitelist the frontend origin**, otherwise you get **403 "blocked by CORS policy"**.

Since the CORS variable name is **not a standard** (backends use `CORS_ORIGINS`, `ALLOWED_ORIGINS`, `FRONTEND_URL`...), the tool does **not** hardcode it. Instead it **auto-detects** the real CORS variable in the backend's `.env`/`.env.example` and:
- **Found** → suggests setting that exact key to `https://<frontend-domain>` (replacing any `localhost` value, no duplicate line). You confirm or edit.
- **Not found** → it does **not** guess; it just **warns** with the origin to whitelist, so you add it in your backend code/config (e.g. `cors()` / `config/cors.php`).

> 💡 CORS only matters for **multi-part Monorepos** (frontend & backend on different origins). A single-origin app doesn't need it.

## Prisma in Production — `migrate deploy` + `db seed` (manual tweak)
By default, the generated Node workflow uses **`prisma db push --accept-data-loss`**. This force-syncs the database to your schema with **no migration history** and **can delete data** when a schema change requires dropping a column/table. It's great for prototyping, but **risky for a live app with real data** (orders, customers...), and it does **not** run seeds.

For a real production app you should switch to migrations + seeding **by hand** in the generated `deploy*.yml`:

```yaml
# Replace this:
            npx prisma generate
            npx prisma db push --accept-data-loss

# With this:
            npx prisma generate
            npx prisma migrate deploy
            # First deploy only (creates roles/admin/reference data):
            # npx prisma db seed
```

Why:
- **`prisma migrate deploy`** applies your committed migration files (`prisma/migrations/`) in order, tracked in `_prisma_migrations` — safe, repeatable, auditable, **no surprise data loss**. (This is the right choice for projects that already use migrations, e.g. one with a `db:migrate` script.)
- **`prisma db seed`** inserts initial data (default admin, RBAC roles, reference data). Run it **only on the first deploy** (or make the seed idempotent), otherwise data gets duplicated.
- **Requirement:** commit your `prisma/migrations/` folder (generated locally with `prisma migrate dev`). `migrate deploy` needs those files; `db push` does not.

## Package Managers & Workspaces (Monorepo) Support
The tool auto-detects the package manager from the lockfile and lets you confirm/override it:

| Lockfile | Package manager |
|---|---|
| `package-lock.json` | npm |
| `pnpm-lock.yaml` | pnpm (Corepack enabled) |
| `yarn.lock` | yarn (Corepack enabled) |

If your monorepo uses **workspaces** (npm/pnpm/yarn) or **Turbo** — i.e. the only lockfile lives at the repo root and the sub-packages don't have their own lockfile — answer **Yes** to the workspaces question for that part. The generated workflow then:
- Installs at the **repo root** with the detected package manager (`npm ci` / `pnpm install --frozen-lockfile` / `yarn install --frozen-lockfile`), so install no longer fails inside the sub-folder.
- Builds at the **repo root** (`<pm> run build`), so Turbo / root build scripts compile shared packages in the right order.
- For SPA: deploys just the built `dist`/`build` folder of the sub-package.
- For Node.js: deploys the whole repo, runs the production install at the root on the VPS (`npm ci --production` / `pnpm install --prod` / `yarn install --production`), then starts the app from its sub-folder with your chosen start script.

**Examples:**
- A **npm-workspaces** monorepo (Next.js + NestJS + a shared package): two parts, both `Node.js`, both *workspaces = Yes*; the NestJS part uses start script `start:prod` and Prisma + PostgreSQL.
- A **pnpm + Turbo** monorepo: same flow — just pick `pnpm` when prompted (it's auto-detected from `pnpm-lock.yaml`).

## How the Auto Port System Works

If you've deployed multiple projects to the same VPS, you don't need to worry about port conflicts. The tool manages it all:

| Deploy # | Project | Auto-assigned |
|---|---|---|
| 1st | Portfolio (Next.js) | Port 3000 |
| 2nd | Blog (Express) | Port 3001 (3000 is taken) |
| 3rd | Customer API | Port 3002 (3000, 3001 are taken) |

The tool SSHs into the VPS, runs `ss -tlnp` to scan all active ports, then finds the next available port in the 3000-3999 range. PM2 starts the application with the `PORT=XXXX` environment variable, ensuring everything matches perfectly.

## Security (Zero-Trust)
- **Your VPS password is absolutely safe**. The tool does not save the password to any file or send it to any server.
- As soon as the tool gains access via password, it immediately generates an **RSA (SSH Keys)** key pair.
- The Public Key is sent to the VPS.
- The Private Key is stored in Github's ultra-secure secret storage (Repository Secrets).
- From that point on, the connection between Github and VPS only uses this "invisible key" — the password is never needed again!

## Frequently Asked Questions (FAQ)

**1. Error "Requested name... appears to be a URL" at Step 1**
- **Symptom:** The tool reports an error while requesting an SSL certificate (Let's Encrypt).
- **Cause:** When the tool asks "Enter Domain Name", you entered `http://domain.com/`. The SSL Certbot only accepts **bare domain names** (FQDN - Fully Qualified Domain Name) like `domain.com`. It does not accept the `http://` protocol or trailing `/`.
- **Fix:** Re-run the tool and just type `domain.com`.

**2. Error "Permission denied" or "cannot be loaded because running scripts is disabled" on PowerShell**
- **Symptom:** When running `deploy-vps` or `npm install -g ...`, PowerShell blocks script execution.
- **Cause:** Windows blocks unsigned scripts by default (Execution Policy = Restricted). This is a default Windows security policy, not a tool bug.
- **Fix:** Open PowerShell and run this command **once** (no Admin rights required):
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```
  Then run `deploy-vps` again. This command only needs to be run once.

**3. Error "Permission denied (publickey,password)" at the Deploy step on Github Actions**
- **Symptom:** Github Actions reports `rsync error: Permission denied` when copying files to the VPS.
- **Cause:** The SSH Key on the VPS doesn't match the SSH Key in Github Secrets. This usually happens when you've run the tool multiple times or changed VPS.
- **Fix:** Re-run `deploy-vps` to let the tool automatically create a new SSH Key pair and sync both the VPS and Github Secrets.

**4. Error requiring a higher Node.js version on Github Actions**
- **Symptom:** The `npm run build` step on Github Actions fails with a message requiring a higher Node.js version.
- **Cause:** The workflow `.yml` file is using an outdated Node.js version.
- **Fix:** Open `.github/workflows/deploy.yml`, find the `node-version` line and change it to `node-version: '26'`. Then commit and push again.
