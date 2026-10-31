import { useEffect, useState } from "react";
import { call, toaster } from "@decky/api";
import { DialogButton, SliderField } from "@decky/ui";
import { useDeckcordState } from "../hooks/useDeckcordState";

export function VoiceChatChannel() {
  const state = useDeckcordState();
  if (state?.vc == undefined) return (<div></div>);
  // Normal (non-negative) spacing so the channel heading never rides up into
  // the divider rule above it.
  return (
    <div style={{ width: "100%", padding: "10px 0 4px", display: "flex", alignItems: "center", gap: "8px" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ margin: "0 0 2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {state?.vc?.channel_name}
        </h3>
        <h4 style={{ margin: "0 0 4px 0", fontWeight: "normal", opacity: 0.8 }}>
          {state?.vc?.guild_name}
        </h4>
      </div>
      <DialogButton
        style={{ minWidth: 0, width: "96px", height: "40px", padding: "0 12px", flexShrink: 0, backgroundColor: "#d83c3e" }}
        onClick={() => {
          call<[], any>("disconnect_vc")
            .then((ok) => {
              if (!ok) toaster.toast({ title: "Deckcord", body: "Could not hang up the call", duration: 3000 });
            })
            .catch(() => { });
        }}
      >
        Hang up
      </DialogButton>
    </div>
  );
}

export function MyVolumeControls() {
  const [vols, setVols] = useState<{ input: number; output: number }>({ input: 100, output: 100 });

  useEffect(() => {
    call<[], any>("get_volumes")
      .then((v) => {
        if (v) setVols({ input: v.input ?? 100, output: v.output ?? 100 });
      })
      .catch(() => { });
  }, []);

  return (
    <div style={{ width: "100%" }}>
      <SliderField
        label="Headset Volume"
        value={vols.output}
        min={0}
        max={200}
        step={5}
        showValue
        onChange={(v: number) => {
          setVols((p) => ({ ...p, output: v }));
          call("set_output_volume", v);
        }}
      />
      <SliderField
        label="Mic Volume"
        value={vols.input}
        min={0}
        max={100}
        step={5}
        showValue
        onChange={(v: number) => {
          setVols((p) => ({ ...p, input: v }));
          call("set_input_volume", v);
        }}
      />
    </div>
  );
}

export function VoiceChatMembers() {
  const state = useDeckcordState();
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const users = state?.vc?.users;
  const myId = state?.me?.id;
  const userKey = users ? users.map((u: any) => u.id).join(",") : "";

  useEffect(() => {
    if (!users) return;
    call<[], any>("get_volumes")
      .then((v) => {
        if (v && v.users) setVolumes((prev) => ({ ...v.users, ...prev }));
      })
      .catch(() => { });
  }, [userKey]);

  if (users == undefined) return (<div></div>);
  const members = [];
  for (const user of users) {
    const isSelf = user?.id === myId;
    const vol = volumes[user?.id] != undefined ? volumes[user?.id] : 100;
    members.push(
      <li
        key={user?.id}
        style={{ display: "flex", flexDirection: "column", justifyContent: "left", gap: "2px", padding: "4px 0", listStyle: "none" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <img
            src={
              "https://cdn.discordapp.com/avatars/" +
              user?.id +
              "/" +
              user?.avatar +
              ".webp"
            }
            width={32}
            height={32}
            style={{ borderRadius: "50%", flexShrink: 0 }}
          />
          {user?.username}
          {isSelf ? " (you)" : ""}
        </div>
        {isSelf ? null : (
          <SliderField
            value={vol}
            min={0}
            max={200}
            step={5}
            showValue
            onChange={(nv: number) => {
              setVolumes((prev) => ({ ...prev, [user.id]: nv }));
              call("set_user_volume", user.id, nv);
            }}
          />
        )}
      </li>
    );
  }
  return <ul style={{ margin: "4px 0 0 0", paddingLeft: 0, listStyle: "none" }}>{members}</ul>;
}
