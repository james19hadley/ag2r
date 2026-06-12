# Security and Development Environment Optimization Plan

This document outlines the security, stability, and workflow challenges identified on the server (`ubuntu-4gb-hel1-1`) and proposes a migration plan to separate development from production, secure the running services, and establish a local-first development workflow.

---

## 🛑 Problem Analysis & Risks

### 1. Overlapping Development & Production Environments
*   **Risk**: High. Heavy tasks (like testing or code generation by the AI agent) consume CPU and memory, which can starve production services. Accidental commands (e.g. database drops, resource cleanups) can cause instant production outages.
*   **Git Credential Vulnerability**: Storing write-access SSH keys or GitHub Personal Access Tokens (PATs) on a production machine is a massive risk. If the production server is breached, the attacker instantly gains write access to your GitHub repositories.

### 2. Services Running as `root`
*   **Risk**: Critical. All services in `/opt/` and `ag2r` currently run under the `root` user.
*   **Consequence**: If a remote code execution (RCE) or path traversal vulnerability is found in any of the Node.js/Python applications, an attacker immediately inherits full root access to the entire operating system.

---

## 🎯 Proposed Long-Term Solutions

### 1. Environment Separation (Dev vs. Prod VM)
*   **Prod VM**: A clean, hardened server. No development tools, no AI agents, no write-access Git keys. Code is deployed via a read-only token (`git pull` with Deploy Key) or automated CI/CD pipeline.
*   **Dev VM**: A mirror of the production VM where you and the AI agent perform development, run tests, and experiment safely. Pushing to GitHub is done only from this machine.

### 2. Privilege Demotion (Non-root Systemd Services)
Every web application or backend service should run under a dedicated, unprivileged system user.
*   Create a system user for each app (e.g., `ag2r`, `pulse`, `bot`):
    ```bash
    sudo useradd -r -s /bin/false ag2r
    ```
*   Assign ownership of the application directory to that user:
    ```bash
    sudo chown -R ag2r:ag2r /root/ag2r
    ```
*   Update the systemd service file to run as the unprivileged user:
    ```ini
    [Service]
    User=ag2r
    Group=ag2r
    ```

---

## 🚀 Temporary Local-First Development Workflow

Until the separate Dev VM and CI/CD pipelines are fully set up, you should perform all development on your local machine and sync tested changes to the server. Here is how to configure and execute this workflow securely:

### 1. Setup Local Git & Remote Repository
1.  Initialize a Git repository on your local computer in your project folder (e.g., `/Users/omercan/Workspace/ag2r`).
2.  Commit all files to the local Git repository.
3.  Create a private repository on GitHub (or your preferred platform) and push the code:
    ```bash
    git remote add origin git@github.com:your-username/ag2r.git
    git push -u origin main
    ```

### 2. Local-to-Server Sync Methods
To deploy your local changes to the server without installing Git keys on the server, choose one of these two methods:

#### Method A: SSH Agent Forwarding (Recommended)
This lets you use your local computer's SSH keys on the remote server temporarily during your active SSH session. No keys are saved on the server.
1.  Add your SSH key to your local SSH agent:
    ```bash
    ssh-add ~/.ssh/id_ed25519
    ```
2.  Connect to the server with agent forwarding enabled:
    ```bash
    ssh -A root@YOUR_SERVER_IP
    ```
3.  Once connected, you can run Git commands on the server (like `git clone` or `git pull`) and they will securely use your local machine's keys.

#### Method B: Direct Rsync (One-way Sync from Local to Server)
Run this command from your local machine to push changes directly to the server, excluding Git metadata and node modules:
```bash
rsync -avz --exclude '.git' --exclude 'node_modules' --exclude '.env' \
  /Users/omercan/Workspace/ag2r/ root@YOUR_SERVER_IP:/root/ag2r/
```

### 3. Step-by-Step Local Development Workflow
When making changes (such as adding the Sleep/Wake controls):
1.  **Develop Locally**: Edit the backend (`src/routes-misc.js`) and frontend (`public/js/app.js`) on your local machine.
2.  **Commit Locally**: Keep your code clean by committing changes locally:
    ```bash
    git add .
    git commit -m "feat: add sleep and wakeup endpoints"
    git push origin main
    ```
3.  **Sync to Server**: Use `rsync` or connect via `ssh -A` and run `git pull` in `/root/ag2r/`.
4.  **Restart the Service**: Restart the AG2R service on the server to apply the changes:
    ```bash
    ssh root@YOUR_SERVER_IP "systemctl restart ag2r.service"
    ```
