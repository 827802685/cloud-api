'use client';

/**
 * 左侧导航：Dashboard、推理与路由、Tools、分析、系统（含 Config 与 Logout）；底部外链与版本号。
 * 支持折叠/展开，折叠态仅显示图标，状态持久化到 localStorage。
 */
import Link from 'next/link';
import BrandExternalLinks from '@/components/layout/BrandExternalLinks';
import LocaleSwitcher from '@/components/layout/LocaleSwitcher';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowLeftStartOnRectangleIcon,
  HomeIcon,
  KeyIcon,
  CpuChipIcon,
  GlobeAltIcon,
  ArrowsRightLeftIcon,
  BeakerIcon,
  PlayCircleIcon,
  DocumentChartBarIcon,
  ClipboardDocumentListIcon,
  ChartBarIcon,
  ServerStackIcon,
  UsersIcon,
  ShieldCheckIcon,
  Cog6ToothIcon,
  WrenchScrewdriverIcon,
  QueueListIcon,
  CommandLineIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { useState, useEffect, useCallback } from 'react';
import { adminAppVersion } from '@/lib/app-version';

const SIDEBAR_COLLAPSED_KEY = 'octafuse_sidebar_collapsed';

interface MenuItem {
  nameKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface MenuGroup {
  groupKey: string;
  items: MenuItem[];
}

const menuGroups: MenuGroup[] = [
  {
    groupKey: 'overview',
    items: [
      { nameKey: 'dashboard', href: '/dashboard', icon: HomeIcon },
      { nameKey: 'testConsole', href: '/gateway/test-console', icon: CommandLineIcon },
    ],
  },
  {
    groupKey: 'inference',
    items: [
      { nameKey: 'providers', href: '/gateway/providers', icon: GlobeAltIcon },
      { nameKey: 'models', href: '/gateway/models', icon: CpuChipIcon },
      { nameKey: 'routes', href: '/gateway/routes', icon: ArrowsRightLeftIcon },
      { nameKey: 'playground', href: '/gateway/playground', icon: BeakerIcon },
      { nameKey: 'simulator', href: '/gateway/simulator', icon: PlayCircleIcon },
    ],
  },
  {
    groupKey: 'user',
    items: [
      { nameKey: 'users', href: '/gateway/users', icon: UsersIcon },
      { nameKey: 'apiKeys', href: '/gateway/keys', icon: KeyIcon },
      { nameKey: 'requestLogs', href: '/gateway/request-logs', icon: DocumentChartBarIcon },
      { nameKey: 'auditLogs', href: '/gateway/audit-logs', icon: ClipboardDocumentListIcon },
    ],
  },
  {
    groupKey: 'tools',
    items: [
      { nameKey: 'toolsConfig', href: '/gateway/tools', icon: WrenchScrewdriverIcon },
      { nameKey: 'toolInvocations', href: '/gateway/tools/invocations', icon: QueueListIcon },
    ],
  },
  {
    groupKey: 'analytics',
    items: [
      { nameKey: 'modelUsage', href: '/gateway/analytics/models', icon: ChartBarIcon },
      { nameKey: 'providerUsage', href: '/gateway/analytics/providers', icon: ServerStackIcon },
      { nameKey: 'userUsage', href: '/gateway/analytics/users', icon: UsersIcon },
      { nameKey: 'reliability', href: '/gateway/analytics/reliability', icon: ShieldCheckIcon },
    ],
  },
  {
    groupKey: 'system',
    items: [
      { nameKey: 'config', href: '/gateway/config', icon: Cog6ToothIcon },
    ],
  },
];

export default function Sidebar() {
  const t = useTranslations('sidebar');
  const tBrand = useTranslations('brand');
  const tAuth = useTranslations('auth');
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  /* Persist collapsed state to localStorage */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (stored === '1') setCollapsed(true);
    } catch {
      /* ignore */
    }
    setMounted(true);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleLogout = async () => {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/');
      router.refresh();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const sidebarWidth = collapsed ? 'w-16' : 'w-64';

  return (
    <aside className={`sticky top-0 h-dvh shrink-0 bg-gray-900 transition-all duration-200 ${sidebarWidth}`}>
      <div className="flex h-full flex-col">
        {/* Logo / Brand */}
        <div className={`flex h-16 flex-col justify-center bg-gray-950 leading-tight transition-all duration-200 ${collapsed ? 'px-2' : 'px-6'}`}>
          <Link href="/dashboard" className="block hover:opacity-90">
            {collapsed ? (
              <span className="block text-center text-lg font-bold tracking-tight text-white">OG</span>
            ) : (
              <>
                <span className="block text-lg font-bold tracking-tight text-white">{tBrand('wordmark')}</span>
                <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
                  {tBrand('sidebarSubtitle')}
                </span>
              </>
            )}
          </Link>
        </div>

        {/* Collapse toggle button */}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="absolute -right-3 top-20 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-gray-700 bg-gray-800 text-gray-400 shadow-sm hover:bg-gray-700 hover:text-white transition-colors"
          title={collapsed ? t('expand') : t('collapse')}
        >
          {collapsed ? (
            <ChevronRightIcon className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeftIcon className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Navigation */}
        <nav className={`flex-1 py-4 overflow-y-auto overflow-x-hidden ${collapsed ? 'px-1.5 space-y-4' : 'px-3 space-y-6'}`}>
          {menuGroups.map((group) => (
            <div key={group.groupKey}>
              {!collapsed && (
                <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  {t(`groups.${group.groupKey}`)}
                </h3>
              )}
              {collapsed && (
                <div className="mx-auto mb-1 h-px w-6 bg-gray-700/60" />
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    (item.href === '/gateway/users' &&
                      (pathname === '/gateway/users' || pathname?.startsWith('/gateway/users/'))) ||
                    (item.href === '/gateway/tools' && pathname === '/gateway/tools');
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.nameKey}
                      href={item.href}
                      title={collapsed ? t(`nav.${item.nameKey}`) : undefined}
                      className={`
                        group flex items-center rounded-lg
                        ${collapsed
                          ? 'justify-center px-0 py-2.5'
                          : 'px-3 py-2.5'
                        }
                        text-sm font-medium
                        ${isActive
                          ? 'bg-gray-800 text-white'
                          : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                        }
                      `}
                    >
                      <Icon className={`
                        flex-shrink-0
                        ${collapsed
                          ? 'h-5 w-5'
                          : 'mr-3 h-5 w-5'
                        }
                        ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-white'}
                      `} />
                      {!collapsed && t(`nav.${item.nameKey}`)}
                    </Link>
                  );
                })}
                {group.groupKey === 'system' && (
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    title={collapsed ? (isLoggingOut ? tAuth('loggingOut') : tAuth('logout')) : undefined}
                    className={`
                      group w-full flex items-center rounded-lg text-sm font-medium
                      ${collapsed
                        ? 'justify-center px-0 py-2.5'
                        : 'px-3 py-2.5'
                      }
                      text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed
                    `}
                  >
                    <ArrowLeftStartOnRectangleIcon className={`
                      flex-shrink-0
                      ${collapsed ? 'h-5 w-5' : 'mr-3 h-5 w-5'}
                      text-gray-400 group-hover:text-white
                    `} />
                    {!collapsed && (isLoggingOut ? tAuth('loggingOut') : tAuth('logout'))}
                  </button>
                )}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer: links + version */}
        <div className={`border-t border-gray-800 space-y-3 ${collapsed ? 'p-2' : 'p-4'}`}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <LocaleSwitcher variant="sidebar" />
            </div>
          ) : (
            <>
              <LocaleSwitcher variant="sidebar" />
              <BrandExternalLinks variant="sidebar" />
              <p className="text-xs text-gray-500 text-center">{t('version', { version: adminAppVersion })}</p>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
