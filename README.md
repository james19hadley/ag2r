# AG2R — Antigravity 2.0 Remote

A lightweight mobile remote interface for monitoring and interacting with [Antigravity](https://antigravity.dev) AI coding sessions.

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Antigravity running with CDP enabled:
  ```bash
  antigravity . --remote-debugging-port=9000
  ```

### Setup

```bash
# Clone the repo
git clone git@github.com:the-future-company/ag2r.git
cd ag2r

# Install dependencies
npm install

# Copy environment config and customize
cp .env.example .env

# Start the server
node server.js
```

On first run, AG2R generates a self-signed SSL certificate in `certs/`.

### Connect from Phone

1. Open `https://<your-computer-ip>:3000` on your phone (same Wi-Fi network)
2. Accept the self-signed certificate warning
3. Enter the passcode (default: `antigravity`, configurable in `.env`)

### Cloudflare Tunnel (Optional)

For access outside your local network, set up a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

```bash
# In .env
TUNNEL_ENABLED=true
TUNNEL_URL=https://remote.yourdomain.com
```

## 📱 Features

- **Real-time chat monitoring** — see Antigravity's responses as they stream
- **Send messages** — type and send messages to the AI from your phone
- **Stop generation** — cancel a running generation with the stop button
- **Auto-reconnect** — seamless reconnection when connection drops
- **Cookie-based auth** — enter passcode once, stays logged in for 30 days

## 🤖 For AI Agents

> Start with **[ONBOARDING.md](./ONBOARDING.md)** for the full technical reference (architecture, file maps, workflows). Your behavioral rules are in **[GEMINI.md](./GEMINI.md)**.

## License

MIT
