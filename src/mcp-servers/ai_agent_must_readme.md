# MCP — How This Folder Works

## Auto-discovery

`auto_discover_mcp.ts` scans this directory for `.json` files at runtime.  
If `"enabled": true`, the server is connected and its tools are loaded automatically.  
**No code changes needed — just add a JSON file.**

---

## File Standard

Each MCP server = one `.json` file. Name the file same as `name`.

### stdio server

```json
{
  "name": "memory",
  "enabled": true,
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-memory"]
}
```

### SSE (HTTP) server

```json
{
  "name": "my_server",
  "enabled": true,
  "url": "http://localhost:3100/sse"
}
```

### With env vars

```json
{
  "name": "github",
  "enabled": true,
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token-here"
  }
}
```

### HTTP server with auth headers (secret from `.env`)

Use `${ENV_VAR}` syntax in header values — resolved from `process.env` at connect time.  
The actual secret never lives in the JSON file.

```json
{
  "name": "context7",
  "enabled": true,
  "url": "https://mcp.context7.com/mcp",
  "headers": {
    "Authorization": "Bearer ${CONTEXT7_API_KEY}"
  }
}
```

Then in `.env`:

```bash
CONTEXT7_API_KEY=your-key-here
```

Multiple headers work too:

```json
{
  "name": "my_server",
  "enabled": true,
  "url": "https://example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${MY_API_KEY}",
    "X-Tenant-ID": "${MY_TENANT_ID}"
  }
}
```

---

## Fields

| Field     | Required | Description                                            |
| --------- | -------- | ------------------------------------------------------ |
| `name`    | ✅       | Tool name prefix: `<name>__<tool_name>`                |
| `enabled` | ✅       | `true` = connect, `false` = skip                       |
| `command` | one of   | Executable (stdio transport)                           |
| `args`    | no       | Arguments for the command                              |
| `env`     | no       | Extra env vars passed to the stdio process             |
| `url`     | one of   | HTTP endpoint (instead of `command`)                   |
| `headers` | no       | HTTP headers — values support `${ENV_VAR}` from `.env` |

---

## Adding a New MCP Server

1. Create `src/mcp/server_name.json`
2. Set `"enabled": true`
3. Done — auto-connected on next run

Tools exposed as: `server_name__tool_name`

## Disabling Without Deleting

Set `"enabled": false` in the JSON file.

---

## What NOT to do

- ❌ Don't put `.ts` server configs here — JSON only
- ❌ Don't set both `command` and `url`
- ❌ Don't put multiple server configs in one file
