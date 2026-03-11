# Security Policy

## Supported Versions

The following versions of MaM Portal currently receive security updates:

| Version | Supported |
|---------|-----------|
| Latest (`main`) | ✅ Yes |
| Older releases | ❌ No |

We recommend always running the latest version from the `main` branch.

---

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Since MaM Portal handles user authentication credentials and webmail session tokens, we take security reports seriously and ask that you disclose responsibly.

### How to Report

Send your report privately via one of the following:

- 📧 **Email**: [afatyo.ajeung@gmail.com](mailto:afatyo.ajeung@gmail.com)
- 🔒 **GitHub Private Advisory**: [Security Advisories](https://github.com/afatyoo/MaM-Portal/security/advisories/new)

### What to Include

Please provide as much detail as possible:

- A clear **description** of the vulnerability
- **Steps to reproduce** the issue
- **Impact assessment**  what can an attacker achieve?
- Your environment (Node.js version, OS, Zimbra/Carbonio version)
- Any **proof of concept** or screenshots (if applicable)

---

## What Happens After You Report

1. You'll receive an acknowledgment within **72 hours**
2. We'll investigate and validate the report
3. A fix will be developed and tested
4. A new release will be published with a security advisory
5. You'll be credited in the advisory (unless you prefer to stay anonymous)

---

## Scope

### In Scope

The following are considered valid security issues:

- Authentication bypass or session hijacking
- Preauth key leakage or misuse
- SSRF (Server-Side Request Forgery) via server configuration
- Admin panel privilege escalation
- Sensitive data exposure (credentials, tokens, keys in logs or responses)
- Improper TLS/certificate validation handling
- Insecure default configurations that lead to compromise

### Out of Scope

- Vulnerabilities in third-party dependencies (report those upstream)
- Issues requiring physical access to the server
- Theoretical vulnerabilities without a working proof of concept
- Self-XSS or issues only exploitable by the admin themselves

---

## Security Best Practices for Deployers

If you are deploying MaM Portal, please follow these recommendations:

- Always set a strong, random `session_secret` in `config.ini`
- Never expose `config.ini`, `data/`, or `certs/` publicly
- Use HTTPS in production terminate TLS at Nginx or Caddy
- Restrict access to the `/admin` path at the reverse proxy level if possible
- Keep Node.js and npm dependencies up to date
- Synchronize server time with NTP (required for Preauth to work correctly)
- Rotate Zimbra/Carbonio Preauth keys periodically

---

## Disclosure Policy

We follow a **coordinated disclosure** model. We ask that you give us a reasonable amount of time to address the issue before any public disclosure.

Typical resolution timeline: **15-30 days** depending on severity.
