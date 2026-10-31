//Credit: https://github.com/jessebofill/DeckWebBrowser

import { afterPatch, findInReactTree, getGamepadNavigationTrees, getReactInstance, getReactRoot, Navigation, Router } from "@decky/ui"
import { FC, ReactElement, ReactNode } from "react"
import { FaDiscord } from "react-icons/fa"

interface MainMenuItemPropsBase {
    route: string
    label: ReactNode
    onFocus?: () => void
    onGamepadFocus?: () => void
    icon?: ReactElement
    onActivate?: () => void
}

type MainMenuItemProps = MainMenuItemPropsBase & Record<string, any>;

const getReactTree = () => {
    const mainMenuElement = getGamepadNavigationTrees()
        ?.find((tree: any) => tree.m_ID === 'MainNavMenuContainer')
        ?.Root?.Element

    return (
        (mainMenuElement ? getReactInstance(mainMenuElement) : undefined) ||
        getReactRoot(document.getElementById('root') as any)
    )
}

export const patchMenu = () => {
    let unpatch = () => { }
    let uninstallDomFallback = () => { }
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false

    const tryPatch = () => {
        if (disposed) return

        const nextUnpatch = patchMenuOnce()
        if (nextUnpatch) {
            unpatch = nextUnpatch
            return
        }

        retryTimer = setTimeout(tryPatch, 1000)
    }

    tryPatch()

    // The DOM fallback clones the Store menu item. That clone is not wired into
    // Steam's gamepad navigation tree (the controller can't focus it) and carries
    // the Store's icon, so it looks squished and "store-like". It must only be a
    // last resort: arm it after a grace period, and only if the React patch has
    // not already added its proper, controller-navigable item.
    fallbackTimer = setTimeout(() => {
        if (disposed || (window as any).__deckcordReactMenuItemAdded) return
        uninstallDomFallback = installDomMenuFallback()
    }, 5000)

    return () => {
        disposed = true
        if (retryTimer) clearTimeout(retryTimer)
        if (fallbackTimer) clearTimeout(fallbackTimer)
        unpatch()
        uninstallDomFallback()
    }
}

const patchMenuOnce = () => {
    const menuNode = findMainMenuNode()
    if (!menuNode || !menuNode.return?.type) {
        console.log('Failed to find main menu root node.')
        return undefined
    }
    const orig = menuNode.return.type
    const menuWrapper = (props: any) => {
        const ret = orig(props)
        patchMenuItems(ret)
        patchNestedMenuRenderers(ret)
        return ret
    }
    menuNode.return.type = menuWrapper
    if (menuNode.return.alternate) {
        menuNode.return.alternate.type = menuNode.return.type;
    }

    return () => {
        if (menuNode.return) {
            menuNode.return.type = orig
            if (menuNode.return.alternate) {
                menuNode.return.alternate.type = menuNode.return.type;
            }
        }
    }
}

function findMainMenuNode() {
    const tree = getReactTree()
    let menuNode = findInReactTree(tree, (node: { memoizedProps: { navID: string } }) => node?.memoizedProps?.navID == 'MainNavMenuContainer')

    let current = tree
    while (current) {
        if (current?.memoizedProps?.navID === 'MainNavMenuContainer') {
            menuNode = current
        }
        current = current.return
    }

    return menuNode
}

const isMenuItemElt = (e: any) => e?.props?.label && (e.props.onFocus || e.props.onGamepadFocus) && e.props.route && e.type?.toString;

function patchMenuItems(ret: any) {
    const menuItems = findInReactTree(ret, (node: any[]) => Array.isArray(node) && node.some(isMenuItemElt)) as Array<any>;

    if (!menuItems || menuItems.some((item) => item?.props?.route === '/discord')) {
        return false
    }

    const itemIndexes = getMenuItemIndexes(menuItems);
    const menuItem = menuItems.find(isMenuItemElt) as { props: MainMenuItemProps, type: () => ReactElement };
    const focusProps = menuItem.props.onGamepadFocus
        ? { onGamepadFocus: menuItem.props.onGamepadFocus }
        : { onFocus: menuItem.props.onFocus };

    const newItem =
        <MenuItemWrapper
            key={'deckcord'}
            route={'/discord'}
            label='Discord'
            {...focusProps}
            useIconAsProp={!!menuItem.props.icon}
            MenuItemComponent={menuItem.type}
        />

    const browserPosition = Number.parseInt(localStorage.getItem("DECKCORD_MENU_POSITION") || "3" as string);

    if (browserPosition === 9) menuItems.splice(itemIndexes[itemIndexes.length - 1] + 1, 0, newItem)
    else menuItems.splice(itemIndexes[browserPosition - 1], 0, newItem)

    // Signal that the proper React item is in place so the DOM fallback stays off
    // (and removes any clone it may already have inserted).
    ;(window as any).__deckcordReactMenuItemAdded = true
    return true
}

