"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Cable,
  CloudCog,
  Boxes,
  FileKey2,
  LayoutDashboard,
  Languages,
  ListChecks,
  Monitor,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  LogOut,
  UserCircle,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Accordion, Avatar, Breadcrumbs, Button, Dropdown } from "@heroui/react";
import { useEffect, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/providers/theme-provider";
import { useLocale, type TranslationKey } from "@/components/providers/locale-provider";
import { NotificationCenter } from "@/components/layout/notification-center";
import { BrandLogo } from "@/components/ui/brand-logo";

type NavigationItem = {
  href: string;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
};

const navigation: NavigationItem[] = [
  {
    href: "/certificates",
    labelKey: "nav.certificates",
    descriptionKey: "section.certificates",
    icon: FileKey2,
  },
  {
    href: "/automations",
    labelKey: "nav.automations",
    descriptionKey: "section.automations",
    icon: CloudCog,
  },
  { href: "/executions", labelKey: "nav.executions", descriptionKey: "section.executions", icon: ListChecks },
];

const resources: NavigationItem[] = [
  {
    href: "/cloud-credentials",
    labelKey: "nav.credentials",
    descriptionKey: "section.credentials",
    icon: CloudCog,
  },
  { href: "/acme-accounts", labelKey: "nav.acme", descriptionKey: "section.acme", icon: ShieldCheck },
  { href: "/dns-accounts", labelKey: "nav.dns", descriptionKey: "section.dns", icon: Cable },
];

const dashboardItem: NavigationItem = {
  href: "/dashboard",
  labelKey: "nav.dashboard",
  descriptionKey: "section.dashboard",
  icon: LayoutDashboard,
};
const settingsItem: NavigationItem = {
  href: "/settings",
  labelKey: "nav.settings",
  descriptionKey: "section.settings",
  icon: Settings,
};
const profileItem: NavigationItem = {
  href: "/profile",
  labelKey: "account.profile",
  descriptionKey: "section.profile",
  icon: UserCircle,
};

function NavigationLink({ item, onNavigate }: { item: NavigationItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useLocale();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;

  return (
    <Link
      className={`nav-link ${active ? "nav-link-active" : ""}`}
      href={item.href}
      onClick={onNavigate}
      aria-label={t(item.labelKey)}
      title={t(item.labelKey)}
    >
      <Icon size={18} strokeWidth={1.8} />
      <span>{t(item.labelKey)}</span>
    </Link>
  );
}

function CollapsedNavigationGroup({
  icon: Icon,
  items,
  labelKey,
}: {
  icon: NavigationItem["icon"];
  items: NavigationItem[];
  labelKey: TranslationKey;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLocale();
  const activeItem = items.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  return (
    <Dropdown>
      <Dropdown.Trigger
        className={`nav-collapsed-menu-trigger ${activeItem ? "nav-collapsed-menu-trigger-active" : ""}`}
        aria-label={t(labelKey)}
      >
        <Icon size={18} strokeWidth={1.8} />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="right top">
        <Dropdown.Menu
          selectedKeys={activeItem ? [activeItem.href] : []}
          selectionMode="single"
          onAction={(key) => router.push(String(key))}
        >
          {items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <Dropdown.Item id={item.href} key={item.href}>
                <ItemIcon size={16} />
                {t(item.labelKey)}
              </Dropdown.Item>
            );
          })}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, setLocale, t } = useLocale();
  const { theme, setTheme } = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ email: string; role: string } | null>(null);
  const resourceActive = resources.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const operationsActive = navigation.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(
    () => new Set([...(resourceActive ? ["resources"] : []), ...(operationsActive ? ["operations"] : [])]),
  );
  const activeExpandedKeys = new Set([
    ...expandedKeys,
    ...(resourceActive ? ["resources"] : []),
    ...(operationsActive ? ["operations"] : []),
  ]);
  const activeItem = [
    ...navigation,
    ...resources,
    dashboardItem,
    profileItem,
    ...(currentUser?.role === "admin" ? [settingsItem] : []),
  ].find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const isAdmin = currentUser?.role === "admin";
  const selectedTheme = theme ?? "system";
  useEffect(() => {
    if (pathname === "/" || pathname === "/login" || pathname === "/register") return;
    fetch("/api/auth/me")
      .then(async (response) => {
        if (response.ok) return response.json();
        const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
        if (!refreshed.ok) return null;
        const retry = await fetch("/api/auth/me");
        return retry.ok ? retry.json() : null;
      })
      .then((user) => {
        if (!user) {
          router.replace("/login");
          return;
        }
        setCurrentUser(user);
      })
      .catch(() => setCurrentUser(null));
  }, [pathname, router]);
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  if (pathname === "/" || pathname === "/login" || pathname === "/register") return <>{children}</>;
  return (
    <div className={`app-frame ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${navOpen ? "mobile-nav-open" : ""}`}>
        <div className="sidebar-brand-row">
          <Link href="/dashboard" className="brand" aria-label={t("navigation.home")}>
            <BrandLogo priority />
          </Link>
          {!sidebarCollapsed ? (
            <Button
              className="sidebar-toggle"
              variant="ghost"
              isIconOnly
              aria-label={t("navigation.collapseSidebar")}
              onPress={() => setSidebarCollapsed(true)}
            >
              <PanelLeftClose size={18} />
            </Button>
          ) : null}
        </div>
        <Button
          className="mobile-menu-button"
          variant="ghost"
          isIconOnly
          aria-label={navOpen ? t("navigation.collapse") : t("navigation.expand")}
          onPress={() => setNavOpen((open) => !open)}
        >
          <Menu size={19} />
        </Button>

        <nav className="sidebar-nav" aria-label={t("navigation.main")}>
          <div className="nav-group nav-group-primary">
            <NavigationLink item={dashboardItem} onNavigate={() => setNavOpen(false)} />
          </div>
          {sidebarCollapsed ? (
            <div className="nav-collapsed-groups">
              <CollapsedNavigationGroup icon={Boxes} items={resources} labelKey="nav.resources" />
              <CollapsedNavigationGroup icon={FileKey2} items={navigation} labelKey="nav.operations" />
            </div>
          ) : (
            <Accordion
              className="nav-accordion"
              hideSeparator
              allowsMultipleExpanded
              expandedKeys={activeExpandedKeys}
              onExpandedChange={(keys) => setExpandedKeys(new Set(Array.from(keys).map(String)))}
            >
              <Accordion.Item id="resources" className="nav-accordion-item">
                <Accordion.Heading className="nav-accordion-heading">
                  <Accordion.Trigger
                    className={`nav-accordion-trigger ${resourceActive ? "nav-accordion-trigger-active" : ""}`}
                    aria-label={t("nav.resources")}
                  >
                    <Boxes size={18} strokeWidth={1.8} />
                    <span>{t("nav.resources")}</span>
                    <Accordion.Indicator />
                  </Accordion.Trigger>
                </Accordion.Heading>
                <Accordion.Panel className="nav-accordion-panel">
                  <Accordion.Body className="nav-accordion-body">
                    {resources.map((item) => (
                      <NavigationLink item={item} key={item.href} onNavigate={() => setNavOpen(false)} />
                    ))}
                  </Accordion.Body>
                </Accordion.Panel>
              </Accordion.Item>
              <Accordion.Item id="operations" className="nav-accordion-item">
                <Accordion.Heading className="nav-accordion-heading">
                  <Accordion.Trigger
                    className={`nav-accordion-trigger ${operationsActive ? "nav-accordion-trigger-active" : ""}`}
                    aria-label={t("nav.operations")}
                  >
                    <FileKey2 size={18} strokeWidth={1.8} />
                    <span>{t("nav.operations")}</span>
                    <Accordion.Indicator />
                  </Accordion.Trigger>
                </Accordion.Heading>
                <Accordion.Panel className="nav-accordion-panel">
                  <Accordion.Body className="nav-accordion-body">
                    {navigation.map((item) => (
                      <NavigationLink item={item} key={item.href} onNavigate={() => setNavOpen(false)} />
                    ))}
                  </Accordion.Body>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          )}
          {isAdmin ? (
            <div className="nav-group nav-group-settings">
              <NavigationLink item={settingsItem} onNavigate={() => setNavOpen(false)} />
            </div>
          ) : null}
        </nav>
        {sidebarCollapsed ? (
          <div className="sidebar-nav-footer">
            <Button
              className="nav-link sidebar-expand-control"
              variant="ghost"
              isIconOnly
              aria-label={t("navigation.expandSidebar")}
              onPress={() => setSidebarCollapsed(false)}
            >
              <PanelLeftOpen size={18} strokeWidth={1.8} />
            </Button>
          </div>
        ) : null}
      </aside>
      <div className="workspace-shell">
        <header className="app-header">
          <div className="app-header-context">
            <Breadcrumbs>
              <Breadcrumbs.Item href="/dashboard">CertFlow</Breadcrumbs.Item>
              {resourceActive ? <Breadcrumbs.Item>{t("nav.resources")}</Breadcrumbs.Item> : null}
              <Breadcrumbs.Item>{t(activeItem?.labelKey ?? "nav.dashboard")}</Breadcrumbs.Item>
            </Breadcrumbs>
            <p className="app-header-description">{t(activeItem?.descriptionKey ?? "section.dashboard")}</p>
          </div>
          <div className="app-header-actions">
            <div className="header-preference-actions">
              {currentUser ? <NotificationCenter /> : null}
              <Dropdown>
                <Dropdown.Trigger className="theme-trigger" aria-label={t("theme.change")}>
                  {selectedTheme === "dark" ? (
                    <Moon size={16} aria-hidden="true" />
                  ) : selectedTheme === "light" ? (
                    <Sun size={16} aria-hidden="true" />
                  ) : (
                    <Monitor size={16} aria-hidden="true" />
                  )}
                </Dropdown.Trigger>
                <Dropdown.Popover placement="bottom end">
                  <Dropdown.Menu
                    selectedKeys={[selectedTheme]}
                    selectionMode="single"
                    onAction={(key) => setTheme(String(key))}
                  >
                    <Dropdown.Item id="system">
                      <Monitor size={16} />
                      {t("theme.system")}
                    </Dropdown.Item>
                    <Dropdown.Item id="light">
                      <Sun size={16} />
                      {t("theme.light")}
                    </Dropdown.Item>
                    <Dropdown.Item id="dark">
                      <Moon size={16} />
                      {t("theme.dark")}
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
              <Dropdown>
                <Dropdown.Trigger className="locale-trigger" aria-label={t("language.change")}>
                  <Languages size={16} aria-hidden="true" />
                  <span>{locale === "zh-CN" ? "中" : "EN"}</span>
                </Dropdown.Trigger>
                <Dropdown.Popover placement="bottom end">
                  <Dropdown.Menu
                    selectedKeys={[locale]}
                    selectionMode="single"
                    onAction={(key) => setLocale(key as "zh-CN" | "en")}
                  >
                    <Dropdown.Item id="zh-CN">{t("language.zh-CN")}</Dropdown.Item>
                    <Dropdown.Item id="en">{t("language.en")}</Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </div>
            {currentUser ? (
              <Dropdown>
                <Dropdown.Trigger className="account-trigger">
                  <Avatar className="account-avatar" size="sm">
                    <Avatar.Fallback>
                      <UserCircle size={16} aria-hidden="true" />
                    </Avatar.Fallback>
                  </Avatar>
                  <span className="account-identity">
                    <span className="account-email">{currentUser.email}</span>
                    <span className="account-role">
                      {currentUser.role === "admin" ? t("account.admin") : t("account.user")}
                    </span>
                  </span>
                </Dropdown.Trigger>
                <Dropdown.Popover placement="bottom end">
                  <Dropdown.Menu
                    onAction={(key) => {
                      if (key === "profile") router.push("/profile");
                      if (key === "logout") void logout();
                    }}
                  >
                    <Dropdown.Item id="profile">
                      <UserCircle size={16} />
                      {t("account.profile")}
                    </Dropdown.Item>
                    <Dropdown.Item id="logout" className="danger-menu-item">
                      <LogOut size={16} />
                      {t("account.logout")}
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            ) : null}
          </div>
        </header>
        <main className="main-content">
          <div className="content-area">{children}</div>
        </main>
      </div>
    </div>
  );
}
