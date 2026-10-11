# Run Dancify with WSL2

Use Ubuntu 24.04 in WSL2 (Python 3.12). Run commands in Ubuntu unless explicitly marked PowerShell. Keep the checkout under your Linux home, not `/mnt/c`, for better performance. The API and frontend run locally; Windows Chrome or Edge provides the webcam.

## 1. Install WSL

In administrator PowerShell:

```powershell
wsl --install -d Ubuntu-24.04
```

Restart Windows if prompted, open Ubuntu, and finish creating your Linux user. For an existing installation, `wsl --list --verbose` in PowerShell should show version 2. Update WSL with `wsl --update` if needed.

## 2. Install system tools

In Ubuntu:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates python3 python3-venv python3-pip ffmpeg libgl1 libglib2.0-0
python3 --version
ffmpeg -version
```

Python must be 3.10–3.12; Ubuntu 24.04 supplies 3.12. Do not use Python 3.13+ for this project's pinned MediaPipe package.

Install Node 22 using nvm's official installer. Download the pinned installer, inspect it if desired, then run it:

```bash
curl -fsSLo /tmp/install-nvm.sh https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh
bash /tmp/install-nvm.sh
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 22
nvm alias default 22
node --version
npm --version
```

Node must be at least 22.12. Use Linux Node/npm inside WSL, not a Windows installation.

## 3. Clone and install

```bash
mkdir -p ~/projects
cd ~/projects
git clone https://github.com/clarkenoel/justmakeit.git
cd justmakeit
```

If the repository is private, authenticate GitHub using your normal Git credential manager or SSH setup; never put tokens into committed files.

For an existing checkout, commit or stash your changes before updating. Once this change has merged, use `main`. For further development, create your own branch:

```bash
git switch main
git pull --ff-only
git switch -c feat/local-web-work
```

Install separate Python environments:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install --upgrade pip
backend/.venv/bin/python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
backend/.venv/bin/python -m pip check

python3 -m venv pipeline/.venv
pipeline/.venv/bin/python -m pip install --upgrade pip
pipeline/.venv/bin/python -m pip install -r pipeline/requirements-dev.txt
pipeline/.venv/bin/python -m pip check

cd web
npm ci
cp .env.example .env.local
npm run build
cd ..
```

If `.env.local` already exists, edit it instead of overwriting it. Set `VITE_DANCIFY_API_URL=http://127.0.0.1:8000`. The cloud workspace's port 8001 is not needed here. Restart Vite after changing environment variables.

`npm ci` also installs the local MediaPipe assets and verifies the full model hash. No separate model download or API key is needed. Never copy virtual environments or `node_modules` from another machine.

## 4. Start the API

In Ubuntu terminal A:

```bash
cd ~/projects/justmakeit
backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Leave it running. Start only one API instance: it owns the preparation worker. In another Ubuntu terminal, verify:

```bash
curl -f http://127.0.0.1:8000/health
```

Expect JSON containing `"ok":true`. SQLite and generated media persist under the ignored `backend/data/` directory. You do not need to start a separate worker or database service.

## 5. Prepare the demo

With the API running, in Ubuntu terminal B:

```bash
cd ~/projects/justmakeit
bash backend/scripts/bake_demo_songs.sh
```

This uses the tracked video/audio fixtures and the reviewed choreography range, excluding the non-dance end card. Processing can take several minutes on CPU. Wait for successful preparation; do not shut down the API. Optional sample fixtures may be reported as skipped. Rerunning reuses the demo song identity.

Alternatively, add a URL or upload a video with its music through the application. Choose a short, continuously visible solo dancer. URL providers can still reject automated downloads on a human's computer; file upload remains the fallback.

## 6. Start the frontend and open it

In Ubuntu terminal B or C:

```bash
cd ~/projects/justmakeit/web
npm run dev
```

Leave it running. In **Windows Chrome or Edge**, enter `http://localhost:5173` in the address bar. WSL2 normally forwards localhost ports to Windows. Do not open `index.html`, use a `file://` URL, or use the editor's static HTML preview: React/TypeScript must be served by Vite.

You should see the development interface and prepared song. Select it, then try keyboard practice before camera scoring. Space toggles playback, Enter hits a checkpoint, arrows seek, and R replays when focus is outside a form control. Seeking makes the current run practice-only; replay from the beginning to save a complete result.

For camera scoring, select camera mode and enable the camera. Allow browser access and ensure your whole body is visible. Using a Windows browser means you do not need to forward a USB webcam into WSL. Check Windows Settings → Privacy & security → Camera if access is denied. Frames stay in the browser. Human calibration is still pending; scoring thresholds are provisional.

The interface is intentionally unstyled while the Figma designs are being finished.

## 7. Verify your installation

From the repository root:

```bash
(cd backend && .venv/bin/python -m pytest -q)
(cd pipeline && .venv/bin/python -m pytest -q)
(cd web && npm test && npm run build)
```

Browser automation is optional and needs a separately installed Chromium plus an isolated test database. See `web/README.md`; do not point those tests at your personal play history.

## Troubleshooting

- **Blank page after opening HTML:** close the file/editor preview and open the Vite address in Windows Chrome/Edge.
- **Failed to fetch / no songs:** confirm the API health request works, `.env.local` uses port 8000, and Vite was restarted. An empty library before preparing a song is normal.
- **Windows cannot connect but Ubuntu curl works:** check both terminals are still running. Update WSL, then run `wsl --shutdown` in PowerShell and reopen Ubuntu; restart both servers afterward. Check VPN/firewall interference. Keep the API bound to loopback; it has no authentication.
- **Port already in use:** stop the previous process with Ctrl+C instead of starting a duplicate. Vite intentionally requires port 5173, which is allowed by the API's default CORS configuration.
- **MediaPipe installation fails:** check Python is 3.10–3.12 and you are using the pipeline virtual environment. These instructions target x86-64 Windows/WSL; ARM64 dependency wheels may need a separate setup.
- **Tracking failed:** inspect the diagnostic video and choose a cleaner clip or a shorter choreography range. Do not lower the gate just to accept an end card or missing dancer.
- **Download failed:** use the upload option with a video containing music. Local execution does not guarantee YouTube access.
- **Camera denied:** open the application in the Windows browser at localhost, grant permissions, and close other applications holding the camera.

Use Ctrl+C in each server terminal to stop. On subsequent days, start only the API and frontend; installed dependencies and prepared songs remain. Run `npm ci` or pip installation again when their dependency files change.

## Easier everyday startup

The [local launcher](../LAUNCHER.md) now manages both servers together. After the
prerequisites are installed, use `bash scripts/setup.sh` once, then
`bash scripts/start.sh` from the repository root. Windows double-click setup and
startup entry points are described in that guide. Stop the old manual servers
before switching to the launcher.