function patchNestedMenuRenderers(node: any, depth = 0) {
    if (!node || depth > 8) return

    if (Array.isArray(node)) {
        node.forEach((child) => patchNestedMenuRenderers(child, depth + 1))
        return
    }

    if (node?.props?.children) {
        patchNestedMenuRenderers(node.props.children, depth + 1)
    }

    if (typeof node?.type === 'function' && !node.__deckcordMenuRendererPatched) {
        node.__deckcordMenuRendererPatched = true
        afterPatch(node, 'type', (_: any, childRet: any) => {
            patchMenuItems(childRet)
            patchNestedMenuRenderers(childRet, depth + 1)
            return childRet
        })
    }
}

function getMenuItemIndexes(items: any[]) {
    return items.flatMap((item, index) => (item && item.$$typeof && item.type !== 'div') ? index : [])
}

const DECKCORD_DISCORD_VIEWBOX = "0 0 640 512"
const DECKCORD_DISCORD_PATH = "M524.531,69.836a1.5,1.5,0,0,0-.764-.7A485.065,485.065,0,0,0,404.081,32.03a1.816,1.816,0,0,0-1.923.91,337.461,337.461,0,0,0-14.9,30.6,447.848,447.848,0,0,0-134.426,0,309.541,309.541,0,0,0-15.135-30.6,1.89,1.89,0,0,0-1.924-.91A483.689,483.689,0,0,0,116.085,69.137a1.712,1.712,0,0,0-.788.676C39.068,183.651,18.186,294.69,28.43,404.354a2.016,2.016,0,0,0,.765,1.375A487.666,487.666,0,0,0,176.02,479.918a1.9,1.9,0,0,0,2.063-.676A348.2,348.2,0,0,0,208.12,430.4a1.86,1.86,0,0,0-1.019-2.588,321.173,321.173,0,0,1-45.868-21.853,1.885,1.885,0,0,1-.185-3.126c3.082-2.309,6.166-4.711,9.109-7.137a1.819,1.819,0,0,1,1.9-.256c96.229,43.917,200.41,43.917,295.5,0a1.812,1.812,0,0,1,1.924.233c2.944,2.426,6.027,4.851,9.132,7.16a1.884,1.884,0,0,1-.162,3.126,301.407,301.407,0,0,1-45.89,21.83,1.875,1.875,0,0,0-1,2.611,391.055,391.055,0,0,0,30.014,48.815,1.864,1.864,0,0,0,2.063.7A486.048,486.048,0,0,0,610.7,405.729a1.882,1.882,0,0,0,.765-1.352C623.729,277.594,590.933,167.465,524.531,69.836ZM222.491,337.58c-28.972,0-52.844-26.587-52.844-59.239S193.056,219.1,222.491,219.1c29.665,0,53.306,26.82,52.843,59.239C275.334,310.993,251.924,337.58,222.491,337.58Zm195.38,0c-28.971,0-52.843-26.587-52.843-59.239S388.437,219.1,417.871,219.1c29.667,0,53.307,26.82,52.844,59.239C470.715,310.993,447.538,337.58,417.871,337.58Z"
// Make sure the cloned fallback item shows the Discord logo (never the Store
// tag it was cloned from) and keeps its icon from being squished.
function applyDiscordIcon(item: HTMLElement, labelNode: Element | undefined) {
    const SVG_NS = "http://www.w3.org/2000/svg"
    let svg = (Array.from(item.querySelectorAll("svg")) as SVGSVGElement[]).find((s) => !labelNode || !labelNode.contains(s))
    if (!svg) {
        svg = item.ownerDocument.createElementNS(SVG_NS, "svg") as SVGSVGElement
        svg.setAttribute("width", "1.4em")
        svg.setAttribute("height", "1.4em")
        item.insertBefore(svg, item.firstChild)
    }
    svg.setAttribute("viewBox", DECKCORD_DISCORD_VIEWBOX)
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet")
    svg.setAttribute("fill", "currentColor")
    while (svg.firstChild)
        svg.removeChild(svg.firstChild)
    const p = item.ownerDocument.createElementNS(SVG_NS, "path")
    p.setAttribute("d", DECKCORD_DISCORD_PATH)
    svg.appendChild(p)
    svg.style.flexShrink = "0"
    svg.style.minWidth = svg.getAttribute("width") ? "" : "1.4em"
}

