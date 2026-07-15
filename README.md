# @cocraft/pi-auth

Pi extension package for Cocraft authentication.

## Installation

```bash
pi install git:https://github.com/tea0112/cocraft-pi-auth
```

Then restart pi.

## Setup

Set the `PI_COCRAFT_API_BASE` environment variable to your Cocraft API base URL:

```bash
export PI_COCRAFT_API_BASE=http://YOUR_INTERNAL_API_HOST
```

Verify the provider is installed:

```bash
pi --list-models | grep -i cocraft
```

## Authentication

Authenticate with your refresh token:

```bash
/login cocraft
```

Enter your Cocraft refresh token when prompted. Credentials are stored in `~/.pi/agent/auth.json`.

## Usage

Chat with the model:

```bash
pi --provider cocraft --model minimax-m2.7 --print "Hello, how are you?"
```

On newer pi versions:

```bash
pi -m cocraft/minimax-m2.7 "Hello, how are you?"
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PI_COCRAFT_API_BASE` | Yes | — | Your Cocraft API base URL (e.g. `http://10.208.217.112`) |
| `PI_COCRAFT_PROXY` | No | unset | If set, route requests through the system proxy. If unset, bypass proxy for direct connection. |
| `PI_COCRAFT_CONTEXT_WINDOW` | No | `1000000` | Context window size in tokens. |
| `PI_COCRAFT_MAX_TOKENS` | No | `65536` | Maximum output tokens. |
| `PI_COCRAFT_DEBUG` | No | unset | Set to `1` for verbose debug logging to stderr. |

### Proxy Behavior

- **`PI_COCRAFT_PROXY` unset (default)**: Direct connection to the API, bypassing the system proxy. Use this when `PI_COCRAFT_API_BASE` points to an internal IP.
- **`PI_COCRAFT_PROXY=1`**: Route requests through the system proxy (`$http_proxy`/`$https_proxy`).

Example with proxy:

```bash
PI_COCRAFT_PROXY=1 PI_COCRAFT_API_BASE=http://YOUR_INTERNAL_API_HOST pi --provider cocraft --model minimax-m2.7 --print "hi"
```

Example without proxy (internal IP):

```bash
PI_COCRAFT_API_BASE=http://10.208.217.112 pi --provider cocraft --model minimax-m2.7 --print "hi"
```

Example with custom context window:

```bash
PI_COCRAFT_CONTEXT_WINDOW=500000 PI_COCRAFT_MAX_TOKENS=32768 PI_COCRAFT_API_BASE=http://10.208.217.112 pi --provider cocraft --model minimax-m2.7 --print "hi"
```

### Token Auto-Rotation

The refresh token is rotated on every API call proactively. Credentials are persisted to `~/.pi/agent/auth.json` automatically.

### Debug Logging

```bash
PI_COCRAFT_DEBUG=1 pi --provider cocraft --model minimax-m2.7 --print "hi"
```

## Troubleshooting

**Provider not appearing in `pi --list-models`**
- Ensure `PI_COCRAFT_API_BASE` is set before running `pi`
- Verify the extension is installed: `pi list`
- Try removing and reinstalling the extension

**Authentication fails**
- Confirm your refresh token is valid
- Ensure `PI_COCRAFT_API_BASE` is correct and reachable

**Connection error on internal IP**
- The proxy env vars may be set globally. Unset `PI_COCRAFT_PROXY` or set it to empty.
- On Windows with Git Bash/ZSH: `PI_COCRAFT_PROXY="" pi ...`