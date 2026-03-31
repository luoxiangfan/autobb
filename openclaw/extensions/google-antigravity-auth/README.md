# Google Antigravity Auth (OpenClaw plugin)

OAuth provider plugin for **Google Antigravity** (Cloud Code Assist).

## Enable

Bundled plugins are disabled by default. Enable this one:

```bash
openclaw plugins enable google-antigravity-auth
```

Restart the Gateway after enabling.

## Authenticate

```bash
openclaw models auth login --provider google-antigravity --set-default
```

## OAuth Secret (Optional)

If your Google OAuth client requires a secret during token exchange, set one of:

```bash
export OPENCLAW_GOOGLE_ANTIGRAVITY_CLIENT_SECRET="your_client_secret"
# or
export GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_SECRET="your_client_secret"
```

Do not commit OAuth client secrets to git.

## Notes

- Antigravity uses Google Cloud project quotas.
- If requests fail, ensure Gemini for Google Cloud is enabled.
