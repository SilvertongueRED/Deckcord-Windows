import { DialogButton } from "@decky/ui";
import { useDeckcordState } from "../../hooks/useDeckcordState";
import { FaVideo, FaVideoSlash } from "react-icons/fa";
import { call, toaster } from "@decky/api";

// Smart screenshare: starts Go Live, watches someone else's stream, or stops.
export function GoLiveButton() {
  const state = useDeckcordState();
  const inVc = state?.vc?.channel_name != undefined;
  const isLive = state?.me?.is_live;

  return (
    <DialogButton
      disabled={!inVc}
      onClick={() => {
        call<[], any>("screenshare")
          .then((r) => {
            if (!r) return;
            const bodies: Record<string, string> = {
              started: "Started screen share",
              watching: "Watching screen share",
              stopped: "Stopped screen share",
              error: r.error || "Screen share failed",
            };
            toaster.toast({ title: "Deckcord", body: bodies[r.action] || "Screen share", duration: 3000 });
          })
          .catch(() => { });
      }}
      style={{
        height: "40px",
        width: "40px",
        minWidth: 0,
        padding: "10px 12px",
        marginRight: "10px",
      }}
    >
      {isLive ? <FaVideoSlash /> : <FaVideo />}
    </DialogButton>
  );
}
