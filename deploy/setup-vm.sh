#!/usr/bin/env bash
# One-time setup for a GCP free-tier VM (Debian 12, e2-micro).
# Usage:  bash setup-vm.sh <your-domain>     e.g.  bash setup-vm.sh mystudio.duckdns.org
set -euo pipefail

DOMAIN="${1:?Usage: bash setup-vm.sh <domain> — e.g. mystudio.duckdns.org}"

echo "==> Installing Node.js 20"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "==> Installing Caddy (automatic HTTPS)"
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
  sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' |
  sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update && sudo apt-get install -y caddy

echo "==> App directory (deploys land here via GitHub Actions)"
sudo mkdir -p /opt/mcp-widget-studio/data
sudo chown -R "$USER":"$USER" /opt/mcp-widget-studio

echo "==> systemd service"
sudo tee /etc/systemd/system/mcp-widget-studio.service >/dev/null <<EOF
[Unit]
Description=MCP Widget Studio
After=network.target

[Service]
User=$USER
WorkingDirectory=/opt/mcp-widget-studio
# Multi-account mode (each visitor generates their own mcps_ token) and no
# stdio: public users must not be able to run commands on this VM.
Environment=PORT=3400
Environment=DISABLE_STDIO=1
Environment=STORE_PATH=/opt/mcp-widget-studio/data/store.json
ExecStart=/usr/bin/node /opt/mcp-widget-studio/server/dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable mcp-widget-studio

echo "==> Caddy reverse proxy with automatic TLS for $DOMAIN"
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
    reverse_proxy localhost:3400
}
EOF
sudo systemctl restart caddy

echo
echo "Setup complete."
echo "Next: add the GitHub secrets and push to main — the Actions workflow"
echo "will deploy the app. Then open: https://$DOMAIN"
