# AG2R Environment Architecture & Regulations

This document establishes the architecture, deployment targets, and operational rules for the AG2R setup.

---

## 🌐 Target Architecture

*   **Primary Production Target (The Server)**:
    *   **Host IP**: `<remote-server-ip>` (accessible via Tailscale).
    *   **Remote Web Interface (AG2R)**: Runs on port `3000` (HTTPS) as the systemd service `ag2r.service`.
    *   **Antigravity Session**: Runs on the server as an Electron GUI application on headless Xvfb display `:99` managed by systemd service `antigravity-gui.service`.
    *   **Debugger Port**: Antigravity exposes the Chrome DevTools Protocol (CDP) on port `9000` (localhost only).

*   **Local Development Target (The Laptop)**:
    *   **Host IP**: `<local-laptop-ip>` (accessible via Tailscale).
    *   **Local Web Interface**: May run on port `3001` (for temporary testing only).
    *   **Operational Rule**: **DO NOT run or rely on the local laptop AG2R server for active usage.** The user connects to the remote server on port `3000` from their mobile phone. Running a parallel instance on the laptop is unnecessary and creates confusion.

---

## 🚀 Deployment & Sync Regulations

To deploy updates from the local repository on the laptop to the remote production server:

1.  **Sync Files**:
    Use `rsync` to copy modified files, excluding keys, configurations, and build modules:
    ```bash
    rsync -az --delete --exclude='.git' --exclude='node_modules' --exclude='certs' --exclude='.env' /home/ging/prog/ag2r/ user@<remote-server-ip>:/path/to/ag2r/
    ```

2.  **Restart remote service**:
    ```bash
    ssh user@<remote-server-ip> "systemctl restart ag2r"
    ```

---

## ⚡ Sleep / Wake Control Integration Plan

To implement Sleep/Wake controls for the remote Antigravity instance:
1.  **systemd Change**: Replace `Requires=antigravity-gui.service` with `Wants=antigravity-gui.service` in `/etc/systemd/system/ag2r.service` on the server so AG2R remains online when the agent is asleep.
2.  **Backend Endpoints**: Add `/api/antigravity/status`, `/api/antigravity/sleep`, and `/api/antigravity/wakeup` to `src/routes-misc.js` (executes systemctl control commands).
3.  **Frontend Controls**: Implement a power state button/toggle in the header to sleep/wake the agent and visually represent its status.
