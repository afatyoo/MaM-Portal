# Changelog

All notable changes to **MaM Portal** will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

---

## [v1.1.0] — 2026-11-26

One hostname for every mail protocol. MaM now proxies IMAPS, POP3S and SMTPS by
login, so users keep a single name in their mail client while the portal still
routes each account to the right Carbonio/Zimbra backend. Tested end to end on a
dedicated host in front of Carbonio CE 4.5.14 and Zimbra 10.1.21, including the
real client IP reaching the backend over IMAP, POP3 and SMTP.

### Added

- **Mail proxy** (`mail/`) for IMAPS 993, POP3S 995 and SMTPS 465, enabled from the
  `[MAIL]` section of `config.ini`. It serves the greeting and the pre-login commands
  itself, routes by the same `MaMKey_*` domain map as the web login, logs in to the
  chosen backend over verified TLS, then splices the two connections.
- The real client IP is forwarded to the backend: `ID ("X-ORIGINATING-IP" ...)` for
  IMAP, `XOIP` for POP3, `XCLIENT` for SMTP, so audit logs and brute-force protection
  see the user instead of the proxy.
- Mail proxy routing cache: remembers which backend accepted an address, so a domain
  that lives on two servers no longer pays the failed attempt on every login. Stored as
  JSON (`data/mail-route-cache.json`, mode 0600, atomic write), with a TTL, an entry cap,
  and a stale entry that is replaced after the next successful login.
- Admin UI page `/admin/mail`: listener state, open connections, uptime, active limits,
  and cache statistics with a "clear cache" action. Backed by
  `GET /api/admin/mail/status` and `DELETE /api/admin/mail/cache`.
- `[MAIL]` settings: `idle_timeout_sec`, `backend_timeout_sec`, `handshake_timeout_sec`,
  `fail_limiter_max_keys`, `route_cache_enabled`, `route_cache_file`,
  `route_cache_ttl_days`, `route_cache_max_entries`.
- Deployment packaging for a dedicated host: `deploy/install.sh` (system user,
  `/opt/mam-portal`, dependencies, `config.ini` bootstrap, systemd unit),
  `deploy/mam-portal.service` (`CAP_NET_BIND_SERVICE`, `ProtectSystem=strict`,
  `LimitNOFILE=65535`), `Dockerfile`, `deploy/docker-compose.yml` with host networking,
  and `deploy/README.md` as the runbook.
- `deploy/selfsigned.sh` (hostname plus every local IP as SANs) and `deploy/localca.sh`
  (a CA with a server certificate signed by it, for clients that refuse a self-signed
  certificate as a trust anchor).

### Security

- A connection can send at most 200 pre-login commands, and commands that fail to parse
  now count as bad. Before this, a client could hold a pre-login slot forever because
  every command reset the pre-login timeout.
- TLS handshake timeout and a `maxConnections` backstop on each listener, because the
  connection limiter only starts after the handshake completes.
- IMAP tags must be printable ASCII; the configured `hostname` is stripped of control
  bytes so it cannot break a greeting or the `EHLO` sent to a backend.
- The failed-login maps are capped (`fail_limiter_max_keys`) so a spray of random
  addresses or usernames cannot grow memory without bound.
- The route cache file is written atomically, stored 0600, and read with `O_NOFOLLOW`
  plus a size cap, so a planted symlink or a corrupt file is not followed.
- `tlsClientError` is logged and counted per listener, so a client that rejects the
  certificate no longer fails invisibly.
- The password is never logged or stored, and pre-login buffer, literal and line limits
  are enforced for all three protocols.

### Changed

- Routing tries the cached server first when a domain maps to more than one backend;
  only domains on several servers are cached.

### Documentation

- `docs/mail-proxy.md`: architecture, the mailboxd ports (7993/7995) needed for the real
  client IP, the FQDN requirement for SOAP login, the Zimbra firewalld rule, preauth, and
  the lab results.
- `README.adoc`, `config.sample.ini` and `deploy/README.md` document the mail proxy and
  the deployment steps.

---

## [v1.0.0] — First Stable Release

### Overview

This is the first official release of **MaM (Multi Access Mail) Portal**, a lightweight authentication portal for Zimbra / Carbonio environments.

MaM Portal allows users to authenticate using their mailbox credentials, route logins based on domain configuration, and redirect users directly into webmail using Preauth. It also includes an Admin Dashboard for managing servers, domain mappings, and portal administrators.

---

### Main Features

#### User Portal
- Login using email address or username and password
- Automatic domain-based routing to the correct Zimbra / Carbonio server
- Webmail redirect using Preauth
- Support for multiple servers with fallback order

#### Admin Dashboard
- Add, edit, and delete Zimbra / Carbonio servers
- Configure domain mappings per server
- Test SOAP authentication connectivity
- Manage admin users
- Session-based admin authentication

#### Security and Operations
- Passwords stored securely using bcrypt hashes
- Configuration stored in `config.ini`
- Optional HTTPS support for the portal
- Optional custom CA file support for internal certificates
- Login attempt logging
- File-based admin session storage

---

### Included in This Release

- Initial MaM Portal backend implementation
- User login flow with SOAP authentication
- Preauth-based redirect to webmail
- Multi-server and domain-based routing support
- Admin Dashboard for server and admin management
- Support for Zimbra and Carbonio compatible environments
- Configuration template via `config.sample.ini`
- Startup helper script for bootstrap and process management
- Updated README documentation for setup, configuration, and operations

---

### Startup and Deployment

This release includes a helper script to simplify deployment and daily operations.

Supported helper commands:

```bash
./start.sh
./start.sh start
./start.sh stop
./start.sh restart
./start.sh status
./start.sh bootstrap
./start.sh help
```

The startup flow supports:

- Automatic environment preparation
- Dependency installation
- Project build
- Admin account creation
- Background or foreground application start

---

### Default Admin Account

During initial bootstrap, the helper script creates a default admin account:

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin` |

> ⚠️ It is **strongly recommended** to change this immediately after deployment.

---

### Configuration Notes

Before running in production, make sure to configure the following in `config.ini`:

- Portal ports and HTTPS settings
- Session secret
- Zimbra / Carbonio server definitions
- Domain mappings
- Preauth key
- SOAP and Preauth paths

---

### Recommended Production Notes

- Place the application behind a reverse proxy such as **Nginx** or **Caddy**
- Use a strong admin session secret
- Do **not** commit sensitive runtime files:
  - `config.ini`
  - `data/`
  - `certs/`
  - `logs/`
  - `app.pid`
  - `.bootstrap.done`

---

### Compatibility

This release is intended for environments using:

- Zimbra
- Carbonio
- Compatible SOAP authentication endpoints
- Compatible Preauth redirect endpoints

---

### Documentation

Please refer to the project [README](./README.adoc) for:

- Installation steps
- Configuration examples
- Admin setup
- Bootstrap and runtime commands
- Troubleshooting guidance

---

[v1.0.0]: https://github.com/afatyoo/MaM-Portal/releases/tag/v1.0.0
