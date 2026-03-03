<div align="center">
  <img src="public/logo.svg" width="80" alt="ForkScout Logo" />
  <h1>ForkScout Frontend</h1>
  <p><strong>Landing page for <a href="https://www.forkscout.com">forkscout.com</a></strong></p>

  <p>
    <a href="https://www.forkscout.com">Website</a> ·
    <a href="https://github.com/marsnext/forkscout">Agent Repo</a> ·
    <a href="https://github.com/marsnext/forkscout/issues">Issues</a>
  </p>
</div>

---

## Overview

Marketing and documentation landing page for **ForkScout** — an autonomous AI agent that runs shell commands, browses the web, reads and writes files, remembers everything, and modifies its own code.

### Sections

| Section          | Description                                                                       |
| ---------------- | --------------------------------------------------------------------------------- |
| **Hero**         | Logo, animated tagline, install commands, CTA buttons                             |
| **Tech Marquee** | Scrolling cards showcasing the tech stack (Bun, TypeScript, AI SDK v6, MCP, etc.) |
| **Features**     | 9 capability cards — shell access, memory, MCP, multi-channel, and more           |
| **Use Cases**    | 6 real-world scenarios — DevOps, code review, security, research                  |
| **Providers**    | 9 LLM provider badges with logos + config code block                              |
| **CTA**          | Final call-to-action with install button                                          |

## Tech Stack

| Layer      | Technology                                                                |
| ---------- | ------------------------------------------------------------------------- |
| Framework  | [Next.js 16](https://nextjs.org) (App Router, Turbopack)                  |
| Runtime    | [Bun](https://bun.sh)                                                     |
| Language   | TypeScript (strict)                                                       |
| Styling    | [Tailwind CSS v4](https://tailwindcss.com)                                |
| Components | [shadcn/ui](https://ui.shadcn.com) + [Radix UI](https://www.radix-ui.com) |
| Animations | [Framer Motion](https://motion.dev)                                       |
| Theming    | [next-themes](https://github.com/pacocoursey/next-themes) (light + dark)  |
| Icons      | [Lucide React](https://lucide.dev)                                        |

## Getting Started

### Prerequisites

- **Bun** ≥ 1.0 — [Install Bun](https://bun.sh)

### Install & Run

```bash
# Clone
git clone https://github.com/marsnext/forkscout.git
cd forkscout

# Install dependencies
bun install

# Start dev server (port 3000)
bun run dev
```

### Build for Production

```bash
bun run build   # creates optimized .next/ output
bun start       # starts production server on :3000
```

## Project Structure

```
src/
├── app/
│   ├── globals.css          # Tailwind v4 theme (oklch purple palette)
│   ├── layout.tsx           # Root layout with ThemeProvider
│   └── page.tsx             # Home page — composes all sections
├── components/
│   ├── home/
│   │   ├── hero-section.tsx        # Hero with logo, rotating text, install block
│   │   ├── tech-marquee.tsx        # Scrolling tech stack cards
│   │   ├── tech-data.ts            # Tech stack item definitions
│   │   ├── features-section.tsx    # 9 feature cards
│   │   ├── use-cases-section.tsx   # 6 use case cards
│   │   ├── providers-section.tsx   # Provider badges + code block
│   │   ├── providers-data.ts       # Provider metadata + logo URLs
│   │   ├── cta-section.tsx         # CTA + footer
│   │   ├── animated-bg.tsx         # Floating gradient orbs background
│   │   └── rotating-text.tsx       # Cycling text animation
│   ├── ui/                  # shadcn/ui components (button, card, badge, etc.)
│   ├── forkscout-logo.tsx   # SVG logo React component
│   ├── theme-provider.tsx   # next-themes wrapper
│   └── theme-toggle.tsx     # Light/dark toggle button
├── lib/
│   └── utils.ts             # cn() helper (clsx + tailwind-merge)
public/
└── logo.svg                 # ForkScout trident logo (also used as favicon)
```

## Deployment

Hosted on [Vercel](https://vercel.com). Every push to `main` triggers automatic deployment.

| Environment | URL                                            |
| ----------- | ---------------------------------------------- |
| Production  | [www.forkscout.com](https://www.forkscout.com) |

### Deploy Your Own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/marsnext/forkscout)

## Related Repos

| Repo                                                                     | Description                                |
| ------------------------------------------------------------------------ | ------------------------------------------ |
| [forkscout](https://github.com/marsnext/forkscout)                       | The autonomous AI agent (Bun + TypeScript) |
| [forkscout-memory-mcp](https://github.com/marsnext/forkscout-memory-mcp) | Persistent memory MCP server               |

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">
  Built by <a href="https://github.com/marsnext"><strong>Martian Academy</strong></a>
</div>
