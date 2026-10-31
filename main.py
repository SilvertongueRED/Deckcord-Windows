from aiohttp.web import (  # type: ignore
    Application,
    Response,
    get,
    WebSocketResponse,
    AppRunner,
    TCPSite,
)
from asyncio import sleep, create_task, create_subprocess_exec
import aiohttp_cors  # type: ignore
from json import dumps
from pathlib import Path
from subprocess import PIPE

import sys
import os

from decky import logger, DECKY_PLUGIN_DIR, emit  # type: ignore
from logging import INFO

# defaults/ contents are moved to plugin root by Decky CI,
# but stay nested for manual installs. Add both paths.
sys.path.append(DECKY_PLUGIN_DIR)
defaults_dir = os.path.join(DECKY_PLUGIN_DIR, "defaults")
if os.path.isdir(defaults_dir):
    sys.path.append(defaults_dir)

from tab_utils.tab import (
    find_discord_tab,
    setup_discord_tab,
    boot_discord,
    setOSK,
)
from tab_utils.cdp import Tab, get_tab
from discord_client.event_handler import EventHandler

logger.setLevel(INFO)


async def stream_watcher(stream, is_err=False):
    async for line in stream:
        line = line.decode("utf-8")
        if not line.strip():
            continue
        if is_err:
            logger.debug("ERROR: " + line)
        else:
            logger.debug(line)


async def initialize():
    """
    Called by the frontend after it creates the BrowserView.
    Finds the tab via CDP, injects Vencord + client scripts, navigates to Discord.
    """
    logger.info("Waiting for Discord browser view tab via CDP...")
    tab = await find_discord_tab()
    logger.info(f"Found Discord tab: {tab.id}")
    await setup_discord_tab(tab)
    await boot_discord(tab)

    # Tell CEF to treat the Discord page as focused even when Steam's UI has
    # input focus, so the compositor keeps producing frames (otherwise the view
    # paints once then freezes on the loading gradient on Windows).
    try:
        await tab._send_devtools_cmd(
            {
                "method": "Emulation.setFocusEmulationEnabled",
                "params": {"enabled": True},
            },
            receive=False,
        )
    except Exception as e:
        logger.warning(f"setFocusEmulationEnabled failed: {e}")

    create_task(watchdog(tab))


async def watchdog(tab: Tab):
    while True:
        while not tab.websocket.closed:
            await sleep(1)

        logger.info("Discord tab websocket is no longer open. Trying to reconnect...")

        try:
            await tab.open_websocket()
            logger.info("Reconnected")

        except Exception as e:
            logger.error(f"Failed to reconnect to Discord tab: {e}")
            break

    logger.info("Discord has died. Re-initializing...")

    while True:
        try:
            await initialize()
            break

        except Exception as e:
            logger.error(f"Re-initialization attempt failed: {e}")
            await sleep(1)


