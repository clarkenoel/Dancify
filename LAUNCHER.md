# Dancify launcher (Windows + WSL2)

Dancify still runs locally in your browser. The launcher starts its Python API
and Vite together, checks readiness, and opens your Windows browser. You no
longer need to manage two terminals or match their API ports by hand.

## First time on a teammate's computer

1. Install Ubuntu 24.04 in WSL2 and clone this repository under the Linux home
   folder. Install Python 3.12 with venv support, Node >=22.12 (Node 22 via nvm
   recommended), FFmpeg, libgl1 and libglib2.0-0. The exact Windows/Ubuntu commands
   are in [the WSL2 setup guide](web/WSL2_SETUP.md), sections 1–3. The launcher
   does not install WSL, request administrator access, or change Windows settings.
2. Open the repository in Windows Explorer: from Ubuntu, run `explorer.exe .`
   inside `~/projects/justmakeit`. Alternatively browse to
   `\\wsl.localhost\Ubuntu-24.04\home\YOUR_USER\projects\justmakeit`.
3. Double-click **Setup Dancify.cmd**. On the first run, enter the installed WSL
   distribution name and Linux repository folder (defaults: `Ubuntu-24.04` and
   `~/projects/justmakeit`). Names and folder paths may contain spaces.
4. Setup installs the separate Python environments, frontend dependencies, and
   local pose assets, then builds the frontend. Wait for **Setup complete**.
   If a prerequisite is missing, follow the displayed instructions and rerun.
   Setup needs Internet access; normal local-file gameplay uses local models.

You can instead run `bash scripts/setup.sh` from the repository root in Ubuntu.
Setup reruns preserve `.env.local`, prepared songs and play history. It refreshes
installed dependencies, so stop existing servers before running it. The launcher
and setup share a lock to prevent concurrent launcher-managed operations.

## Every day

Double-click **Start Dancify.cmd**. Or create a Windows shortcut to that file
(right-click → Show more options → Send to → Desktop) and name it Start Dancify.
The first launch checks dependencies; **Ready** appears only after the API,
song library route, and frontend respond. Your browser opens automatically.

Keep the launcher window open. **Ctrl+C is the recommended shutdown:** it stops
both owned services, including preparation work. Normal terminal hangup is also
handled. Force-killing WSL/Windows or losing power cannot guarantee graceful
shutdown; interrupted preparations can be retried on the next launch.

The configuration is saved in `%LOCALAPPDATA%\Dancify\launcher.json`. If you move
the checkout or switch distributions, delete that file and launch again. Windows
execution policy bypass is scoped to the launcher process, not saved system-wide;
organization policy may still prevent scripts from running. Use the Ubuntu
command below if your organization blocks PowerShell scripts.

## Ubuntu commands and troubleshooting

```bash
cd ~/projects/justmakeit
bash scripts/start.sh
# Optional: do not open a browser automatically
bash scripts/start.sh --no-browser
# Optional: use another API port; frontend remains on 5173
bash scripts/start.sh --api-port 8001
```

- **Already running:** use the existing launcher window. A second invocation does
  not start duplicates or take over its services.
- **Port in use:** stop your old manually started Vite/backend with Ctrl+C, then
  launch again. The launcher never kills unrelated programs or attaches to an
  unknown backend/database. Another backend port can be selected as above;
  frontend port 5173 must be free.
- **Missing dependency:** run setup after installing the listed prerequisite.
  nvm is loaded explicitly for noninteractive Windows launches.
- **Startup failure or service crash:** both owned services stop. Read the
  `backend.log` or `frontend.log` inside the printed `.launcher/run-…` folder.
  Logs stay local and are ignored by Git. Old run folders can be deleted when
  the launcher is stopped.
- **Browser did not open:** use `http://127.0.0.1:5173` in Windows Chrome/Edge.
  The launcher cannot repair Windows firewall/VPN/WSL forwarding problems.
- **Wrong API setting:** the launcher supplies the API address to Vite for this
  run, overriding stale `.env.local` values without modifying the file.
- **Data:** the API uses the existing `backend/data` by default. An explicitly
  supplied `DANCIFY_DATA_DIR` is respected for isolated testing. No data is erased.

Do not run another API worker against the same data directory concurrently.
You can prepare the tracked demo using `bash backend/scripts/bake_demo_songs.sh`
while the launcher is running, or upload a video through the browser.

## Verification and limits

Run launcher tests from the root with:

```bash
python3 -m unittest discover -s scripts/tests -v
```

Linux lifecycle and browser preparation tests can run in the development workspace.
Windows Explorer double-click, PowerShell/WSL argument passing and Windows browser
opening require a real Windows/WSL2 acceptance test; Linux tests do not establish
those behaviors. This launcher is a development convenience, not a self-contained
Windows installer or hosted service.

Current implementation validation: eight launcher tests and 24 frontend tests
passed; the setup helper completed its dependency checks and production build.
All four browser scenarios passed against launcher-owned services, including real
MP4 upload/preparation, playback/save retry, and recorded-dancer camera inference.
Actual service shutdown released both ports, and restart correctly overrode an
existing `.env.local` API port without modifying that file. Duplicate launch and
setup-while-running were rejected without disrupting the running application.
Windows native acceptance remains pending as described above.
