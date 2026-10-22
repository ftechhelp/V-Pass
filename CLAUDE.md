# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

All project guidance (architecture, commands, verification status, gotchas) is in AGENTS.md, so other coding agents read the same content:

@AGENTS.md

## Claude-specific notes

- The original approved build plan is in `/home/vincent/.claude/plans/i-want-to-make-majestic-cat.md`. Its milestones were all drafted in the first session; see "Verification status" in AGENTS.md for what still needs to be run.
- **Every feature and change is for every client** unless the owner names just one: the web app, the Chrome extension, the iPhone app, and any client built later. Build, test and ship it on all of them without asking; if one can't have it, say why and list the gap. Standing rule from the owner (2026-10-22); details in "Decisions made with the owner" in AGENTS.md.
- Docker works without `sudo` (the user is in the `docker` group). If the daemon is ever down, ask the user to start it rather than working around it.
- **After every change that is finished and passes its tests on the throwaway dev stack, update V-Pass on the owner's production Nextcloud** so they can test it too. Follow "Ship every tested change to production" in AGENTS.md: back up first, bump the version, touch only the `vpass` app, verify, then report. This is a standing instruction from the owner (2026-10-16), so don't wait to be asked; never ship untested or failing changes. The production URL, container names and backup folder are in memory (`production-nextcloud`).
