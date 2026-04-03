'use client';

import { useEffect, useState } from 'react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    PolarAngleAxis,
    PolarGrid,
    PolarRadiusAxis,
    Radar,
    RadarChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

function getMonthString(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function buildRecentMonths(length = 6) {
    return Array.from({ length }, (_, index) => {
        const date = new Date();
        date.setMonth(date.getMonth() - (length - index - 1));
        return getMonthString(date);
    });
}

function formatCurrency(value) {
    return `CNY ${Number(value || 0).toFixed(2)}`;
}

async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();
}

function ChartTooltip({ active, payload, label }) {
    if (!active || !payload?.length) {
        return null;
    }

    return (
        <div className="card" style={{ padding: '14px 16px' }}>
            <div className="panel-eyebrow">Data Sample</div>
            <div className="panel-title" style={{ fontSize: '0.92rem', marginTop: '4px' }}>{label}</div>
            <div className="metric-value neon" style={{ fontSize: '1.5rem', marginTop: '10px' }}>
                {payload[0].name?.includes('工作量') ? payload[0].value : formatCurrency(payload[0].value)}
            </div>
        </div>
    );
}

export default function ReportsPage() {
    const [month, setMonth] = useState(() => getMonthString(new Date()));
    const [staffData, setStaffData] = useState([]);
    const [projectData, setProjectData] = useState([]);
    const [trendData, setTrendData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const loadReports = async () => {
            setLoading(true);
            try {
                const recentMonths = buildRecentMonths(6);
                const [staffReport, projectReport, ...trendReports] = await Promise.all([
                    fetchJson(`/api/reports?groupBy=staff&month=${month}`),
                    fetchJson(`/api/reports?groupBy=project&month=${month}`),
                    ...recentMonths.map((item) => fetchJson(`/api/reports?groupBy=staff&month=${item}`)),
                ]);

                if (cancelled) {
                    return;
                }

                setStaffData(Array.isArray(staffReport) ? staffReport : []);
                setProjectData(Array.isArray(projectReport) ? projectReport : []);
                setTrendData(
                    recentMonths.map((item, index) => ({
                        month: item,
                        total: Number((trendReports[index] || []).reduce((sum, entry) => sum + Number(entry.total || 0), 0).toFixed(2)),
                    })),
                );
            } catch (error) {
                if (!cancelled) {
                    console.error('加载产值报表失败:', error);
                    setStaffData([]);
                    setProjectData([]);
                    setTrendData([]);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void loadReports();

        return () => {
            cancelled = true;
        };
    }, [month]);

    const totalRevenue = staffData.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const totalTestingValue = staffData.reduce((sum, item) => sum + Number(item.testingTotal || 0), 0);
    const totalReportValue = staffData.reduce((sum, item) => sum + Number(item.reportTotal || 0), 0);
    const totalWorkload = staffData.reduce((sum, item) => sum + Number(item.workloadQuantity || 0), 0);
    const pendingAreaCount = projectData.reduce((sum, item) => sum + Number(item.pendingAreaCount || 0), 0);
    const noContractCount = projectData.reduce((sum, item) => sum + Number(item.noContractCount || 0), 0);

    const topStaff = staffData.slice(0, 6).map((item) => ({
        name: item.staffName,
        total: Number(item.total.toFixed(2)),
        workload: Number(item.workloadQuantity.toFixed(2)),
    }));

    const radarData = projectData.slice(0, 6).map((item) => ({
        project: item.projectName.length > 10 ? `${item.projectName.slice(0, 10)}…` : item.projectName,
        value: Number(item.total.toFixed(2)),
    }));

    return (
        <>
            <div className="page-header">
                <div>
                    <div className="page-kicker">Revenue + Workload</div>
                    <h2>产值报表</h2>
                    <p className="page-desc">报表现在同时展示产值、人员工作量、待确认占比和未签合同记录，不再只看已计价的数据。</p>
                </div>
                <div className="page-actions">
                    <input
                        className="form-input"
                        type="month"
                        value={month}
                        onChange={(event) => setMonth(event.target.value)}
                        style={{ width: '170px' }}
                    />
                    <button className="btn btn-secondary" onClick={() => window.open(`/api/export?groupBy=staff&month=${month}`, '_blank')}>
                        导出汇总
                    </button>
                    <button className="btn btn-primary" onClick={() => window.open(`/api/export?groupBy=detail&month=${month}`, '_blank')}>
                        导出明细
                    </button>
                </div>
            </div>

            <div className="page-body">
                {(pendingAreaCount > 0 || noContractCount > 0) && (
                    <div className="alert alert-warning">
                        本月仍有 {pendingAreaCount} 条面积合同记录待确认占比，{noContractCount} 条记录所属项目尚未绑定合同；这些工作量已纳入统计，但部分产值仍待补全。
                    </div>
                )}

                <div className="report-kpis">
                    <div className="mini-kpi">
                        <div className="mini-kpi-label">月度产值合计</div>
                        <div className="mini-kpi-value">{formatCurrency(totalRevenue)}</div>
                    </div>
                    <div className="mini-kpi">
                        <div className="mini-kpi-label">检测工作产值</div>
                        <div className="mini-kpi-value">{formatCurrency(totalTestingValue)}</div>
                    </div>
                    <div className="mini-kpi">
                        <div className="mini-kpi-label">出具报告产值</div>
                        <div className="mini-kpi-value">{formatCurrency(totalReportValue)}</div>
                    </div>
                    <div className="mini-kpi">
                        <div className="mini-kpi-label">人员工作量</div>
                        <div className="mini-kpi-value">{totalWorkload.toFixed(2).replace(/\.?0+$/u, '')}</div>
                    </div>
                    <div className="mini-kpi">
                        <div className="mini-kpi-label">待确认占比</div>
                        <div className="mini-kpi-value">{pendingAreaCount}</div>
                    </div>
                    <div className="mini-kpi">
                        <div className="mini-kpi-label">未签合同记录</div>
                        <div className="mini-kpi-value">{noContractCount}</div>
                    </div>
                </div>

                <div className="report-grid">
                    <section className="chart-panel">
                        <div className="panel-top">
                            <div className="panel-copy">
                                <div className="panel-eyebrow">Monthly Revenue Chart</div>
                                <div className="panel-title">月度产值趋势</div>
                                <div className="panel-note">最近 6 个月的产值总量。</div>
                            </div>
                        </div>

                        {loading || trendData.length === 0 ? (
                            <div className="empty-state"><div><div className="empty-dot" /><strong>Tracing Revenue Bars</strong>正在生成趋势图。</div></div>
                        ) : (
                            <div style={{ width: '100%', height: 320 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={trendData} margin={{ top: 12, right: 8, left: -8, bottom: 2 }}>
                                        <defs>
                                            <linearGradient id="revenueBar" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#65B9FF" stopOpacity={0.95} />
                                                <stop offset="100%" stopColor="#65B9FF" stopOpacity={0.16} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                                        <XAxis dataKey="month" tick={{ fill: '#6B7280', fontSize: 12 }} axisLine={false} tickLine={false} />
                                        <YAxis tick={{ fill: '#6B7280', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(value) => `¥${Math.round(value)}`} />
                                        <Tooltip content={<ChartTooltip />} />
                                        <Bar dataKey="total" name="产值" fill="url(#revenueBar)" radius={[12, 12, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </section>

                    <section className="chart-panel">
                        <div className="panel-top">
                            <div className="panel-copy">
                                <div className="panel-eyebrow">Project Distribution Radar</div>
                                <div className="panel-title">项目产值分布</div>
                                <div className="panel-note">当前月份各项目产值分布，未计价项目会在下方矩阵里继续显示工作量。</div>
                            </div>
                        </div>

                        {loading || radarData.length === 0 ? (
                            <div className="empty-state"><div><div className="empty-dot" /><strong>No Project Echoes</strong>当前月份还没有可用于图表的项目产值。</div></div>
                        ) : (
                            <div style={{ width: '100%', height: 320 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <RadarChart data={radarData}>
                                        <PolarGrid stroke="rgba(255,255,255,0.09)" />
                                        <PolarAngleAxis dataKey="project" tick={{ fill: '#6B7280', fontSize: 11 }} />
                                        <PolarRadiusAxis tick={{ fill: '#9CA3AF', fontSize: 10 }} />
                                        <Radar name="产值" dataKey="value" stroke="#65B9FF" fill="rgba(101, 185, 255, 0.2)" fillOpacity={0.72} strokeWidth={2.2} />
                                    </RadarChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </section>

                    <section className="chart-panel">
                        <div className="panel-top">
                            <div className="panel-copy">
                                <div className="panel-eyebrow">Top Staff Output</div>
                                <div className="panel-title">人员产值排行</div>
                                <div className="panel-note">产值排序中同时保留每个人员的工作量信息。</div>
                            </div>
                        </div>

                        {loading || topStaff.length === 0 ? (
                            <div className="empty-state"><div><div className="empty-dot" /><strong>Awaiting Ranking Signal</strong>当前还没有人员数据。</div></div>
                        ) : (
                            <div style={{ width: '100%', height: 320 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={topStaff} layout="vertical" margin={{ top: 4, right: 12, left: 36, bottom: 4 }}>
                                        <defs>
                                            <linearGradient id="staffBar" x1="0" y1="0" x2="1" y2="0">
                                                <stop offset="0%" stopColor="#65B9FF" stopOpacity={0.95} />
                                                <stop offset="100%" stopColor="#65B9FF" stopOpacity={0.2} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                                        <XAxis type="number" tick={{ fill: '#6B7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                                        <YAxis type="category" dataKey="name" tick={{ fill: '#0F172A', fontSize: 12 }} axisLine={false} tickLine={false} width={96} />
                                        <Tooltip content={<ChartTooltip />} />
                                        <Bar dataKey="total" name="产值" fill="url(#staffBar)" radius={[0, 10, 10, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </section>

                    <section className="chart-panel">
                        <div className="panel-top">
                            <div className="panel-copy">
                                <div className="panel-eyebrow">Project Matrix</div>
                                <div className="panel-title">项目工作量矩阵</div>
                                <div className="panel-note">这里会保留未签合同项目和待确认占比项目，方便你补完产值链路。</div>
                            </div>
                        </div>

                        <div className="ranking-list">
                            {projectData.slice(0, 6).map((item, index) => (
                                <div key={`${item.projectId}-${index}`} className="ranking-item">
                                    <span className="ranking-index">{index + 1}</span>
                                    <div>
                                        <div className="ranking-name">{item.projectName}</div>
                                        <div className="ranking-meta">
                                            检测 {formatCurrency(item.testingTotal || 0)} / 报告 {formatCurrency(item.reportTotal || 0)} / 工作量 {item.workloadQuantity}
                                        </div>
                                    </div>
                                    <span className="value-text">{formatCurrency(item.total)}</span>
                                </div>
                            ))}
                            {!loading && projectData.length === 0 && (
                                <div className="empty-state"><div><div className="empty-dot" /><strong>No Project Matrix</strong>当前月份还没有项目汇总。</div></div>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </>
    );
}
