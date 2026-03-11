# Contributing to MaM Portal

Thanks for your interest in contributing to **MaM (Multi Access Mail) Portal**! Whether it's a bug fix, a new feature, or a documentation improvement all contributions are welcome.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Branching Strategy](#branching-strategy)
- [Making Changes](#making-changes)
- [Code Style](#code-style)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)
- [Security Issues](#security-issues)
- [What NOT to Commit](#what-not-to-commit)

---

## Getting Started

1. **Fork** this repository
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/your-username/mam-portal.git
   cd mam-portal
   ```
3. Add the upstream remote:
   ```bash
   git remote add upstream https://github.com/original-owner/mam-portal.git
   ```

---

## Development Setup

### Requirements

- **Node.js 18+** (LTS recommended)
- **npm**
- A running **Zimbra / Carbonio** instance (for full integration testing)

### Install dependencies

```bash
npm install
```

### Configure

```bash
cp config.sample.ini config.ini
# Edit config.ini with your local server settings
```

### Create a local admin user

```bash
npm run create-admin
```

### Run in development mode

Run backend and admin UI separately:

```bash
npm run dev:backend   # Node.js backend on :8080
npm run dev           # Vite dev server on :5173
```

Or run both together:

```bash
npm run dev:all
```

### Build the admin UI

```bash
npm run build
```

---

## Project Structure

```
.
├── config.sample.ini     # Template config — do NOT commit config.ini
├── server.js             # Main backend entry point
├── package.json
├── public/               # Static assets + built admin UI
├── data/                 # Runtime data (sessions, admin users, logs) — do NOT commit
├── logs/                 # Application logs — do NOT commit
├── certs/                # TLS certificates — do NOT commit
└── start.sh              # Bootstrap and runtime helper script
```

---

## Branching Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable, production-ready code |
| `dev` | Active development and integration |
| `feature/<name>` | New features |
| `fix/<name>` | Bug fixes |
| `docs/<name>` | Documentation-only changes |

Always branch off from `dev` (or `main` for hotfixes):

```bash
git checkout dev
git pull upstream dev
git checkout -b feature/my-new-feature
```

---

## Making Changes

- Keep changes **focused and scoped** one feature or fix per PR
- Write **clear commit messages**:
  ```
  fix: handle missing domain in SOAP auth fallback
  feat: add per-server connection timeout config
  docs: update troubleshooting section in README
  ```
- If your change affects behavior, **update the relevant documentation** (README, inline comments, etc.)
- If your change adds a new `config.ini` option, **update `config.sample.ini`** as well

---

## Code Style

- **JavaScript**: Follow the existing code style. Use `const`/`let`, avoid `var`.
- **Async**: Prefer `async/await` over raw `.then()` chains.
- **Security**: Never log passwords, tokens, or preauth keys — even at debug level.
- **Config**: All configurable values should go through `config.ini`, not be hardcoded.
- **Error handling**: Always handle errors gracefully and return meaningful HTTP status codes.

---

## Submitting a Pull Request

1. Push your branch to your fork:
   ```bash
   git push origin feature/my-new-feature
   ```
2. Open a **Pull Request** against the `dev` branch (or `main` for hotfixes)
3. Fill in the PR description:
   - **What** does this change do?
   - **Why** is it needed?
   - **How** was it tested?
   - Any **breaking changes** or migration steps?
4. Wait for review — be responsive to feedback and requested changes

---

## Reporting Bugs

Please open an issue and include:

- A **clear title** describing the problem
- Steps to **reproduce** the issue
- **Expected** vs **actual** behavior
- Your environment:
  - Node.js version (`node -v`)
  - OS and version
  - Zimbra / Carbonio version (if relevant)
- Any relevant **log output** from `logs/app.log` (remove sensitive data first)

---

## Requesting Features

Open an issue with the label `enhancement` and describe:

- The **use case** or problem you're trying to solve
- Your **proposed solution** (if any)
- Any **alternatives** you've considered

---

## Security Issues

**Do not open a public issue for security vulnerabilities.**

Please report security concerns privately by emailing the maintainer directly or using the repository's private security advisory feature (if enabled).

---

## What NOT to Commit

Make sure your `.gitignore` covers these never commit:

```
config.ini          # Contains secrets (preauth keys, session secrets)
data/               # Contains admin credentials and session tokens
certs/              # Contains TLS private keys
logs/               # Runtime logs
app.pid
.bootstrap.done
```
---
## LICENSE

By contributing to this project, you agree that your contributions will be licensed under the same license as the project.
---

## Thank You

Every contribution, no matter how small, helps make MaM Portal better for everyone. 🙌