function installDomMenuFallback() {
    let observer: MutationObserver | undefined
    let warned = false
    const onActivate = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()

        try {
            ((Navigation as any).Navigate || (Router as any).Navigate).call(Navigation, '/discord')
            ; (Navigation as any).CloseSideMenus?.()
        } catch (e) {
            console.error('Deckcord: Failed to navigate to Discord route:', e)
        }
    }

    const removeOwnClone = () => {
        document.querySelectorAll('[data-deckcord-menu-item="true"]').forEach((node) => node.remove())
    }

    const inject = () => {
        try {
            // If the React patch has added the proper, controller-navigable item,
            // never inject, and tear down any clone we previously added.
            if ((window as any).__deckcordReactMenuItemAdded) {
                removeOwnClone()
                return
            }
            const menuRoot = getGamepadNavigationTrees()
                ?.find((tree: any) => tree.m_ID === 'MainNavMenuContainer')
                ?.Root?.Element as HTMLElement | undefined
            const menu = menuRoot?.querySelector('[role="menu"]') as HTMLElement | undefined
            if (!menuRoot || !menu) return

            const hasDiscordItem = Array.from(menuRoot.querySelectorAll('[role="menuitem"]'))
                .some((item) => item.getAttribute('aria-label') === 'Discord' || item.textContent?.trim() === 'Discord')
            if (hasDiscordItem || menu.querySelector('[data-deckcord-menu-item="true"]')) return

            const nestedMenuItems = Array.from(menu.querySelectorAll('[role="menuitem"]')) as HTMLElement[]
            const directMenuItems = Array.from(menu.children)
                .filter((item): item is HTMLElement => item instanceof HTMLElement && item.getAttribute('role') === 'menuitem')
            const menuItems = directMenuItems.length ? directMenuItems : nestedMenuItems
            const template = menuItems.find((item) => item.getAttribute('aria-label') === 'Store') || menuItems[0]
            if (!template) return

            const deckcordItem = template.cloneNode(true) as HTMLElement
            deckcordItem.setAttribute('aria-label', 'Discord')
            deckcordItem.setAttribute('data-deckcord-menu-item', 'true')
            deckcordItem.title = 'Discord'
            deckcordItem.tabIndex = 0

            const templateLabel = template.getAttribute('aria-label')
            const labelNode = Array.from(deckcordItem.querySelectorAll('*')).find((node) => node.children.length === 0 && node.textContent?.trim() === templateLabel)
            if (labelNode) labelNode.textContent = 'Discord'
            else deckcordItem.textContent = 'Discord'
            applyDiscordIcon(deckcordItem, labelNode)

            deckcordItem.addEventListener('click', onActivate)
            deckcordItem.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') onActivate(event)
            })

            const browserPosition = Number.parseInt(localStorage.getItem("DECKCORD_MENU_POSITION") || "3" as string)
            const insertParent = directMenuItems.length ? menu : template.parentElement || menu
            const siblingItems = Array.from(insertParent.children)
                .filter((item): item is HTMLElement => item instanceof HTMLElement && item.getAttribute('role') === 'menuitem')
            const insertBefore = browserPosition === 9 ? null : siblingItems[browserPosition - 1] || null
            insertParent.insertBefore(deckcordItem, insertBefore)
        } catch (e) {
            if (!warned) {
                warned = true
                console.warn('Deckcord: Failed to inject fallback menu item:', e)
            }
        }
    }

    const interval = setInterval(inject, 1000)
    inject()

    try {
        observer = new MutationObserver(inject)
        observer.observe(document.documentElement, { childList: true, subtree: true })
    } catch (e) {
        console.warn('Deckcord: Failed to watch menu DOM for fallback injection:', e)
    }

    return () => {
        clearInterval(interval)
        observer?.disconnect()
        document.querySelectorAll('[data-deckcord-menu-item="true"]').forEach((node) => node.remove())
    }
}

interface MenuItemWrapperProps extends MainMenuItemPropsBase {
    MenuItemComponent: FC<MainMenuItemProps>;
    useIconAsProp: boolean;
}

const MenuItemWrapper: FC<MenuItemWrapperProps> = ({ MenuItemComponent, useIconAsProp, ...props }) => {
    const componentProps: any = { ...props };
    componentProps[useIconAsProp ? 'icon' : 'children'] = <FaDiscord />;

    return (
        <MenuItemComponent
            {...componentProps}
            label={'Discord'}
        />
    )
}
