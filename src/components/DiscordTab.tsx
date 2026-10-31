import { call, toaster } from "@decky/api"
import { Router } from "@decky/ui"
import { useLayoutEffect } from "react"

// Steam hides the Big Picture status bar (clock, battery, wifi) on custom
// plugin routes by transforming it off-screen. Find that element by
// structural signature — direct child of `.BasicUI.GamepadMode`, tiny
// absolute-positioned bar near the top — and force transform:none while
// Discord tab is mounted so the status bar overlays on top of Discord.
const STATUS_BAR_STYLE_ID = "deckcord-statusbar-fix";

function findStatusBarClass(doc: Document): string | null {
    const basicUI = doc.querySelector(".BasicUI.GamepadMode") as HTMLElement | null;
    if (!basicUI) return null;
    for (const child of Array.from(basicUI.children) as HTMLElement[]) {
        const cs = child.ownerDocument.defaultView?.getComputedStyle(child);
        if (!cs) continue;
        if (cs.position !== "absolute") continue;
        const transform = cs.transform || "";
        // Hidden status bar has a translate(y, negative) transform.
        if (!/matrix\([^)]*,\s*-\d/.test(transform)) continue;
        const rect = child.getBoundingClientRect();
        if (rect.width < 100 || rect.width > 500) continue;
        if (rect.height < 20 || rect.height > 60) continue;
        // Use the first non-modifier class (base class, not the hidden modifier).
        const cls = (child.getAttribute("class") || "").split(/\s+/)[0];
        if (cls) return cls;
    }
    return null;
}

function installStatusBarFix(doc: Document) {
    if (doc.getElementById(STATUS_BAR_STYLE_ID)) return;
    const cls = findStatusBarClass(doc);
    if (!cls) return;
    const style = doc.createElement("style");
    style.id = STATUS_BAR_STYLE_ID;
    style.textContent = `.${cls}{transform:none!important}`;
    doc.head.appendChild(style);
}

function removeStatusBarFix(doc: Document) {
    doc.getElementById(STATUS_BAR_STYLE_ID)?.remove();
}

export const DiscordTab = () => {
    useLayoutEffect(() => {
        // Status bar lives inside the Big Picture (GamepadUI) main window
        // DOM, not SharedJSContext. Grab that document explicitly.
        const mainWindow: any =
            (Router as any).WindowStore?.GamepadUIMainWindowInstance?.m_BrowserWindow;
        const doc: Document = mainWindow?.document ?? document;
        installStatusBarFix(doc);

        call<[], any>("get_state").then(res => {
            const state = res;
            if (state?.loaded && window.DISCORD_TAB) {
                const bv = window.DISCORD_TAB.m_browserView;
                bv.SetVisible(true);
                // Keep the Discord BrowserView on top. On Windows, bottom-
                // stacking it (SetWindowStackingOrder(0)) puts it beneath
                // Steam's opaque main-UI layer, which composites as a solid
                // black screen. SetFocus brings it to the front instead.
                bv.SetFocus(true);
                try { bv.NotifyUserActivation?.(); } catch (_e) { }

                // On Windows this build leaves the BrowserView far smaller than
                // the Steam window (window size / devicePixelRatio), so Discord
                // renders into a small top-left box. Resize the view to fill the
                // actual main window, and re-apply a few times while Discord
                // settles (and after any keyboard-driven resize).
                const __dcMW = () => (Router as any).WindowStore?.GamepadUIMainWindowInstance?.m_BrowserWindow;
                const __dcFill = () => {
                    try {
                        const mw = __dcMW();
                        const W = (mw && mw.innerWidth) || 1280;
                        const H = (mw && mw.innerHeight) || 800;
                        window.DISCORD_TAB.WIDTH = W;
                        window.DISCORD_TAB.HEIGHT = H;
                        bv.SetVisible(true);
                        bv.SetBounds(0, 0, W, H);
                        // Stacking order 1 brings the BrowserView above Steam's UI
                        // layer on Windows so Discord is actually visible.
                        try { if (bv.SetWindowStackingOrder) bv.SetWindowStackingOrder(1); } catch (_e) { }
                        bv.SetFocus(true);
                    } catch (_e) { }
                };
                __dcFill();
                setTimeout(__dcFill, 400);
                setTimeout(__dcFill, 1200);
                setTimeout(__dcFill, 3000);
                setTimeout(__dcFill, 6000);
            }
            else {
                toaster.toast({
                    title: "Deckcord",
                    body: "Deckcord has not loaded yet!"
                });
                Router.Navigate("/library/home");
            }
        })
        return () => {
            removeStatusBarFix(doc);
            if (!window.DISCORD_TAB)
                return;

            window.DISCORD_TAB.m_browserView.SetVisible(false);
            window.DISCORD_TAB.m_browserView.SetFocus(false);
        }
    }, [])
    return <div></div>
}