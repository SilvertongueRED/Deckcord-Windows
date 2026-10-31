import {
  PanelSection,
  PanelSectionRow,
  staticClasses,
  Focusable,
  Router,
} from "@decky/ui";
import {
  definePlugin,
  call,
  routerHook,
  toaster,
  addEventListener,
  removeEventListener,
} from "@decky/api";
import { FaDiscord } from "react-icons/fa";

import { patchMenu } from "./patches/menuPatch";
import { DiscordTab } from "./components/DiscordTab";
import {
  useDeckcordState,
  isLoaded,
  isLoggedIn,
} from "./hooks/useDeckcordState";

import { MuteButton } from "./components/buttons/MuteButton";
import { DeafenButton } from "./components/buttons/DeafenButton";
import { DisconnectButton } from "./components/buttons/DisconnectButton";
import { GoLiveButton } from "./components/buttons/GoLiveButton";
import { PushToTalkButton } from "./components/buttons/PushToTalk";
import {
  VoiceChatChannel,
  VoiceChatMembers,
  MyVolumeControls,
} from "./components/VoiceChatViews";
import { DirectMessageCalls } from "./components/DirectMessageCalls";
import { UploadScreenshot } from "./components/UploadScreenshot";

declare global {
  interface Window {
    DISCORD_TAB: any;
    DECKCORD: {
      dispatchNotification: any;
      MIC_PEER_CONNECTION: any;
    };
    DECKCORD_VK_CALLBACK?: (showing: boolean) => void;
  }
}

/**
 * Creates the Discord BrowserView using the Steam UI's Router.
 * This MUST happen in the frontend context because Router.WindowStore
 * is only available here (not in SharedJSContext via CDP).
 */
function createDiscordBrowserView(): boolean {
  try {
    // Clean up any existing tab
    if (window.DISCORD_TAB) {
      try {
        window.DISCORD_TAB.m_browserView.SetVisible(false);
        window.DISCORD_TAB.Destroy();
      } catch (_e) { }
      window.DISCORD_TAB = undefined;
    }

    const windowRouter = (Router as any).WindowStore?.GamepadUIMainWindowInstance;
    if (!windowRouter) {
      console.error("Deckcord: GamepadUIMainWindowInstance not found");
      return false;
    }

    const tab = windowRouter.CreateBrowserView("discord");
    tab.WIDTH = 860;
    tab.HEIGHT = 495;
    tab.m_browserView.SetBounds(0, 0, tab.WIDTH, tab.HEIGHT);
    // Load a sentinel URL so the backend can find this tab via CDP
    tab.m_browserView.LoadURL("data:text/plain,to_be_discord");

    window.DISCORD_TAB = tab;

    // Register virtual keyboard resize handler
    try {
      const callbacks =
        windowRouter.m_VirtualKeyboardManager?.IsShowingVirtualKeyboard?.m_callbacks?.m_vecCallbacks;
      if (Array.isArray(callbacks)) {
        if (window.DECKCORD_VK_CALLBACK) {
          const oldIdx = callbacks.indexOf(window.DECKCORD_VK_CALLBACK);
          if (oldIdx >= 0) callbacks.splice(oldIdx, 1);
        }
        window.DECKCORD_VK_CALLBACK = (showing: boolean) => {
          if (!window.DISCORD_TAB) return;
          if (!showing) {
            const bounds = window.DISCORD_TAB.m_browserView.GetBounds();
            if (bounds.height !== window.DISCORD_TAB.HEIGHT) {
              window.DISCORD_TAB.m_browserView.SetBounds(
                0, 0, window.DISCORD_TAB.WIDTH, window.DISCORD_TAB.HEIGHT
              );
            }
          } else {
            const bounds = window.DISCORD_TAB.m_browserView.GetBounds();
            if (bounds.height !== window.DISCORD_TAB.HEIGHT * 0.6) {
              window.DISCORD_TAB.m_browserView.SetBounds(
                0, 0, window.DISCORD_TAB.WIDTH, window.DISCORD_TAB.HEIGHT * 0.6
              );
            }
          }
        };
        callbacks.push(window.DECKCORD_VK_CALLBACK);
      }
    } catch (e) {
      console.warn("Deckcord: Could not register virtual keyboard handler:", e);
    }

    console.log("Deckcord: BrowserView created successfully from frontend");
    return true;
  } catch (e) {
    console.error("Deckcord: Failed to create BrowserView:", e);
    return false;
  }
}

async function initializeDiscordBrowserView() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const browserViewCreated = createDiscordBrowserView();
    if (browserViewCreated) {
      // Tell the backend the tab is ready to be found via CDP.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      call("initialize_discord_tab").catch((e) => {
        console.error("Deckcord: Failed to initialize Discord tab:", e);
      });
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.error("Deckcord: FATAL — Could not create Discord BrowserView");
}

