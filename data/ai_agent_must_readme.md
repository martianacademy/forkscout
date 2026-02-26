# 📁 Data Folder — Agent Standards

## Purpose
This folder stores **persistent non-code output** — reports, exports, generated assets, workflow files, and any other data that isn't source code.

---

## 📋 Storage Rules (MANDATORY)

| File Type | Where to Save | Example |
|-----------|---------------|---------|
| **Workflow JSON** | `data/workflows/` | `forkscout-test-workflow.json` |
| **Reports & Docs** | `data/docs/` | `progress.md`, `weekly-summary.md` |
| **Exports** | `data/exports/` | `export-2024.csv` |
| **Generated Assets** | `data/assets/` | `image.png`, `chart.svg` |
| **Legacy/Migrated Files** | `data/legacy/` | Old files kept for reference |
| **Temp Files** | `/tmp/` | Only for throwaway temp data |
| **Runtime Logs** | `.forkscout/` | Activity logs, chat history |

---

## ⚠️ ROOT DIRECTORY — NEVER TOUCH!

**The root directory is OFF LIMITS for any new non-code files.**

- ✅ Code/config files stay in root: `package.json`, `Dockerfile`, `.env`, etc.
- ✅ Source code in `src/`
- ❌ NEVER create/save new non-code files in root
- ❌ NEVER save output, reports, exports in root

**If you need to save anything non-code → save it in `data/` with proper subfolder!**

---

## 🔑 Critical Rules

1. **ALWAYS save non-code to `data/`** — NEVER the root directory
2. **ALWAYS create subfolders** — never dump files flat in `data/`
3. **ALWAYS create `ai_agent_must_readme.md`** when making new subfolders
4. **Use `/tmp/` only for throwaway** — files that can be deleted anytime

---

## 🛡️ Backup & Recovery (MUST READ!)

**Before ANY code change → Git commit first!**

```bash
git add -A && git commit -m "Backup before <change>"
```

**Recovery if errors after typecheck passes:**

| Level | Action |
|-------|--------|
| 1 | Stop → Check logs → Fix → Typecheck → Start |
| 2 | `git checkout <last-good-commit>` |
| 3 | `git checkout main && git pull` |

**See:** `data/docs/recovery/ai_agent_must_readme.md` for full details!

---

## 📂 Current Structure

```
data/
├── ai_agent_must_readme.md    ← You are here
├── docs/
│   ├── progress.md
│   └── recovery/              ← Backup & Recovery Policy
│       └── ai_agent_must_readme.md
├── legacy/
│   └── typescript
└── workflows/
    └── forkscout-test-workflow.json
```

---

## 🔄 Workflow Import Process

When creating n8n workflow files:
1. Save to `data/workflows/<workflow-name>.json`
2. Document webhook path and purpose in the JSON comments or separate README
3. User imports manually via n8n UI

---

## ✨ Example File Creation

**Correct:**
```
data/reports/2024/weekly/week12.md
data/assets/images/screenshot.png
data/exports/users.csv
data/docs/meeting-notes.md
```

**WRONG:**
```
./report.md                 ← Outside data! NEVER!
/root/somefile.json         ← NEVER!
data/somefile.json          ← No subfolder!
/tmp/important-data.csv     ← Should be in data if persistent
```

---

## 📝 Agent Memory

- **This folder (`data/`)** = persistent output only
- **Root directory** = code/config only — NEVER touch for new files!
- **Source code (`src/`)** = source code only
- **Runtime data (`.forkscout/`)** = logs, runtime data
- **Temp files (`/tmp/`)** = throwaway only

**Remember:** 
- ✅ Always organize in subfolders
- ✅ Always create readme in new folders
- ✅ Always save non-code to data/
- ❌ NEVER save to root directory!
- 🛡️ ALWAYS git commit before any change!