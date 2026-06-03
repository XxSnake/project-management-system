'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const baseNavSections = [
    {
        title: 'Command Layer',
        items: [
            { href: '/', code: 'CTL', label: '控制台', note: '实时总览与快捷操作' },
            { href: '/worklog', code: 'LOG', label: '工作记录', note: '日志导入、筛选与批量处理' },
            { href: '/reports', code: 'RPT', label: '产值报表', note: '收入趋势、排行与导出' },
            { href: '/nexus', code: 'NXS', label: 'System Nexus', note: '备份、安全与系统状态' },
        ],
    },
    {
        title: 'Data Fabric',
        items: [
            { href: '/contracts', code: 'CTR', label: '合同管理', note: '合同识别、批量导入与价目表' },
            { href: '/master/staff', code: 'STF', label: '人员管理', note: '人员档案与角色信息' },
            { href: '/master/projects', code: 'PRJ', label: '项目管理', note: '项目状态、阶段与合同关联' },
            { href: '/master/inbox', code: 'BOX', label: '异常处理', note: '集中处理数量、人员、合同和产值异常' },
            { href: '/master/models', code: 'API', label: '模型 API', note: '统一管理 OCR 与推理模型' },
        ],
    },
];

export default function Sidebar() {
    const pathname = usePathname();
    const [inboxCount, setInboxCount] = useState(0);

    const refreshInboxCount = async () => {
        try {
            const response = await fetch(`/api/inbox/exceptions?page=1&pageSize=1&_t=${Date.now()}`, {
                cache: 'no-store',
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'load inbox count failed');
            }

            setInboxCount(Number(data?.counts?.total || 0));
        } catch (error) {
            console.error('Load inbox count failed:', error);
        }
    };

    useEffect(() => {
        void refreshInboxCount();
    }, [pathname]);

    useEffect(() => {
        const handleRefresh = () => {
            void refreshInboxCount();
        };

        window.addEventListener('focus', handleRefresh);
        window.addEventListener('inbox-updated', handleRefresh);

        return () => {
            window.removeEventListener('focus', handleRefresh);
            window.removeEventListener('inbox-updated', handleRefresh);
        };
    }, []);

    const navSections = useMemo(() => baseNavSections.map((section) => ({
        ...section,
        items: section.items.map((item) => (
            item.href === '/master/inbox'
                ? { ...item, badge: inboxCount }
                : item
        )),
    })), [inboxCount]);

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="brand-mark">EI</div>
                <div>
                    <h1>工程检测项目管理系统</h1>
                    <p className="subtitle">Glass Command Mesh</p>
                </div>
            </div>

            <div className="sidebar-status">
                <span className="status-dot" />
                <span>Core nodes online</span>
            </div>

            <nav className="sidebar-nav">
                {navSections.map((section) => (
                    <section key={section.title} className="nav-section">
                        <div className="nav-section-title">{section.title}</div>
                        {section.items.map((item) => {
                            const active = pathname === item.href;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`nav-link ${active ? 'active' : ''}`}
                                >
                                    <span className="icon">{item.code}</span>
                                    <span className="nav-copy">
                                        <span className="nav-label">{item.label}</span>
                                        <span className="nav-note">{item.note}</span>
                                    </span>
                                    {item.badge > 0 ? (
                                        <span className="sidebar-badge">{item.badge}</span>
                                    ) : null}
                                </Link>
                            );
                        })}
                    </section>
                ))}
            </nav>

            <div className="sidebar-footer">
                <a href="/api/backup?download=current" target="_blank" rel="noreferrer" className="vault-link">
                    下载当前数据库
                </a>
                <span className="footer-note">Desktop engineering command center</span>
            </div>
        </aside>
    );
}
