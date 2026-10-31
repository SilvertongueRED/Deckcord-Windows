import { call } from "@decky/api";
import { DialogButton, Focusable } from "@decky/ui";
import { useEffect, useState } from "react";

export function DirectMessageCalls() {
  const [dms, setDms] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    call<[], any>("get_dms")
      .then((r) => {
        if (alive && Array.isArray(r)) setDms(r);
      })
      .catch(() => { });
    return () => {
      alive = false;
    };
  }, []);

  if (!dms || dms.length === 0) return <div></div>;

  const rows = dms.map((dm) => (
    <Focusable
      key={dm.id}
      style={{ display: "flex", alignItems: "center", gap: "8px", padding: "3px 0" }}
    >
      <img
        src={dm.icon || "https://cdn.discordapp.com/embed/avatars/0.png"}
        width={28}
        height={28}
        style={{ borderRadius: "50%", flexShrink: 0 }}
      />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {dm.name}
      </span>
      <DialogButton
        disabled={busy === dm.id}
        style={{ minWidth: 0, width: "64px", height: "32px", padding: "0 8px" }}
        onClick={() => {
          setBusy(dm.id);
          call("dm_call", dm.id).finally(() => setBusy(null));
        }}
      >
        {busy === dm.id ? "..." : "Call"}
      </DialogButton>
    </Focusable>
  ));

  return (
    <div style={{ width: "100%" }}>
      <div style={{ fontWeight: "bold", margin: "4px 0" }}>Direct Messages</div>
      {rows}
    </div>
  );
}
