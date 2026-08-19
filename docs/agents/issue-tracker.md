# Issue tracker: committed local documentation

Citywide work is tracked in `docs/engineering/ticket-catalog.md` and Git history. GitHub Issues and pull requests are not used.

## Conventions

- The ticket catalog is the source of ticket scope, blockers, ownership, acceptance, and status.
- Work only on tickets whose blockers are complete.
- Mark a ticket complete only after the primary agent has reviewed it, run the phase gate, committed the checkpoint, and pushed it to `origin/main`.
- Record the verification commands and commit SHA in the ticket's completion note.
- Use imperative local commit messages and push directly to `origin/main` after every verified checkpoint.
- The primary agent owns integration, deployment, browser verification, and status updates.

Never place credentials, database addresses, raw provider payloads, or incident artifacts in the ticket catalog or commit messages.
