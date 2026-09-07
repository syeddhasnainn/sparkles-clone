# Saved cloud-browser sessions

## Outcome

A user's Chromium logins survive workspace shutdown and restore, and can seed new tasks in the same project. Account settings show saved-session state and provide a working Clear saved sessions action. A clear operation must prevent any stale sandbox or task checkpoint from resurrecting cleared credentials.

## Ownership and storage

- Scope canonical profiles by authenticated user ID and immutable repository/project ID, never repository display name.
- Keep browser data outside the repository and ordinary agent checkpoints. Use a dedicated runtime directory and private R2 object prefix.
- Encrypt bounded archive bytes before writing R2 using authenticated encryption and ownership/version associated data. Reuse the configured secret through a separate cryptographic context; never pass the encryption key to agents or browsers. No cookie values or profile bytes in logs, UI responses, or D1 metadata.
- Store only profile metadata in D1: owner, project, archive reference, revision, clear generation, updated time, and any explicit concurrency state needed. Authenticate metadata reads and clearing without requiring an active GitHub connection.
- Apply hard archive and extracted-size limits, reject unsafe archive paths, links and special files, validate ownership and integrity, and discard Chromium process locks and caches.

## Runtime and lifecycle

- Both desktop bootstrap and computer_open must use one shared profile-path contract.
- Restore a profile before Chromium starts on new and resumed workspaces. Do not carry profiles through the existing repository checkpoint archive.
- Save browser changes periodically and before orderly stop, including changes made manually while the agent is idle. Reuse workspace lifecycle orchestration where practical.
- Capture a consistent browser profile, including cookies, local storage, IndexedDB and relevant encryption state. Ordinary recursive copying of actively changing SQLite/LevelDB files is insufficient. Implement a bounded quiesce/snapshot/release flow with cleanup in finally; do not repeatedly close user windows during periodic snapshots.
- Keep each live sandbox's browser profile private. Coordinate canonical publication using ownership/generation/revision checks. A stale workspace must never silently replace a newer canonical profile. Make conflict behavior explicit and preserve the last valid saved state rather than merging cookie databases.
- Failed transfers retain the last valid profile and surface a useful status. Abrupt sandbox loss can restore only the last completed save.

## Clearing

- Atomically advance an authoritative per-user clear generation and invalidate saved profile references first.
- Reject in-flight saves and restores from earlier generations. Profile generations must be checked during provisioning and publication, including races with clear.
- Reset Chromium and its profile in all affected live workspaces; keep computer actions coordinated with reset. Restart cleanly where appropriate. Do not claim success while a known live browser still holds the cleared session. Retry/report reset failures without allowing that browser to publish old cookies.
- Delete invalidated R2 objects, with retryable cleanup where necessary. An old task checkpoint must not contain a reusable canonical profile.
- Clearing local cloud-browser sessions does not revoke sessions at third-party identity providers; UI wording must not promise remote revocation.

## UI

Use the existing CloudBrowserSettings section. Replace the disabled placeholder with authenticated saved-state loading, a working action, pending state, and honest success/error feedback. Follow existing styling and individual Hugeicons imports. Do not expose implementation details to users.

## Verification

- Unit/integration tests for owner/project separation, encrypted round trip, archive validation, revision conflicts, and clear-versus-save/restore races.
- Lifecycle coverage: new task seed, same-task stop/resume, periodic save with idle agent, no-browser no-op, and failed save retaining previous good state.
- Live Modal/Chromium test with a synthetic HTTP cookie/localStorage marker: save, terminate sandbox, restore into another sandbox, verify marker; clear and verify absent in running and subsequently restored browsers.
- Browser-test Account settings through the user's Chrome extension; close test tabs afterward. Use synthetic sessions only; never clear the user's genuine cloud logins for verification.
- Run relevant tests, pnpm check, and pnpm build. Review all changes. No deployment or commit unless requested.

## Implementation decisions

- Chromium uses `/tmp/sparkles-browser-profile` with `--password-store=basic` and `--restore-last-session`. The profile archive keeps `Local State`, `Default`, and named profile directories while dropping process locks, caches, and downloaded browser components.
- Capture freezes the Chromium process tree without closing its windows, drains computer actions through the runtime lock, writes a bounded archive, and resumes Chromium in a finally path. Compressed archives are limited to 16 MiB and extraction to 128 MiB.
- R2 objects use independently authenticated 512 KiB AES-GCM frames. HKDF derives a per-archive key from the existing encryption secret, and every frame authenticates the user, repository ID, generation, revision, archive metadata, frame count, and frame index.
- D1 compare-and-swap publication increments the project revision only when the workspace lease still matches. Conflicting workspaces keep the canonical profile unchanged and stop publishing their local browser state.
- Clear advances the per-user generation and queues every invalidated object for deletion in the same D1 transaction. Live workspaces are blocked from publishing until their local browser reset succeeds.