const Content = () => {
  const state = useDeckcordState();
  if (!state?.loaded) {
    return (
      <div style={{ display: "flex", justifyContent: "center" }}>
        <h2>Initializing...</h2>
      </div>
    );
  } else if (!state?.logged_in) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          flexDirection: "column",
          paddingLeft: "15px",
        }}
      >
        <h2>Not logged in!</h2>
        <h3>
          Open{" "}
          <b>
            <FaDiscord />
            Discord
          </b>{" "}
          from the Steam Menu and login.
        </h3>
        <h4>If you did not logout, just wait for a few seconds.</h4>
      </div>
    );
  } else {
    return (
      <PanelSection>
        <PanelSectionRow>
          <Focusable style={{ display: "flex", justifyContent: "center" }}>
            <MuteButton />
            <DeafenButton />
            <GoLiveButton />
            <DisconnectButton />
          </Focusable>
        </PanelSectionRow>
        <PanelSectionRow>
          <div
            style={{
              marginTop: "8px",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <PushToTalkButton />
          </div>
        </PanelSectionRow>
        <hr></hr>
        <PanelSectionRow>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
              <img
                src={
                  "https://cdn.discordapp.com/avatars/" +
                  state?.me?.id +
                  "/" +
                  state?.me?.avatar +
                  ".webp"
                }
                width={32}
                height={32}
                style={{ borderRadius: "50%", flexShrink: 0 }}
              />
              {state?.me?.username}
            </span>
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <MyVolumeControls />
        </PanelSectionRow>
        {state?.vc?.channel_name && (
          <>
            <hr></hr>
            <PanelSectionRow>
              <VoiceChatChannel />
              <VoiceChatMembers />
            </PanelSectionRow>
          </>
        )}
        <hr></hr>
        <PanelSectionRow>
          <DirectMessageCalls />
        </PanelSectionRow>
        <hr></hr>
        <PanelSectionRow>
          <UploadScreenshot />
        </PanelSectionRow>
      </PanelSection>
    );
  }
};

export default definePlugin(() => {
  window.DECKCORD = {
    dispatchNotification: (payload: { title: string; body: string }) => {
      console.log("Dispatching Deckcord notification: ", payload);
      toaster.toast({
        title: payload.title,
        body: payload.body,
        duration: 5000,
        // Render as a Steam toast that overlays games/BrowserViews.
        critical: true,
        showToast: true,
        playSound: true,
        sound: 6,
      });
    },
    MIC_PEER_CONNECTION: undefined,
  };

  // Create the BrowserView from the frontend where Router is available.
  initializeDiscordBrowserView();

  let peerConnection: RTCPeerConnection;
  const webrtcEventListener = async (data: any) => {
    if (!data.webrtc) return;
    data = data.webrtc;
    console.log(data);
    if (data.offer) {
      console.log("Deckcord: Starting RTC connection");
      if (peerConnection) peerConnection.close();
      peerConnection = new RTCPeerConnection();
      window.DECKCORD.MIC_PEER_CONNECTION = peerConnection;
      const localStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
      });
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(data.offer)
      );
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      console.log("Deckcord: Sending RTC Answer");
      await call("mic_webrtc_answer", answer);
    } else if (data.ice) {
      try {
        while (peerConnection.remoteDescription == null) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await peerConnection.addIceCandidate(data.ice);
      } catch (e) {
        console.error("Deckcord: Error adding received ice candidate", e);
      }
    }
  };
  const stateListener = addEventListener("state", webrtcEventListener);

  let settingsChangeUnregister: any;
  const appLifetimeUnregister =
    SteamClient.GameSessions.RegisterForAppLifetimeNotifications(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      setPlaying();
    }).unregister;
  const unpatchMenu = patchMenu();

  const setPlaying = () => {
    const app = (window as any).Router?.MainRunningApp;
    call("set_rpc", app !== undefined ? app?.display_name : null);
  };

  let lastDisplayIsExternal = false;
  (async () => {
    await isLoaded();

    settingsChangeUnregister = SteamClient.Settings.RegisterForSettingsChanges(
      async (settings: any) => {
        if (settings.bDisplayIsExternal != lastDisplayIsExternal) {
          lastDisplayIsExternal = settings.bDisplayIsExternal;
          const bounds: any = await call("get_screen_bounds");
          if (!window.DISCORD_TAB) return;
          window.DISCORD_TAB.HEIGHT = bounds.height;
          window.DISCORD_TAB.WIDTH = bounds.width;
          window.DISCORD_TAB.m_browserView.SetBounds(
            0,
            0,
            bounds.width,
            bounds.height
          );
        }
      }
    );
    await isLoggedIn();
    try {
      setPlaying();
    } catch (e) {
      console.error("Deckcord: Failed to update RPC:", e);
    }
  })();

  routerHook.addRoute("/discord", () => {
    return <DiscordTab />;
  });

  return {
    name: "Deckcord",
    titleView: <div className={staticClasses.Title}>Deckcord</div>,
    content: <Content />,
    icon: <FaDiscord />,
    onDismount() {
      unpatchMenu();
      removeEventListener("state", stateListener);
      routerHook.removeRoute("/discord");
      // Clean up the browser view
      if (window.DISCORD_TAB) {
        try {
          window.DISCORD_TAB.m_browserView.SetVisible(false);
          window.DISCORD_TAB.Destroy();
          window.DISCORD_TAB = undefined;
        } catch (_e) { }
      }
      try {
        const callbacks =
          (Router as any).WindowStore?.GamepadUIMainWindowInstance?.m_VirtualKeyboardManager?.IsShowingVirtualKeyboard?.m_callbacks?.m_vecCallbacks;
        if (Array.isArray(callbacks) && window.DECKCORD_VK_CALLBACK) {
          const idx = callbacks.indexOf(window.DECKCORD_VK_CALLBACK);
          if (idx >= 0) callbacks.splice(idx, 1);
        }
        window.DECKCORD_VK_CALLBACK = undefined;
      } catch (_e) { }
      try {
        appLifetimeUnregister();
        settingsChangeUnregister();
      } catch (_error) { }
    },
    alwaysRender: true,
  };
});