class Plugin:
    server = Application()
    cors = aiohttp_cors.setup(
        server,
        defaults={
            "*": aiohttp_cors.ResourceOptions(
                expose_headers="*", allow_headers="*", allow_credentials=True
            )
        },
    )
    evt_handler = EventHandler()
    last_ws: WebSocketResponse = None

    @classmethod
    async def _main(cls):
        logger.info("Starting Deckcord backend — waiting for frontend to create browser view")

        # Start the aiohttp server immediately so it's ready when the frontend
        # calls initialize_discord_tab and when Discord client.js connects
        cls.server.add_routes(
            [
                get("/openkb", cls._openkb),
                get("/socket", cls._websocket_handler)
            ]
        )
        for r in list(cls.server.router.routes())[:-1]:
            cls.cors.add(r)

        cls.runner = AppRunner(cls.server, access_log=None)
        await cls.runner.setup()
        logger.info("Starting server.")
        await TCPSite(cls.runner, "127.0.0.1", 65123).start()

        cls.shared_js_tab = await get_tab("SharedJSContext")
        await cls.shared_js_tab.open_websocket()
        create_task(cls._notification_dispatcher())

        # The GStreamer WebRTC helper is Linux/Steam Deck only — it relies on
        # /usr/bin/python and a set of Linux library paths. On Windows (and any
        # other non-Linux host) launching it raises FileNotFoundError, which
        # would crash backend startup and leave the plugin stuck initializing.
        if sys.platform.startswith("linux"):
            cls.webrtc_server = await create_subprocess_exec(
                "/usr/bin/python",
                str(Path(DECKY_PLUGIN_DIR) / "gst_webrtc.py"),
                env={
                    "LD_LIBRARY_PATH": str(Path(DECKY_PLUGIN_DIR) / "bin"),
                    "GI_TYPELIB_PATH": str(Path(DECKY_PLUGIN_DIR) / "bin/girepository-1.0"),
                    "GST_PLUGIN_PATH": str(Path(DECKY_PLUGIN_DIR) / "bin/gstreamer-1.0"),
                    "GST_VAAPI_ALL_DRIVERS": "1",
                    "OPENSSL_CONF": "/etc/ssl/openssl.cnf",
                    "DBUS_SESSION_BUS_ADDRESS": "unix:path=/run/user/1000/bus",
                    "XDG_RUNTIME_DIR": "/run/user/1000",
                    "XDG_DATA_DIRS": "/home/deck/.local/share/flatpak/exports/share:/var/lib/flatpak/exports/share:/usr/local/share:/usr/share",
                    "LIBVA_DRIVER_NAME": "radeonsi",
                },
                stdout=PIPE,
                stderr=PIPE,
            )
            create_task(stream_watcher(cls.webrtc_server.stdout))
            create_task(stream_watcher(cls.webrtc_server.stderr, True))
        else:
            logger.info(
                f"Skipping GStreamer WebRTC helper on non-Linux platform ({sys.platform})"
            )

        # Yield state updates to frontend
        async for state in cls.evt_handler.yield_new_state():
            await emit("state", state)

    @classmethod
    async def initialize_discord_tab(cls):
        """
        Called by the frontend after it creates the BrowserView using Router.
        This finds the tab via CDP and sets up Vencord + Discord.
        """
        logger.info("Frontend requested Discord tab initialization")
        try:
            await initialize()
            logger.info("Discord tab initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Discord tab: {e}")

    @classmethod
    async def _ensure_shared_js_tab(cls, force_refresh=False):
        if force_refresh or not hasattr(cls, "shared_js_tab"):
            cls.shared_js_tab = await get_tab("SharedJSContext")
        await cls.shared_js_tab.ensure_open()

    @classmethod
    async def _evaluate_shared_js(cls, js: str) -> bool:
        last_error = None
        for attempt in range(2):
            try:
                await cls._ensure_shared_js_tab(force_refresh=attempt > 0)
                await cls.shared_js_tab.evaluate(js)
                return True
            except Exception as e:
                last_error = e
                logger.warning(f"SharedJSContext evaluation failed: {e}")

        logger.error(f"SharedJSContext evaluation failed after reconnect: {last_error}")
        return False

    @classmethod
    async def _openkb(cls, request):
        await cls._ensure_shared_js_tab()
        await setOSK(cls.shared_js_tab, True)
        logger.info("Setting discord visibility to true")
        return Response(text="OK")

    @classmethod
    async def _websocket_handler(cls, request):
        logger.info("Received websocket connection!")
        ws = WebSocketResponse(max_msg_size=0)
        await ws.prepare(request)
        await cls.evt_handler.main(ws)
        return ws

    @classmethod
    async def _notification_dispatcher(cls):
        async for notification in cls.evt_handler.yield_notification():
            logger.info("Dispatching notification")
            payload = dumps(
                {"title": notification["title"], "body": notification["body"]}
            )
            await cls._evaluate_shared_js(
                f"window.DECKCORD.dispatchNotification({payload});"
            )

    @classmethod
    async def connect_ws(cls):
        await cls._evaluate_shared_js("window.DECKCORD.connectWs()")

    @classmethod
    async def get_state(cls):
        return cls.evt_handler.build_state_dict()

    @classmethod
    async def toggle_mute(cls):
        logger.info("Toggling mute")
        return await cls.evt_handler.toggle_mute(act=True)

    @classmethod
    async def toggle_deafen(cls):
        logger.info("Toggling deafen")
        return await cls.evt_handler.toggle_deafen(act=True)

    @classmethod
    async def disconnect_vc(cls):
        logger.info("Disconnecting vc")
        return await cls.evt_handler.disconnect_vc()

    @classmethod
    async def get_volumes(cls):
        """Return {input, output, users: {user_id: volume}} from the Discord tab."""
        return await cls.evt_handler.api.get_volumes() or {
            "input": 100,
            "output": 100,
            "users": {},
        }

    @classmethod
    async def set_user_volume(cls, user_id, volume):
        logger.info(f"Setting local volume for {user_id} to {volume}")
        await cls.evt_handler.send_json(
            {"type": "$set_local_volume", "user_id": user_id, "volume": volume}
        )

    @classmethod
    async def set_input_volume(cls, volume):
        logger.info(f"Setting mic (input) volume to {volume}")
        await cls.evt_handler.send_json({"type": "$set_input_volume", "volume": volume})

    @classmethod
    async def set_output_volume(cls, volume):
        logger.info(f"Setting headset (output) volume to {volume}")
        await cls.evt_handler.send_json({"type": "$set_output_volume", "volume": volume})

    @classmethod
    async def set_ptt(cls, value):
        await cls.evt_handler.send_json({"type": "$ptt", "value": value})

    @classmethod
    async def enable_ptt(cls, enabled):
        await cls.evt_handler.send_json({"type": "$setptt", "enabled": enabled})

    @classmethod
    async def set_rpc(cls, game):
        logger.info("Setting RPC")
        await cls.evt_handler.send_json({"type": "$rpc", "game": game})

    @classmethod
    async def get_last_channels(cls):
        return await cls.evt_handler.api.get_last_channels() or []

    @classmethod
    async def get_all_channels(cls):
        """Full list of servers (with their text channels) and DMs for the
        QAM 'Browse all' picker."""
        return await cls.evt_handler.api.get_all_channels() or {"servers": [], "dms": []}

    @classmethod
    async def get_clips(cls):
        """Scan known Steam recording folders for exported video clips.
        Returns [{id, name, path, mtime}], newest first. Safe to return []."""
        import glob

        roots = []
        # Windows Steam install locations.
        for env in ("ProgramFiles(x86)", "ProgramFiles", "ProgramW6432"):
            base = os.environ.get(env)
            if base:
                roots.append(os.path.join(base, "Steam"))
        # Common Linux / Steam Deck locations.
        home = os.path.expanduser("~")
        roots += [
            os.path.join(home, ".steam", "steam"),
            os.path.join(home, ".local", "share", "Steam"),
            "/home/deck/.local/share/Steam",
        ]

        seen = set()
        clips = []
        exts = (".mp4", ".mov", ".webm", ".mkv")
        for root in roots:
            userdata = os.path.join(root, "userdata")
            if not os.path.isdir(userdata):
                continue
            for path in glob.glob(
                os.path.join(userdata, "*", "gamerecordings", "**", "*"),
                recursive=True,
            ):
                try:
                    if not path.lower().endswith(exts) or not os.path.isfile(path):
                        continue
                    rp = os.path.realpath(path)
                    if rp in seen:
                        continue
                    seen.add(rp)
                    st = os.stat(path)
                    clips.append(
                        {
                            "id": rp,
                            "name": os.path.basename(path),
                            "path": rp,
                            "mtime": int(st.st_mtime),
                        }
                    )
                except OSError:
                    continue
        clips.sort(key=lambda c: c["mtime"], reverse=True)
        return clips[:50]

    @classmethod
    async def get_dms(cls):
        return await cls.evt_handler.api.get_dms() or []

    @classmethod
    async def dm_call(cls, channel_id):
        logger.info("DM call requested for " + str(channel_id))
        return await cls.evt_handler.api.dm_call(channel_id)

    @classmethod
    async def post_screenshot(cls, channel_id, data, filename="screenshot.jpg"):
        logger.info("Posting screenshot to " + channel_id)
        r = await cls.evt_handler.api.post_screenshot(channel_id, data, filename)

        if r:
            return True

        payload = dumps({"title": "Deckcord", "body": "Error while posting screenshot"})
        await cls._evaluate_shared_js(
            f"window.DECKCORD.dispatchNotification({payload});"
        )

    @classmethod
    async def post_local_file(cls, channel_id, path, filename=None):
        """Read a local file (e.g. a video clip) and upload it to a channel."""
        from base64 import b64encode

        logger.info("Posting local file to " + str(channel_id) + ": " + str(path))
        try:
            with open(path, "rb") as f:
                data = b64encode(f.read()).decode("ascii")
        except OSError as e:
            logger.error("Could not read local file: " + str(e))
            data = None

        if data is not None:
            fn = filename or os.path.basename(path)
            r = await cls.evt_handler.api.post_screenshot(channel_id, data, fn)
            if r:
                return True

        payload = dumps({"title": "Deckcord", "body": "Error while posting file"})
        await cls._evaluate_shared_js(
            f"window.DECKCORD.dispatchNotification({payload});"
        )

    @classmethod
    async def get_screen_bounds(cls):
        return await cls.evt_handler.api.get_screen_bounds() or {"width": 1280, "height": 800}

    @classmethod
    async def screenshare(cls):
        # Smart screen-share: watch an existing stream in my VC, stop my own,
        # or start a Go Live. Returns the action taken so the UI can toast it.
        return await cls.evt_handler.api.screenshare()

    @classmethod
    async def go_live(cls):
        await cls.evt_handler.send_json({"type": "$golive", "stop": False})

    @classmethod
    async def stop_go_live(cls):
        await cls.evt_handler.send_json({"type": "$golive", "stop": True})

    @classmethod
    async def mic_webrtc_answer(cls, answer):
        await cls.evt_handler.send_json({"type": "$webrtc", "payload": answer})

    @classmethod
    async def _unload(cls):
        if hasattr(cls, "webrtc_server"):
            if cls.webrtc_server.returncode is None:
                cls.webrtc_server.kill()
                await cls.webrtc_server.wait()

        if hasattr(cls, "runner"):
            await cls.runner.shutdown()
            await cls.runner.cleanup()

        if hasattr(cls, "shared_js_tab"):
            await cls.shared_js_tab.close_websocket()
