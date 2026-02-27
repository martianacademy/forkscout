# src/secrets/ — Secret Vault

## Purpose

Encrypted named secret storage. Secrets are stored as `{{secret:alias}}` placeholders everywhere
in the LLM context — actual values only exist in `.agent/vault.enc.json` (AES-256-GCM) and
briefly in tool `execute()` scope during substitution.

## Rules

- NEVER import from this folder in system prompts or identity files
- NEVER log secret values — only alias names
- `resolveSecrets()` is ONLY called inside tool execute() at runtime
- `censorSecrets()` is called on ALL tool outputs before returning to LLM
- Vault file (`.agent/vault.enc.json`) is gitignored — never commit it
- Key = `VAULT_KEY` env var (or `TELEGRAM_BOT_TOKEN` as fallback)

## Files

| File       | Purpose                                                       |
| ---------- | ------------------------------------------------------------- |
| `vault.ts` | Core vault: encrypt/decrypt, resolve/censor, alias management |

## Placeholder format

```
{{secret:my_alias}}
```

User says: "use {{secret:db_pass}} to connect"
LLM sees: the placeholder, never the value
Tool gets: placeholder → resolves to actual value inside execute() only
