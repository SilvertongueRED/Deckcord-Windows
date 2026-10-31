from asyncio import Event, wait_for, TimeoutError

class User:
    def __init__(self, data) -> None:
        self.id = data["id"]
        self.name = data["username"]
        self.discriminator = data["discriminator"]
        self.avatar = data["avatar"]

        self.is_muted = False
        self.is_deafened = False
        self.is_live = False

    @classmethod
    def from_vc(cls, data):
        usr = User({"id": data["userId"], "username": "", "discriminator": None, "avatar": ""})
        usr.is_muted = data["mute"]
        usr.is_deafened = data["deaf"]
        return usr

    async def populate(self, api):
        if self.name:
            return

        r = await api.get_user(self.id)
        self.name = r["username"]
        self.discriminator = r["discriminator"]
        self.avatar = r["avatar"]

    def to_dict(self):
        return {
            "id": self.id,
            "username": str(self),
            "avatar": self.avatar,
            "is_muted": self.is_muted,
            "is_deafened": self.is_deafened,
            "is_live": self.is_live
        }

    def __str__(self) -> str:
        return f"{self.name}{'#'+self.discriminator if self.discriminator and self.discriminator != '0' else ''}"


class Response:
    def __init__(self) -> None:
        self.lock = Event()
        self.response = None


class StoreAccess:
    def __init__(self) -> None:
        self.request_increment = 0
        self.requests = {}
        self.ws = None

    def _set_result(self, increment, result):
        response = self.requests.get(increment)
        if response is None:
            return
        response.result = result
        response.lock.set()

    async def _store_access_request(self, command, id="", **kwargs):
        if self.ws is None or self.ws.closed:
            return None

        self.request_increment += 1
        request_id = self.request_increment
        response = Response()
        self.requests[request_id] = response
        try:
            await self.ws.send_json({"type": command, "id": id, "increment": request_id, **kwargs})
            await wait_for(response.lock.wait(), timeout=5)
            return response.result
        except (Exception, TimeoutError):
            return None
        finally:
            self.requests.pop(request_id, None)

    async def get_user(self, id):
        return await self._store_access_request("$getuser", id)

    async def get_channel(self, id):
        return await self._store_access_request("$getchannel", id)

    async def get_guild(self, id):
        return await self._store_access_request("$getguild", id)

    async def get_media(self):
        return await self._store_access_request("$getmedia")

    async def get_last_channels(self):
        return await self._store_access_request("$get_last_channels")

    async def get_all_channels(self):
        return await self._store_access_request("$get_all_channels")

    async def post_screenshot(self, channel_id, data, filename="screenshot.jpg"):
        return await self._store_access_request("$screenshot", channel_id=channel_id, attachment_b64=data, filename=filename)

    async def get_screen_bounds(self):
        return await self._store_access_request("$get_screen_bounds")

    async def get_dms(self):
        return await self._store_access_request("$get_dms")

    async def dm_call(self, channel_id):
        return await self._store_access_request("$dm_call", channel_id=channel_id)

    async def get_volumes(self):
        return await self._store_access_request("$get_volumes")

    async def get_current_vc(self):
        return await self._store_access_request("$get_current_vc")

    async def screenshare(self):
        return await self._store_access_request("$screenshare")
