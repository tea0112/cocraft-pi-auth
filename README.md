# @cocraft/pi-auth

Pi extension package for Cocraft authentication.

## Installation

```bash
pi install git:https://github.com/tea0112/cocraft-pi-auth
```

## Setup

1. Set the `PI_COCRAFT_API_BASE` environment variable to your Cocraft API base URL:

```bash
export PI_COCRAFT_API_BASE=http://YOUR_INTERNAL_API_HOST:PORT
```

2. Verify the provider is installed:

```bash
pi --list-models | grep -i cocraft
```

## Authentication

Authenticate with your refresh token:

```bash
/login cocraft
```

Enter your Cocraft refresh token when prompted. Credentials are stored in `~/.pi/agent/auth.json` (managed by Pi, not this package).

## Usage

Chat with the model using the `cocraft/minimax-m2.7` model ID:

```bash
pi -m cocraft/minimax-m2.7 "Hello, how are you?"
```

Or set it as your default model in settings.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PI_COCRAFT_API_BASE` | Yes | Your Cocraft API base URL (e.g. `http://YOUR_INTERNAL_API_HOST:PORT`) |
| `PI_COCRAFT_PROXY` | No | If set, route requests through the system proxy (`$http_proxy`/`$https_proxy`). If unset, bypass proxy for direct connection. |

### Proxy Behavior

- **`PI_COCRAFT_PROXY` unset (default)**: Direct connection to the API. HTTP proxy is bypassed via `--noproxy "*"` flag. Use this when `PI_COCRAFT_API_BASE` points to an internal IP.
- **`PI_COCRAFT_PROXY=1`**: Route requests through the system proxy. Both `http://` and `https://` URLs use `$http_proxy`/`$https_proxy` respectively.

Example (with proxy):
```bash
PI_COCRAFT_PROXY=1 PI_COCRAFT_API_BASE=http://YOUR_INTERNAL_API_HOST:PORT pi -m cocraft/minimax-m2.7 "hi"
```

Example (without proxy, internal IP):
```bash
PI_COCRAFT_API_BASE=http://YOUR_INTERNAL_API_HOST:PORT pi -m cocraft/minimax-m2.7 "hi"
```

### Token Storage

OAuth credentials are stored in `~/.pi/agent/auth.json`, managed by Pi. This package does not write or read any custom token files.

## Troubleshooting

**Provider not appearing in `pi --list-models`**
- Ensure `PI_COCRAFT_API_BASE` is set before running `pi`
- Verify `pi --version` is >= 1.0
- Try `pi reload` to hot-reload extensions

**Authentication fails**
- Confirm your refresh token is valid
- Ensure `PI_COCRAFT_API_BASE` is correct and reachable from your network

**Proxy errors**
- If behind a proxy: set `PI_COCRAFT_PROXY=1`
- If connecting to an internal IP: leave `PI_COCRAFT_PROXY` unset
