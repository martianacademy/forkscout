# 🔄 ForkScout Backup & Recovery Policy

## Why This Exists

`bun run typecheck` sirf TypeScript compile verify karta hai. Runtime errors, config issues, ya external service failures TYPECHECK SE NAHIN ATE.

---

## ⚠️ Errors That Survive Typecheck

| Error Type | Example | Detected By |
|------------|---------|-------------|
| **Runtime Logic** | `undefined` access, async issues | Activity log |
| **Config Issues** | Wrong API key, missing env | Runtime |
| **Import Resolution** | Bun resolves differently than TSC | Runtime |
| **External Services** | n8n/Telegram down | Activity log |
| **Missing Runtime Files** | Config file missing | Runtime |

---

## 🛡️ Backup Policy (HAR CHANGE SE PEHLE)

### Step 1: Git Commit Before Changes

```bash
# Current state save karo
git add -A
git commit -m "Backup: before <change-description>"
```

### Step 2: Note Current Working State

```bash
# Agent status note karo
echo "Pre-change state: $(date)" >> data/docs/recovery/change-log.md
```

---

## 🔧 Recovery Procedure (WHEN ERRORS OCCUR)

### Level 1: Quick Fix (60% cases)

```bash
# 1. Stop agent
bun run stop

# 2. Check exact error
grep '"type":"error"' .forkscout/activity.log | tail -5 | jq .

# 3. Fix the error (read file at line mentioned in error)

# 4. Verify with typecheck
bun run typecheck

# 5. Restart
bun start
```

### Level 2: Rollback (30% cases)

```bash
# Last working commit pe jao
git log --oneline -5
git checkout <commit-hash>

# Verify
bun run typecheck && bun start
```

### Level 3: Full Restore (10% cases)

```bash
# Pure backup se restore
git checkout main
git pull origin main

# Reinstall dependencies
rm -rf node_modules && bun install

# Verify
bun run typecheck

# Restore config
cp .env.example .env  # edit with actual values
```

---

## ✅ Health Check After Restart

Agent restart ke baad verify karo:

```bash
# 1. Check logs for errors
tail -20 .forkscout/activity.log | jq .

# 2. Verify telegram polling
grep "Starting long-poll" .forkscout/activity.log

# 3. Check no recent errors
grep '"type":"error"' .forkscout/activity.log | tail -3
```

**Success indicators:**
- ✅ `[telegram] Starting long-poll...`
- ✅ No recent `"type":"error"` entries
- ✅ Agent responds to test message

---

## 📋 Change Log Template

Jab bhi changes karo, is format mein log karo:

```markdown
## 2026-02-26

### Change: Added n8n workflow trigger
- Pre-check: git commit done
- Typecheck: ✅ PASSED
- Runtime test: ✅ PASSED
- Issues: None

### Change: <description>
- Pre-check: git commit done
- Typecheck: ✅/❌
- Runtime test: ✅/❌
- Issues: <if any>
```

---

## 🚨 Emergency Contacts

| Scenario | Action |
|----------|--------|
| Telegram Bot dead | Check `.env` BOT_TOKEN, restart n8n |
| n8n not triggering | Verify n8n running at configured URL |
| Memory full | Run `forkscout-mem__consolidate_memory` |
| Total crash | Full restore from git backup |

---

## 📝 Quick Reference Card

```bash
# BEFORE any change:
git add -A && git commit -m "Backup before <change>"

# AFTER any change:
bun run typecheck || { echo "FAILED"; exit 1; }
bun start

# IF ERROR:
bun run stop
grep '"type":"error"' .forkscout/activity.log | tail -3 | jq .
# Fix → typecheck → start

# IF UNRECOVERABLE:
git log --oneline -3  # find last good commit
git checkout <good-commit>
bun start
```

---

**Remember:** Git commit = your safety net. Never skip it!