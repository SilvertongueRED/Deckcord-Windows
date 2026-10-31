from json import dumps, loads
from asyncio import sleep, get_event_loop, Task, Event, Queue
from aiohttp import WSMsgType # type: ignore
from aiohttp.web import WebSocketResponse # type: ignore
from traceback import print_exception
import base64
import mimetypes
import os


from .store_access import StoreAccess, User
from decky import logger # type: ignore

class EventHandler:
    def __init__(self) -> None:
        self.ws: WebSocketResponse | None = None
        self.api = StoreAccess()
        self.state_changed_event = Event()
        self.notification_queue = Queue()
        self.event_handlers = {
            "LOADED": self._loaded,
            "CONNECTION_OPEN": self._logged_in,
            "LOGOUT": self._logout,
            "CONNECTION_CLOSED": self._logout,
            "VOICE_STATE_UPDATES": self._voice_state_update,
            "VOICE_CHANNEL_SELECT": self._voice_channel_select,
            "AUDIO_TOGGLE_SELF_MUTE": self.toggle_mute,
            "AUDIO_TOGGLE_SELF_DEAF": self.toggle_deafen,
            "RPC_NOTIFICATION_CREATE": self._notification_create,
            "STREAM_STOP": self.toggle_mute,
            "STREAM_START": self.toggle_mute,
            "$MIC_WEBRTC": self._webrtc_mic_forward,
            "$file_picker": self._file_picker,
            "$file_picker_select": self._file_picker_select,
        }

        self.loaded = False
        self.logged_in = False
        self.me = User({"id": "", "username": "", "discriminator": None, "avatar": ""})
        self.voicestates = {}

        self.vc_channel_id = ""
        self.vc_channel_name = ""
        self.vc_guild_name = ""
        self._vc_sig = None
        self._vc_poll_task = None

        self.webrtc = None

    async def send_json(self, data) -> bool:
        if self.ws is None or self.ws.closed:
            logger.warning("Discord client websocket is not connected")
            return False
        try:
            await self.ws.send_json(data)
            return True
        except Exception as e:
            logger.warning(f"Discord client websocket write failed: {e}")
            return False

    async def yield_new_state(self):
        while True:
            await self.state_changed_event.wait()
            dc = self.build_state_dict()
            yield dc
            self.state_changed_event.clear()

    async def yield_notification(self):
        while True:
            yield await self.notification_queue.get()

    def build_state_dict(self):

        r = {
            "loaded": self.loaded,
            "logged_in": self.logged_in,
            "me": self.me.to_dict(),
            "vc": {},
            "webrtc": self.webrtc.copy() if self.webrtc else None
        }
        if self.vc_channel_id:
            r["vc"]["channel_name"] = self.vc_channel_name
            r["vc"]["guild_name"] = self.vc_guild_name
            r["vc"]["users"] = []
            if self.vc_channel_id in self.voicestates:
                for user in self.voicestates[self.vc_channel_id].values():
                    r["vc"]["users"].append(user.to_dict())

        if self.webrtc:
            self.webrtc = None
        return r

    async def toggle_mute(self, *args, act=False):
        if act:
            # Use the dedicated toggleSelfMute action creator on the client side
            # (raw AUDIO_TOGGLE_SELF_MUTE dispatch does not reliably toggle on
            # Windows). The client processes this before the get_media below.
            await self.send_json({"type": "$toggle_self_mute"})
        r = await self.api.get_media()
        if not r:
            return
        self.me.is_muted = r["mute"]
        self.me.is_deafened = r["deaf"]
        self.me.is_live = r["live"]

    async def toggle_deafen(self, *args, act=False):
        if act:
            await self.send_json({"type": 'AUDIO_TOGGLE_SELF_DEAF', "context": 'default', "syncRemote": True})
        r = await self.api.get_media()
        if not r:
            return
        self.me.is_muted = r["mute"]
        self.me.is_deafened = r["deaf"]
        self.me.is_live = r["live"]

    async def disconnect_vc(self):
        ok = await self.send_json({"type": "$disconnect"})
        if ok:
            # Optimistically clear local VC state for snappy UI; the poll loop
            # re-syncs from the stores within a few seconds either way.
            self.vc_channel_id = ""
            self.vc_channel_name = ""
            self.vc_guild_name = ""
            self._vc_sig = None
            self.state_changed_event.set()
        return ok

    async def _refresh_current_vc(self):
        """Pull the live voice channel + members from the Discord stores and
        update local state. Only emits a new state when something actually
        changed, so the QAM panel doesn't flicker or reset every poll."""
        vc = await self.api.get_current_vc()
        if vc is None:
            return

        new_id = vc.get("channel_id") or ""
        if not new_id:
            if self.vc_channel_id:
                self.vc_channel_id = ""
                self.vc_channel_name = ""
                self.vc_guild_name = ""
                self._vc_sig = None
                self.state_changed_event.set()
            return

        users = {}
        for u in vc.get("users", []):
            uid = u.get("id")
            if not uid:
                continue
            usr = User({"id": uid, "username": u.get("username", ""), "discriminator": None, "avatar": u.get("avatar", "")})
            usr.is_muted = u.get("is_muted", False)
            usr.is_deafened = u.get("is_deafened", False)
            usr.is_live = u.get("is_live", False)
            users[uid] = usr

        sig = (
            new_id,
            vc.get("channel_name", "") or "",
            vc.get("guild_name", "") or "",
            tuple(sorted((uid, u.name, u.is_muted, u.is_deafened, u.is_live) for uid, u in users.items())),
        )
        if sig == self._vc_sig:
            return

        self._vc_sig = sig
        self.vc_channel_id = new_id
        self.vc_channel_name = vc.get("channel_name", "") or ""
        self.vc_guild_name = vc.get("guild_name", "") or ""
        self.voicestates[new_id] = users
        self.state_changed_event.set()

    async def _poll_vc_loop(self):
        """Background loop that keeps the active-call panel in sync regardless
        of whether FluxDispatcher interceptor events reach the backend."""
        while True:
            try:
                if self.logged_in and self.api.ws is not None and not self.api.ws.closed:
                    await self._refresh_current_vc()
            except Exception as e:
                logger.debug(f"VC poll error: {e}")
            await sleep(3)

    async def main(self, ws):
        logger.info("Received WS Connection. Starting event processing loop")
        self.ws = ws
        self.api.ws = ws
        if self._vc_poll_task is None or self._vc_poll_task.done():
            self._vc_poll_task = get_event_loop().create_task(self._poll_vc_loop())
        async for msg in self.ws:
            if msg.type == WSMsgType.TEXT:
                self._process_event(loads(msg.data))
            elif msg.type == WSMsgType.ERROR:
                print('ws connection closed with exception %s' % self.ws.exception())

    def _process_event(self, data):
        if data["type"] == "$ping":
            return
        if data["type"] == "$deckcord_request" and "increment" in data:
            self.api._set_result(data["increment"], data["result"])
            return
        if data["type"] in self.event_handlers:
            callback = self.event_handlers[data["type"]]
            logger.info(f"Handling event: {data['type']}")
            #print(dumps(data, indent=2)+"\n\n")
        else:
            return
        def _(future: Task):
            self.state_changed_event.set()
            e = future.exception()
            if e:
                print(f"Exception during handling of {data['type']} event.   {e}")
                print_exception(e)
        get_event_loop().create_task(callback(data)).add_done_callback(_)

    async def _loaded(self, data):
        self.loaded = True

    async def _logged_in(self, data):
        self.logged_in = True
        self.me = User(data["user"])

        s = await self.api.get_media()
        if s:
            self.me.is_muted = s["mute"]
            self.me.is_deafened = s["deaf"]
            self.me.is_live = s["live"]

        # If we logged in while already sitting in a voice channel, surface it
        # immediately rather than waiting for the next channel change.
        try:
            await self._refresh_current_vc()
        except Exception as e:
            logger.debug(f"Initial VC refresh failed: {e}")

    async def _logout(self, data):
        self.logged_in = False

    async def _voice_channel_select(self, data):
        self.vc_channel_id = data["channelId"]
        if not self.vc_channel_id:
            self.vc_channel_name = ""
            self.vc_guild_name = ""
            return
        self.vc_channel_name = (await self.api.get_channel(self.vc_channel_id))["name"]
        if "guildId" in data and data["guildId"]:
            self.vc_guild_name = (await self.api.get_guild(data["guildId"]))["name"]
        if self.vc_channel_id in self.voicestates:
            for user in self.voicestates[self.vc_channel_id].values():
                await user.populate(self.api)

    async def _voice_state_update(self, data):
        states = data["voiceStates"]
        for state in states:
            if "oldChannelId" in state and state["oldChannelId"] in self.voicestates:
                self.voicestates[state["oldChannelId"]].pop(state["userId"], None)
                if not self.voicestates[state["oldChannelId"]]:
                    self.voicestates.pop(state["oldChannelId"], None)
            if state["userId"] == self.me.id:
                user_to_add = self.me
            else:
                user_to_add = User.from_vc(state)
                if state["channelId"] == self.vc_channel_id:
                    await user_to_add.populate(self.api)
            if state["channelId"] in self.voicestates:
                self.voicestates[state["channelId"]][state["userId"]] = user_to_add
            else:
                self.voicestates[state["channelId"]] = {state["userId"]: user_to_add}

    async def _notification_create(self, data):
        await self.notification_queue.put(data)

    async def _webrtc_mic_forward(self, data):
        self.webrtc = data

    async def _file_picker(self, data) -> None:
        """List files in a directory for the in-BrowserView file picker.

        If no path is given, returns quick-access directories
        (Screenshots, Pictures, Downloads, Home).
        """
        path: str = data.get("path", "")
        home: str = os.path.expanduser("~")

        # Security: validate path is within allowed directories
        allowed_bases: list[str] = [
            home,
            os.path.join(home, ".local/share/Steam/userdata"),
        ]

        def _is_path_allowed(p: str) -> bool:
            if not p:
                return True
            real = os.path.realpath(p)
            for base in allowed_bases:
                base_real = os.path.realpath(base)
                try:
                    if os.path.commonpath([real, base_real]) == base_real:
                        return True
                except ValueError:
                    continue
            return False

        if path and not _is_path_allowed(path):
            logger.warning(f"File picker: blocked access to {path}")
            await self.send_json({
                "type": "$file_picker_list",
                "entries": [],
                "path": path,
                "parent": "",
                "error": "Access denied"
            })
            return

        if not path:
            entries: list[dict] = []

            # Find Steam screenshots directory
            steam_userdata = os.path.join(home, ".local/share/Steam/userdata")
            if os.path.isdir(steam_userdata):
                for uid in os.listdir(steam_userdata):
                    sp = os.path.join(steam_userdata, uid, "760", "remote")
                    if os.path.isdir(sp):
                        entries.append({"name": "\U0001f4f8 Screenshots", "path": sp, "type": "directory"})
                        break

            pictures = os.path.join(home, "Pictures")
            if os.path.isdir(pictures):
                entries.append({"name": "\U0001f5bc\ufe0f Pictures", "path": pictures, "type": "directory"})

            downloads = os.path.join(home, "Downloads")
            if os.path.isdir(downloads):
                entries.append({"name": "\U0001f4e5 Downloads", "path": downloads, "type": "directory"})

            entries.append({"name": "\U0001f3e0 Home", "path": home, "type": "directory"})

            await self.send_json({
                "type": "$file_picker_list",
                "entries": entries,
                "path": "",
                "parent": "",
                "is_root": True
            })
            return

        if not os.path.isdir(path):
            await self.send_json({
                "type": "$file_picker_list",
                "entries": [],
                "path": path,
                "parent": os.path.dirname(path),
                "error": "Not a directory"
            })
            return

        entries = []
        try:
            for name in sorted(os.listdir(path)):
                if name.startswith('.'):
                    continue
                full_path = os.path.join(path, name)
                entry: dict = {"name": name, "path": full_path}
                if os.path.isdir(full_path):
                    entry["type"] = "directory"
                else:
                    entry["type"] = "file"
                    try:
                        entry["size"] = os.path.getsize(full_path)
                    except OSError:
                        entry["size"] = 0
                    mime = mimetypes.guess_type(name)[0] or ""
                    entry["mime"] = mime
                entries.append(entry)
        except PermissionError:
            pass

        entries.sort(key=lambda e: (0 if e["type"] == "directory" else 1, e["name"].lower()))

        await self.send_json({
            "type": "$file_picker_list",
            "entries": entries,
            "path": path,
            "parent": os.path.dirname(path),
            "is_root": False
        })

    async def _file_picker_select(self, data) -> None:
        """Read a selected file and return as base64."""
        filepath: str = data.get("path", "")
        if not filepath or not os.path.isfile(filepath):
            logger.error(f"File not found: {filepath}")
            await self.send_json({"type": "$file_picker_result", "files": []})
            return

        # Security: validate path is within allowed directories
        home: str = os.path.expanduser("~")
        allowed_bases: list[str] = [
            home,
            os.path.join(home, ".local/share/Steam/userdata"),
        ]
        real_path = os.path.realpath(filepath)
        allowed = False
        for base in allowed_bases:
            base_real = os.path.realpath(base)
            try:
                if os.path.commonpath([real_path, base_real]) == base_real:
                    allowed = True
                    break
            except ValueError:
                continue
        if not allowed:
            logger.warning(f"File picker select: blocked access to {filepath}")
            await self.send_json({"type": "$file_picker_result", "files": []})
            return

        # Safety: reject files larger than 50MB to prevent OOM
        max_size: int = 50 * 1024 * 1024
        file_size = os.path.getsize(filepath)
        if file_size > max_size:
            logger.warning(f"File too large: {filepath} ({file_size} bytes)")
            await self.send_json({"type": "$file_picker_result", "files": []})
            return

        try:
            filename = os.path.basename(filepath)
            mime_type = mimetypes.guess_type(filepath)[0] or "application/octet-stream"

            with open(filepath, "rb") as f:
                file_data = base64.b64encode(f.read()).decode("ascii")

            logger.info(f"Sending file: {filename} ({mime_type}, {len(file_data)} bytes b64)")
            await self.send_json({
                "type": "$file_picker_result",
                "files": [{
                    "name": filename,
                    "type": mime_type,
                    "data": file_data
                }]
            })
        except Exception as e:
            logger.error(f"File picker select error: {e}")
            await self.send_json({"type": "$file_picker_result", "files": []})
