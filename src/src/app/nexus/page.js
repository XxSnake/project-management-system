'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDateTime(value) {
    if (!value) {
        return '--';
    }

    return new Date(value).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();
}

export default function NexusPage() {
    const [loading, setLoading] = useState(true);
    const [backups, setBackups] = useState([]);
    const [systemStats, setSystemStats] = useState({
        providers: 0,
        staff: 0,
        projects: 0,
        contracts: 0,
        workLogs: 0,
    });
    const [backuping, setBackuping] = useState(false);
    const [message, setMessage] = useState(null);

    const loadNexus = async () => {
        setLoading(true);
        try {
            const [backupList, modelConfig, staff, projects, contracts, workLogs] = await Promise.all([
                fetchJson('/api/backup'),
                fetchJson('/api/models'),
                fetchJson('/api/staff'),
                fetchJson('/api/projects'),
                fetchJson('/api/contracts'),
                fetchJson('/api/worklog'),
            ]);

            setBackups(backupList || []);
            setSystemStats({
                providers: (modelConfig.providers || []).filter((item) => item.enabled).length,
                staff: staff.length,
                projects: projects.length,
                contracts: contracts.length,
                workLogs: workLogs.length,
            });
            setMessage(null);
        } catch (error) {
            setMessage({ type: 'danger', text: `Nexus 数据加载失败：${error.message}` });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadNexus();
    }, []);

    const healthScore = useMemo(() => {
        let score = 34;
        if (backups.length > 0) score += 24;
        if (systemStats.providers > 0) score += 16;
        if (systemStats.contracts > 0) score += 12;
        if (systemStats.workLogs > 0) score += 8;
        if (systemStats.projects > 0) score += 4;
        return Math.min(score, 100);
    }, [backups.length, systemStats]);

    const handleCreateBackup = async () => {
        setBackuping(true);
        try {
            const response = await fetch('/api/backup', { method: 'POST' });
            const payload = await response.json();
            if (!response.ok || !payload.success) {
                throw new Error(payload.error || '备份失败');
            }

            setMessage({ type: 'success', text: `已创建新快照：${payload.fileName}` });
            setBackups(await fetchJson('/api/backup'));
        } catch (error) {
            setMessage({ type: 'danger', text: `备份失败：${error.message}` });
        } finally {
            setBackuping(false);
        }
    };

    const terminalLines = backups.slice(0, 8).map((item) => ({
        time: formatDateTime(item.createdAt),
        message: `snapshot archived :: ${item.name} :: ${formatBytes(item.size)}`,
    }));

    return (
        <>
            <div className="page-header">
                <div>
                    <div className="page-kicker">System Nexus</div>
                    <h2>数据安全与备份</h2>
                    <p className="page-desc">
                        一个偏系统中枢的全息面板，用来观察备份健康度、模型节点、合同与工作记录总量，并执行数据库快照动作。
                    </p>
                </div>
                <div className="page-actions">
                    <button className="btn btn-accent" onClick={handleCreateBackup} disabled={backuping}>
                        {backuping ? 'Archiving' : '创建手动备份'}
                    </button>
                    <a className="btn btn-secondary" href="/api/backup?download=current" target="_blank" rel="noreferrer">
                        下载当前数据库
                    </a>
                </div>
            </div>

            <div className="page-body">
                {message && (
                    <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                        {message.text}
                    </div>
                )}

                <div className="nexus-grid">
                    <section className="card">
                        <div className="panel-top">
                            <div className="panel-copy">
                                <div className="panel-eyebrow">System Health Ring</div>
                                <div className="panel-title">运行健康度</div>
                                <div className="panel-note">综合备份节点、模型节点和业务数据活跃度估算系统健康分。</div>
                            </div>
                            <span className="status-badge status-badge--approved">Secure</span>
                        </div>

                        <div className="health-ring" style={{ ['--ring-progress']: healthScore }}>
                            <div className="health-ring-core">
                                <div className="health-score">{healthScore}</div>
                                <div className="health-caption">Health Index</div>
                            </div>
                        </div>

                        <div className="node-grid mt-4">
                            <div className="node-card">
                                <div className="node-label">Active Models</div>
                                <div className="node-value">{systemStats.providers}</div>
                            </div>
                            <div className="node-card">
                                <div className="node-label">Backup Snapshots</div>
                                <div className="node-value">{backups.length}</div>
                            </div>
                            <div className="node-card">
                                <div className="node-label">Contracts</div>
                                <div className="node-value">{systemStats.contracts}</div>
                            </div>
                            <div className="node-card">
                                <div className="node-label">Work Logs</div>
                                <div className="node-value">{systemStats.workLogs}</div>
                            </div>
                        </div>

                        <div className="action-row mt-4">
                            <Link href="/master/models" className="btn btn-secondary">模型节点管理</Link>
                            <Link href="/contracts" className="btn btn-secondary">查看合同档案</Link>
                        </div>
                    </section>

                    <section className="terminal-panel">
                        <div className="terminal-header">
                            <div className="panel-copy">
                                <div className="panel-eyebrow">Security Logs</div>
                                <div className="panel-title">备份活动日志</div>
                                <div className="panel-note">最近快照将以终端样式投射在右侧玻璃面板中。</div>
                            </div>
                            <span className="status-badge status-badge--pending">{loading ? 'Syncing' : 'Realtime'}</span>
                        </div>

                        <div className="terminal">
                            {loading ? (
                                <div className="terminal-line">
                                    <span className="terminal-time">--:--:--</span>
                                    <span>nexus boot :: synchronizing backup registry ...</span>
                                </div>
                            ) : terminalLines.length > 0 ? (
                                terminalLines.map((line) => (
                                    <div key={`${line.time}-${line.message}`} className="terminal-line">
                                        <span className="terminal-time">{line.time}</span>
                                        <span>{line.message}</span>
                                    </div>
                                ))
                            ) : (
                                <div className="terminal-line">
                                    <span className="terminal-time">await</span>
                                    <span>no backup snapshots detected :: create the first vault archive.</span>
                                </div>
                            )}
                        </div>

                        <div className="ranking-list">
                            {backups.slice(0, 4).map((item, index) => (
                                <div key={item.name} className="ranking-item">
                                    <span className="ranking-index">{index + 1}</span>
                                    <div>
                                        <div className="ranking-name">{item.name}</div>
                                        <div className="ranking-meta">{formatDateTime(item.createdAt)} · {formatBytes(item.size)}</div>
                                    </div>
                                    <a href={item.downloadUrl} className="btn btn-secondary" target="_blank" rel="noreferrer">下载</a>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </>
    );
}
