'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

function getCurrentMonthString(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatCurrency(value) {
    return `CNY ${Number(value || 0).toFixed(2)}`;
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
    });
}

async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }

    return response.json();
}

async function loadDashboardState(currentMonth) {
    const [
        staff,
        projects,
        workLogs,
        contracts,
        backupList,
        staffReport,
        currentLogs,
    ] = await Promise.all([
        fetchJson('/api/staff'),
        fetchJson('/api/projects'),
        fetchJson('/api/worklog'),
        fetchJson('/api/contracts'),
        fetchJson('/api/backup'),
        fetchJson(`/api/reports?groupBy=staff&month=${currentMonth}`),
        fetchJson(`/api/worklog?month=${currentMonth}`),
    ]);

    return {
        stats: {
            staff: staff.length,
            projects: projects.length,
            workLogs: workLogs.length,
            contracts: contracts.length,
        },
        catalog: {
            staff: staff.map((item) => item.name).filter(Boolean),
            projects: projects.map((item) => item.name).filter(Boolean),
        },
        backups: backupList || [],
        chartData: (staffReport || []).slice(0, 8).map((item, index) => ({
            rank: `#${String(index + 1).padStart(2, '0')}`,
            name: item.staffName,
            value: Number(item.total.toFixed(2)),
        })),
        recentLogs: (currentLogs || []).slice(0, 8),
    };
}

function DashboardTooltip({ active, payload, label }) {
    if (!active || !payload?.length) {
        return null;
    }

    return (
        <div className="card" style={{ padding: '14px 16px', minWidth: '180px' }}>
            <div className="panel-eyebrow">Production Node</div>
            <div className="panel-title" style={{ fontSize: '0.95rem', marginTop: '4px' }}>{label}</div>
            <div className="metric-value neon" style={{ fontSize: '1.6rem', marginTop: '10px' }}>
                {formatCurrency(payload[0].value)}
            </div>
        </div>
    );
}

const EMPTY_QUICK_FORM = {
    workDate: new Date().toISOString().slice(0, 10),
    projectName: '',
    testContent: '',
    quantity: '',
    unit: '',
    staffNames: '',
    remarks: '',
};

const METRIC_LINKS = [
    { key: 'staff', label: 'Registered Personnel', note: '检测团队在线人员总数', valueClass: 'neon', href: '/master/staff' },
    { key: 'projects', label: 'Total Projects', note: '当前纳入监测的项目数量', valueClass: 'magenta', href: '/master/projects' },
    { key: 'workLogs', label: 'Cumulative Records', note: '累计入库的工作记录条数', valueClass: 'success', href: '/worklog' },
    { key: 'contracts', label: 'Archived Contracts', note: '已归档合同与价目表总数', valueClass: 'warning', href: '/contracts' },
];

const QUICK_LINKS = [
    { code: 'CTR', tag: 'Batch', tagClass: 'status-badge--pending', href: '/contracts', title: '上传合同', note: '进入合同批量导入、OCR 识别和人工复核页。' },
    { code: 'RPT', tag: 'Glow', tagClass: 'status-badge--approved', href: '/reports', title: '产值图谱', note: '查看收入趋势、排名、项目分布和导出入口。' },
    { code: 'NXS', tag: 'Secure', tagClass: 'status-badge--rejected', href: '/nexus', title: 'System Nexus', note: '查看系统健康度、备份状态与数据库入口。' },
];

