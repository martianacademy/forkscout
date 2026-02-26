# ⚙️ n8n Workflows

This folder contains n8n workflow JSON exports that can be imported into n8n.

## Usage

1. Open n8n UI: http://localhost:5678
2. Menu → Import from File
3. Select the workflow JSON
4. Activate the workflow

## Current Workflows

| File | Webhook Path | Description |
|------|--------------|-------------|
| `forkscout-test-workflow.json` | `forkscout-test` | Test workflow for ForkScout |

## Adding New Workflows

When adding a new workflow:
1. Export from n8n as JSON
2. Name it descriptively: `<purpose>-workflow.json`
3. Update this readme with webhook path and description
4. Ensure workflow is set to active after import