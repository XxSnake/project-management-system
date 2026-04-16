'use client';

import { buildProjectDisplayName } from '@/lib/projectDisplayName';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

const COLUMNS = [
    { key: 'testItem', label: '检测项目' },
    { key: 'contractQty', label: '合同数量' },
    { key: 'unitPrice', label: '单价' },
    { key: 'quantityText', label: '已检数量' },
    { key: 'detectDate', label: '检测时间', type: 'date' },
    { key: 'mainTester', label: '检测人员' },
    { key: 'reportNo', label: '报告编号' },
    { key: 'remarks', label: '备注' },
];

// Editable fields in detection records
const EDITABLE_KEYS = ['testItem', 'quantityText', 'detectDate', 'mainTester', 'reportNo', 'remarks'];

const DRIFT_FIELDS = {
    testItem: 'srcTestItem',
    quantityText: 'srcQuantityText',
    detectDate: 'srcDetectDate',
    mainTester: 'srcMainTester',
};

const CONTRACT_GROUP_PHASE_PLACEHOLDER = '例如：一标段-新梅和收集站';

function normalizeText(value) {
    return String(value ?? '').trim();
}

function toDateInputValue(v) {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateDisplay(v) {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

function formatNumber(value) {
    return Number(value || 0).toFixed(2).replace(/\.?0+$/u, '');
}

function formatCurrency(value) {
    return `¥${Number(value || 0).toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function getWorklogStaffNames(log) {
    return (log?.staffMembers || [])
        .map((item) => item.staff?.name)
        .filter(Boolean);
}

function formatWorklogQuantity(log) {
    const quantity = Number(log?.quantity || 0);
    const unit = log?.unit || '';
    return `${formatNumber(quantity)}${unit}`;
}

function isFieldDrifted(record, colKey) {
    const srcKey = DRIFT_FIELDS[colKey];
    if (!srcKey) return false;
    if (colKey === 'detectDate') {
        const a = record[colKey] ? new Date(record[colKey]).getTime() : 0;
        const b = record[srcKey] ? new Date(record[srcKey]).getTime() : 0;
        return a !== b;
    }
    return (record[colKey] || '') !== (record[srcKey] || '');
}

// Match a detection record's testItem to a contract price item
function findPriceItem(priceItems, testItem) {
    if (!testItem || !priceItems || priceItems.length === 0) return null;
    const normalized = testItem.trim();
    return priceItems.find((p) => p.testItemName === normalized)
        || priceItems.find((p) => normalized.includes(p.testItemName) || p.testItemName.includes(normalized))
        || null;
}

const CONTRACT_DETAIL_TABLE_MIN_WIDTH = 980;
const CONTRACT_DETAIL_TEXT_CELL_STYLE = {
    minWidth: 320,
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    lineHeight: 1.6,
};
const CONTRACT_DETAIL_CATEGORY_CELL_STYLE = {
    minWidth: 140,
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    lineHeight: 1.6,
};
const CONTRACT_DETAIL_NUMERIC_CELL_STYLE = {
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
};
const WORKLOG_TEXT_CELL_STYLE = {
    minWidth: 220,
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    lineHeight: 1.6,
};
const WORKLOG_META_CELL_STYLE = {
    minWidth: 160,
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    lineHeight: 1.6,
};

function extractProjectBaseName(projectName) {
    const normalized = normalizeText(projectName);
    if (!normalized) {
        return '';
    }

    const bracketIndex = normalized.search(/[（(]/u);
    const dashIndex = normalized.search(/[-—–]/u);
    let cutIndex = -1;

    if (bracketIndex >= 0 && dashIndex >= 0) {
        cutIndex = Math.min(bracketIndex, dashIndex);
    } else {
        cutIndex = Math.max(bracketIndex, dashIndex);
    }

    if (cutIndex <= 0) {
        return normalized;
    }

    return normalizeText(normalized.slice(0, cutIndex));
}

function getSuggestedParentName(projects = []) {
    if (!Array.isArray(projects) || projects.length === 0) {
        return '';
    }

    const candidateMap = new Map();
    for (const item of projects) {
        const fallbackName = normalizeText(item?.name);
        const candidate = extractProjectBaseName(fallbackName) || fallbackName;
        if (!candidate) {
            continue;
        }

        const current = candidateMap.get(candidate) || { count: 0, length: candidate.length };
        current.count += 1;
        candidateMap.set(candidate, current);
    }

    return Array.from(candidateMap.entries())
        .sort((left, right) => {
            if (right[1].count !== left[1].count) {
                return right[1].count - left[1].count;
            }
            if (right[1].length !== left[1].length) {
                return right[1].length - left[1].length;
            }
            return left[0].localeCompare(right[0], 'zh-CN');
        })[0]?.[0] || normalizeText(projects[0]?.name);
}

function extractPhasePlaceholder(projectName, parentName = '') {
    const normalizedName = normalizeText(projectName);
    if (!normalizedName) {
        return '';
    }

    const normalizedParentName = normalizeText(parentName);
    let remainder = normalizedName;

    if (normalizedParentName && normalizedName.startsWith(normalizedParentName)) {
        remainder = normalizedName.slice(normalizedParentName.length);
    } else {
        const baseName = extractProjectBaseName(normalizedName);
        if (baseName && normalizedName.startsWith(baseName)) {
            remainder = normalizedName.slice(baseName.length);
        }
    }

    remainder = remainder
        .replace(/^[\s\-—–:：]+/u, '')
        .replace(/项目$/u, '')
        .trim();

    const bracketMatch = remainder.match(/^[（(]([^（）()]+)[）)]/u);
    if (bracketMatch) {
        const rest = remainder
            .slice(bracketMatch[0].length)
            .replace(/^[\s\-—–:：]+/u, '')
            .replace(/项目$/u, '')
            .trim();
        return rest ? `${bracketMatch[1]}-${rest}` : bracketMatch[1];
    }

    return remainder;
}

function buildContractGroupLabel(item, parentName = '') {
    return normalizeText(item?.phase)
        || extractPhasePlaceholder(item?.name, parentName)
        || buildProjectDisplayName(item)
        || `项目 #${item?.id ?? '-'}`;
}

function sumContractGroupWorkLogs(projects = []) {
    return projects.reduce((sum, item) => sum + (item?._count?.workLogs || item?.workLogs?.length || 0), 0);
}

export default function ProjectDetailPage() {
    const router = useRouter();
    const params = useParams();
    const projectId = params?.id;
    const numericProjectId = Number.parseInt(projectId, 10);
    const [project, setProject] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showAddRecord, setShowAddRecord] = useState(false);
    const [newRecord, setNewRecord] = useState({});
    const [viewingContract, setViewingContract] = useState(null);
    const [groupParentName, setGroupParentName] = useState('');
    const [groupPhases, setGroupPhases] = useState([]);
    const [groupSaving, setGroupSaving] = useState(false);
    const [groupMessage, setGroupMessage] = useState({ type: '', text: '' });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/projects/${projectId}`, { cache: 'no-store' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '加载失败');
            setProject(data);
            setError('');
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        if (projectId) void load();
    }, [projectId, load]);

    useEffect(() => {
        setGroupMessage({ type: '', text: '' });
    }, [projectId]);

    useEffect(() => {
        const siblingProjects = project?.siblingProjects || [];
        if (siblingProjects.length === 0) {
            setGroupParentName('');
            setGroupPhases([]);
            return;
        }

        setGroupParentName(getSuggestedParentName(siblingProjects) || normalizeText(project?.name));
        setGroupPhases(siblingProjects.map((item) => ({
            id: item.id,
            phase: normalizeText(item.phase),
        })));
    }, [project]);

    const handleSaveCell = async (record, key, value) => {
        const original = key === 'detectDate' ? toDateInputValue(record[key]) : (record[key] || '');
        if (value === original) return;
        const payload = { [key]: value || null };
        const res = await fetch(`/api/projects/${projectId}/detection-records/${record.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || '保存失败');
            return;
        }
        await load();
    };

    const handleDeleteRecord = async (record) => {
        if (!confirm('确认删除这条记录？')) return;
        const res = await fetch(`/api/projects/${projectId}/detection-records/${record.id}`, { method: 'DELETE' });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || '删除失败');
            return;
        }
        await load();
    };

    const handleAddRecord = async () => {
        const payload = { ...newRecord, projectId: Number(projectId) };
        const res = await fetch(`/api/projects/${projectId}/detection-records`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || '新增失败');
            return;
        }
        setNewRecord({});
        setShowAddRecord(false);
        await load();
    };

    const handleGroupPhaseChange = (targetId, value) => {
        setGroupPhases((current) => current.map((item) => (
            item.id === targetId ? { ...item, phase: value } : item
        )));
        setGroupMessage({ type: '', text: '' });
    };

    const handleApplyParentName = () => {
        const nextParentName = normalizeText(groupParentName);
        if (!nextParentName) {
            alert('请先填写大项目名称');
            return;
        }

        if (!confirm(`保存后会把这组项目统一成“${nextParentName}”，继续吗？`)) {
            return;
        }

        setGroupMessage({
            type: 'warning',
            text: `本次保存会把同合同项目统一改成“${nextParentName}”，点“保存全部修改”后才会正式生效。`,
        });
    };

    const handleSaveContractGroup = async (contractId, siblingProjects) => {
        const parentName = normalizeText(groupParentName);
        if (!parentName) {
            alert('请先填写大项目名称');
            return;
        }

        const payloadProjects = siblingProjects.map((item) => {
            const draftPhase = groupPhases.find((draft) => draft.id === item.id)?.phase ?? '';
            return {
                id: item.id,
                phase: normalizeText(draftPhase) || null,
            };
        });

        if (payloadProjects.filter((item) => !item.phase).length > 1) {
            alert('当前有多个项目的子项仍为空。统一大项目名称后会出现重名，请先补齐子项。');
            return;
        }

        if (!confirm(`确认保存合同项目组的整理结果吗？这次会同时更新 ${payloadProjects.length} 个项目。`)) {
            return;
        }

        try {
            setGroupSaving(true);
            setGroupMessage({ type: '', text: '' });

            const res = await fetch('/api/projects/batch-rename', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contractId,
                    parentName,
                    projects: payloadProjects,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || '保存失败');
            }

            await load();
            setGroupMessage({
                type: 'success',
                text: `已保存 ${payloadProjects.length} 个项目的大项目名称和子项。`,
            });
        } catch (e) {
            setGroupMessage({
                type: 'danger',
                text: e.message || '保存失败',
            });
        } finally {
            setGroupSaving(false);
        }
    };

    if (loading) return <div className="page-body">加载中…</div>;
    if (error) return <div className="page-body"><div className="card">错误：{error}</div></div>;
    if (!project) return null;

    const contract = project.contract;
    const priceItems = contract?.priceItems || [];
    const records = project.detectionRecords || [];
    const workLogs = project.workLogs || [];
    const buildingSummaries = project.buildingSummaries || [];
    const siblingProjects = project.siblingProjects || [];
    const hasContractGroup = Boolean(contract?.id) && siblingProjects.length > 1;
    const groupParentSuggestion = getSuggestedParentName(siblingProjects) || normalizeText(project.name);
    const normalizedGroupParentName = normalizeText(groupParentName) || groupParentSuggestion;
    const currentProjectWorklogTitle = hasContractGroup ? '当前项目工作记录' : '全部工作记录';
    const currentProjectWorklogNote = hasContractGroup
        ? '上面的“合同项目组汇总”会把同合同下的其他子项一起列出来；这里保留当前项目自身的完整工作记录，方便你单独核对。'
        : '这里显示该项目下的完整工作记录。下方“检测与报告记录”是整理后的明细，不等于全部工作记录。';

    return (
        <>
            <div className="page-header">
                <div>
                    <div className="page-kicker">Project Detail</div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        {project.name}
                        {project.buildingMode ? <span className="badge badge-info">单体建筑模式</span> : null}
                        {contract ? (
                            <button
                                type="button"
                                onClick={() => setViewingContract(contract)}
                                className="badge badge-info"
                                style={{ fontSize: '0.7rem', cursor: 'pointer', textDecoration: 'none', fontWeight: 500, border: 'none', background: 'none' }}
                                title="点击查看合同检测项目"
                            >
                                <span className="badge badge-info">{contract.contractNo}</span>
                            </button>
                        ) : (
                            <a
                                href={`/contracts?projectId=${projectId}&projectName=${encodeURIComponent(project.name)}`}
                                onClick={(e) => { e.preventDefault(); router.push(`/contracts?projectId=${projectId}&projectName=${encodeURIComponent(project.name)}`); }}
                                className="badge badge-warning"
                                style={{ fontSize: '0.7rem', cursor: 'pointer', textDecoration: 'none', fontWeight: 500 }}
                            >
                                未关联合同
                            </a>
                        )}
                    </h2>
                    <p className="page-desc">
                        状态：{project.status}
                        {project.phase ? ` · 阶段/子项：${project.phase}` : ''}
                        {project.buildingMode ? ' · 单体建筑模式已开启' : ''}
                        {contract?.clientName ? ` · 甲方：${contract.clientName}` : ''}
                    </p>
                </div>
                <div className="page-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => router.push('/master/projects')}>返回列表</button>
                    <button type="button" className="btn btn-secondary" onClick={() => void load()}>刷新</button>
                    <button type="button" className="btn btn-primary" onClick={() => setShowAddRecord(!showAddRecord)}>{showAddRecord ? '取消添加' : '添加记录'}</button>
                </div>
            </div>

            <div className="page-body">
                {project.buildingMode && (
                    <section className="table-shell" style={{ marginBottom: 16 }}>
                        <div className="card-header">
                            <div className="card-copy">
                                <div className="panel-eyebrow">Building Summary</div>
                                <div className="panel-title">本项目下的单体建筑列表</div>
                                <div className="panel-note">这里按单体建筑汇总工作记录条数和当前累计产值。未填写单体建筑的记录仍保留在项目主账下。</div>
                            </div>
                        </div>
                        <div className="data-table-shell" style={{ overflowX: 'auto' }}>
                            <table className="data-table" style={{ minWidth: 620 }}>
                                <thead>
                                    <tr>
                                        <th style={{ width: 70 }}>序号</th>
                                        <th>单体建筑</th>
                                        <th style={{ width: 140 }}>工作记录数</th>
                                        <th style={{ width: 180 }}>累计产值</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {buildingSummaries.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '28px 0' }}>
                                                暂无单体建筑记录
                                            </td>
                                        </tr>
                                    ) : buildingSummaries.map((item, index) => (
                                        <tr key={item.buildingName}>
                                            <td style={{ textAlign: 'center', color: 'var(--color-muted)' }}>{index + 1}</td>
                                            <td>{item.buildingName}</td>
                                            <td>{item.workLogCount} 条</td>
                                            <td>{formatCurrency(item.totalValue)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}

                {hasContractGroup && (
                    <section className="table-shell">
                        <div className="card-header">
                            <div className="card-copy">
                                <div className="panel-eyebrow">Contract Project Group</div>
                                <div className="panel-title">合同项目组</div>
                                <div className="panel-note">
                                    当前合同下共有 {siblingProjects.length} 个项目、{sumContractGroupWorkLogs(siblingProjects)} 条工作记录。
                                    你可以在这里统一整理大项目名称，再给每个子项分别命名。
                                </div>
                            </div>
                            <div className="page-actions">
                                <span className="badge badge-info">{contract?.contractNo || `合同 #${contract?.id}`}</span>
                            </div>
                        </div>

                        <div className="project-group-panel">
                            <div className="project-group-toolbar">
                                <div className="form-group project-group-parent-field">
                                    <label>大项目名称</label>
                                    <input
                                        className="form-input"
                                        value={groupParentName}
                                        placeholder={groupParentSuggestion || '请输入统一后的大项目名称'}
                                        onChange={(e) => {
                                            setGroupParentName(e.target.value);
                                            setGroupMessage({ type: '', text: '' });
                                        }}
                                    />
                                </div>
                                <button type="button" className="btn btn-secondary" onClick={handleApplyParentName}>统一修改</button>
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    disabled={groupSaving}
                                    onClick={() => void handleSaveContractGroup(contract.id, siblingProjects)}
                                >
                                    {groupSaving ? '保存中...' : '保存全部修改'}
                                </button>
                            </div>

                            {groupMessage.text ? (
                                <div className={`alert ${groupMessage.type === 'danger' ? 'alert-danger' : groupMessage.type === 'warning' ? 'alert-warning' : 'alert-success'}`}>
                                    {groupMessage.text}
                                </div>
                            ) : null}

                            <div className="project-group-list">
                                {siblingProjects.map((item) => {
                                    const phaseDraft = groupPhases.find((draft) => draft.id === item.id)?.phase ?? '';
                                    const phasePlaceholder = extractPhasePlaceholder(item.name, normalizedGroupParentName) || CONTRACT_GROUP_PHASE_PLACEHOLDER;
                                    const currentDisplayName = buildProjectDisplayName(item);
                                    const nextDisplayName = buildProjectDisplayName(normalizedGroupParentName || item.name, normalizeText(phaseDraft) || null)
                                        || normalizedGroupParentName
                                        || item.name;

                                    return (
                                        <div
                                            key={item.id}
                                            className={`project-group-row${item.id === numericProjectId ? ' project-group-row--current' : ''}`}
                                        >
                                            <div className="project-group-row-meta">
                                                <div className="project-group-row-head">
                                                    <span className="badge badge-info">#{item.id}</span>
                                                    {item.id === numericProjectId ? <span className="badge badge-warning">当前项目</span> : null}
                                                    <span className="badge badge-success">{item._count?.workLogs || item.workLogs?.length || 0} 条工作记录</span>
                                                </div>
                                                <div className="project-group-row-name">{currentDisplayName || '未命名项目'}</div>
                                                <div className="project-group-row-note">保存后：{nextDisplayName}</div>
                                            </div>
                                            <div className="form-group">
                                                <label>子项 / 阶段</label>
                                                <input
                                                    className="form-input"
                                                    value={phaseDraft}
                                                    placeholder={phasePlaceholder}
                                                    onChange={(e) => handleGroupPhaseChange(item.id, e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </section>
                )}

                {hasContractGroup && (
                    <section className="table-shell">
                        <div className="card-header">
                            <div className="card-copy">
                                <div className="panel-eyebrow">All Work Logs</div>
                                <div className="panel-title">全部工作记录（合同项目组汇总）</div>
                                <div className="panel-note">
                                    这里把同一合同下所有子项的工作记录放在一起，按子项分组展示，方便一次核对完整项目组。
                                </div>
                            </div>
                            <div className="page-actions">
                                <span className="badge badge-info">{sumContractGroupWorkLogs(siblingProjects)} 条</span>
                            </div>
                        </div>

                        <div className="project-group-worklogs">
                            {siblingProjects.map((item) => {
                                const groupLogs = item.workLogs || [];
                                const groupLabel = buildContractGroupLabel(item, normalizedGroupParentName || groupParentSuggestion);
                                return (
                                    <details key={item.id} className="project-group-log-card" open>
                                        <summary className="project-group-log-summary">
                                            <div>
                                                <div className="project-group-log-title">{groupLabel}</div>
                                                <div className="panel-note">
                                                    #{item.id}
                                                    {item.id === numericProjectId ? ' · 当前项目' : ''}
                                                    {item.buildingMode ? ' · 单体建筑模式' : ''}
                                                </div>
                                            </div>
                                            <span className="badge badge-success">{groupLogs.length} 条</span>
                                        </summary>

                                        <div className="data-table-shell" style={{ overflowX: 'auto' }}>
                                            <table className="data-table" style={{ minWidth: 1120, tableLayout: 'fixed' }}>
                                                <thead>
                                                    <tr>
                                                        <th style={{ width: 56 }}>序号</th>
                                                        <th style={{ width: 110 }}>日期</th>
                                                        <th style={{ width: 180 }}>单体建筑</th>
                                                        <th style={{ width: 260 }}>检测内容</th>
                                                        <th style={{ width: 120 }}>数量</th>
                                                        <th style={{ width: 180 }}>人员</th>
                                                        <th style={{ width: 260 }}>备注</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {groupLogs.length === 0 ? (
                                                        <tr>
                                                            <td colSpan={7} style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '28px 0' }}>
                                                                暂无工作记录
                                                            </td>
                                                        </tr>
                                                    ) : groupLogs.map((log, index) => {
                                                        const staffNames = getWorklogStaffNames(log);
                                                        return (
                                                            <tr key={`${item.id}-${log.id}`}>
                                                                <td style={{ textAlign: 'center', color: 'var(--color-muted)' }}>{index + 1}</td>
                                                                <td style={CONTRACT_DETAIL_NUMERIC_CELL_STYLE}>{formatDateDisplay(log.workDate) || '-'}</td>
                                                                <td style={WORKLOG_META_CELL_STYLE}>{log.buildingName || '-'}</td>
                                                                <td style={WORKLOG_TEXT_CELL_STYLE}>{log.testContent || '-'}</td>
                                                                <td style={CONTRACT_DETAIL_NUMERIC_CELL_STYLE}>{formatWorklogQuantity(log)}</td>
                                                                <td style={WORKLOG_META_CELL_STYLE}>{staffNames.length ? staffNames.join('、') : '-'}</td>
                                                                <td style={WORKLOG_TEXT_CELL_STYLE}>{log.remarks || '-'}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </details>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* Add Record Form */}
                {showAddRecord && (
                    <div className="card stack" style={{ padding: 16, marginBottom: 16 }}>
                        <div className="panel-note" style={{ marginBottom: 8 }}>手工添加一条检测记录</div>
                        <div className="form-grid">
                            {COLUMNS.filter((col) => EDITABLE_KEYS.includes(col.key)).map((col) => (
                                <div key={col.key} className="form-group">
                                    <label>{col.label}</label>
                                    <input
                                        className="form-input"
                                        type={col.type === 'date' ? 'date' : 'text'}
                                        value={newRecord[col.key] || ''}
                                        onChange={(e) => setNewRecord((prev) => ({ ...prev, [col.key]: e.target.value }))}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="page-actions" style={{ marginTop: 12 }}>
                            <button type="button" className="btn btn-primary" onClick={() => void handleAddRecord()}>确认添加</button>
                        </div>
                    </div>
                )}

                <section className="table-shell" style={{ marginBottom: 16 }}>
                    <div className="card-header">
                        <div className="card-copy">
                            <div className="panel-eyebrow">All Work Logs</div>
                            <div className="panel-title">{currentProjectWorklogTitle}</div>
                            <div className="panel-note">{currentProjectWorklogNote}</div>
                        </div>
                        <div className="page-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => router.push('/worklog')}>打开工作记录总账</button>
                        </div>
                    </div>
                    <div className="data-table-shell" style={{ overflowX: 'auto' }}>
                        <table className="data-table" style={{ minWidth: 1160, tableLayout: 'fixed' }}>
                            <thead>
                                <tr>
                                    <th style={{ width: 56 }}>序号</th>
                                    <th style={{ width: 110 }}>日期</th>
                                    <th style={{ width: 180 }}>单体建筑</th>
                                    <th style={{ width: 240 }}>检测内容</th>
                                    <th style={{ width: 110 }}>数量</th>
                                    <th style={{ width: 180 }}>人员</th>
                                    <th style={{ width: 260 }}>备注</th>
                                    <th style={{ width: 160 }}>明细状态</th>
                                </tr>
                            </thead>
                            <tbody>
                                {workLogs.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '32px 0' }}>
                                            暂无工作记录
                                        </td>
                                    </tr>
                                ) : workLogs.map((log, index) => {
                                    const staffNames = getWorklogStaffNames(log);
                                    return (
                                        <tr key={log.id}>
                                            <td style={{ textAlign: 'center', color: 'var(--color-muted)' }}>{index + 1}</td>
                                            <td style={CONTRACT_DETAIL_NUMERIC_CELL_STYLE}>{formatDateDisplay(log.workDate) || '-'}</td>
                                            <td style={WORKLOG_META_CELL_STYLE}>{log.buildingName || '-'}</td>
                                            <td style={WORKLOG_TEXT_CELL_STYLE}>{log.testContent || '-'}</td>
                                            <td style={CONTRACT_DETAIL_NUMERIC_CELL_STYLE}>{formatWorklogQuantity(log)}</td>
                                            <td style={WORKLOG_META_CELL_STYLE}>{staffNames.length ? staffNames.join('、') : '-'}</td>
                                            <td style={WORKLOG_TEXT_CELL_STYLE}>{log.remarks || '-'}</td>
                                            <td style={WORKLOG_META_CELL_STYLE}>
                                                {log.detectionRecord?.id ? `已同步 #${log.detectionRecord.sequence}` : '未同步到明细'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* Unified Table */}
                <section className="table-shell">
                    <div className="card-header">
                        <div className="card-copy">
                            <div className="panel-eyebrow">Detection &amp; Report Records</div>
                            <div className="panel-title">检测与报告记录</div>
                            <div className="panel-note">
                                直接点击单元格即可编辑。合同数量和单价从关联合同自动匹配。
                                {records.some((r) => Object.keys(DRIFT_FIELDS).some((k) => isFieldDrifted(r, k))) && (
                                    <span style={{ marginLeft: 8 }}><span style={{ color: '#e67e22', fontWeight: 600 }}>橙色背景</span>表示与工作记录原始数据不一致。</span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="data-table-shell">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th style={{ width: 50 }}>序号</th>
                                    {COLUMNS.map((c) => <th key={c.key}>{c.label}</th>)}
                                    <th style={{ width: 60 }}>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {records.length === 0 ? (
                                    <tr><td colSpan={COLUMNS.length + 2} style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '32px 0' }}>暂无记录，可通过工作记录自动同步或点击「添加记录」手工新增</td></tr>
                                ) : records.map((record) => {
                                    const matched = findPriceItem(priceItems, record.testItem);
                                    return (
                                        <tr key={record.id}>
                                            <td style={{ textAlign: 'center', color: 'var(--color-muted)', fontSize: '0.8rem' }}>{record.sequence}</td>
                                            {COLUMNS.map((col) => {
                                                // Contract fields: read-only, auto-matched
                                                if (col.key === 'contractQty') {
                                                    return <td key={col.key} style={{ color: matched ? 'inherit' : 'var(--color-muted)' }}>{matched ? `${matched.quantity ?? '-'} ${matched.unit || ''}`.trim() : '-'}</td>;
                                                }
                                                if (col.key === 'unitPrice') {
                                                    return <td key={col.key} style={{ color: matched ? 'inherit' : 'var(--color-muted)' }}>{matched ? `¥${Number(matched.unitPrice).toFixed(2)}` : '-'}</td>;
                                                }

                                                // Non-editable fields
                                                if (!EDITABLE_KEYS.includes(col.key)) {
                                                    return <td key={col.key}>{record[col.key] || '-'}</td>;
                                                }

                                                // Editable fields
                                                const drifted = isFieldDrifted(record, col.key);
                                                const cellStyle = drifted ? { background: '#ffe8cc' } : undefined;
                                                const title = drifted
                                                    ? `工作记录原值：${col.key === 'detectDate' ? formatDateDisplay(record[DRIFT_FIELDS[col.key]]) : (record[DRIFT_FIELDS[col.key]] || '(空)')}`
                                                    : undefined;

                                                if (col.type === 'date') {
                                                    return (
                                                        <td key={col.key} style={cellStyle} title={title}>
                                                            <input
                                                                type="date"
                                                                defaultValue={toDateInputValue(record[col.key])}
                                                                onBlur={(e) => void handleSaveCell(record, col.key, e.target.value)}
                                                                style={{ width: '100%', background: 'transparent', border: '1px dashed transparent', padding: 2 }}
                                                                onFocus={(e) => { e.target.style.border = '1px dashed var(--color-border)'; }}
                                                            />
                                                        </td>
                                                    );
                                                }
                                                return (
                                                    <td key={col.key} style={cellStyle} title={title}>
                                                        <input
                                                            type="text"
                                                            defaultValue={record[col.key] || ''}
                                                            onBlur={(e) => void handleSaveCell(record, col.key, e.target.value)}
                                                            style={{ width: '100%', background: 'transparent', border: '1px dashed transparent', padding: 2 }}
                                                            onFocus={(e) => { e.target.style.border = '1px dashed var(--color-border)'; }}
                                                        />
                                                    </td>
                                                );
                                            })}
                                            <td>
                                                <button type="button" className="btn btn-danger" style={{ minHeight: 28, padding: '0 8px', fontSize: '0.7rem' }} onClick={() => void handleDeleteRecord(record)}>删除</button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>

            {/* Contract Detail Dialog */}
            {viewingContract && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={() => setViewingContract(null)}>
                    <div className="card stack" style={{ width: 'min(96vw, 980px)', maxWidth: 980, padding: 24, maxHeight: '85vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
                        <div className="panel-eyebrow">Contract Detail</div>
                        <div className="panel-title" style={{ marginBottom: 4 }}>
                            {viewingContract.contractNo || `合同 #${viewingContract.id}`}
                        </div>
                        <div className="panel-note" style={{ marginBottom: 16, lineHeight: 1.7 }}>
                            {[viewingContract.clientName && `委托方：${viewingContract.clientName}`, viewingContract.partyB && `受托方：${viewingContract.partyB}`, viewingContract.signedDate && `签订日期：${new Date(viewingContract.signedDate).toLocaleDateString('zh-CN')}`, ({ area: `按面积计价 · 总价 ¥${Number(viewingContract.areaPricingAmount || 0).toLocaleString()} · 面积 ${viewingContract.areaPricingArea || '-'}`, mixed: `混合计费 · 面积部分 ¥${Number(viewingContract.areaPricingAmount || 0).toLocaleString()} · 面积 ${viewingContract.areaPricingArea || '-'}`, lumpsum: `包干价 · 总价 ¥${Number(viewingContract.lumpSumAmount || 0).toLocaleString()}` }[viewingContract.pricingMode] || '按单价计价')].filter(Boolean).join(' · ')}
                        </div>

                        {(viewingContract.priceItems || []).length > 0 ? (
                            <div className="data-table-shell" style={{ overflowX: 'auto', overflowY: 'auto' }}>
                                <table className="data-table" style={{ minWidth: CONTRACT_DETAIL_TABLE_MIN_WIDTH, tableLayout: 'fixed' }}>
                                    <thead>
                                        <tr>
                                            <th style={{ width: 50 }}>序号</th>
                                            <th style={{ width: 140 }}>检测类别</th>
                                            <th style={{ width: 320 }}>检测项目</th>
                                            <th style={{ width: 100 }}>数量</th>
                                            <th style={{ width: 90 }}>单位</th>
                                            <th style={{ width: 110 }}>单价</th>
                                            <th style={{ width: 130 }}>小计</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {viewingContract.priceItems.map((item, idx) => (
                                            <tr key={item.id || idx}>
                                                <td style={{ textAlign: 'center', color: 'var(--color-muted)' }}>{idx + 1}</td>
                                                <td style={CONTRACT_DETAIL_CATEGORY_CELL_STYLE}>{item.testCategory || '-'}</td>
                                                <td style={CONTRACT_DETAIL_TEXT_CELL_STYLE}>{item.testItemName || '-'}</td>
                                                <td style={CONTRACT_DETAIL_NUMERIC_CELL_STYLE}>{item.quantity ?? '-'}</td>
                                                <td style={CONTRACT_DETAIL_NUMERIC_CELL_STYLE}>{item.unit || '-'}</td>
                                                <td style={CONTRACT_DETAIL_NUMERIC_CELL_STYLE}>¥{Number(item.unitPrice || 0).toFixed(2)}</td>
                                                <td style={CONTRACT_DETAIL_NUMERIC_CELL_STYLE}>¥{((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)).toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr>
                                            <td colSpan={6} style={{ textAlign: 'right', fontWeight: 600 }}>合计</td>
                                            <td style={{ fontWeight: 600 }}>¥{viewingContract.priceItems.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0).toLocaleString()}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '24px 0' }}>该合同暂无检测项目清单</div>
                        )}

                        <div className="page-actions" style={{ marginTop: 16 }}>
                            <button type="button" className="btn btn-secondary" onClick={() => setViewingContract(null)}>关闭</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
