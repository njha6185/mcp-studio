# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report vulnerabilities either:

- by email: **njha6185@gmail.com**, or
- privately via GitHub: *Security → Report a vulnerability* on this repository.

Include steps to reproduce and the affected version. You should get a response
within a few days.

## Scope notes

- MCP Studio is a developer tool intended for localhost / trusted-network use.
  The STDIO transport intentionally executes user-specified local commands —
  that is a feature, not a vulnerability. On shared or public deployments it
  should be disabled with `DISABLE_STDIO=1`.
- Account tokens (`mcps_…`) are bearer secrets: anyone holding a token can
  access that account's data. Reports about token handling, cross-account
  data leaks, widget sandbox escapes, or the OAuth flow are especially
  welcome.
