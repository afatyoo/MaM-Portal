# Changelog

All notable changes to **MaM Portal** will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

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
