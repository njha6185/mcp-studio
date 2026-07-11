# Deploying to GCP free tier (with GitHub Actions CI/CD)

Runs MCP Widget Studio on Google Cloud's **always-free** `e2-micro` VM with
HTTPS and automatic deploys on every push to `main`. Total cost: $0 (a credit
card is required at GCP signup but the free tier is never billed).

## 1. Create the VM (Cloud Console, one time)

1. [console.cloud.google.com](https://console.cloud.google.com) → create a
   project → **Compute Engine** → enable the API → **Create instance**.
2. Settings that keep it inside the free tier (all three matter):
   - **Region**: `us-central1`, `us-west1`, or `us-east1` (free tier only
     exists in these)
   - **Machine type**: `e2-micro`
   - **Boot disk**: Debian 12, **Standard persistent disk** (not balanced/SSD),
     ≤ 30 GB
3. Firewall: check **Allow HTTP traffic** and **Allow HTTPS traffic**.
4. Create. Then: **VPC network → IP addresses → Reserve external static IP**
   and attach it to the instance (free while attached to a running VM).

## 2. Free domain + DNS (one time)

TLS certificates need a domain. Free forever option:
[duckdns.org](https://www.duckdns.org) — sign in, create a subdomain
(e.g. `mystudio.duckdns.org`), set its IP to your VM's static IP.

## 3. Set up the VM (one time)

Open the instance's **SSH** button (browser terminal) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/njha6185/mcp-widget-studio/main/deploy/setup-vm.sh -o setup-vm.sh
bash setup-vm.sh mystudio.duckdns.org
```

This installs Node 20 + Caddy (automatic HTTPS), creates the app directory,
and registers the systemd service with production settings:
`DISABLE_STDIO=1` (public users must not run commands on your VM) and
multi-account mode (every visitor generates their own `mcps_…` account token).

## 4. Wire up CI/CD (one time)

1. On your **local machine**, create a deploy key:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/mcp-deploy -N "" -C "github-actions-deploy"
   cat ~/.ssh/mcp-deploy.pub
   ```
2. On the **VM** (browser SSH): append that public key line to
   `~/.ssh/authorized_keys`.
3. In the **GitHub repo** → Settings → Secrets and variables → Actions, add:
   | Secret | Value |
   |---|---|
   | `VM_HOST` | the static IP |
   | `VM_USER` | your username on the VM (shown in the SSH prompt) |
   | `VM_SSH_KEY` | contents of `~/.ssh/mcp-deploy` (the **private** key) |

## 5. Deploy

Push to `main` (or run the **Deploy to VM** workflow manually from the
Actions tab). The workflow builds the client + server, ships the artifacts
over SSH, installs production dependencies, restarts the service, and
health-checks it.

Open `https://mystudio.duckdns.org` — the token gate greets each visitor,
and every generated token is an isolated account.

## Notes

- **Free-tier fine print**: one e2-micro per account, in the three US regions,
  standard PD ≤ 30 GB, 1 GB/month network egress (plenty for this app).
- **Data**: everything lives in `/opt/mcp-widget-studio/data/store.json` on
  the VM's persistent disk — surviving deploys and reboots. Back it up if the
  accounts matter.
- **Logs**: `sudo journalctl -u mcp-widget-studio -f` on the VM.
- **stdio is disabled** on this deployment by design; connect to remote
  (streamable HTTP / SSE) MCP servers, or run stdio servers locally with
  `npx mcp-widget-studio` instead.