export default function DashboardPage() {
    const [currentMonth] = useState(() => getCurrentMonthString());
    const [stats, setStats] = useState({ staff: 0, projects: 0, workLogs: 0, contracts: 0 });
    const [chartData, setChartData] = useState([]);
    const [recentLogs, setRecentLogs] = useState([]);
    const [backups, setBackups] = useState([]);
    const [catalog, setCatalog] = useState({ staff: [], projects: [] });
    const [loading, setLoading] = useState(true);
    const [isQuickOpen, setIsQuickOpen] = useState(false);
    const [submittingQuick, setSubmittingQuick] = useState(false);
    const [creatingBackup, setCreatingBackup] = useState(false);
    const [quickForm, setQuickForm] = useState(EMPTY_QUICK_FORM);
    const [message, setMessage] = useState(null);

    const loadDashboard = async () => {
        setLoading(true);
        try {
            const nextState = await loadDashboardState(currentMonth);
            setStats(nextState.stats);
            setCatalog(nextState.catalog);
            setBackups(nextState.backups);
            setChartData(nextState.chartData);
            setRecentLogs(nextState.recentLogs);
            setMessage(null);
        } catch (error) {
            setMessage({ type: 'danger', text: `控制台数据加载失败：${error.message}` });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let cancelled = false;

        setLoading(true);
        loadDashboardState(currentMonth)
            .then((nextState) => {
                if (cancelled) {
                    return;
                }

                setStats(nextState.stats);
                setCatalog(nextState.catalog);
                setBackups(nextState.backups);
                setChartData(nextState.chartData);
                setRecentLogs(nextState.recentLogs);
                setMessage(null);
            })
            .catch((error) => {
                if (!cancelled) {
                    setMessage({ type: 'danger', text: `控制台数据加载失败：${error.message}` });
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [currentMonth]);

    const handleQuickSubmit = async (event) => {
        event.preventDefault();
        setSubmittingQuick(true);

        try {
            const quantityField = quickForm.unit
                ? `${quickForm.quantity}${quickForm.unit}`
                : String(quickForm.quantity || '');

            const rawText = [
                quickForm.workDate,
                quickForm.projectName,
                quickForm.testContent,
                quantityField,
                quickForm.staffNames,
                quickForm.remarks,
            ].join('\t');

            const response = await fetch('/api/worklog', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rawText }),
            });
            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload.error || '提交失败');
            }

            setQuickForm(EMPTY_QUICK_FORM);
            setIsQuickOpen(false);
            if (payload.pendingAllocations?.length > 0) {
                setMessage({
                    type: 'danger',
                    text: `本次录入有 ${payload.pendingAllocations.length} 条面积合同记录待确认占比，请到工作记录页补完后再核算产值。`,
                });
            } else {
                setMessage({ type: 'success', text: `记录已初始化，本次入库 ${payload.saved || 0} 条。` });
            }
            await loadDashboard();
        } catch (error) {
            setMessage({ type: 'danger', text: `快速录入失败：${error.message}` });
        } finally {
            setSubmittingQuick(false);
        }
    };

    const handleCreateBackup = async () => {
        setCreatingBackup(true);

        try {
            const response = await fetch('/api/backup', { method: 'POST' });
            const payload = await response.json();
            if (!response.ok || !payload.success) {
                throw new Error(payload.error || '备份失败');
            }

            setMessage({ type: 'success', text: `备份已归档：${payload.fileName}` });
            setBackups(await fetchJson('/api/backup'));
        } catch (error) {
            setMessage({ type: 'danger', text: `备份失败：${error.message}` });
        } finally {
            setCreatingBackup(false);
        }
    };

    return (
        <>
            <div className="page-header">
                <div>
                    <div className="page-kicker">Realtime Command Layer</div>
                    <h2>控制台</h2>
                    <p className="page-desc">
                        把项目、人员、工作记录、合同和备份状态压缩成一张可实时操作的总览面板。
                        关键卡片和快捷入口都可以直接点按，跳转到对应业务位置。
                    </p>
                </div>
                <div className="page-actions">
                    <button className="btn btn-primary" onClick={() => setIsQuickOpen(true)}>录入每日工作</button>
                    <button className="btn btn-accent" onClick={handleCreateBackup} disabled={creatingBackup}>
                        {creatingBackup ? 'Creating Vault' : '立即备份'}
                    </button>
                </div>
            </div>

            <div className="page-body">
                {message ? (
                    <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-danger'}`}>
                        {message.text}
                    </div>
                ) : null}

                <div className="metric-grid">
                    {METRIC_LINKS.map((item) => (
                        <Link key={item.key} href={item.href} className="metric-card dashboard-jump">
                            <div className="metric-label">{item.label}</div>
                            <div className={`metric-value ${item.valueClass}`}>{stats[item.key]}</div>
                            <div className="metric-meta">{item.note}</div>
                        </Link>
                    ))}
                </div>

                <div className="dashboard-grid">
                    <section className="chart-panel">
                        <div className="panel-top">
                            <div className="panel-copy">
                                <div className="panel-eyebrow">Production Ranking</div>
                                <div className="panel-title">{currentMonth} 人员产值全息曲线</div>
                                <div className="panel-note">图表区域右上角和空状态都会映射到报表页面。</div>
                            </div>
                            <Link href="/reports" className="btn btn-secondary">进入报表中心</Link>
                        </div>

                        {loading ? (
                            <div className="empty-state">
                                <div>
                                    <div className="empty-dot" />
                                    <strong>Tracing Liquid Layers</strong>
                                    正在同步本月的产值节点。
                                </div>
                            </div>
                        ) : chartData.length === 0 ? (
                            <Link href="/reports" className="empty-state dashboard-empty-link">
                                <div>
                                    <div className="empty-dot" />
                                    <strong>Awaiting Data Node Connection</strong>
                                    当前月份还没有可渲染的产值数据，点击进入报表页查看明细。
                                </div>
                            </Link>
                        ) : (
                            <div style={{ width: '100%', height: 360 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={chartData} margin={{ top: 18, right: 12, left: -10, bottom: 8 }}>
                                        <defs>
                                            <linearGradient id="dashboardArea" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#b9ecff" stopOpacity={0.88} />
                                                <stop offset="88%" stopColor="#b9ecff" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                                        <XAxis
                                            dataKey="name"
                                            tick={{ fill: '#d6e6f7', fontSize: 12 }}
                                            axisLine={false}
                                            tickLine={false}
                                        />
                                        <YAxis
                                            tick={{ fill: '#d6e6f7', fontSize: 12 }}
                                            axisLine={false}
                                            tickLine={false}
                                            tickFormatter={(value) => `¥${Math.round(value)}`}
                                        />
                                        <Tooltip content={<DashboardTooltip />} />
                                        <Area
                                            type="monotone"
                                            dataKey="value"
                                            stroke="#b9ecff"
                                            strokeWidth={3}
                                            fill="url(#dashboardArea)"
                                            dot={{ r: 3, strokeWidth: 2, fill: '#12203a', stroke: '#b9ecff' }}
                                            activeDot={{ r: 6, fill: '#b9ecff', stroke: '#ffc0dd', strokeWidth: 2 }}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </section>

                    <aside className="feed-panel">
                        <div className="panel-top">
                            <div className="panel-copy">
                                <div className="panel-eyebrow">Work Dynamics</div>
                                <div className="panel-title">最新工作动态</div>
                                <div className="panel-note">每条记录都可以点击，跳到工作记录页继续处理。</div>
                            </div>
                            <Link href="/worklog" className="btn btn-secondary">查看总账</Link>
                        </div>

                        {loading ? (
                            <div className="empty-state">
                                <div>
                                    <div className="empty-dot" />
                                    <strong>Syncing Recent Logs</strong>
                                    正在拉取最新工作记录。
                                </div>
                            </div>
                        ) : recentLogs.length === 0 ? (
                            <Link href="/worklog" className="empty-state dashboard-empty-link">
                                <div>
                                    <div className="empty-dot" />
                                    <strong>Awaiting Data Node Connection</strong>
                                    当前还没有工作动态，点击进入工作记录页开始录入。
                                </div>
                            </Link>
                        ) : (
                            <div className="holo-feed">
                                {recentLogs.map((log) => {
                                    const staffNames = (log.staffMembers || []).map((item) => item.staff?.name).filter(Boolean);
                                    return (
                                        <Link key={log.id} href="/worklog" className="feed-item dashboard-feed-link">
                                            <div className="feed-item-head">
                                                <div>
                                                    <div className="feed-item-title">{log.project?.name || '未绑定项目'}</div>
                                                    <div className="feed-item-meta">{new Date(log.workDate).toLocaleDateString('zh-CN')}</div>
                                                </div>
                                                <span className="status-badge status-badge--approved">Approved</span>
                                            </div>
                                            <div className="feed-item-content">
                                                <div>
                                                    <div>{log.testContent}</div>
                                                    <div className="feed-item-meta">
                                                        {log.quantity}{log.unit || ''} / {staffNames.join('、') || '未绑定人员'}
                                                    </div>
                                                </div>
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>
                        )}
                    </aside>
                </div>

                <div className="card">
                    <div className="panel-top">
                        <div className="panel-copy">
                            <div className="panel-eyebrow">Quick Start</div>
                            <div className="panel-title">快速开始</div>
                            <div className="panel-note">每个快捷动作都映射到对应业务位置，避免在页面之间盲切。</div>
                        </div>
                    </div>

                    <div className="quick-grid">
                        <button className="quick-action" onClick={() => setIsQuickOpen(true)}>
                            <div className="quick-action-top">
                                <span className="quick-action-code">LOG</span>
                                <span className="status-badge status-badge--approved">Live</span>
                            </div>
                            <div>
                                <div className="quick-action-title">录入每日工作</div>
                                <div className="quick-action-note">直接弹出快速录入窗口，提交后立即刷新累计记录卡片。</div>
                            </div>
                        </button>

                        {QUICK_LINKS.map((item) => (
                            <Link key={item.code} href={item.href} className="quick-action">
                                <div className="quick-action-top">
                                    <span className="quick-action-code">{item.code}</span>
                                    <span className={`status-badge ${item.tagClass}`}>{item.tag}</span>
                                </div>
                                <div>
                                    <div className="quick-action-title">{item.title}</div>
                                    <div className="quick-action-note">
                                        {item.code === 'NXS'
                                            ? `${item.note} 最近备份：${backups[0] ? formatDateTime(backups[0].createdAt) : '暂无'}`
                                            : item.note}
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            </div>

            {isQuickOpen ? (
                <div className="modal-backdrop" onClick={() => setIsQuickOpen(false)}>
                    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <div className="page-kicker">Quick Log Initialization</div>
                                <div className="modal-title">录入每日工作</div>
                                <div className="modal-note">直接在控制台录入单条工作记录，提交后累计记录卡片会立刻刷新。</div>
                            </div>
                            <button className="btn btn-secondary" onClick={() => setIsQuickOpen(false)}>关闭</button>
                        </div>

                        <form onSubmit={handleQuickSubmit}>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label htmlFor="quick-date">工作日期</label>
                                    <input
                                        id="quick-date"
                                        className="form-input"
                                        type="date"
                                        value={quickForm.workDate}
                                        onChange={(event) => setQuickForm((current) => ({ ...current, workDate: event.target.value }))}
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="quick-project">工程项目</label>
                                    <input
                                        id="quick-project"
                                        className="form-input"
                                        list="dashboard-project-list"
                                        value={quickForm.projectName}
                                        onChange={(event) => setQuickForm((current) => ({ ...current, projectName: event.target.value }))}
                                        placeholder="输入项目名称"
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="quick-content">检测内容</label>
                                    <input
                                        id="quick-content"
                                        className="form-input"
                                        value={quickForm.testContent}
                                        onChange={(event) => setQuickForm((current) => ({ ...current, testContent: event.target.value }))}
                                        placeholder="例如：轻型动力触探"
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="quick-staff">执行人员</label>
                                    <input
                                        id="quick-staff"
                                        className="form-input"
                                        list="dashboard-staff-list"
                                        value={quickForm.staffNames}
                                        onChange={(event) => setQuickForm((current) => ({ ...current, staffNames: event.target.value }))}
                                        placeholder="张三、李四"
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="quick-quantity">数量</label>
                                    <input
                                        id="quick-quantity"
                                        className="form-input"
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={quickForm.quantity}
                                        onChange={(event) => setQuickForm((current) => ({ ...current, quantity: event.target.value }))}
                                        placeholder="例如：10"
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="quick-unit">单位</label>
                                    <input
                                        id="quick-unit"
                                        className="form-input"
                                        value={quickForm.unit}
                                        onChange={(event) => setQuickForm((current) => ({ ...current, unit: event.target.value }))}
                                        placeholder="例如：点 / 组 / 根"
                                    />
                                </div>
                            </div>

                            <div className="form-group mt-4">
                                <label htmlFor="quick-remarks">备注 / 部位</label>
                                <textarea
                                    id="quick-remarks"
                                    className="form-textarea"
                                    value={quickForm.remarks}
                                    onChange={(event) => setQuickForm((current) => ({ ...current, remarks: event.target.value }))}
                                    placeholder="例如：2#楼地下室、东侧基坑"
                                />
                            </div>

                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setIsQuickOpen(false)}>取消</button>
                                <button type="submit" className="btn btn-primary" disabled={submittingQuick}>
                                    {submittingQuick ? 'Initializing' : '提交记录'}
                                </button>
                            </div>
                        </form>

                        <datalist id="dashboard-project-list">
                            {catalog.projects.map((item) => <option key={item} value={item} />)}
                        </datalist>
                        <datalist id="dashboard-staff-list">
                            {catalog.staff.map((item) => <option key={item} value={item} />)}
                        </datalist>
                    </div>
                </div>
            ) : null}
        </>
    );
}
