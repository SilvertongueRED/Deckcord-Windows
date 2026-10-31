import { call } from "@decky/api";
import { DialogButton, Dropdown, DropdownOption, Focusable, Toggle } from "@decky/ui";
import { useEffect, useState } from "react";

function urlContentToDataUri(url: string) {
  return fetch(url)
    .then((response) => response.blob())
    .then(
      (blob) =>
        new Promise((callback) => {
          let reader = new FileReader();
          reader.onload = function () {
            callback(this.result);
          };
          reader.readAsDataURL(blob);
        })
    );
}

// Hide/show the Discord BrowserView so dropdown menus aren't drawn behind it.
function hideDiscordTab() {
  try {
    if (window.DISCORD_TAB) {
      window.DISCORD_TAB.m_browserView.SetVisible(false);
      window.DISCORD_TAB.m_browserView.SetFocus(false);
    }
  } catch (_e) { }
}

function showDiscordTabIfOnRoute() {
  try {
    if (window.location.pathname == "/routes/discord" && window.DISCORD_TAB) {
      window.DISCORD_TAB.m_browserView.SetVisible(true);
      window.DISCORD_TAB.m_browserView.SetFocus(true);
    }
  } catch (_e) { }
}

export function UploadScreenshot() {
  // Media (screenshots + video clips), newest first.
  const [media, setMedia] = useState<any[]>([]);
  const [mediaIndex, setMediaIndex] = useState<number>(0);
  // Channel selection.
  const [selectedChannel, setChannel] = useState<any>();
  const [recentChannels, setRecentChannels] = useState<DropdownOption[]>([]);
  const [browseAll, setBrowseAll] = useState<boolean>(false);
  const [allChannels, setAllChannels] = useState<any>(null); // { servers:[{id,name,channels:[]}], dms:[] }
  const [selectedServer, setSelectedServer] = useState<any>();
  const [uploadButtonDisabled, setUploadButtonDisabled] = useState<boolean>(false);

  useEffect(() => {
    // Recently used channels (default picker).
    call<[], Record<string, any>>("get_last_channels").then((res) => {
      if (!res || "error" in res) return;
      const nextChannels: DropdownOption[] = Object.entries(res).map(([channelId, label]) => ({
        data: channelId,
        label: String(label),
      }));
      setRecentChannels(nextChannels);
      if (nextChannels.length > 0) {
        setChannel(nextChannels[0].data);
      }
    });

    // Build the media list: all local screenshots + any exported video clips.
    const collect = async () => {
      const items: any[] = [];
      try {
        let shots: any[] = [];
        if ((SteamClient.Screenshots as any).GetAllLocalScreenshots)
          shots = await (SteamClient.Screenshots as any).GetAllLocalScreenshots();
        if ((!shots || !shots.length) && (SteamClient.Screenshots as any).GetAllAppsLocalScreenshots)
          shots = await (SteamClient.Screenshots as any).GetAllAppsLocalScreenshots();
        if (Array.isArray(shots) && shots.length) {
          // Steam returns local screenshots oldest-first. Prefer the real
          // creation time; if it's missing, synthesize one from the array
          // position so the newest screenshot still sorts to the front and
          // stays roughly comparable with clip mtimes.
          const nowSec = Math.floor(Date.now() / 1000);
          const n = shots.length;
          shots.forEach((s: any, i: number) => {
            if (!s || !s.strUrl) return;
            const ts = s.unCreated || s.nCreated || (nowSec - (n - 1 - i));
            items.push({ type: "image", url: "https://steamloopback.host/" + s.strUrl, filename: "screenshot.jpg", ts: ts });
          });
        } else {
          const last: any = await SteamClient.Screenshots.GetLastScreenshotTaken();
          if (last && last.strUrl)
            items.push({ type: "image", url: "https://steamloopback.host/" + last.strUrl, filename: "screenshot.jpg", ts: last.unCreated || last.nCreated || Math.floor(Date.now() / 1000) });
        }
      } catch (_e) { }
      try {
        const clips: any = await call<[], any>("get_clips");
        if (Array.isArray(clips)) {
          for (const c of clips) {
            items.push({ type: "video", path: c.path, filename: c.name || "clip.mp4", label: c.name || "Video clip", ts: c.mtime || 0 });
          }
        }
      } catch (_e) { }
      items.sort((a, b) => (b.ts || 0) - (a.ts || 0)); // newest first
      setMedia(items);
      setMediaIndex(0);
    };
    collect();
  }, []);

  // Lazily load the full server/DM list the first time "Browse all" is enabled.
  useEffect(() => {
    if (browseAll && allChannels === null) {
      call<[], any>("get_all_channels")
        .then((res) => {
          if (!res || "error" in res) {
            setAllChannels({ servers: [], dms: [] });
            return;
          }
          setAllChannels({ servers: res.servers || [], dms: res.dms || [] });
        })
        .catch(() => setAllChannels({ servers: [], dms: [] }));
    }
  }, [browseAll]);

  const current = media[mediaIndex];
  const total = media.length;

  const onPickChannel = (id: any) => {
    setChannel(id);
    showDiscordTabIfOnRoute();
  };

  // Build the "Browse all" dropdown option lists.
  let serverOptions: DropdownOption[] = [];
  let channelOptions: DropdownOption[] = [];
  if (allChannels) {
    serverOptions = [{ data: "__dms__", label: "Direct Messages" } as DropdownOption].concat(
      (allChannels.servers || []).map((g: any) => ({ data: g.id, label: g.name }))
    );
    if (selectedServer === "__dms__") {
      channelOptions = (allChannels.dms || []).map((d: any) => ({ data: d.id, label: d.name }));
    } else if (selectedServer) {
      const g = (allChannels.servers || []).find((x: any) => x.id === selectedServer);
      channelOptions = g ? (g.channels || []).map((c: any) => ({ data: c.id, label: "#" + c.name })) : [];
    }
  }

  // Media preview (centered).
  let preview;
  if (!current) {
    preview = (
      <div style={{ width: 240, height: 160, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.05)", borderRadius: "4px", color: "#999" }}>
        No screenshots found
      </div>
    );
  } else if (current.type === "video") {
    preview = (
      <div style={{ width: 240, height: 160, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.05)", borderRadius: "4px", padding: "0 8px", boxSizing: "border-box" }}>
        <div style={{ fontSize: "40px", lineHeight: "1" }}>🎬</div>
        <div style={{ marginTop: "8px", fontSize: "12px", color: "#ddd", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
          {current.label || current.filename}
        </div>
      </div>
    );
  } else {
    preview = <img width={240} height={160} style={{ borderRadius: "4px", objectFit: "cover" }} src={current.url} />;
  }

  const navButtonStyle = { minWidth: 0, width: "54px", height: "40px", padding: 0, flexShrink: 0, fontSize: "20px", display: "flex", alignItems: "center", justifyContent: "center" } as const;

  return (
    <div style={{ width: "100%" }}>
      {/* Centered media preview. */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "8px" }}>{preview}</div>

      {/* Prev / counter / Next navigation row, below the preview so it isn't
          cramped against the panel edges and is easy to reach with the dpad. */}
      <Focusable
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", marginBottom: "14px" }}
        flow-children="horizontal"
      >
        <DialogButton disabled={total <= 1} style={navButtonStyle} onClick={() => setMediaIndex((i) => (i - 1 + total) % total)}>
          ‹
        </DialogButton>
        <div style={{ minWidth: "78px", textAlign: "center", fontSize: "13px", color: "#bbb" }}>
          {total ? `${mediaIndex + 1} / ${total}${current && current.type === "video" ? " · video" : ""}` : "—"}
        </div>
        <DialogButton disabled={total <= 1} style={navButtonStyle} onClick={() => setMediaIndex((i) => (i + 1) % total)}>
          ›
        </DialogButton>
      </Focusable>

      {/* Channel picker: recent by default, with a "Browse all" toggle. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
        <span style={{ fontSize: "13px" }}>Browse all servers</span>
        <Toggle value={browseAll} onChange={(v: boolean) => setBrowseAll(v)} />
      </div>
      {browseAll ? (
        <div style={{ marginBottom: "4px" }}>
          <Dropdown
            menuLabel="Server"
            strDefaultLabel="Select a server or DMs"
            selectedOption={selectedServer}
            rgOptions={serverOptions}
            onMenuOpened={hideDiscordTab}
            onChange={(e) => {
              setSelectedServer(e.data);
              setChannel(undefined);
              showDiscordTabIfOnRoute();
            }}
          />
          <div style={{ height: "8px" }}></div>
          <Dropdown
            menuLabel="Channel"
            strDefaultLabel={selectedServer ? "Select a channel" : "Pick a server first"}
            selectedOption={selectedChannel}
            rgOptions={channelOptions}
            onMenuOpened={hideDiscordTab}
            onChange={(e) => onPickChannel(e.data)}
          />
        </div>
      ) : (
        <Dropdown
          menuLabel="Last Channels"
          strDefaultLabel="Select a channel"
          selectedOption={selectedChannel}
          rgOptions={recentChannels}
          onMenuOpened={hideDiscordTab}
          onChange={(e) => onPickChannel(e.data)}
        />
      )}
      <DialogButton
        style={{ marginTop: "12px", width: "100%" }}
        disabled={uploadButtonDisabled || !selectedChannel || !current}
        onClick={async () => {
          setUploadButtonDisabled(true);
          try {
            if (current.type === "video") {
              await call("post_local_file", selectedChannel, current.path, current.filename);
            } else {
              const data = await urlContentToDataUri(current.url);
              await call("post_screenshot", selectedChannel, data, current.filename);
            }
          } finally {
            setUploadButtonDisabled(false);
          }
        }}
      >
        {uploadButtonDisabled ? "Uploading…" : "Upload"}
      </DialogButton>
    </div>
  );
}
