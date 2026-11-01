<p align="center">
  <img src="assets/cover.jpg" alt="Deckcord" />
</p>

# Deckcord
## Discord on the Deck, made easy

## Features
- Runs web discord as a separate tab in the background.
- Open/Close easily while in-game from the main menu.
- Mute/Deafen/Go Live/Disconnect and check members in your channel from the QAM.
- Headset, mic and per-user volume sliders in the QAM.
- Start calls with your recent DMs straight from the QAM.
- One-button post Steam screenshots and video clips to your recent channels, or browse every server/DM.
- Show your current game as playing status.
- Get notifications for DMs and pings in-game.
- Push-to-talk support, with physical keybind to rear buttons. (R5 Button)
- [Vencord](https://vencord.dev/) gets injected automatically before discord is loaded. It's needed to access a lot of the functionality that allows the plugin to do cool stuff, but also gives ya access to tons of other cool stuff.
- Working screenshare with audio
- One zip for both platforms: works on Steam Deck (Decky Loader) and Windows (Steam Big Picture). Platform-specific behavior is detected automatically.
- Windows (Steam Big Picture) support: fullscreen Discord view, Windows-safe startup and Vencord download.

## How to install  
1. Enable *Developer Mode* in Decky General settings.
2. Download the lateste release from https://github.com/SilvertongueRED/Deckcord-Windows/releases 
3. Go to Developer in Decky settings and upload the downloaded Deckcord zip file

The same zip is used on Steam Deck and on Windows - no separate download needed.

Note: Go Live uses a GStreamer helper on Steam Deck (Linux only). On Windows, Discord's native screenshare is used instead.

### Deckcord is provided with no gurantee as for its functionality, and I offer no "official" support for it. You can ask in the relevant thread on the [Decky Discord](https://discord.com/invite/U88fbeHyzt) and I will try to help if it's something simple. If it breaks, I will try to fix it, but that's it.

## Changelog
### v1.0.13
- One zip now works on both Steam Deck and Windows: the Discord view keeps Steam's status bar and menus on top on the Deck, and fills the window on Windows.
- Go Live: the GStreamer screenshare helper is only used on Steam Deck/Linux; on Windows (or if the helper can't start) Discord's native screenshare is used. A missing helper can no longer block startup.
- The GStreamer helper is now found whether or not Decky merged `defaults/` into the plugin folder.

### v1.0.12
- The call section (call name, Hang up button, members) now only shows while you are actually in a call.

### v1.0.11
- Added a red **Hang up** button right next to the current call's name in the QAM, so you can always leave a call (including DM and group calls).
- Disconnect is more reliable for DM/group calls: if Discord ignores the normal leave request, Deckcord now presses Discord's own Disconnect/Leave Call button.

### v1.0.10
- Fixed the "Group Call" (voice channel) heading overlapping the divider under Mic Volume in the QAM.
- The Discord item in the left Steam menu now always shows the Discord logo, even when the fallback item is used (it used to show the Store tag icon and look squished).
- Repo source synced with the live Windows plugin: volume sliders, DM call list, smart screenshare button, media/clip uploader with browse-all picker, fullscreen view fix, menu fallback gating.

## Credits
- Huge thanks to [@marios8543](https://github.com/marios8543) for creating this Decky plugin
- Huge thanks to [@aagaming](https://github.com/AAGaming00) for his enormous contributions towards getting mic working on the SteamClient tab, as well as his general support throughout the development of this plugin.
- Huge thanks to [@Epictek](https://github.com/Epictek) for his help in getting QR Code login working.
- Huge thanks to [@jessebofill](https://github.com/jessebofill) for the menu patching code.
