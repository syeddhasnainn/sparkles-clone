# Workspace files, preview, and desktop

Implemented in the task workbench. The toolbar opens a resizable Files, Preview, or Desktop panel alongside the conversation; narrow layouts show the selected panel at full width. Closing a panel preserves the conversation draft.

| View    | Behavior                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Files   | All/changed file navigation, task-base or HEAD comparison, highlighted content, unified/split diffs, and image previews.                               |
| Preview | Configurable development command and port, service logs, embedded page, relative path navigation, reload, mobile viewport, and owner-authorized links. |
| Desktop | On-demand Linux desktop with Chromium, interactive mouse/keyboard input, reconnect, fullscreen, and owner-authorized links.                            |

## Runtime

The existing Modal sandbox hosts all three views. File operations run bounded Git and filesystem reads. Preview and Desktop use a small Node supervisor with a private localhost control endpoint. The preview gateway forwards HTTP and WebSocket traffic to the selected application port. The desktop gateway serves noVNC and forwards its WebSocket to private websockify/x11vnc ports; Xvfb, Openbox, and Chromium supply the desktop.

Desktop is a browser-equipped OS view for the user. It does not configure MCP or give the agent additional computer-control tools. Browser profiles are temporary; audio and recording are not implemented.

Preview detects npm/pnpm/yarn development scripts and installs dependencies if needed. Static projects use a restricted server that rejects dotfiles, private key files, node_modules, and all symlinks, and serves regular files up to 16 MiB without directory listings. Custom development commands remain responsible for their own file-serving policy. The command and port remain editable and are saved under `.git/sparkles/preview.json`, which survives workspace checkpoints without adding a tracked file. If a server already answers on the chosen port, Preview connects to it; Disconnect revokes access without killing that independently started process. Stop terminates a process started by Preview.

## Access and isolation

Every application command checks the signed-in owner, repository authorization, current run, readiness, and expiry. The controller checks the run again before returning results so a response from a stopped or superseded sandbox is discarded.

Preview and Desktop use distinct Modal encrypted-tunnel origins. The gateways require one-time bootstrap tickets exchanged for host-only, HttpOnly, Secure, SameSite=None, Partitioned cookies. Grants expire after at most 15 minutes or at workspace expiry, whichever comes first. The UI renews its connection every 12 minutes. Bootstrap tickets travel in URL fragments, are removed immediately, and never become the copied link. Stable application links authenticate the owner before issuing fresh access.

The proxy validates request origins, strips gateway credentials before forwarding, preserves application cookies, rewrites localhost redirects, and supports WebSocket upgrades. Stopping the workspace revokes both services and closes existing sockets; stopping/disconnecting Preview revokes its grants and sockets. Preview content is isolated from application session cookies and framed in a sandboxed iframe. Raw VNC and control ports are not exposed.

File reads reject traversal, escaping symlinks, internal state, and common secret files, including aliases resolving into blocked directories. Reads are limited to 512 KiB per file and listings to 2,000 entries. Views are read-only. Task-base comparisons remain stable after agent commits; HEAD comparisons show uncommitted changes. Untracked and deleted files are supported.

## Lifecycle and limits

Stopped workspaces retain conversation history, but these live views require Resume. Checkpoints restore repository files and preview configuration, not running processes. Start Preview or Open Desktop after resuming; connections are issued for the restored run. Existing sandboxes created before this feature need a stop/resume cycle to receive the new image and tunnel ports.

The path field controls requested preview navigation. Navigation within an arbitrary cross-origin app cannot automatically update that field. Applications with custom origin checks, OAuth callbacks, or absolute development URLs may need their own development-server configuration.

## Verification

Automated coverage includes bounded file reads and diffs, unsafe paths and secrets, ownership and stale-run checks, unauthenticated/expired/cross-service session rejection, one-time ticket exchange, credential stripping, WebSocket forwarding, and disconnect revocation. Live Modal/Chrome verification covers isolated preview embedding, desktop rendering and keyboard input, and Files in the real task workbench.

Gateway URL parsing rejects malformed request targets with HTTP 400 before session processing. Security regression tests cover gateway survival and restricted static file serving through authenticated sessions. Existing running supervisors receive these changes after their workspace is stopped and resumed.
