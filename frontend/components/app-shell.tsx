"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Cable,
  CloudCog,
  FileKey2,
  LayoutDashboard,
  ListChecks,
  ShieldCheck,
  Settings,
  LogOut,
  UserCircle,
} from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";

type NavigationItem = {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
};

const navigation: NavigationItem[] = [
  { href: "/dashboard", label: "概览", icon: LayoutDashboard },
  { href: "/certificates", label: "证书", icon: FileKey2 },
  { href: "/executions", label: "执行记录", icon: ListChecks },
  { href: "/automations", label: "自动化", icon: CloudCog },
  { href: "/profile", label: "个人中心", icon: UserCircle },
];

const configuration: NavigationItem[] = [
  { href: "/cloud-credentials", label: "云凭证", icon: CloudCog },
  { href: "/acme-accounts", label: "ACME 账户", icon: ShieldCheck },
  { href: "/dns-accounts", label: "DNS 账户", icon: Cable },
];

function NavigationLink({ item }: { item: NavigationItem }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;

  return (
    <Link className={`nav-link ${active ? "nav-link-active" : ""}`} href={item.href}>
      <Icon size={18} strokeWidth={1.8} />
      <span>{item.label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();
	const router = useRouter();
	const [isAdmin, setIsAdmin] = useState(false);
	const [currentUser, setCurrentUser] = useState<{ email: string; role: string } | null>(null);
	useEffect(() => {
		if (pathname === "/login" || pathname === "/register") return;
		fetch("/api/auth/me")
			.then((response) => response.ok ? response.json() : null)
			.then((user) => {
				if (!user) { router.replace("/login"); return; }
				setCurrentUser(user);
				setIsAdmin(user.role === "admin");
			})
			.catch(() => { setCurrentUser(null); setIsAdmin(false); });
	}, [pathname, router]);
	async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); }
	if (pathname === "/login" || pathname === "/register") return <>{children}</>;
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand" aria-label="CertFlow 首页">
          <span className="brand-mark"><ShieldCheck size={20} strokeWidth={2.2} /></span>
          <span>CertFlow</span>
        </Link>

        <nav className="sidebar-nav" aria-label="主导航">
          <div className="nav-group">
            {navigation.map((item) => <NavigationLink item={item} key={item.href} />)}
          </div>
          <div className="nav-caption">配置</div>
          <div className="nav-group">
            {configuration.map((item) => <NavigationLink item={item} key={item.href} />)}
			{isAdmin ? <NavigationLink item={{ href: "/settings", label: "设置", icon: Settings }} /> : null}
          </div>
        </nav>

        <div className="sidebar-footer">
          <span className="service-indicator"><Activity size={14} /> 服务就绪</span>
          {currentUser ? <div className="account-summary"><Link href="/profile" className="account-link"><UserCircle size={16} /><span className="account-email">{currentUser.email}</span><span className="account-role">{currentUser.role === "admin" ? "管理员" : "用户"}</span></Link><button type="button" className="logout-button" onClick={logout} aria-label="退出登录" title="退出登录"><LogOut size={16} /></button></div> : null}
        </div>
      </aside>
      <main className="content-area">{children}</main>
    </div>
  );
}
